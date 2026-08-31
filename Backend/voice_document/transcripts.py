import datetime
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from utils.auth import RequestAuth, get_request_auth_required
from utils.db.voice_transcript_db import (
    create_voice_daily_report,
    create_voice_transcript,
    get_voice_daily_report_by_id,
    get_voice_daily_report_by_user_date,
    get_voice_transcript_by_id,
    is_user_a_manager,
    list_reports_for_user_ids,
    list_team_user_ids,
    fetch_user_profiles,
    list_voice_daily_reports,
    list_voice_transcripts,
    soft_delete_voice_transcript,
    update_voice_daily_report,
    update_voice_transcript,
)
from .agent import VoiceDocumentAgent

router = APIRouter(prefix="/api/voice-transcripts", tags=["voice-transcripts"])


class VoiceTranscriptCreateRequest(BaseModel):
    title: str
    raw_transcript: str
    audio_url: Optional[str] = None
    transcript_date: Optional[str] = None


class VoiceTranscriptUpdateRequest(BaseModel):
    title: Optional[str] = None
    edited_transcript: Optional[str] = None
    final_transcript: Optional[str] = None


class GenerateDailyReportRequest(BaseModel):
    user_id: Optional[str] = None
    report_date: Optional[str] = None
    report_title: Optional[str] = None


class VoiceDailyReportUpdateRequest(BaseModel):
    report_title: Optional[str] = None
    summary_text: Optional[str] = None
    structured_json: Optional[Dict[str, Any]] = None
    renderable_content: Optional[Dict[str, Any]] = None
    combined_transcript: Optional[str] = None


def _normalize_report_date(value: Optional[str]) -> str:
    if not value:
        return datetime.date.today().isoformat()
    try:
        return datetime.date.fromisoformat(value).isoformat()
    except Exception:
        raise HTTPException(status_code=400, detail="report_date must be a valid ISO date string")


@router.post("/")
async def create_transcript(
    request: VoiceTranscriptCreateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    if not request.title or not request.raw_transcript:
        raise HTTPException(status_code=400, detail="title and raw_transcript are required")

    payload: Dict[str, Any] = {
        "title": request.title.strip(),
        "raw_transcript": request.raw_transcript.strip(),
        "edited_transcript": None,
        "final_transcript": None,
        "audio_url": request.audio_url,
        "transcript_date": request.transcript_date or datetime.date.today().isoformat(),
    }

    result = await create_voice_transcript(auth_ctx.user_id, payload)
    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])

    return {"success": True, "transcript": result.get("data")}


@router.patch("/daily-reports/{report_id}")
async def update_daily_report(
    report_id: str,
    request: VoiceDailyReportUpdateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    updates = request.dict(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = await update_voice_daily_report(auth_ctx.user_id, report_id, updates)
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])

    return {"success": True, "report": result.get("data")}


