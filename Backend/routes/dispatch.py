from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional, List
import google.generativeai as genai
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from utils.db.dispatch_db import (
    get_sprints_by_company,
    get_sub_modules_by_sprint,
    get_assigned_users_for_sprint,
    get_sprint_image,
)

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


# ── Endpoints ───────────────────────────────────────────────────

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

    event_date = f"{request.scheduled_date} at {request.scheduled_time}" if request.scheduled_date and request.scheduled_time else "your scheduled training time"

    prompt = f"""You are a corporate learning & development assistant.
Draft a professional yet warm and encouraging nudge email for employees about their upcoming training content.

Sprint: {request.sprint_title}
Sub-modules covered:
{sub_modules_text}
"""
    if request.engagement_question:
        prompt += f"\nInclude this engagement question in the email naturally: \"{request.engagement_question}\"\n"

    if request.scheduled_date and request.scheduled_time:
        prompt += f"\nThe content is scheduled for {request.scheduled_date} at {request.scheduled_time}.\n"

    # Build image block for hero card — two-column if image provided, single column otherwise
    if request.sprint_image_url:
        hero_image_block = f"""
                  </td>

                  <!-- Sprint Image -->
                  <td style="vertical-align:bottom;text-align:right;width:40%;padding:0;">
                    <img src="{request.sprint_image_url}"
                      alt="{request.sprint_title}"
                      width="200"
                      style="display:block;margin-left:auto;border-radius:0 0 20px 0;object-fit:cover;max-height:240px;" />
                  </td>"""
        hero_td_width = "width:60%;"
    else:
        hero_image_block = """
                  </td>"""
        hero_td_width = "width:100%;"

    prompt += f"""
Requirements:
1. Keep the tone motivating and professional.
2. The email should encourage employees to complete the listed sub-modules.
3. If an engagement question is provided, weave it into the email so it feels natural.
4. Return ONLY a JSON object with two keys: "subject" (email subject line) and "body" (the full HTML email body). Do not wrap the JSON in markdown code fences.

For the "body", you MUST output the following HTML template exactly, replacing only the placeholder tokens (wrapped in {{{{ }}}}) with appropriate generated content. Do not alter any HTML tags, inline styles, or structure outside the placeholder tokens.

Template:
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Virtual Event Invite</title>
</head>
<body style="margin:0;padding:0;background-color:#dde6f5;font-family:'Segoe UI',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#dde6f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">

          <!-- LOGO HEADER -->
          <tr>
            <td style="padding:28px 36px 20px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size:26px;font-weight:800;color:#e91e8c;letter-spacing:-1px;">
                      &#128022; <span style="color:#e91e8c;">Lucid</span><span style="color:#3a3a6e;">Learn</span>
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO CARD -->
          <tr>
            <td style="padding:0 24px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:linear-gradient(135deg,#eef1ff 0%,#dde4ff 100%);border-radius:20px;overflow:hidden;">
                <tr>
                  <td style="padding:32px 36px;vertical-align:top;{hero_td_width}">

                    <!-- Badge -->
                    <div style="display:inline-block;border:1.5px solid #aab0d0;border-radius:999px;padding:5px 16px;font-size:13px;color:#3a3a6e;margin-bottom:20px;">
                      Learning Sprint
                    </div>

                    <!-- Sprint Title -->
                    <h1 style="margin:0 0 6px;font-size:32px;font-weight:800;color:#1a1a4e;line-height:1.15;">
                      {{{{SPRINT_TITLE}}}}
                    </h1>

                    <!-- Tagline -->
                    <p style="margin:0 0 18px;font-size:15px;font-weight:600;color:#3a3a6e;">
                      {{{{SPRINT_TAGLINE}}}}
                    </p>

                    <!-- Date -->
                    <p style="margin:0 0 24px;font-size:15px;color:#3a3a6e;">
                      &#128197;&nbsp; <strong>{{{{EVENT_DATE}}}}</strong>
                    </p>

                    <!-- CTA Button -->
                    <a href="#"
                      style="display:inline-block;background:#e91e8c;color:#ffffff;text-decoration:none;
                             font-weight:700;font-size:15px;padding:13px 24px;border-radius:999px;">
                      Start Learning &nbsp;&#10140;
                    </a>
{hero_image_block}
                </tr>
              </table>
            </td>
          </tr>

          <!-- EMAIL BODY -->
          <tr>
            <td style="padding:0 36px 36px;color:#222;font-size:16px;line-height:1.7;">

              <p>Hi there,</p>

              <p>
                {{{{EMAIL_INTRO}}}}
              </p>

              <p>
                {{{{EMAIL_BODY}}}}
              </p>

              {{{{ENGAGEMENT_BLOCK}}}}

              <!-- Secondary CTA -->
              <p style="margin-top:28px;">
                <a href="#"
                  style="display:inline-block;background:#e91e8c;color:#ffffff;text-decoration:none;
                         font-weight:700;font-size:15px;padding:13px 28px;border-radius:999px;">
                  Start Learning &nbsp;&#10140;
                </a>
              </p>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:20px 36px;border-top:1px solid #eee;font-size:12px;color:#888;text-align:center;">
              You're receiving this because you are enrolled in a training sprint on LucidLearn.<br/>
              <a href="#" style="color:#e91e8c;text-decoration:none;">Unsubscribe</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>

Placeholder instructions:
- {{{{SPRINT_TITLE}}}}: Use "{request.sprint_title}"
- {{{{SPRINT_TAGLINE}}}}: Write a short motivating subtitle for the sprint (e.g. "Your pathway to mastery starts here")
- {{{{EVENT_DATE}}}}: Use "{event_date}"
- {{{{EMAIL_INTRO}}}}: Write a warm 1-2 sentence opener referencing the sprint and the modules: {sub_modules_text}
- {{{{EMAIL_BODY}}}}: Write 2-3 encouraging sentences about the sub-modules covered and why they matter
- {{{{ENGAGEMENT_BLOCK}}}}: If an engagement question was provided, render it as a styled blockquote like:
  <blockquote style="border-left:4px solid #e91e8c;margin:20px 0;padding:12px 20px;background:#fff0f7;border-radius:0 12px 12px 0;font-style:italic;color:#3a3a6e;">
    💡 <strong>Thought for today:</strong> [the engagement question here]
  </blockquote>
  Otherwise leave {{{{ENGAGEMENT_BLOCK}}}} as an empty string.
"""

    try:
        model = genai.GenerativeModel("gemini-2.0-flash")
        response = model.generate_content(prompt)
        text = response.text.strip()

        # Strip markdown fences if present
        if text.startswith("```"):
            text = "\n".join(text.split("\n")[1:])
        if text.endswith("```"):
            text = "\n".join(text.split("\n")[:-1])

        import json
        email_data = json.loads(text)
        return {"email": email_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate email: {str(e)}")


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