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
    module_id: str
    selected_content: List[str]   # e.g. ["flashcards", "audio"]
    scheduled_date: Optional[str] = None
    scheduled_time: Optional[str] = None
    customFlashcards: Optional[List[Dict[str, Any]]] = None   # overrides module flashcard_data
    customAudioUrl: Optional[str] = None                      # overrides module audio_url
    dry_run: bool = False                                     # True = build + return full HTML, no send
    blocks_only: bool = False                                 # True = return only the inner content block HTML


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

    if run_dt <= datetime.utcnow():
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
    """
    # 1a. Fetch sprint title from training_modules
    sprint_result = supabase.table("training_modules") \
        .select("title") \
        .eq("module_id", request.module_id) \
        .single() \
        .execute()

    if not sprint_result.data:
        raise HTTPException(status_code=404, detail="Module not found")

    # 1b. Fetch flashcard_data and audio_url from processed_modules for this sprint
    fc_result = supabase.table("processed_modules") \
        .select("flashcard_data, audio_url") \
        .eq("original_module_id", request.module_id) \
        .execute()

    # Aggregate flashcard_data arrays and pick the first available audio_url
    combined_flashcards: List[Dict[str, Any]] = []
    audio_url_from_db = ""
    for row in (fc_result.data or []):
        if row.get("flashcard_data"):
            combined_flashcards.extend(row["flashcard_data"])
        if not audio_url_from_db and row.get("audio_url"):
            audio_url_from_db = row["audio_url"]

    module = {
        "title": sprint_result.data.get("title", ""),
        "audio_url": audio_url_from_db,
        "flashcard_data": combined_flashcards,
    }

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

    # 3. Get assigned users
    users_result = await get_assigned_users_for_sprint(request.module_id)
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

        if run_dt <= datetime.utcnow():
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

    Uses only UTC arithmetic so local-timezone offsets never interfere.
    Python's weekday(): Mon=0 … Sun=6  — same as _DAY_MAP.
    """
    target_wd = _DAY_MAP.get(day_name, 0)
    now_utc = datetime.utcnow()

    # Build today's candidate at the requested HH:MM UTC
    candidate = now_utc.replace(hour=hour, minute=minute, second=0, microsecond=0)

    # How many days until target_wd?
    days_ahead = (target_wd - now_utc.weekday()) % 7
    candidate += timedelta(days=days_ahead)

    # If the candidate is not strictly in the future, push one full week ahead
    if candidate <= now_utc:
        candidate += timedelta(weeks=1)

    return candidate


class ScheduleMultiModuleRequest(BaseModel):
    """Schedule one email per module on successive occurrences of a weekday.

    Example: module_ids = [A, B], scheduled_day = "Mon", scheduled_time = "09:00"
      → Module A sent on the first upcoming Monday at 09:00 UTC
      → Module B sent on the Monday after that (+ 7 days)
    """
    module_ids: List[str]           # ordered list of module IDs (sprint sub-modules)
    selected_content: List[str]     # e.g. ["flashcards", "audio"]
    scheduled_day: str              # "Mon" | "Tue" | … | "Sun"
    scheduled_time: str             # "HH:MM" in UTC
    customFlashcards: Optional[List[Dict[str, Any]]] = None
    customAudioUrl: Optional[str] = None


@router.post("/schedule-multi-module")
async def schedule_multi_module(
    request: ScheduleMultiModuleRequest,
    user_id: str = Header(..., alias="X-User-ID"),
):
    """
    Schedule one flashcard/content email per module, staggered by one week each.

    Returns a list of scheduled jobs with their run dates so the frontend
    can show a preview like:
      Module 1 → Mon 17 Mar 2026 09:00 UTC
      Module 2 → Mon 24 Mar 2026 09:00 UTC
    """
    try:
        if not request.module_ids:
            raise HTTPException(status_code=400, detail="module_ids must not be empty")

        if request.scheduled_day not in _DAY_MAP:
            raise HTTPException(
                status_code=400,
                detail=f"scheduled_day must be one of {list(_DAY_MAP.keys())}",
            )

        try:
            hour, minute = [int(x) for x in request.scheduled_time.split(":")]
        except ValueError:
            raise HTTPException(status_code=400, detail="scheduled_time must be HH:MM")

        # Compute base run date (first upcoming occurrence of the chosen weekday/time)
        base_dt = _next_weekday(request.scheduled_day, hour, minute)

        scheduled_jobs = []

        for idx, module_id in enumerate(request.module_ids):
            run_dt = base_dt + timedelta(weeks=idx)

            # ── Fetch processed_module row (title, flashcard_data, audio_url,
            #    AND the parent original_module_id for user lookup) ──
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

            # ── Build email HTML ──
            html_body = build_email_body(
                module_data,
                request.selected_content,
                custom_flashcards=request.customFlashcards,
                custom_audio_url=request.customAudioUrl,
            )
            subject = f"Your training module is ready: {module_title}"

            # ── Fetch assigned users via the parent sprint (original_module_id) ──
            # Users are assigned at the training_module (sprint) level, not per sub-module.
            lookup_id = original_module_id or module_id
            users_result = await get_assigned_users_for_sprint(lookup_id)
            if users_result["error"]:
                raise HTTPException(status_code=400, detail=users_result["error"])

            users_data = users_result["data"] or []
            recipient_emails = [u["email"] for u in users_data if u.get("email")]

            if not recipient_emails:
                # Still record the entry but flag no recipients
                scheduled_jobs.append({
                    "week": idx + 1,
                    "module_id": module_id,
                    "module_title": module_title,
                    "run_date": run_dt.isoformat(),
                    "recipient_count": 0,
                    "job_id": None,
                    "warning": "No users assigned to this module",
                })
                continue

            # ── Create APScheduler job ──
            job_id = f"multi_notify_{module_id}_{uuid.uuid4().hex[:8]}"
            scheduler.add_job(
                send_smtp_job,
                trigger="date",
                run_date=run_dt,
                id=job_id,
                args=[recipient_emails, subject, html_body],
                replace_existing=True,
            )

            scheduled_jobs.append({
                "week": idx + 1,
                "module_id": module_id,
                "module_title": module_title,
                "run_date": run_dt.isoformat(),
                "recipient_count": len(recipient_emails),
                "job_id": job_id,
            })

        return {
            "status": "multi_module_scheduled",
            "scheduled_day": request.scheduled_day,
            "scheduled_time": request.scheduled_time,
            "total_modules": len(request.module_ids),
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