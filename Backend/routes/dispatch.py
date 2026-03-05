from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional, List
import google.generativeai as genai
import os
import re
import json
import smtplib
import uuid
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from scheduler import scheduler

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


class ScheduleEmailRequest(BaseModel):
    module_id: str
    subject: str
    body: str
    scheduled_date: str   # "YYYY-MM-DD"
    scheduled_time: str   # "HH:MM"


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
        engagement_block = f'''<blockquote style="border-left:4px solid #3B66F5;margin:24px 0;padding:14px 20px;background:#EEF2FF;border-radius:0 12px 12px 0;font-style:italic;color:#1E3A8A;">
  <strong>{engagement_text}</strong>
</blockquote>'''

    if request.sprint_image_url:
        hero_image_col = f'''<td style="vertical-align:bottom;text-align:right;width:38%;padding:0;">
                    <img src="{request.sprint_image_url}"
                      alt="{request.sprint_title}"
                      width="190"
                      style="display:block;margin-left:auto;border-radius:0 0 20px 0;object-fit:cover;max-height:220px;" />
                  </td>'''
        hero_td_width = "width:62%;"
    else:
        hero_image_col = ""
        hero_td_width = "width:100%;"

    date_row = ""
    if event_date:
        date_row = f'<p style="margin:0 0 24px;font-size:14px;color:#3B66F5;font-weight:600;">&#128197;&nbsp; {event_date}</p>'

    # Lucid "L" logo — light blue rounded square with blue "L" (matches app icon)
    lucid_logo_html = (
        '<div style="display:inline-block;background:#EEF2FF;border-radius:14px;'
        'width:44px;height:44px;text-align:center;vertical-align:middle;line-height:44px;">'
        '<span style="font-size:26px;font-weight:900;color:#3B66F5;'
        'font-family:Arial,Helvetica,sans-serif;line-height:44px;display:inline-block;vertical-align:middle;">L</span>'
        '</div>'
    )

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>{subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#EFF6FF;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#EFF6FF;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(59,102,245,0.10);">

          <!-- LOGO HEADER -->
          <tr>
            <td style="padding:16px 36px 12px;border-bottom:1px solid #EFF6FF;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    {lucid_logo_html}
                  </td>
                  <td style="vertical-align:middle;padding-left:10px;">
                    <span style="font-size:22px;font-weight:800;color:#1E293B;letter-spacing:-0.5px;">Lucid</span>
                    <span style="font-size:22px;font-weight:400;color:#3B66F5;letter-spacing:-0.5px;">Learn</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO CARD -->
          <tr>
            <td style="padding:8px 24px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:linear-gradient(135deg,#3B66F5 0%,#1D4ED8 100%);border-radius:16px;overflow:hidden;">
                <tr>
                  <td style="padding:32px 32px 32px;vertical-align:top;{hero_td_width}">
                    <div style="display:inline-block;background:rgba(255,255,255,0.18);border-radius:999px;padding:5px 16px;font-size:12px;color:#ffffff;font-weight:600;letter-spacing:0.5px;margin-bottom:18px;text-transform:uppercase;">
                      Learning Sprint
                    </div>
                    <h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#ffffff;line-height:1.2;">{request.sprint_title}</h1>
                    <p style="margin:0 0 20px;font-size:14px;font-weight:500;color:rgba(255,255,255,0.85);">{tagline}</p>
                    {date_row}
                    <a href="https://lucid.workfloww.ai" style="display:inline-block;background:#ffffff;color:#3B66F5;text-decoration:none;font-weight:700;font-size:14px;padding:11px 24px;border-radius:999px;">
                      Start Learning &rarr;
                    </a>
                  </td>
                  {hero_image_col}
                </tr>
              </table>
            </td>
          </tr>

          <!-- EMAIL BODY -->
          <tr>
            <td style="padding:8px 36px 36px;color:#334155;font-size:15px;line-height:1.75;">
              <p style="margin:0 0 16px;">Hi there,</p>
              <p style="margin:0 0 16px;">{intro}</p>
              <p style="margin:0 0 16px;">{body_text}</p>
              {engagement_block}
              <p style="margin:28px 0 0;">
                <a href="https://lucid.workfloww.ai" style="display:inline-block;background:#3B66F5;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:999px;">
                  Start Learning &rarr;
                </a>
              </p>
            </td>
          </tr>

          <!-- DIVIDER -->
          <tr>
            <td style="padding:0 36px;">
              <div style="height:1px;background:#EFF6FF;"></div>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:20px 36px 28px;font-size:12px;color:#94A3B8;text-align:center;">
              You're receiving this because you are enrolled in a training sprint on LucidLearn.<br/>
              <a href="#" style="color:#3B66F5;text-decoration:none;">Unsubscribe</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
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