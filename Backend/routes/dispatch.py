from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional, List, Any, Dict
import google.generativeai as genai
import os
import re
import json
import smtplib
import uuid
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from scheduler import scheduler

from utils.db.dispatch_db import (
    get_sprints_by_company,
    get_sub_modules_by_sprint,
    get_assigned_users_for_sprint,
    get_sprint_image,
)
from utils.supabase_client import supabase

router = APIRouter(prefix="/api/dispatch", tags=["dispatch"])

# Configure Gemini
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))


# ── Request Models ──────────────────────────────────────────────

class GenerateEmailRequest(BaseModel):
    sprint_title: str
    sub_module_titles: List[str]
    engagement_question: Optional[str] = None
    scheduled_date: Optional[str] = None
    scheduled_time: Optional[str] = None
    sprint_image_url: Optional[str] = None


class SendEmailRequest(BaseModel):
    module_id: str
    subject: str
    body: str
    scheduled_date: Optional[str] = None
    scheduled_time: Optional[str] = None


class ScheduleEmailRequest(BaseModel):
    module_id: str
    subject: str
    body: str
    scheduled_date: str   # "YYYY-MM-DD"
    scheduled_time: str   # "HH:MM"


class NotifyEmailRequest(BaseModel):
    module_id: Optional[str] = None                           # For backward compatibility (single module)
    selected_content: List[str]   # e.g. ["flashcards", "audio"]
    scheduled_date: Optional[str] = None
    scheduled_time: Optional[str] = None
    customFlashcards: Optional[List[Dict[str, Any]]] = None   # overrides module flashcard_data
    customAudioUrl: Optional[str] = None                      # overrides module audio_url
    dry_run: bool = False                                     # True = build + return full HTML, no send
    blocks_only: bool = False                                 # True = return only the inner content block HTML
    module_ids: Optional[List[str]] = None                    # For multi-module: list of specific modules to include


# ── Content-block email builder ─────────────────────────────────

def build_content_blocks(
    module: Dict[str, Any],
    selected_content: List[str],
    custom_flashcards: Optional[List[Dict[str, Any]]] = None,
    custom_audio_url: Optional[str] = None,
) -> str:
    """Return only the inner HTML content blocks (flashcards + audio) with no email wrapper.
    Uses table-only layout — no divs — for full Outlook compatibility."""
    # ── Flashcard block ───────────────────────────────────────
    flashcard_html = ""
    if "flashcards" in selected_content:
        flashcard_data = custom_flashcards if custom_flashcards is not None else (module.get("flashcard_data") or [])
        if flashcard_data:
            cards = ""
            for card in flashcard_data:
                heading = card.get("heading", "")
                points = card.get("points") or []
                items = "".join(
                    f'<li style="margin-top:0;margin-bottom:4px;font-size:14px;'
                    f'color:#555555;font-family:Arial,sans-serif;">{p}</li>'
                    for p in points
                )
                cards += (
                    '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"'
                    ' style="border-collapse:collapse;margin-bottom:12px;">'
                    '<tr>'
                    '<td width="4" bgcolor="#7C6FFF"'
                    ' style="width:4px;background-color:#7C6FFF;font-size:1px;line-height:1px;">&nbsp;</td>'
                    '<td bgcolor="#F0EEFF"'
                    ' style="background-color:#F0EEFF;padding-top:16px;padding-bottom:16px;'
                    'padding-left:16px;padding-right:16px;">'
                    f'<p style="margin-top:0;margin-bottom:8px;font-size:15px;font-weight:700;'
                    f'color:#333333;font-family:Arial,sans-serif;">{heading}</p>'
                    f'<ul style="margin-top:0;margin-bottom:0;padding-left:18px;">{items}</ul>'
                    '</td>'
                    '</tr>'
                    '</table>'
                )
            flashcard_html = (
                '<p style="margin-top:0;margin-bottom:12px;font-size:16px;font-weight:700;'
                'color:#1E293B;font-family:Arial,sans-serif;">&#128218; Flashcards</p>'
                + cards
            )

    # ── Audio block ───────────────────────────────────────────
    audio_html = ""
    if "audio" in selected_content:
        audio_url = custom_audio_url if custom_audio_url is not None else module.get("audio_url", "")
        if audio_url:
            audio_html = (
                '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"'
                ' style="border-collapse:collapse;margin-bottom:16px;">'
                '<tr>'
                '<td bgcolor="#FEF3EC"'
                ' style="background-color:#FEF3EC;padding-top:16px;padding-bottom:16px;'
                'padding-left:16px;padding-right:16px;">'
                '<p style="margin-top:0;margin-bottom:6px;font-size:15px;font-weight:700;'
                'color:#333333;font-family:Arial,sans-serif;">&#127911; Audio Lesson</p>'
                '<p style="margin-top:0;margin-bottom:12px;font-size:13px;color:#666666;'
                'font-family:Arial,sans-serif;">Click below to listen to the full audio for this module.</p>'
                '<table role="presentation" border="0" cellpadding="0" cellspacing="0"'
                ' style="border-collapse:collapse;">'
                '<tr>'
                f'<td bgcolor="#E8824A"'
                f' style="background-color:#E8824A;padding-top:10px;padding-bottom:10px;'
                f'padding-left:20px;padding-right:20px;border-radius:6px;">'
                f'<a href="{audio_url}"'
                f' style="font-size:14px;font-weight:700;color:#ffffff;'
                f'font-family:Arial,sans-serif;text-decoration:none;display:inline-block;">'
                f'&#9654; Play Audio</a>'
                f'</td>'
                '</tr>'
                '</table>'
                '</td>'
                '</tr>'
                '</table>'
            )

    return flashcard_html + audio_html