@router.get("/")
async def list_transcripts(
    transcript_date: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = 100,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    if not transcript_date:
        transcript_date = datetime.date.today().isoformat()

    result = await list_voice_transcripts(
        auth_ctx.user_id,
        user_id=user_id,
        transcript_date=transcript_date,
        include_deleted=False,
        limit=limit,
    )
    if result.get("error"):
        raise HTTPException(status_code=403, detail=result["error"])

    return {
        "transcripts": result.get("data") or [],
        "count": len(result.get("data") or []),
        "report_date": transcript_date,
    }





@router.post("/daily-reports/generate")
async def generate_daily_report(
    request: GenerateDailyReportRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    report_date = _normalize_report_date(request.report_date)
    target_user_id = request.user_id or auth_ctx.user_id

    transcripts_result = await list_voice_transcripts(
        auth_ctx.user_id,
        user_id=target_user_id,
        transcript_date=report_date,
        include_deleted=False,
        limit=200,
    )
    if transcripts_result.get("error"):
        raise HTTPException(status_code=403, detail=transcripts_result["error"])

    transcripts = transcripts_result.get("data") or []
    if not transcripts:
        raise HTTPException(status_code=400, detail="No transcripts found for the selected date")

    combined_transcript = "\n\n".join(
        [
            f"Title: {item.get('title') or 'Untitled'}\n{item.get('edited_transcript') or item.get('raw_transcript') or ''}"
            for item in transcripts
        ]
    )

    report_title = request.report_title or f"Daily Report {report_date}"

    agent = VoiceDocumentAgent()
    try:
        generated = await agent.generate_daily_report(
            combined_transcript,
            report_title=report_title,
            output_format="docx",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Daily report generation failed: {exc}")

    report_payload: Dict[str, Any] = {
        "user_id": target_user_id,
        "report_date": report_date,
        "report_title": report_title,
        "combined_transcript": combined_transcript,
        "summary_text": generated.get("summary_text"),
        "structured_json": generated.get("structured_json"),
        "renderable_content": generated.get("renderable_content"),
        "model_used": generated.get("model_used"),
        "status": "ready",
        "source_transcript_ids": [item.get("transcript_id") for item in transcripts if item.get("transcript_id")],
    }

    existing_report = await get_voice_daily_report_by_user_date(auth_ctx.user_id, target_user_id, report_date)
    if existing_report.get("error") is None and existing_report.get("data"):
        report = await update_voice_daily_report(auth_ctx.user_id, existing_report["data"]["report_id"], report_payload)
    else:
        report = await create_voice_daily_report(auth_ctx.user_id, report_payload)

    if report.get("error"):
        raise HTTPException(status_code=500, detail=report["error"])

    return {"success": True, "report": report.get("data")}


@router.get("/daily-reports")
async def list_daily_reports(
    report_date: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = 100,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    result = await list_voice_daily_reports(
        auth_ctx.user_id,
        user_id=user_id,
        report_date=report_date,
        limit=limit,
    )
    if result.get("error"):
        raise HTTPException(status_code=403, detail=result["error"])

    return {"reports": result.get("data") or [], "count": len(result.get("data") or [])}


@router.get("/daily-reports/{report_id}")
async def get_daily_report(
    report_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    result = await get_voice_daily_report_by_id(auth_ctx.user_id, report_id)
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])

    return {"report": result.get("data")}


@router.get("/check-manager-status")
async def check_manager_status(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
):
    """Check if the authenticated user is a manager (has direct reports).

    Returns: { is_manager: bool }
    """
    effective_user_id = x_user_id or auth_ctx.user_id
    result = await is_user_a_manager(effective_user_id)
    if result.get("error"):
        raise HTTPException(status_code=403, detail=result["error"])

    return {"is_manager": result.get("data", False)}


# Transcript-specific endpoints placed after daily-reports to avoid shadowing
@router.get("/{transcript_id}")
async def get_transcript(
    transcript_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    result = await get_voice_transcript_by_id(auth_ctx.user_id, transcript_id)
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    return {"transcript": result.get("data")}


@router.patch("/{transcript_id}")
async def patch_transcript(
    transcript_id: str,
    request: VoiceTranscriptUpdateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    updates = request.dict(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = await update_voice_transcript(auth_ctx.user_id, transcript_id, updates)
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])

    return {"success": True, "transcript": result.get("data")}


@router.delete("/{transcript_id}")
async def delete_transcript(
    transcript_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    result = await soft_delete_voice_transcript(auth_ctx.user_id, transcript_id)
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])

    return {"success": True, "transcript": result.get("data")}


@router.get("/manager/team-reports")
async def get_manager_team_reports(
    report_date: Optional[str] = None,
    limit: int = 100,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Fetch aggregated daily reports for all team members managed by the authenticated user.
    
    Returns reports for all users where manager_id = auth_ctx.user_id, with optional date filter.
    Includes numerical insights: count of reports, count of team members, avg summary length.
    """
    # Step 1: Get list of team user IDs
    team_result = await list_team_user_ids(auth_ctx.user_id)
    if team_result.get("error"):
        raise HTTPException(status_code=403, detail=team_result["error"])
    
    team_user_ids = team_result.get("data") or []
    if not team_user_ids:
        return {
            "team_members": 0,
            "reports": [],
            "report_count": 0,
            "avg_summary_length": 0,
            "insights": "No team members found.",
        }
    
    # Step 2: Fetch daily reports for all team members
    if not report_date:
        report_date = datetime.date.today().isoformat()
    
    reports_result = await list_reports_for_user_ids(team_user_ids, report_date=report_date, limit=limit)
    if reports_result.get("error"):
        raise HTTPException(status_code=403, detail=reports_result["error"])
    
    reports = reports_result.get("data") or []

    # Enrich reports with user display names
    try:
        user_profiles_result = await fetch_user_profiles(team_user_ids)
        profiles = user_profiles_result.get("data") or []
        user_name_map = {p.get("user_id"): p.get("full_name") for p in profiles}
    except Exception:
        user_name_map = {}

    for r in reports:
        uid = r.get("user_id")
        if uid and uid in user_name_map:
            r["user_name"] = user_name_map.get(uid)
        else:
            r["user_name"] = None

    # Step 3: Fetch manager summary and insights from DB
    from utils.db.manager_daily_report_db import get_manager_daily_report_from_db
    saved_report = await get_manager_daily_report_from_db(auth_ctx.user_id, report_date)
    
    if saved_report:
        manager_summary = saved_report.get("manager_summary")
        insights = saved_report.get("insights")
    else:
        manager_summary = None
        insights = None

    return {
        "report_date": report_date,
        "team_members": len(team_user_ids),
        "report_count": len(reports),
        "reports": reports,
        "insights": insights,
        "manager_summary": manager_summary,
    }


class GenerateManagerReportRequest(BaseModel):
    report_date: Optional[str] = None

@router.post("/manager/team-reports/generate")
async def generate_and_send_manager_report(
    request: GenerateManagerReportRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Generate the manager's report for a specific day, save to DB, and email it."""
    report_date = request.report_date or datetime.date.today().isoformat()
    
    # 1. First, fetch all the team reports to get the underlying data
    team_result = await list_team_user_ids(auth_ctx.user_id)
    if team_result.get("error"):
        raise HTTPException(status_code=403, detail=team_result["error"])
    
    team_user_ids = team_result.get("data") or []
    if not team_user_ids:
        raise HTTPException(status_code=400, detail="No team members found.")
        
    reports_result = await list_reports_for_user_ids(team_user_ids, report_date=report_date, limit=100)
    reports = reports_result.get("data") or []
    
    report_count = len(reports)
    team_count = len(team_user_ids)

    # Identify team members who did not submit a report
    reported_user_ids = {str(r.get("user_id")) for r in reports if r.get("user_id")}
    missing_user_ids = [uid for uid in team_user_ids if str(uid) not in reported_user_ids]

    # Aggregate action items, risks, follow-ups across reports
    aggregated_action_items = []
    aggregated_risks = []
    aggregated_follow_ups = []
    topics_counter: Dict[str, int] = {}

    for r in reports:
        rc = r.get("renderable_content") or {}
        # action_items may be list of dicts
        for ai in rc.get("action_items") or []:
            aggregated_action_items.append({**ai, "report_id": r.get("report_id"), "user_id": r.get("user_id")})
            # Tokenize task text to collect simple topic keywords
            task_text = (ai.get("task") or "").lower()
            for word in (task_text.split()[:6]):
                topics_counter[word] = topics_counter.get(word, 0) + 1

        for risk in rc.get("risks") or []:
            aggregated_risks.append({**risk, "report_id": r.get("report_id"), "user_id": r.get("user_id")})

        for fu in rc.get("follow_ups") or []:
            aggregated_follow_ups.append({"text": fu, "report_id": r.get("report_id"), "user_id": r.get("user_id")})

    open_actions = [ai for ai in aggregated_action_items if (ai.get("status") or "open").lower() != "closed"]

    # Top topics heuristic
    top_topics = sorted(((k, v) for k, v in topics_counter.items() if k.isalpha()), key=lambda x: x[1], reverse=True)[:8]

    insights = {
        "team_members": team_count,
        "report_count": report_count,
        "missing_reports_count": len(missing_user_ids),
        "missing_user_ids": missing_user_ids,
        "open_action_items_count": len(open_actions),
        "total_action_items": len(aggregated_action_items),
        "total_risks": len(aggregated_risks),
        "total_follow_ups": len(aggregated_follow_ups),
        "top_topics": top_topics,
    }

    # Build a concise prompt for the agent using renderable_content from each report
    agent = VoiceDocumentAgent()
    try:
        # Prepare a compact JSON payload of renderable contents (limit size)
        compact_rcs = []
        for r in reports:
            rc = r.get("renderable_content") or {}
            compact_rcs.append({
                "user_id": r.get("user_id"),
                "report_id": r.get("report_id"),
                "title": r.get("report_title") or r.get("report_id"),
                "renderable_content": rc,
            })

        prompt = (
            "You are an executive assistant summarizer for a manager.\n"
            "Input: a JSON array named `reports` where each item has `user_id`, `report_id`, `title`, and `renderable_content`.\n"
            "Each `renderable_content` may include `action_items` (objects with owner, task, due_date, status), `risks`, `follow_ups`, `sections`, and `tables`.\n"
            "Task: Produce JSON ONLY (no explanation) matching this exact schema:\n"
            "{\n"
            "  \"executive_summary\": [\"short bullet 1\", \"short bullet 2\"],\n"
            "  \"top_action_items\": [{\"owner\":\"name\", \"task\":\"...\", \"due_date\":\"YYYY-MM-DD or relative\", \"status\":\"open|closed\", \"user_id\":\"...\", \"report_id\":\"...\", \"source\":\"title\"}],\n"
            "  \"top_risks\": [{\"risk\":\"...\", \"severity\":\"high|medium|low\", \"mitigation\":\"...\", \"user_id\":\"...\", \"report_id\":\"...\"}],\n"
            "  \"follow_ups\": [{\"text\":\"...\", \"user_id\":\"...\", \"report_id\":\"...\"}],\n"
            "  \"insights\": {\"missing_reports_count\":0, \"open_action_items_count\":0, \"total_risks\":0, \"top_topics\":[\"t1\"]}\n"
            "}\n"
            "Constraints:\n"
            "- Return only JSON, no surrounding markdown or explanatory text.\n"
            "- Executive summary: 2-6 terse bullets (max 20 words each) focused on escalations, deadlines, owners, and blockers.\n"
            "- Prioritize action items that include an explicit owner or due date. If a due date is not present, set due_date to null or \"no_due_date\".\n"
            "- For risks, tag severity (high/medium/low) and suggest a short mitigation when possible.\n"
            "- Highlight items that contain keywords: blocked, escalate, urgent, critical, overdue, due, by tomorrow, by EOD.\n"
            "- Limit top_action_items and top_risks to the most critical 20 items.\n"
            "If you cannot identify owners or dates, mark them as null.\n"
            "Now analyze the following reports and produce the JSON described above.\n"
            + json.dumps(compact_rcs)
        )

        # Call the model in a thread
        manager_summary_raw = await __import__("asyncio").to_thread(agent._call_model_text, prompt)
        # Try to parse JSON from model output
        try:
            manager_summary = VoiceDocumentAgent._safe_json_loads(manager_summary_raw) or {"text": manager_summary_raw}
        except Exception:
            manager_summary = {"text": manager_summary_raw}
    except Exception as exc:
        manager_summary = {"error": f"Aggregation failed: {exc}"}

    # If the agent failed or returned non-actionable output, synthesize a concise fallback summary
    if not isinstance(manager_summary, dict) or (
        isinstance(manager_summary, dict) and not any(k in manager_summary for k in ("executive_summary", "top_action_items", "top_risks", "follow_ups", "text"))
    ):
        try:
            lines: List[str] = []
            lines.append(f"Team: {team_count} members; Reports: {report_count}; Missing: {insights.get('missing_reports_count', 0)}; Open actions: {insights.get('open_action_items_count', 0)}.")

            if open_actions:
                lines.append("Top action items:")
                for ai in open_actions[:5]:
                    owner = ai.get("owner") or "Unassigned"
                    task = (ai.get("task") or "").strip().replace("\n", " ")
                    lines.append(f"- {task} (owner: {owner})")

            if aggregated_risks:
                lines.append("Top risks:")
                for r in aggregated_risks[:5]:
                    lines.append(f"- {r.get('risk')}")

            if top_topics:
                top_topic_list = ", ".join([t for t, _ in top_topics[:6]])
                lines.append(f"Top topics: {top_topic_list}")

            fallback_text = "\n".join(lines)
            manager_summary = {
                "text": fallback_text,
                "executive_summary": None,
                "top_action_items": open_actions[:10],
                "top_risks": aggregated_risks[:10],
                "follow_ups": aggregated_follow_ups[:10],
                "insights": insights,
                "fallback": True,
            }
        except Exception:
            manager_summary = {"text": "No aggregated summary available.", "fallback": True}

    
    if not manager_summary or manager_summary.get("error"):
        raise HTTPException(status_code=500, detail="Failed to generate manager summary.")
        
    # 2. Save to DB
    from utils.db.manager_daily_report_db import upsert_manager_daily_report
    await upsert_manager_daily_report(
        manager_id=auth_ctx.user_id,
        report_date=report_date,
        manager_summary=manager_summary,
        insights=insights
    )
    
    # 3. Send Email
    from utils.daily_manager_report_task import send_manager_daily_report_email
    profiles_result = await fetch_user_profiles([auth_ctx.user_id])
    profiles = profiles_result.get("data") or []
    manager_profile = profiles[0] if profiles else {}
    manager_email = manager_profile.get("email")
    manager_name = manager_profile.get("full_name", "Manager")
    
    if manager_email:
        await send_manager_daily_report_email(
            manager_email=manager_email,
            manager_name=manager_name,
            report_date=report_date,
            manager_summary=manager_summary,
            insights=insights
        )
        
    return {"success": True, "message": f"Report for {report_date} generated, saved, and emailed successfully."}

