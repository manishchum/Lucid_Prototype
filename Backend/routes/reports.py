import os
import re
import json
from datetime import datetime, timedelta
from typing import Optional, List
from io import BytesIO

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from google import genai
from utils.auth import RequestAuth, get_request_auth_required
from utils.supabase_client import supabase

# ReportLab imports
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

router = APIRouter(prefix="/api/reports", tags=["Reports"])

class ReportGenerateRequest(BaseModel):
    task_id: str
    duration: str  # "30_days", "90_days", "all"
    admin_email: Optional[str] = None

def is_user_admin(user_id: str) -> bool:
    try:
        # Check roles via user_role_assignments
        res = (
            supabase.table("user_role_assignments")
            .select("role:roles(role_name)")
            .eq("user_id", user_id)
            .eq("is_active", True)
            .execute()
        )
        if res.data:
            for row in res.data:
                role_dict = row.get("role")
                if role_dict:
                    role_name = str(role_dict.get("role_name") or "").lower()
                    if role_name in ("admin", "manager", "super_admin", "developer"):
                        return True
        return False
    except Exception as exc:
        print("[Reports API] Error checking admin status:", exc)
        return False

def build_pdf_report(task_title: str, report_text: str, pending_failed: List[dict]) -> bytes:
    buffer = BytesIO()
    # 0.75 in margins
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=54,
        leftMargin=54,
        topMargin=54,
        bottomMargin=54
    )
    story = []
    styles = getSampleStyleSheet()
    
    # Custom colors & styles
    primary_color = colors.HexColor('#2F63FF')
    text_color = colors.HexColor('#0F172A')
    muted_color = colors.HexColor('#475569')
    alert_color = colors.HexColor('#B91C1C')
    
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=22,
        leading=26,
        textColor=primary_color,
        spaceAfter=8
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=muted_color,
        spaceAfter=15
    )
    
    h1_style = ParagraphStyle(
        'SectionHeader',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=primary_color,
        spaceBefore=12,
        spaceAfter=6,
        keepWithNext=True
    )
    
    body_style = ParagraphStyle(
        'BodyTextCustom',
        parent=styles['BodyText'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13.5,
        textColor=text_color,
        spaceAfter=6
    )

    alert_style = ParagraphStyle(
        'AlertText',
        parent=body_style,
        fontName='Helvetica-Bold',
        textColor=alert_color
    )

    # Document Header
    story.append(Paragraph(f"Lucid Team Performance Report", title_style))
    story.append(Paragraph(f"Task: {task_title} | Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC", subtitle_style))
    story.append(Spacer(1, 10))

    # Parse headings from Gemini output
    # Splits text on headings starting with "1. ", "2. ", etc. or markdown titles
    parts = re.split(r'\n(?=\d\.\s+[A-Z\s]+:?)', report_text)
    for part in parts:
        part = part.strip()
        if not part:
            continue
        lines = part.split('\n')
        header_line = lines[0].strip()
        body_lines = lines[1:]
        
        # Clean header formatting
        header_clean = re.sub(r'^\d\.\s*', '', header_line) # remove numbers
        header_clean = header_clean.replace('**', '').replace('*', '').strip(':').strip()
        
        story.append(Paragraph(header_clean, h1_style))
        
        # Format paragraph lines
        body_content = "\n".join(body_lines).strip()
        # Parse basic markdown bolds
        body_content = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', body_content)
        
        paragraphs = body_content.split('\n\n')
        for p in paragraphs:
            p = p.strip()
            if not p:
                continue
            
            # Bullet points parsing
            if p.startswith('* ') or p.startswith('- '):
                items = [item.strip() for item in re.split(r'\n[\*\-]\s+', p) if item.strip()]
                for item in items:
                    item_clean = item.lstrip('* ').lstrip('- ')
                    story.append(Paragraph(f"• {item_clean}", body_style))
            else:
                story.append(Paragraph(p, body_style))
                
    # Append Pending or Failed Submissions separately
    if pending_failed:
        story.append(Spacer(1, 12))
        story.append(Paragraph("Pending or Failed Submissions", h1_style))
        story.append(Paragraph("The following team submissions are currently incomplete or failed validation:", body_style))
        for r in pending_failed:
            user_info = r.get("users") or {}
            name = user_info.get("name") or user_info.get("email") or "Unknown Employee"
            status = (r.get("analysis_status") or "pending").upper()
            story.append(Paragraph(f"• {name} - Status: {status}", alert_style))
            
    doc.build(story)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes

def send_email_with_pdf(to_email: str, subject: str, body_html: str, pdf_bytes: bytes, filename: str) -> bool:
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.mime.base import MIMEBase
    from email import encoders

    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")
    from_email = os.getenv("FROM_EMAIL", smtp_user)

    if not smtp_user or not smtp_pass:
        print("[Reports SMTP] Credentials not configured")
        return False

    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email

    msg.attach(MIMEText(body_html, "html"))

    part = MIMEBase("application", "octet-stream")
    part.set_payload(pdf_bytes)
    encoders.encode_base64(part)
    part.add_header(
        "Content-Disposition",
        f"attachment; filename={filename}",
    )
    msg.attach(part)

    try:
        server = smtplib.SMTP(smtp_host, smtp_port)
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(from_email, to_email, msg.as_string())
        server.quit()
        print(f"[Reports SMTP] Emailed report successfully to {to_email}")
        return True
    except Exception as e:
        print(f"[Reports SMTP Error] Failed to send email to {to_email}:", e)
        return False

@router.post("/generate")
async def generate_report(
    payload: ReportGenerateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    # 1. Authorize - only Admins/Managers can access submissions analysis
    if not is_user_admin(auth_ctx.user_id):
        raise HTTPException(
            status_code=403,
            detail="Forbidden: Only administrators or managers can generate analysis reports."
        )

    company_id = auth_ctx.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company ID not resolved from context.")

    # 2. Fetch Task Details
    task_res = (
        supabase.table("tasks")
        .select("title, description")
        .eq("task_id", payload.task_id)
        .eq("company_id", company_id)
        .maybe_single()
        .execute()
    )
    task = task_res.data or {}
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    task_title = task.get("title", "Task")

    # 3. Query Task Submissions inside duration filter
    query = (
        supabase.table("task_submissions")
        .select("*, users(name, email)")
        .eq("task_id", payload.task_id)
        .eq("company_id", company_id)
    )

    if payload.duration == "30_days":
        start_date = (datetime.utcnow() - timedelta(days=30)).isoformat()
        query = query.gte("submitted_at", start_date)
    elif payload.duration == "90_days":
        start_date = (datetime.utcnow() - timedelta(days=90)).isoformat()
        query = query.gte("submitted_at", start_date)

    submissions_res = query.execute()
    submissions = submissions_res.data or []

    if not submissions:
        raise HTTPException(status_code=404, detail="No submissions found for the selected parameters.")

    # 4. Partition completed vs pending/failed
    completed_records = [r for r in submissions if r.get("analysis_status") == "completed"]
    pending_failed_records = [r for r in submissions if r.get("analysis_status") != "completed"]

    if not completed_records:
        # Build minimal PDF with only pending list if no analysis completed yet
        pdf_bytes = build_pdf_report(
            task_title,
            "1. TEAM SUMMARY:\nNo completed submission analysis records exist for this period yet.",
            pending_failed_records
        )
    else:
        # 5. Extract JSON and formulate combined prompt
        submissions_summary = []
        for r in completed_records:
            user_info = r.get("users") or {}
            name = user_info.get("name") or user_info.get("email") or "Unknown Employee"
            analysis = r.get("ai_analysis") or {}
            
            # Fallbacks to support older rows or new schemas cleanly
            metrics = analysis.get("metrics") or {}
            submissions_summary.append({
                "employee": name,
                "score": r.get("score") or analysis.get("overall_score") or 0,
                "strengths": analysis.get("strengths") or [],
                "weaknesses": analysis.get("weaknesses") or [],
                "detected_issues": analysis.get("detected_issues") or metrics.get("issues") or [],
                "improvement_points": analysis.get("improvement_points") or metrics.get("recommendations") or []
            })

        gemini_prompt = f"""
        You are a corporate training performance analyst.
        
        Synthesize the following task submission evaluations for the team:
        Task Name: {task_title}
        Number of completed submissions analyzed: {len(completed_records)}
        
        Submissions Data:
        {json.dumps(submissions_summary, indent=2)}
        
        Generate a comprehensive team training report. You must structure it with these exact headings:
        1. TEAM SUMMARY: A concise overall summary of the team's performance.
        2. TOP PERFORMERS: The top 3 performers and what they did exceptionally well.
        3. EMPLOYEES NEEDING IMPROVEMENT: List employees with lower scores and their main struggles.
        4. COMMON PROBLEMS: The most common mistakes or issues observed across the team.
        5. SKILL GAPS: Key skill areas where the team lacks proficiency.
        6. FUTURE IMPROVEMENT PLAN: Actionable recommendations for training.
        7. STANDARD PROCESS NEXT TIME: Clear step-by-step instructions on what process the team should follow for similar tasks next time.
        """

        try:
            # Query Gemini Flash to synthesize the report
            client = genai.Client(api_key=os.getenv("GEMINI_API_KEY") or "")
            gemini_res = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=gemini_prompt
            )
            report_text = gemini_res.text or ""
        except Exception as e:
            print("[Reports API] Gemini generation failed:", e)
            report_text = "1. TEAM SUMMARY:\nUnable to compile summary insights via Gemini at this time."

        # 6. Generate ReportLab PDF
        pdf_bytes = build_pdf_report(task_title, report_text, pending_failed_records)

    # 7. Email PDF to Admin
    admin_email = payload.admin_email or auth_ctx.email
    if admin_email:
        email_body = f"""
        <html>
        <body>
            <h3>Lucid Admin Report Generated</h3>
            <p>Hello,</p>
            <p>Your team performance report for the task <b>{task_title}</b> has been compiled and is attached below.</p>
            <p>Best regards,<br>Lucid Platform Team</p>
        </body>
        </html>
        """
        send_email_with_pdf(
            to_email=admin_email,
            subject=f"Lucid Performance Report: {task_title}",
            body_html=email_body,
            pdf_bytes=pdf_bytes,
            filename=f"Lucid_Report_{payload.task_id[:8]}.pdf"
        )

    # 8. Return PDF bytes directly as response for download
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=Lucid_Report_{payload.task_id[:8]}.pdf"
        }
    )