def build_email_body(
    module: Dict[str, Any],
    selected_content: List[str],
    custom_flashcards: Optional[List[Dict[str, Any]]] = None,
    custom_audio_url: Optional[str] = None,
) -> str:
    """
    Build a fully Outlook/Gmail/Apple-Mail-compatible HTML email.
    Rules: tables only, inline styles, VML for rounded corners, no divs, no gradients.
    """
    title = module.get("title", "Your Training Module")
    content_blocks = build_content_blocks(module, selected_content, custom_flashcards, custom_audio_url)

    if not content_blocks:
        content_blocks = (
            '<p style="margin-top:0;margin-bottom:0;color:#94A3B8;font-size:14px;'
            'text-align:center;font-family:Arial,sans-serif;">No additional content was selected.</p>'
        )

    html = f"""<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <title>{title}</title>
</head>
<body style="margin:0;padding:0;background-color:#EEF2FF;">
<!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#EEF2FF"><tr><td><![endif]-->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#EEF2FF"
       style="background-color:#EEF2FF;border-collapse:collapse;">
  <tr>
    <td align="center" style="padding-top:40px;padding-bottom:40px;padding-left:16px;padding-right:16px;">

      <!-- OUTER WHITE CARD -->
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="760"
             style="background-color:#ffffff;border-collapse:collapse;width:600px;max-width:600px;">

        <!-- HEADER: Lucid logo -->
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;padding-top:20px;padding-bottom:16px;
                                       padding-left:36px;padding-right:36px;
                                       border-bottom:2px solid #EEF2FF;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <!-- "L" icon box -->
                <td width="44" style="width:44px;">
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0"
                         width="44" bgcolor="#EEF2FF"
                         style="background-color:#EEF2FF;width:44px;border-collapse:collapse;">
                    <tr>
                      <td width="44" height="44" align="center" bgcolor="#EEF2FF"
                          style="background-color:#EEF2FF;width:44px;height:44px;
                                 text-align:center;vertical-align:middle;">
                        <span style="font-size:26px;font-weight:900;color:#3B66F5;
                                     font-family:Arial,Helvetica,sans-serif;line-height:44px;">L</span>
                      </td>
                    </tr>
                  </table>
                </td>
                <!-- Brand name -->
                <td style="padding-left:10px;vertical-align:middle;">
                  <span style="font-size:22px;font-weight:800;color:#1E293B;
                               font-family:Arial,Helvetica,sans-serif;letter-spacing:-1px;">Lucid</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- HERO: blue box with VML rounded corners for Outlook -->
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;padding-top:16px;padding-bottom:16px;
                                       padding-left:24px;padding-right:24px;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
              xmlns:w="urn:schemas-microsoft-com:office:word"
              href="https://lucid.workfloww.ai"
              style="height:180px;v-text-anchor:middle;width:552px;"
              arcsize="5%" fillcolor="#3B66F5" strokecolor="#3B66F5">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:13px;">
            <![endif]-->
            <!--[if !mso]><!-->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                   bgcolor="#3B66F5"
                   style="background-color:#3B66F5;border-collapse:collapse;border-radius:16px;width:100%;">
              <tr>
                <td bgcolor="#3B66F5" style="background-color:#3B66F5;padding-top:28px;padding-bottom:28px;
                                             padding-left:32px;padding-right:32px;border-radius:16px;">
            <!--<![endif]-->

                  <!-- Badge pill -->
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0"
                         style="border-collapse:collapse;margin-bottom:14px;">
                    <tr>
                      <td bgcolor="#5577FF"
                          style="background-color:#5577FF;padding-top:5px;padding-bottom:5px;
                                 padding-left:16px;padding-right:16px;border-radius:999px;">
                        <span style="font-size:11px;font-weight:700;color:#ffffff;
                                     font-family:Arial,sans-serif;letter-spacing:1px;
                                     text-transform:uppercase;">Learning Module</span>
                      </td>
                    </tr>
                  </table>

                  <!-- Sprint title -->
                  <p style="margin-top:0;margin-bottom:16px;font-size:24px;font-weight:800;
                             color:#ffffff;font-family:Arial,Helvetica,sans-serif;line-height:1.25;">
                    {title}
                  </p>

                  <!-- CTA button -->
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0"
                         style="border-collapse:collapse;">
                    <tr>
                      <td bgcolor="#ffffff"
                          style="background-color:#ffffff;border-radius:999px;padding-top:11px;
                                 padding-bottom:11px;padding-left:24px;padding-right:24px;">
                        <a href="https://lucid.workfloww.ai"
                           style="font-size:14px;font-weight:700;color:#3B66F5;
                                  font-family:Arial,sans-serif;text-decoration:none;
                                  display:inline-block;">Start Exploring &#8594;</a>
                      </td>
                    </tr>
                  </table>

            <!--[if !mso]><!-->
                </td>
              </tr>
            </table>
            <!--<![endif]-->
            <!--[if mso]></center></v:roundrect><![endif]-->
          </td>
        </tr>

        <!-- CONTENT BLOCKS (flashcards / audio) -->
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;
                                       padding-top:8px;padding-bottom:32px;
                                       padding-left:36px;padding-right:36px;">
            {content_blocks}
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;
                                       padding-left:36px;padding-right:36px;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                   style="border-collapse:collapse;">
              <tr>
                <td height="1" bgcolor="#EEF2FF"
                    style="height:1px;font-size:1px;line-height:1px;background-color:#EEF2FF;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td bgcolor="#ffffff" align="center"
              style="background-color:#ffffff;padding-top:20px;padding-bottom:28px;
                     padding-left:36px;padding-right:36px;text-align:center;">
            <p style="margin-top:0;margin-bottom:6px;font-size:12px;color:#94A3B8;
                      font-family:Arial,sans-serif;text-align:center;">
              You&#39;re receiving this because you are enrolled in a training module on Lucid.
            </p>
            <a href="#" style="font-size:12px;color:#3B66F5;font-family:Arial,sans-serif;
                               text-decoration:none;">Unsubscribe</a>
          </td>
        </tr>

      </table>
      <!-- END OUTER WHITE CARD -->

    </td>
  </tr>
</table>
<!--[if mso | IE]></td></tr></table><![endif]-->
</body>
</html>"""
    return html

@router.get("/sprints/{company_id}")
async def list_sprints(
    company_id: str,
    user_id: str = Header(..., alias="X-User-ID"),
):
    result = await get_sprints_by_company(company_id)
    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"sprints": result["data"] or []}


@router.get("/sub-modules/{module_id}")
async def list_sub_modules(
    module_id: str,
    user_id: str = Header(..., alias="X-User-ID"),
):
    result = await get_sub_modules_by_sprint(module_id)
    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"sub_modules": result["data"] or []}


