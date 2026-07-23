import os
import re
import json
import html
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
    email: Optional[str] = None

def is_user_admin(user_id: str) -> bool:
    try:
        # Check roles via user_role_assignments
        res = (
            supabase.table("user_role_assignments")
            .select("role:roles(name)")
            .eq("user_id", user_id)
            .eq("is_active", True)
            .execute()
        )
        if res.data:
            for row in res.data:
                role_dict = row.get("role")
                if role_dict:
                    role_name = str(role_dict.get("name") or "").lower()
                    if role_name in ("admin", "manager", "super_admin", "developer"):
                        return True
        return False
    except Exception as exc:
        print("[Reports API] Error checking admin status:", exc)
        return False

def clean_text_for_paragraph(text: str) -> str:
    if not text:
        return ""
    # 1. Unescape any html entities first (e.g. &amp; -> &) to avoid double escaping
    text = html.unescape(text)
    
    # 2. Normalize br tags (e.g. <br>, <br /> -> <br/>)
    text = re.sub(r'<br\s*/?>', '<br/>', text, flags=re.IGNORECASE)
    
    # 3. Parse basic markdown bolds/italics to HTML tags
    text = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'\*([^*]+)\*', r'<i>\1</i>', text)
    
    # 4. Map valid tags we want to preserve to placeholders
    placeholders = {
        "__B_OPEN__": "<b>",
        "__B_CLOSE__": "</b>",
        "__I_OPEN__": "<i>",
        "__I_CLOSE__": "</i>",
        "__U_OPEN__": "<u>",
        "__U_CLOSE__": "</u>",
        "__BR__": "<br/>"
    }
    
    # Temporarily substitute valid tags with placeholders
    text = re.sub(r'<b>', '__B_OPEN__', text, flags=re.IGNORECASE)
    text = re.sub(r'</b>', '__B_CLOSE__', text, flags=re.IGNORECASE)
    text = re.sub(r'<i>', '__I_OPEN__', text, flags=re.IGNORECASE)
    text = re.sub(r'</i>', '__I_CLOSE__', text, flags=re.IGNORECASE)
    text = re.sub(r'<u>', '__U_OPEN__', text, flags=re.IGNORECASE)
    text = re.sub(r'</u>', '__U_CLOSE__', text, flags=re.IGNORECASE)
    text = re.sub(r'<br/>', '__BR__', text, flags=re.IGNORECASE)
    
    # 5. Escape special XML/HTML characters
    text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    
    # 6. Restore valid tags
    for placeholder, tag in placeholders.items():
        text = text.replace(placeholder, tag)
        
    return text

def is_separator_line(line: str) -> bool:
    line = line.strip()
    if not line or '|' not in line:
        return False
    cleaned = line.replace('|', '').replace('-', '').replace(':', '').replace(' ', '').replace('\t', '')
    return cleaned == ''

def parse_markdown_table(text: str):
    lines = [line.strip() for line in text.strip().split('\n') if line.strip()]
    headers = []
    rows = []
    
    if not lines:
        return headers, rows
        
    header_line = lines[0]
    raw_headers = [col.strip() for col in header_line.split('|')]
    if header_line.startswith('|') and len(raw_headers) > 1:
        raw_headers = raw_headers[1:]
    if header_line.endswith('|') and len(raw_headers) > 0:
        raw_headers = raw_headers[:-1]
    
    headers = [col.strip() for col in raw_headers]
    
    for line in lines[2:]:
        raw_cols = [col.strip() for col in line.split('|')]
        if line.startswith('|') and len(raw_cols) > 1:
            raw_cols = raw_cols[1:]
        if line.endswith('|') and len(raw_cols) > 0:
            raw_cols = raw_cols[:-1]
        rows.append([col.strip() for col in raw_cols])
        
    num_cols = len(headers)
    for i, r in enumerate(rows):
        if len(r) < num_cols:
            rows[i] = r + [''] * (num_cols - len(r))
        elif len(r) > num_cols:
            rows[i] = r[:num_cols]
            
    return headers, rows

