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


@router.post("/generate-email")
async def generate_email(
    request: GenerateEmailRequest,
    user_id: str = Header(..., alias="X-User-ID"),
):
    """Use Gemini to draft a nudge / encouragement email."""
    sub_modules_text = "\n".join(f"  - {t}" for t in request.sub_module_titles)

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

    prompt += """
Requirements:
1. Keep the tone motivating and professional.
2. The email should encourage employees to complete the listed sub-modules.
3. If an engagement question is provided, weave it into the email so it feels natural.
4. Return ONLY a JSON object with two keys: "subject" (email subject line) and "body" (the full HTML email body with inline styles for a clean, modern look). Do not wrap the JSON in markdown code fences.
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