@router.get("/assigned-users/{module_id}")
async def list_assigned_users(
    module_id: str,
    user_id: str = Header(..., alias="X-User-ID"),
):
    result = await get_assigned_users_for_sprint(module_id)
    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"users": result["data"] or [], "count": len(result["data"] or [])}


@router.get("/sprint-image/{module_id}")
async def get_sprint_image_url(
    module_id: str,
    user_id: str = Header(..., alias="X-User-ID"),
):
    """Return the first available image URL for a sprint from vectordb_images."""
    result = await get_sprint_image(module_id)
    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"image_url": result["data"]}


@router.post("/generate-email")
async def generate_email(
    request: GenerateEmailRequest,
    user_id: str = Header(..., alias="X-User-ID"),
):
    """Use Gemini to draft a nudge / encouragement email."""
    sub_modules_text = "\n".join(f"  - {t}" for t in request.sub_module_titles)
    event_date = (
        f"{request.scheduled_date} at {request.scheduled_time}"
        if request.scheduled_date and request.scheduled_time
        else None
    )

    # ── Step 1: Ask Gemini ONLY for the text snippets (no HTML in JSON) ──────
    schedule_line = f"Scheduled for: {event_date}" if event_date else ""
    prompt = f"""You are a corporate learning & development assistant.
Generate content snippets for a training nudge email. Return ONLY a raw JSON object (no markdown fences, no explanation) with exactly these keys:

- "subject": a compelling email subject line (plain text, no quotes inside)
- "tagline": a short motivating subtitle for the sprint, e.g. "Your pathway to mastery starts here" (plain text, max 12 words)
- "intro": a warm 1-2 sentence opener referencing the sprint and its sub-modules (plain text, no HTML)
- "body": 2-3 encouraging sentences about why these sub-modules matter (plain text, no HTML)
- "engagement": if an engagement question is provided below, write it as a single plain-text sentence starting with "💡 Thought for today: ". Otherwise return an empty string "".

Sprint: {request.sprint_title}
Sub-modules covered:
{sub_modules_text}
{schedule_line}
Engagement question: {request.engagement_question or "none"}
"""

    try:
        model = genai.GenerativeModel("gemini-2.0-flash")
        response = model.generate_content(prompt)
        text = response.text.strip()

        # Strip any markdown fences (```json ... ```)
        text = re.sub(r'^```[a-zA-Z]*\s*', '', text)
        text = re.sub(r'\s*```\s*$', '', text)
        text = text.strip()

        snippets = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"AI returned invalid JSON: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate email content: {str(e)}")

    # ── Step 2: Build the HTML template in Python (no JSON encoding issues) ──
    subject = snippets.get("subject", f"Your training sprint is ready: {request.sprint_title}")
    tagline = snippets.get("tagline", "Your pathway to mastery starts here")
    intro = snippets.get("intro", "")
    body_text = snippets.get("body", "")
    engagement_text = snippets.get("engagement", "")

    engagement_block = ""
    if engagement_text:
        engagement_block = f"""
            <tr>
              <td style="padding-top:0;padding-bottom:16px;padding-left:0;padding-right:0;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                       style="border-collapse:collapse;">
                  <tr>
                    <td width="4" bgcolor="#3B66F5"
                        style="width:4px;background-color:#3B66F5;font-size:1px;line-height:1px;">&nbsp;</td>
                    <td bgcolor="#EEF2FF"
                        style="background-color:#EEF2FF;padding-top:14px;padding-bottom:14px;
                               padding-left:20px;padding-right:20px;">
                      <p style="margin-top:0;margin-bottom:0;font-size:14px;color:#1E3A8A;
                                 font-style:italic;font-family:Arial,sans-serif;font-weight:700;">
                        {engagement_text}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>"""

    # Build hero image column (if provided)
    if request.sprint_image_url:
        hero_image_col = f"""
                  <td width="190" style="width:190px;vertical-align:bottom;text-align:right;padding:0;">
                    <img src="{request.sprint_image_url}" alt="{request.sprint_title}"
                         width="190" height="auto" border="0"
                         style="display:block;width:190px;max-width:190px;" />
                  </td>"""
        hero_text_width = 'width="370" style="width:370px;'
    else:
        hero_image_col = ""
        hero_text_width = 'width="552" style="width:552px;'

    date_row = ""
    if event_date:
        date_row = (f'<p style="margin-top:0;margin-bottom:20px;font-size:14px;color:#93C5FD;'
                    f'font-weight:600;font-family:Arial,sans-serif;">&#128197; {event_date}</p>')

    html_body = f"""<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <title>{subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#EEF2FF;">
<!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#EEF2FF"><tr><td><![endif]-->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#EEF2FF"
       style="background-color:#EEF2FF;border-collapse:collapse;">
  <tr>
    <td align="center" style="padding-top:40px;padding-bottom:40px;padding-left:16px;padding-right:16px;">

      <!-- OUTER WHITE CARD -->
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600"
             bgcolor="#ffffff"
             style="background-color:#ffffff;border-collapse:collapse;width:600px;max-width:600px;">

        <!-- HEADER: Lucid logo -->
        <tr>
          <td bgcolor="#ffffff"
              style="background-color:#ffffff;padding-top:20px;padding-bottom:16px;
                     padding-left:36px;padding-right:36px;
                     border-bottom:2px solid #EEF2FF;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0"
                   style="border-collapse:collapse;">
              <tr>
                <td width="44" style="width:44px;">
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0"
                         width="44" bgcolor="#EEF2FF"
                         style="background-color:#EEF2FF;width:44px;border-collapse:collapse;">
                    <tr>
                      <td width="44" height="44" align="center" bgcolor="#EEF2FF"
                          style="background-color:#EEF2FF;width:44px;height:44px;
                                 text-align:center;vertical-align:middle;">
                        <span style="font-size:26px;font-weight:900;color:#3B66F5;
                                     font-family:Arial,Helvetica,sans-serif;line-height:44px;">L</span>
                      </td>
                    </tr>
                  </table>
                </td>
                <td style="padding-left:10px;vertical-align:middle;">
                  <span style="font-size:22px;font-weight:800;color:#1E293B;
                               font-family:Arial,Helvetica,sans-serif;letter-spacing:-1px;">Lucid</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- HERO: blue box, VML rounded corners for Outlook -->
        <tr>
          <td bgcolor="#ffffff"
              style="background-color:#ffffff;padding-top:16px;padding-bottom:16px;
                     padding-left:24px;padding-right:24px;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
              xmlns:w="urn:schemas-microsoft-com:office:word"
              href="https://lucid.workfloww.ai"
              style="height:190px;v-text-anchor:middle;width:552px;"
              arcsize="5%" fillcolor="#3B66F5" strokecolor="#3B66F5">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Arial,sans-serif;">
            <![endif]-->
            <!--[if !mso]><!-->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                   bgcolor="#3B66F5"
                   style="background-color:#3B66F5;border-collapse:collapse;border-radius:16px;">
              <tr>
                <td {hero_text_width}padding-top:28px;padding-bottom:28px;
                              padding-left:32px;padding-right:32px;
                              vertical-align:top;border-radius:16px;">
            <!--<![endif]-->

                  <!-- Badge -->
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0"
                         style="border-collapse:collapse;margin-bottom:14px;">
                    <tr>
                      <td bgcolor="#5577FF"
                          style="background-color:#5577FF;padding-top:5px;padding-bottom:5px;
                                 padding-left:16px;padding-right:16px;border-radius:999px;">
                        <span style="font-size:11px;font-weight:700;color:#ffffff;
                                     font-family:Arial,sans-serif;letter-spacing:1px;
                                     text-transform:uppercase;">Sprint</span>
                      </td>
                    </tr>
                  </table>

                  <!-- Title -->
                  <p style="margin-top:0;margin-bottom:8px;font-size:26px;font-weight:800;
                             color:#ffffff;font-family:Arial,Helvetica,sans-serif;line-height:1.2;">
                    {request.sprint_title}
                  </p>
                  <!-- Tagline -->
                  <p style="margin-top:0;margin-bottom:20px;font-size:14px;font-weight:500;
                             color:#C7D7FD;font-family:Arial,sans-serif;">
                    {tagline}
                  </p>
                  {date_row}
                  <!-- CTA button -->
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0"
                         style="border-collapse:collapse;">
                    <tr>
                      <td bgcolor="#ffffff"
                          style="background-color:#ffffff;border-radius:999px;
                                 padding-top:11px;padding-bottom:11px;
                                 padding-left:24px;padding-right:24px;">
                        <a href="https://lucid.workfloww.ai"
                           style="font-size:14px;font-weight:700;color:#3B66F5;
                                  font-family:Arial,sans-serif;text-decoration:none;
                                  display:inline-block;">Start Exploring &#8594;</a>
                      </td>
                    </tr>
                  </table>

            <!--[if !mso]><!-->
                </td>
                {hero_image_col}
              </tr>
            </table>
            <!--<![endif]-->
            <!--[if mso]></center></v:roundrect><![endif]-->
          </td>
        </tr>

        <!-- EMAIL BODY TEXT -->
        <tr>
          <td bgcolor="#ffffff"
              style="background-color:#ffffff;padding-top:8px;padding-bottom:8px;
                     padding-left:36px;padding-right:36px;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                   style="border-collapse:collapse;">
              <tr>
                <td style="padding-bottom:16px;">
                  <p style="margin-top:0;margin-bottom:0;font-size:15px;color:#334155;
                             font-family:Arial,sans-serif;line-height:1.75;">Hi there,</p>
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:16px;">
                  <p style="margin-top:0;margin-bottom:0;font-size:15px;color:#334155;
                             font-family:Arial,sans-serif;line-height:1.75;">{intro}</p>
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:16px;">
                  <p style="margin-top:0;margin-bottom:0;font-size:15px;color:#334155;
                             font-family:Arial,sans-serif;line-height:1.75;">{body_text}</p>
                </td>
              </tr>
              {engagement_block}
              <!-- Second CTA -->
              <tr>
                <td style="padding-top:12px;padding-bottom:28px;">
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0"
                         style="border-collapse:collapse;">
                    <tr>
                      <td bgcolor="#3B66F5"
                          style="background-color:#3B66F5;border-radius:999px;
                                 padding-top:12px;padding-bottom:12px;
                                 padding-left:28px;padding-right:28px;">
                        <a href="https://lucid.workfloww.ai"
                           style="font-size:14px;font-weight:700;color:#ffffff;
                                  font-family:Arial,sans-serif;text-decoration:none;
                                  display:inline-block;">Start Exploring &#8594;</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;padding-left:36px;padding-right:36px;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                   style="border-collapse:collapse;">
              <tr>
                <td height="1" bgcolor="#EEF2FF"
                    style="height:1px;font-size:1px;line-height:1px;background-color:#EEF2FF;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td bgcolor="#ffffff" align="center"
              style="background-color:#ffffff;padding-top:20px;padding-bottom:28px;
                     padding-left:36px;padding-right:36px;text-align:center;">
            <p style="margin-top:0;margin-bottom:6px;font-size:12px;color:#94A3B8;
                      font-family:Arial,sans-serif;text-align:center;">
              You&#39;re receiving this because you are enrolled in a training sprint on Lucid.
            </p>
            <a href="#" style="font-size:12px;color:#3B66F5;font-family:Arial,sans-serif;
                               text-decoration:none;">Unsubscribe</a>
          </td>
        </tr>

      </table>
      <!-- END OUTER WHITE CARD -->

    </td>
  </tr>
</table>
<!--[if mso | IE]></td></tr></table><![endif]-->
</body>
</html>"""

    return {"email": {"subject": subject, "body": html_body}}


