import os
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict

logger = logging.getLogger(__name__)

def _smtp_settings() -> Dict[str, Any]:
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")
    from_email = os.getenv("FROM_EMAIL", smtp_user)
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")

    if not smtp_user or not smtp_pass:
        logger.warning("SMTP credentials not configured on server")

    return {
        "smtp_host": smtp_host,
        "smtp_port": smtp_port,
        "smtp_user": smtp_user,
        "smtp_pass": smtp_pass,
        "from_email": from_email,
        "frontend_url": frontend_url,
    }

async def send_manager_daily_report_email(manager_email: str, manager_name: str, report_date: str, manager_summary: Dict[str, Any], insights: Dict[str, Any]) -> bool:
    settings = _smtp_settings()
    if not settings["smtp_user"]:
        return False
        
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Daily Team Report - {report_date}"
        msg["From"] = settings["from_email"]
        msg["To"] = manager_email
        
        # Build HTML content
        html_content = f"""
        <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
               
                <div style="
                    background: linear-gradient(135deg,#1e3a8a,#2563eb);
                    color:white;
                    padding:24px;
                    border-radius:10px;
                    text-align:center;
                ">
                    <h2 style="margin:0;">Daily Team Report</h2>
                    <p style="margin:8px 0 0 0;">{report_date}</p>
                </div>
                <p>Hello {manager_name},</p>
                
                <table width="100%" cellpadding="10" cellspacing="10">
                <tr>

                <td align="center"
                style="background:#eff6ff;border-radius:8px;">
                <h2 style="margin:0;color:#2563eb;">
                {insights.get('team_members',0)}
                </h2>
                <div>Team Members</div>
                </td>

                <td align="center"
                style="background:#ecfdf5;border-radius:8px;">
                <h2 style="margin:0;color:#16a34a;">
                {insights.get('report_count',0)}
                </h2>
                <div>Reports</div>
                </td>

                <td align="center"
                style="background:#fff7ed;border-radius:8px;">
                <h2 style="margin:0;color:#ea580c;">
                {insights.get('missing_reports_count',0)}
                </h2>
                <div>Missing</div>
                </td>

                <td align="center"
                style="background:#fef2f2;border-radius:8px;">
                <h2 style="margin:0;color:#dc2626;">
                {insights.get('open_action_items_count',0)}
                </h2>
                <div>Open Actions</div>
                </td>

                </tr>
                </table>
        """
        
        if manager_summary:
            if manager_summary.get('executive_summary'):
                html_content += f"""
                <h3 style="color: #334155;">Executive Summary</h3>
                <ul>
                """
                for bullet in manager_summary['executive_summary']:
                    html_content += f"<li>{bullet}</li>"
                html_content += "</ul>"
                
            if manager_summary.get('top_action_items'):
                html_content += f"""
                <h3 style="color: #334155;">Top Action Items</h3>
                <ul>
                """
                for ai in manager_summary['top_action_items']:
                    owner = ai.get('owner', 'Unassigned')
                    task = ai.get('task', '')
                    due = ai.get('due_date', 'no date')
                    html_content += f"<li><strong>{owner}</strong>: {task} (Due: {due})</li>"
                html_content += "</ul>"
                
            if manager_summary.get('top_risks'):
                html_content += f"""
                <h3 style="color: #e11d48;">Top Risks</h3>
                <ul>
                """
                for risk in manager_summary['top_risks']:
                    r_text = risk.get('risk', '')
                    sev = risk.get('severity', '')
                    mit = risk.get('mitigation', '')
                    html_content += f"<li><strong>{sev}</strong>: {r_text} <br/> <em>Mitigation: {mit}</em></li>"
                html_content += "</ul>"
                
        html_content += f"""
                <br/>
                <p>View the full report in your Manager Dashboard.</p>

                <p style="margin: 16px 0;">
                    <a href="{settings['frontend_url']}/employee/voice-notes"
                    style="
                            display:inline-block;
                            background:#2563eb;
                            color:white;
                            padding:8px 18px;
                            border-radius:6px;
                            text-decoration:none;
                            font-weight:600;
                            font-size:14px;
                    ">
                        Open Manager Dashboard
                    </a>
                </p>

                <p>Best,<br>Team Lucid</p>

                <hr style="border:none;border-top:1px solid #e2e8f0;">

                <p style="font-size:12px;color:#64748b;">

This report was automatically generated from today's submitted voice updates.

</p>
            </body>
        </html>
        """
        
        part2 = MIMEText(html_content, "html")
        msg.attach(part2)
        
        # We must use asyncio.to_thread for smtplib since it is blocking
        import asyncio
        await asyncio.to_thread(_send_email_sync, msg, settings)
        return True
    except Exception as e:
        logger.error(f"Failed to send manager daily report email: {e}")
        return False

def _send_email_sync(msg: MIMEMultipart, settings: Dict[str, Any]):
    with smtplib.SMTP(settings["smtp_host"], settings["smtp_port"]) as server:
        server.starttls()
        server.login(settings["smtp_user"], settings["smtp_pass"])
        server.send_message(msg)