def add_text_or_bullets(text_block: str, story: list, body_style: ParagraphStyle):
    text_block = text_block.strip()
    if not text_block:
        return
        
    if text_block.startswith('* ') or text_block.startswith('- '):
        items = [item.strip() for item in re.split(r'\n[\*\-]\s+', text_block) if item.strip()]
        for item in items:
            item_clean = item.lstrip('* ').lstrip('- ')
            cleaned = clean_text_for_paragraph(item_clean)
            story.append(Paragraph(f"• {cleaned}", body_style))
    else:
        cleaned = clean_text_for_paragraph(text_block)
        story.append(Paragraph(cleaned, body_style))

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
    story.append(Paragraph(f"Lucid Coaching Report", title_style))
    story.append(Paragraph(f"Task: {task_title} | Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC", subtitle_style))
    story.append(Spacer(1, 10))

    # Parse headings from Gemini output
    # Splits text on headings starting with "1. ", "2. ", "SECTION X", etc.
    parts = re.split(r'\n(?=(?:SECTION\s+\d+|\d\.\s+[A-Za-z\s]+:?))', report_text, flags=re.IGNORECASE)
    cell_style_counter = 0
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
        
        story.append(Paragraph(clean_text_for_paragraph(header_clean), h1_style))
        
        # Format paragraph lines
        body_content = "\n".join(body_lines).strip()
        
        paragraphs = body_content.split('\n\n')
        for p in paragraphs:
            p = p.strip()
            if not p:
                continue
            
            p_lines = p.split('\n')
            i = 0
            current_text_lines = []
            while i < len(p_lines):
                if i + 1 < len(p_lines) and is_separator_line(p_lines[i+1]):
                    # Flush accumulated text lines
                    if current_text_lines:
                        text_block = "\n".join(current_text_lines).strip()
                        if text_block:
                            add_text_or_bullets(text_block, story, body_style)
                        current_text_lines = []
                    
                    # Extract table lines
                    table_lines = [p_lines[i], p_lines[i+1]]
                    i += 2
                    while i < len(p_lines) and '|' in p_lines[i]:
                        table_lines.append(p_lines[i])
                        i += 1
                        
                    # Parse and render table
                    table_text = "\n".join(table_lines)
                    headers, rows = parse_markdown_table(table_text)
                    if headers:
                        header_cell_style = ParagraphStyle(
                            name=f"HStyle_{id(story)}",
                            parent=styles['Normal'],
                            fontName='Helvetica-Bold',
                            fontSize=9,
                            leading=12,
                            textColor=colors.white
                        )
                        body_cell_style = ParagraphStyle(
                            name=f"BStyle_{id(story)}",
                            parent=styles['Normal'],
                            fontName='Helvetica',
                            fontSize=8.5,
                            leading=11.5,
                            textColor=text_color
                        )
                        
                        header_paragraphs = []
                        for h_idx, col in enumerate(headers):
                            cell_style_counter += 1
                            p_style = ParagraphStyle(
                                name=f"CellH_{cell_style_counter}",
                                parent=header_cell_style
                            )
                            header_paragraphs.append(Paragraph(clean_text_for_paragraph(col), p_style))
                            
                        data_rows_flowables = []
                        for row_idx, r in enumerate(rows):
                            row_flowables = []
                            for col_idx, col in enumerate(r):
                                cell_style_counter += 1
                                p_style = ParagraphStyle(
                                    name=f"CellB_{cell_style_counter}",
                                    parent=body_cell_style
                                )
                                row_flowables.append(Paragraph(clean_text_for_paragraph(col), p_style))
                            data_rows_flowables.append(row_flowables)
                            
                        table_data = [header_paragraphs] + data_rows_flowables
                        
                        num_cols = len(headers)
                        if num_cols == 2:
                            col_widths = [160, 344]
                        elif num_cols == 3:
                            col_widths = [120, 192, 192]
                        elif num_cols == 4:
                            col_widths = [90, 140, 140, 134]
                        else:
                            col_widths = [504 / num_cols] * num_cols
                            
                        t = Table(table_data, colWidths=col_widths)
                        
                        t_style = TableStyle([
                            ('BACKGROUND', (0, 0), (-1, 0), primary_color),
                            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                            ('TOPPADDING', (0, 0), (-1, -1), 6),
                            ('LEFTPADDING', (0, 0), (-1, -1), 8),
                            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
                        ])
                        
                        for r_idx in range(1, len(rows) + 1):
                            bg_color = colors.HexColor('#F8FAFC') if r_idx % 2 == 1 else colors.HexColor('#FFFFFF')
                            t_style.add('BACKGROUND', (0, r_idx), (-1, r_idx), bg_color)
                            
                        t.setStyle(t_style)
                        story.append(Spacer(1, 8))
                        story.append(t)
                        story.append(Spacer(1, 8))
                else:
                    current_text_lines.append(p_lines[i])
                    i += 1
            
            if current_text_lines:
                text_block = "\n".join(current_text_lines).strip()
                if text_block:
                    add_text_or_bullets(text_block, story, body_style)
                
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
    from utils.task_resolver import resolve_task_details
    task = resolve_task_details(payload.task_id, company_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    task_title = task.get("title", "Task")
    task_description = task.get("description", "")

    parent_task_id = task.get("parent_task_id")
    bundle_tasks = task.get("bundle_tasks") or []

    if parent_task_id is not None:
        # Case 3: Specific child task of a bundle
        table_name = "child_task_submissions"
        id_column = "child_task_id"
        query_task_id = payload.task_id
        needs_manual_user_join = True
    elif len(bundle_tasks) > 0:
        # Case 2: Parent bundle task
        table_name = "child_task_submissions"
        id_column = "parent_task_id"
        query_task_id = payload.task_id
        needs_manual_user_join = True
    else:
        # Case 1: Normal task
        table_name = "task_submissions"
        id_column = "task_id"
        query_task_id = payload.task_id
        needs_manual_user_join = False

    select_clause = "*" if needs_manual_user_join else "*, users:users!task_submissions_user_id_fkey(name, email)"

    # 3. Query Task Submissions inside duration filter
    query = (
        supabase.table(table_name)
        .select(select_clause)
        .eq(id_column, query_task_id)
        .eq("company_id", company_id)
    )

    if payload.duration == "7_days":
        start_date = (datetime.utcnow() - timedelta(days=7)).isoformat()
        query = query.gte("submitted_at", start_date)
    elif payload.duration == "30_days":
        start_date = (datetime.utcnow() - timedelta(days=30)).isoformat()
        query = query.gte("submitted_at", start_date)
    elif payload.duration == "90_days":
        start_date = (datetime.utcnow() - timedelta(days=90)).isoformat()
        query = query.gte("submitted_at", start_date)

    submissions_res = query.execute()
    submissions = submissions_res.data or []

    # Manually populate users for bundle reports since the foreign key relation doesn't exist
    if needs_manual_user_join and submissions:
        user_ids = list(set([s.get("user_id") for s in submissions if s.get("user_id")]))
        if user_ids:
            users_res = supabase.table("users").select("user_id, name, email").in_("user_id", user_ids).execute()
            users_dict = {u.get("user_id"): {"name": u.get("name"), "email": u.get("email")} for u in (users_res.data or [])}
            for s in submissions:
                s["users"] = users_dict.get(s.get("user_id"), {})

    # Map subtask titles for parent bundle tasks
    if len(bundle_tasks) > 0 and parent_task_id is None and submissions:
        child_task_ids = list(set([s.get("child_task_id") for s in submissions if s.get("child_task_id")]))
        if child_task_ids:
            ct_res = supabase.table("child_tasks").select("child_task_id, title").in_("child_task_id", child_task_ids).execute()
            ct_dict = {ct.get("child_task_id"): ct.get("title") for ct in (ct_res.data or [])}
            for s in submissions:
                s["subtask_title"] = ct_dict.get(s.get("child_task_id"), task_title)
    else:
        for s in submissions:
            s["subtask_title"] = task_title

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
            analysis_raw = r.get("ai_analysis")
            if isinstance(analysis_raw, str):
                try:
                    analysis = json.loads(analysis_raw)
                except json.JSONDecodeError:
                    analysis = {}
            else:
                analysis = analysis_raw or {}
            # Normalize score (e.g. 1/1 binary scores to 100%)
            raw_score = r.get("score") or analysis.get("overall_score") or 0
            max_score = r.get("max_score") or 100
            if max_score > 0 and max_score <= 5:
                normalized_score = int((raw_score / max_score) * 100)
            else:
                normalized_score = raw_score
            
            task_insights = analysis.get("task_insights")
            quality_analysis = analysis.get("quality_analysis")
            
            # Fallback for legacy database rows where task_insights or quality_analysis is missing
            if not task_insights:
                strengths = analysis.get("strengths") or []
                weaknesses = analysis.get("weaknesses") or []
                task_insights = {
                    "summary": strengths[0] if strengths else "No summary available.",
                    "measurable_outcomes": [
                        {
                            "name": "overall_score",
                            "value": normalized_score,
                            "confidence": "high",
                            "evidence": "Completed with score"
                        }
                    ],
                    "actions_taken": strengths,
                    "unique_methods": [],
                    "challenges": weaknesses,
                    "learnings": [],
                    "missing_information": [],
                    "extraction_confidence": "medium"
                }
                
            if not quality_analysis:
                metrics = analysis.get("metrics") or {}
                quality_analysis = {
                    "technical_score": normalized_score,
                    "metrics_detail": metrics
                }
            
            submissions_summary.append({
                "employee": name,
                "subtask": r.get("subtask_title"),
                "status": r.get("status"),
                "task_insights": task_insights,
                "quality_analysis": quality_analysis
            })

        gemini_prompt = f"""
You are an Enterprise Performance Reporting Assistant.

Your job is NOT to write an AI report.

Your job is to create a management dashboard that helps a manager understand the team's performance within 2 minutes.

The report should answer only these questions:

1. Who is performing well?
2. Who needs coaching?
3. Which tasks are causing the most problems?
4. What actions should the manager take?

If any section does not help answer one of these questions, DO NOT include it.

==========================================================
GENERAL RULES
==========================================================

• Think like an Operations Manager, not an AI model.
• Think like Excel, not ChatGPT.
• Keep the report extremely easy to scan.
• Prefer tables over paragraphs.
• One row = one business record.
• Never repeat the same information.
• Every section should provide NEW information.
• Avoid long explanations.
• Maximum comment length: one sentence.
• No HTML.
• No CSS.
• No Markdown code blocks.
• No decorative formatting.
• No AI terminology.
• Tables MUST be formatted as proper markdown tables with a separator line (e.g. |---|---|). Do not skip the separator line.

Never use words such as

- Semantic Similarity
- CLIP
- OCR
- YOLO
- Gemini
- Confidence
- Object Detection
- Verification Criteria

Instead use simple business language.

Examples

"The uploaded image does not match the assigned task."

"The required item is not visible."

"The submission is incomplete."

"The uploaded image is unclear."

==========================================================
REPORT STRUCTURE
==========================================================

SECTION 1
EXECUTIVE SUMMARY

Display only a KPI table.

| Metric | Value |
|--------|-------|
| Total Employees | ... |
| Total Tasks | ... |
| Total Submissions | ... |
| Completed | ... |
| Passed | ... |
| Needs Review | ... |
| Average Score | ... |
| Best Performer | ... |
| Lowest Performer | ... |

Maximum one sentence summarizing the team's overall performance.

----------------------------------------------------------

SECTION 2
EMPLOYEES REQUIRING ATTENTION

This should be the MOST IMPORTANT section.

Show ONLY employees needing manager action.

| Employee | Score | Tasks Needing Review | Main Issue | Recommended Action |
|----------|-------|----------------------|------------|--------------------|
| ...      | ...   | ...                  | ...        | ...                |

----------------------------------------------------------

SECTION 3
TASK PERFORMANCE

One row per subtask.

| Subtask | Avg Score | Pass Rate | Employees Reviewed | Main Issue |
|---------|-----------|-----------|--------------------|------------|
| ...     | ...       | ...       | ...                | ...        |

Sort from lowest score to highest.

Manager should immediately know which task requires improvement.

----------------------------------------------------------

SECTION 4
EMPLOYEE LEADERBOARD

One row per employee.

| Rank | Employee | Avg Score | Passed | Review | Status |
|------|----------|-----------|--------|--------|--------|
| ...  | ...      | ...       | ...    | ...    | ...    |

Status examples: Excellent, Good, Satisfactory, Needs Coaching
Sort by score descending.

----------------------------------------------------------

SECTION 5
ACTION ITEMS

Generate only actionable items.

| Priority | Action | Owner |
|----------|--------|-------|
| ...      | ...    | ...   |

----------------------------------------------------------

SECTION 6
OPTIONAL DETAILS

Generate this section ONLY for employees who require coaching.

For each employee generate ONE table.

Employee Name

| Subtask | Score | Issue | Recommendation |
|---------|-------|-------|----------------|
| ...     | ...   | ...   | ...            |

Maximum one sentence in Issue.
Maximum one sentence in Recommendation.

DO NOT explain the AI analysis.
DO NOT explain technical metrics.
DO NOT write paragraphs.
DO NOT include employees who passed all tasks.

==========================================================
WHAT NOT TO DO
==========================================================

Do NOT generate

Long reports
Essays
Repeated summaries
Repeated recommendations
Paragraphs for every employee
Paragraphs for every submission
Technical explanations
AI explanations
Storytelling

==========================================================
SCALABILITY
==========================================================

The report must remain readable if

5 employees
50 employees
500 employees
5000 employees

If there are many employees

Summarize first.

Only expand details for employees requiring manager intervention.

==========================================================
FINAL GOAL
==========================================================

The manager should be able to answer these questions within 2 minutes:

• Who needs coaching?
• Which task is failing?
• Who are the top performers?
• What actions should I take today?

If the report does not help answer these questions quickly, simplify it further.

The report should feel like an enterprise MIS dashboard or executive review sheet rather than an AI-generated report.

Here is the data you must analyze:
Task Name: {task_title}
Task Description: {task_description}

Submissions Data JSON (contains employees, their subtasks, status, scores, and analysis):
{json.dumps(submissions_summary, indent=2)}
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
            report_text = "1. Overall Team Outcome:\nUnable to compile summary insights via Gemini at this time."

        # 6. Generate ReportLab PDF
        pdf_bytes = build_pdf_report(task_title, report_text, pending_failed_records)

    # 7. Email PDF to Admin
    admin_email = payload.admin_email or payload.email or auth_ctx.email
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