@router.post("/send-email")
async def send_email(
    request: SendEmailRequest,
    user_id: str = Header(..., alias="X-User-ID"),
):
    """Send the drafted email to all users assigned to the sprint."""
    # 1. Get assigned users
    users_result = await get_assigned_users_for_sprint(request.module_id)
    if users_result["error"]:
        raise HTTPException(status_code=400, detail=users_result["error"])

    users = users_result["data"] or []
    if not users:
        raise HTTPException(status_code=404, detail="No users assigned to this sprint")

    recipient_emails = [u["email"] for u in users if u.get("email")]
    if not recipient_emails:
        raise HTTPException(status_code=404, detail="No valid email addresses found")

    # 2. Send via SMTP
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")
    from_email = os.getenv("FROM_EMAIL", smtp_user)

    if not smtp_user or not smtp_pass:
        raise HTTPException(status_code=500, detail="SMTP credentials not configured on server")

    sent_count = 0
    failed: List[str] = []

    try:
        server = smtplib.SMTP(smtp_host, smtp_port)
        server.starttls()
        server.login(smtp_user, smtp_pass)

        for email_addr in recipient_emails:
            try:
                msg = MIMEMultipart("alternative")
                msg["Subject"] = request.subject
                msg["From"] = from_email
                msg["To"] = email_addr
                msg.attach(MIMEText(request.body, "html"))
                server.sendmail(from_email, email_addr, msg.as_string())
                sent_count += 1
            except Exception:
                failed.append(email_addr)

        server.quit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SMTP connection failed: {str(e)}")

    return {
        "message": f"Email sent to {sent_count}/{len(recipient_emails)} users",
        "sent_count": sent_count,
        "failed": failed,
    }


# ── Standalone SMTP helper (called by APScheduler — must be a plain function) ─

def send_smtp_job(recipient_emails: List[str], subject: str, body: str) -> None:
    """Send HTML email via SMTP. Designed to be called as an APScheduler job."""
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")
    from_email = os.getenv("FROM_EMAIL", smtp_user)

    if not smtp_user or not smtp_pass:
        raise RuntimeError("SMTP credentials not configured on server")

    server = smtplib.SMTP(smtp_host, smtp_port)
    server.starttls()
    server.login(smtp_user, smtp_pass)

    for email_addr in recipient_emails:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = from_email
        msg["To"] = email_addr
        msg.attach(MIMEText(body, "html"))
        server.sendmail(from_email, email_addr, msg.as_string())

    server.quit()


@router.post("/schedule-email")
async def schedule_email(
    request: ScheduleEmailRequest,
    user_id: str = Header(..., alias="X-User-ID"),
):
    """Schedule the drafted email to be delivered at a future date/time (UTC)."""
    # 1. Parse the run date
    try:
        run_dt = datetime.strptime(
            f"{request.scheduled_date} {request.scheduled_time}", "%Y-%m-%d %H:%M"
        )
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid date/time format. Expected YYYY-MM-DD and HH:MM",
        )

    from datetime import timezone as _tz
    if run_dt.replace(tzinfo=_tz.utc) <= datetime.now(_tz.utc):
        raise HTTPException(
            status_code=400,
            detail="Scheduled time must be in the future (UTC)",
        )

    # 2. Get assigned users
    users_result = await get_assigned_users_for_sprint(request.module_id)
    if users_result["error"]:
        raise HTTPException(status_code=400, detail=users_result["error"])

    users_data = users_result["data"] or []
    if not users_data:
        raise HTTPException(status_code=404, detail="No users assigned to this sprint")

    recipient_emails = [u["email"] for u in users_data if u.get("email")]
    if not recipient_emails:
        raise HTTPException(status_code=404, detail="No valid email addresses found")

    # 3. Schedule the job (SQLite-persisted, survives restarts)
    job_id = f"dispatch_{request.module_id}_{uuid.uuid4().hex[:8]}"
    scheduler.add_job(
        send_smtp_job,
        trigger="date",
        run_date=run_dt,
        id=job_id,
        args=[recipient_emails, request.subject, request.body],
        replace_existing=True,
    )

    return {
        "status": "scheduled",
        "job_id": job_id,
        "scheduled_at": run_dt.isoformat(),
        "recipient_count": len(recipient_emails),
    }


# ── Notify endpoint: selected-content email ────────────────────

@router.post("/notify-email")
async def notify_email(
    request: NotifyEmailRequest,
    user_id: str = Header(..., alias="X-User-ID"),
):
    """
    Build and send (or schedule) an email whose content blocks are
    determined by the admin's `selected_content` list.

    selected_content examples:
      ["flashcards", "audio"]  → both blocks
      ["audio"]                → audio only
      ["flashcards"]           → flashcards only
      []                       → header + footer only
    
    When module_ids are provided, only include flashcards/audio from those specific modules.
    When module_ids is None, use module_id (backward compatibility - aggregates all modules).
    """

    print(f"\n[NOTIFY-EMAIL DEBUG] Received request: {request}")
    # Determine which module IDs to fetch content for
    target_module_ids = request.module_ids if request.module_ids else [request.module_id] if request.module_id else []
    
    if not target_module_ids:
        raise HTTPException(status_code=400, detail="Either module_id or module_ids must be provided")

    # 1a. Fetch sprint title from training_modules
    first_module_id = target_module_ids[0]
    print(f"\n[NOTIFY-EMAIL DEBUG] Fetching sprint title for module: {first_module_id}")
    sprint_result = supabase.table("processed_modules") \
        .select("title") \
        .eq("processed_module_id", first_module_id) \
        .single() \
        .execute()

    if not sprint_result.data:
        raise HTTPException(status_code=404, detail="Module not found")

    # 1b. Fetch flashcard_data and audio_url ONLY from the specified modules
    combined_flashcards: List[Dict[str, Any]] = []
    audio_url_from_db = ""
    
    for target_id in target_module_ids:
        print(f"\n[NOTIFY-EMAIL DEBUG] Fetching content for module: {target_id}")
        
        # If module_ids provided, fetch by processed_module_id; otherwise use original_module_id
        if request.module_ids:
            # Fetching specific processed modules
            print(f"[NOTIFY-EMAIL DEBUG] Using module_ids approach (specific module ID)")
            fc_result = supabase.table("processed_modules") \
                .select("flashcard_data, audio_url, title") \
                .eq("processed_module_id", target_id) \
                .single() \
                .execute()
            print(f"[NOTIFY-EMAIL DEBUG] Query result: {fc_result.data}")
        else:
            # Backward compatibility: fetch all processed modules for original module
            print(f"[NOTIFY-EMAIL DEBUG] Using backward compatibility approach (original module ID)")
            fc_result = supabase.table("processed_modules") \
                .select("flashcard_data, audio_url, title") \
                .eq("original_module_id", target_id) \
                .execute()
            print(f"[NOTIFY-EMAIL DEBUG] Query result: {fc_result.data}")
        
        # Aggregate flashcard_data and pick first audio_url
        if fc_result.data:
            print(f"[NOTIFY-EMAIL DEBUG] Data found for {target_id}")
            if isinstance(fc_result.data, list):
                # Multiple rows
                print(f"[NOTIFY-EMAIL DEBUG] Multiple rows returned: {len(fc_result.data)}")
                for row in fc_result.data:
                    print(f"[NOTIFY-EMAIL DEBUG] Row: {row.get('title')} - flashcards: {len(row.get('flashcard_data') or [])}")
                    if row.get("flashcard_data"):
                        combined_flashcards.extend(row["flashcard_data"])
                    if not audio_url_from_db and row.get("audio_url"):
                        audio_url_from_db = row["audio_url"]
            else:
                # Single row
                print(f"[NOTIFY-EMAIL DEBUG] Single row returned: {fc_result.data.get('title')}")
                print(f"[NOTIFY-EMAIL DEBUG] Flashcard data: {fc_result.data.get('flashcard_data')}")
                if fc_result.data.get("flashcard_data"):
                    fc_list = fc_result.data["flashcard_data"]
                    print(f"[NOTIFY-EMAIL DEBUG] Adding {len(fc_list)} flashcards")
                    combined_flashcards.extend(fc_list)
                else:
                    print(f"[NOTIFY-EMAIL DEBUG] No flashcard_data found in row")
                if not audio_url_from_db and fc_result.data.get("audio_url"):
                    audio_url_from_db = fc_result.data["audio_url"]
                print(f"[NOTIFY-EMAIL DEBUG] Current audio_url_from_db: {audio_url_from_db or 'NONE'}")
        else:
            print(f"[NOTIFY-EMAIL DEBUG] No data found for {target_id}")

    print(f"\n[NOTIFY-EMAIL DEBUG] Total flashcards aggregated: {len(combined_flashcards)}")
    print(f"[NOTIFY-EMAIL DEBUG] Audio URL from DB: {audio_url_from_db or 'NONE'}")
    
    module = {
        "title": sprint_result.data.get("title", ""),
        "audio_url": audio_url_from_db,
        "flashcard_data": combined_flashcards,
    }

    print(f"\n[NOTIFY-EMAIL DEBUG] === FINAL MODULE DATA ===")
    print(f"[NOTIFY-EMAIL DEBUG] Title: {module['title']}")
    print(f"[NOTIFY-EMAIL DEBUG] Total flashcards aggregated: {len(combined_flashcards)}")
    print(f"[NOTIFY-EMAIL DEBUG] Audio URL: {audio_url_from_db or 'NONE'}")
    print(f"[NOTIFY-EMAIL DEBUG] Selected content types: {request.selected_content}")
    if combined_flashcards:
        for i, fc in enumerate(combined_flashcards[:3]):
            print(f"[NOTIFY-EMAIL DEBUG] Flashcard {i+1}: {fc.get('heading', 'NO HEADING')}")

    # 2. Build the dynamic HTML body (use custom overrides when provided)
    html_body = build_email_body(
        module,
        request.selected_content,
        custom_flashcards=request.customFlashcards,
        custom_audio_url=request.customAudioUrl,
    )
    subject = f"Your training module is ready: {module.get('title', '')}"

    # blocks_only: return just the raw inner HTML snippet so the frontend
    # can inject it into the Gemini-generated email body
    if request.blocks_only:
        blocks = build_content_blocks(
            module,
            request.selected_content,
            custom_flashcards=request.customFlashcards,
            custom_audio_url=request.customAudioUrl,
        )
        return {"blocks_html": blocks}

    # Dry-run: return the full notify-style email HTML without sending
    if request.dry_run:
        return {"subject": subject, "body": html_body}

    # 3. Get assigned users (use first module's sprint info)
    sprint_id_for_users = request.module_id or target_module_ids[0]
    users_result = await get_assigned_users_for_sprint(sprint_id_for_users)
    if users_result["error"]:
        raise HTTPException(status_code=400, detail=users_result["error"])

    users_data = users_result["data"] or []
    if not users_data:
        raise HTTPException(status_code=404, detail="No users assigned to this module")

    recipient_emails = [u["email"] for u in users_data if u.get("email")]
    if not recipient_emails:
        raise HTTPException(status_code=404, detail="No valid email addresses found")

    # 4a. Schedule for later if date/time provided
    if request.scheduled_date and request.scheduled_time:
        try:
            run_dt = datetime.strptime(
                f"{request.scheduled_date} {request.scheduled_time}", "%Y-%m-%d %H:%M"
            )
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Invalid date/time format. Expected YYYY-MM-DD and HH:MM",
            )

        from datetime import timezone as _tz
        if run_dt.replace(tzinfo=_tz.utc) <= datetime.now(_tz.utc):
            raise HTTPException(
                status_code=400,
                detail="Scheduled time must be in the future (UTC)",
            )

        job_id = f"notify_{request.module_id}_{uuid.uuid4().hex[:8]}"
        scheduler.add_job(
            send_smtp_job,
            trigger="date",
            run_date=run_dt,
            id=job_id,
            args=[recipient_emails, subject, html_body],
            replace_existing=True,
        )
        return {
            "status": "scheduled",
            "job_id": job_id,
            "scheduled_at": run_dt.isoformat(),
            "recipient_count": len(recipient_emails),
        }

    # 4b. Send immediately
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")
    from_email = os.getenv("FROM_EMAIL", smtp_user)

    if not smtp_user or not smtp_pass:
        raise HTTPException(status_code=500, detail="SMTP credentials not configured on server")

    sent_count = 0
    failed: List[str] = []

    try:
        server = smtplib.SMTP(smtp_host, smtp_port)
        server.starttls()
        server.login(smtp_user, smtp_pass)

        for email_addr in recipient_emails:
            try:
                msg = MIMEMultipart("alternative")
                msg["Subject"] = subject
                msg["From"] = from_email
                msg["To"] = email_addr
                msg.attach(MIMEText(html_body, "html"))
                server.sendmail(from_email, email_addr, msg.as_string())
                sent_count += 1
            except Exception:
                failed.append(email_addr)

        server.quit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SMTP connection failed: {str(e)}")

    return {
        "message": f"Notify email sent to {sent_count}/{len(recipient_emails)} users",
        "sent_count": sent_count,
        "failed": failed,
        "selected_content": request.selected_content,
    }


# ── Multi-Module Staggered Schedule ───────────────────────────────────────────
# When the admin selects N modules and a recurring day/time, we schedule one
# job per module, each offset by 1 week:
#   Module 1 → first upcoming <day> at <time>
#   Module 2 → first upcoming <day> + 7 days
#   Module 3 → first upcoming <day> + 14 days  … and so on.

_DAY_MAP = {"Mon": 0, "Tue": 1, "Wed": 2, "Thu": 3, "Fri": 4, "Sat": 5, "Sun": 6}


def _next_weekday(day_name: str, hour: int, minute: int) -> datetime:
    """Return the next future UTC datetime that falls on day_name at hour:minute UTC.

    Returns a timezone-aware UTC datetime so isoformat() always includes +00:00
    and APScheduler fires at the correct wall-clock UTC time regardless of the
    server's local timezone.
    """
    from datetime import timezone as _tz

    target_wd = _DAY_MAP.get(day_name, 0)
    now_utc = datetime.now(_tz.utc)

    # Build today's candidate at the requested HH:MM UTC (timezone-aware)
    candidate = now_utc.replace(hour=hour, minute=minute, second=0, microsecond=0)

    # How many days until target_wd? (weekday(): Mon=0 … Sun=6)
    days_ahead = (target_wd - now_utc.weekday()) % 7
    candidate += timedelta(days=days_ahead)

    # If the candidate is not strictly in the future, push one full week ahead
    if candidate <= now_utc:
        candidate += timedelta(weeks=1)

    return candidate


class ScheduleMultiModuleItem(BaseModel):
    """One entry: module + content type + scheduling info (recurring or one-time)."""
    module_id: str                                  # processed_module_id
    content_type: str                               # e.g. "flashcards" or "audio"
    
    # ── SCHEDULING: choose one ──
    day_of_week: Optional[str] = None               # For recurring: "Mon" | "Tue" | … | "Sun"
    scheduled_date: Optional[str] = None            # For one-time: "YYYY-MM-DD"
    
    customFlashcards: Optional[List[Dict[str, Any]]] = None  # Module-specific custom flashcards
    customAudioUrl: Optional[str] = None            # Module-specific custom audio URL


class ScheduleMultiModuleRequest(BaseModel):
    """Schedule emails with paired module-content-scheduling mappings.
    
    Supports TWO modes:
    
    1. RECURRING (day-of-week):
       - Each item has day_of_week: "Mon", "Tue", etc
       - scheduled_date is null/omitted
       - scheduled_time: shared time (e.g. "09:00")
       - Emails send on that day every week at that time
    
    2. ONE-TIME (specific date):
       - Each item has scheduled_date: "YYYY-MM-DD"
       - day_of_week is null/omitted
       - scheduled_time: shared time (e.g. "09:00")
       - Emails send once on that exact date/time

    Example 1 (Recurring):
      [
        { 
          module_id: "A", 
          content_type: "flashcards", 
          day_of_week: "Tue"
        },
        { 
          module_id: "B", 
          content_type: "audio", 
          day_of_week: "Tue"
        }
      ]
      scheduled_time: "09:00"
    
    Example 2 (One-time):
      [
        { 
          module_id: "A", 
          content_type: "flashcards", 
          scheduled_date: "2026-03-20"
        },
        { 
          module_id: "B", 
          content_type: "audio", 
          scheduled_date: "2026-03-20"
        }
      ]
      scheduled_time: "09:00"
    """
    schedule_items: List[ScheduleMultiModuleItem]   # module + content + day/date + per-module custom content pairings
    scheduled_time: str                             # "HH:MM" in UTC (applied to all items)


@router.post("/schedule-multi-module")
async def schedule_multi_module(
    request: ScheduleMultiModuleRequest,
    user_id: str = Header(..., alias="X-User-ID"),
):
    """
    Schedule emails with paired module-content-scheduling mappings.
    
    Supports TWO modes:
    
    MODE 1 - RECURRING (day-of-week):
      All items have day_of_week (e.g., "Tue")
      Emails send on that day every week at scheduled_time
      Example:
        Module A → Flashcards → Every Tuesday 09:00 UTC
        Module B → Audio       → Every Tuesday 09:00 UTC
    
    MODE 2 - ONE-TIME (specific date):
      All items have scheduled_date (e.g., "2026-03-20")
      Emails send once on that date at scheduled_time
      Example:
        Module A → Flashcards → 2026-03-20 09:00 UTC (one-time)
        Module B → Audio       → 2026-03-20 09:00 UTC (one-time)
    """
    try:
        if not request.schedule_items:
            raise HTTPException(status_code=400, detail="schedule_items must not be empty")

        try:
            hour, minute = [int(x) for x in request.scheduled_time.split(":")]
        except ValueError:
            raise HTTPException(status_code=400, detail="scheduled_time must be HH:MM")

        # ── Determine scheduling mode ──
        has_day_of_week = any(item.day_of_week for item in request.schedule_items)
        has_scheduled_date = any(item.scheduled_date for item in request.schedule_items)
        
        if has_day_of_week and has_scheduled_date:
            raise HTTPException(
                status_code=400,
                detail="Mixed scheduling: cannot mix day_of_week and scheduled_date. Choose one mode.",
            )
        
        if not has_day_of_week and not has_scheduled_date:
            raise HTTPException(
                status_code=400,
                detail="No scheduling provided: either all items need day_of_week (recurring) OR all need scheduled_date (one-time)",
            )
        
        is_recurring_mode = has_day_of_week
        
        print(f"\n[SCHEDULE DEBUG] {'='*80}")
        print(f"[SCHEDULE DEBUG] MODE: {'RECURRING (day-of-week)' if is_recurring_mode else 'ONE-TIME (specific date)'}")
        print(f"[SCHEDULE DEBUG] Total items: {len(request.schedule_items)}")
        print(f"[SCHEDULE DEBUG] Scheduled time: {request.scheduled_time} UTC")
        print(f"[SCHEDULE DEBUG] {'='*80}")

        scheduled_jobs = []

        for idx, item in enumerate(request.schedule_items):
            module_id = item.module_id
            content_type = item.content_type
            
            # ── Determine run_date based on mode ──
            if is_recurring_mode:
                # RECURRING MODE: day_of_week
                day_of_week = item.day_of_week
                if not day_of_week:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Item {idx}: day_of_week required in recurring mode",
                    )
                
                if day_of_week not in _DAY_MAP:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Item {idx}: day_of_week must be one of {list(_DAY_MAP.keys())}, got {day_of_week}",
                    )
                
                run_dt = _next_weekday(day_of_week, hour, minute)
                print(f"[SCHEDULE DEBUG] Item {idx}: {module_id} → Every {day_of_week} @ {hour:02d}:{minute:02d} UTC → Next: {run_dt}")
            else:
                # ONE-TIME MODE: scheduled_date
                scheduled_date = item.scheduled_date
                if not scheduled_date:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Item {idx}: scheduled_date required in one-time mode",
                    )
                
                try:
                    run_dt = datetime.strptime(
                        f"{scheduled_date} {request.scheduled_time}", "%Y-%m-%d %H:%M"
                    )
                    # Make timezone-aware (UTC)
                    from datetime import timezone as _tz
                    run_dt = run_dt.replace(tzinfo=_tz.utc)
                except ValueError:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Item {idx}: Invalid date/time. Expected scheduled_date='YYYY-MM-DD' and scheduled_time='HH:MM'",
                    )
                
                # Validate it's in the future
                from datetime import timezone as _tz
                if run_dt <= datetime.now(_tz.utc):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Item {idx}: Scheduled time must be in the future (UTC)",
                    )
                
                print(f"[SCHEDULE DEBUG] Item {idx}: {module_id} → One-time on {scheduled_date} @ {hour:02d}:{minute:02d} UTC → {run_dt}")

            # Validate content type
            if content_type not in ["flashcards", "audio"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Item {idx}: content_type must be 'flashcards' or 'audio', got {content_type}",
                )

            # ── Fetch processed_module row ──
            pm_result = supabase.table("processed_modules") \
                .select("processed_module_id, title, flashcard_data, audio_url, original_module_id") \
                .eq("processed_module_id", module_id) \
                .single() \
                .execute()

            if not pm_result.data:
                raise HTTPException(
                    status_code=404,
                    detail=f"Processed module {module_id} not found in processed_modules",
                )

            pm_row = pm_result.data
            module_title = pm_row.get("title") or module_id
            original_module_id = pm_row.get("original_module_id")

            combined_flashcards: List[Dict[str, Any]] = pm_row.get("flashcard_data") or []
            audio_url_from_db: str = pm_row.get("audio_url") or ""

            module_data = {
                "title": module_title,
                "audio_url": audio_url_from_db,
                "flashcard_data": combined_flashcards,
            }

            # ── Build email with ONLY the paired content type ──
            selected_content = [content_type]  # Only include this specific content type
            
            # Debug logging - Comprehensive audio and flashcard tracking
            print(f"\n{'='*80}")
            print(f"[MODULE {idx}] Processing: {module_id}")
            print(f"{'='*80}")
            print(f"  Module Title: {module_title}")
            print(f"  Content Type: {content_type}")
            print(f"  Day of Week: {day_of_week}")
            print(f"  Run Date: {run_dt}")
            print(f"\n  📚 FLASHCARDS:")
            print(f"    - From DB: {len(combined_flashcards)} flashcards found")
            if combined_flashcards:
                for i, fc in enumerate(combined_flashcards[:2]):  # Show first 2
                    print(f"      [{i+1}] {fc.get('heading', 'No heading')}")
            print(f"    - Custom from item: {item.customFlashcards is not None}")
            if item.customFlashcards:
                print(f"      Using CUSTOM flashcards ({len(item.customFlashcards)} cards)")
            print(f"    - Will include in email: {content_type == 'flashcards'}")
            
            print(f"\n  🎵 AUDIO:")
            print(f"    - From DB: {audio_url_from_db if audio_url_from_db else 'NO AUDIO'}")
            print(f"    - Custom from item: {item.customAudioUrl if item.customAudioUrl else 'None'}")
            if item.customAudioUrl:
                print(f"      Using CUSTOM audio URL")
            final_audio_url = item.customAudioUrl if item.customAudioUrl else audio_url_from_db
            print(f"    - Final audio URL to use: {final_audio_url if final_audio_url else 'NO AUDIO'}")
            print(f"    - Will include in email: {content_type == 'audio'}")
            print(f"{'='*80}\n")
            
            html_body = build_email_body(
                module_data,
                selected_content,
                custom_flashcards=item.customFlashcards if content_type == "flashcards" else None,
                custom_audio_url=item.customAudioUrl if content_type == "audio" else None,
            )
            subject = f"Your training module is ready: {module_title}"

            # ── Fetch assigned users via the parent sprint ──
            lookup_id = original_module_id or module_id
            users_result = await get_assigned_users_for_sprint(lookup_id)
            if users_result["error"]:
                raise HTTPException(status_code=400, detail=users_result["error"])

            users_data = users_result["data"] or []
            recipient_emails = [u["email"] for u in users_data if u.get("email")]

            if not recipient_emails:
                # Still record the entry but flag no recipients
                scheduled_jobs.append({
                    "module_id": module_id,
                    "module_title": module_title,
                    "content_type": content_type,
                    "day_of_week": day_of_week,
                    "run_date": run_dt.isoformat(),
                    "recipient_count": 0,
                    "job_id": None,
                    "warning": "No users assigned to this module",
                })
                continue

            # ── Create APScheduler job ──
            job_id = f"multi_notify_{module_id}_{content_type}_{uuid.uuid4().hex[:8]}"
            scheduler.add_job(
                send_smtp_job,
                trigger="date",
                run_date=run_dt,
                id=job_id,
                args=[recipient_emails, subject, html_body],
                replace_existing=True,
            )

            scheduled_jobs.append({
                "module_id": module_id,
                "module_title": module_title,
                "content_type": content_type,
                "day_of_week": day_of_week,
                "run_date": run_dt.isoformat(),
                "recipient_count": len(recipient_emails),
                "job_id": job_id,
            })

        return {
            "status": "multi_module_scheduled",
            "scheduled_time": request.scheduled_time,
            "total_items": len(request.schedule_items),
            "jobs": scheduled_jobs,
        }

    except HTTPException:
        raise  # re-raise FastAPI HTTP errors as-is (they already carry status codes)
    except Exception as exc:
        # Catch-all: log and return a proper 500 so CORS headers are always present
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"schedule-multi-module failed: {str(exc)}",
        )