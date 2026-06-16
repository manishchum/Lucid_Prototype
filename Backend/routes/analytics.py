from fastapi import APIRouter, Header
from utils.auth_bridge import get_service_supabase_client
from utils.redis_client import set_cache, get_cache
import json

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


@router.get("/dashboard/{company_id}")
async def get_dashboard_analytics(
    company_id: str,
    x_user_id: str = Header(...)
):
    """
    Single analytics endpoint.

    Returns:
    - overall stats
    - module stats
    - learning styles
    - assessment stats

    Redis cached.
    """

    cache_key = f"analytics:{company_id}"

    cached = get_cache(cache_key)
    if cached:
        print(f"Analytics cache hit for company_id: {company_id}")
        if isinstance(cached, str):
            return json.loads(cached)
        return cached

    db = get_service_supabase_client()

    # ----------------------------------
    # USERS
    # ----------------------------------

    users_resp = (
        db.table("users")
        .select("user_id")
        .eq("company_id", company_id)
        .execute()
    )

    users = users_resp.data or []

    user_ids = [u["user_id"] for u in users]

    total_employees = len(user_ids)

    # ----------------------------------
    # TRAINING MODULES
    # ----------------------------------

    modules_resp = (
        db.table("training_modules")
        .select("module_id,title")
        .eq("company_id", company_id)
        .execute()
    )

    modules = modules_resp.data or []

    module_ids = [m["module_id"] for m in modules]

    # ----------------------------------
    # LEARNING PLANS
    # ----------------------------------

    plans_resp = (
        db.table("learning_plan")
        .select("*")
        .in_("user_id", user_ids)
        .execute()
    )

    plans = plans_resp.data or []

    total_assignments = len(plans)

    # ----------------------------------
    # LEARNING STYLE
    # ----------------------------------

    style_resp = (
        db.table("employee_learning_style")
        .select("learning_style")
        .in_("user_id", user_ids)
        .execute()
    )

    styles = style_resp.data or []

    style_map = {}

    for row in styles:
        style = row.get("learning_style") or "Unknown"
        style_map[style] = style_map.get(style, 0) + 1

    # ----------------------------------
    # MODULE PROGRESS
    # ----------------------------------

    progress_resp = (
        db.table("module_progress")
        .select("*")
        .in_("user_id", user_ids)
        .execute()
    )

    progress = progress_resp.data or []
    progress_data = progress

    completed_assignments = len(
        [p for p in progress if p.get("completed_at")]
    )
    
    in_progress_assignments = len([
        p for p in progress
        if p.get("started_at")
        and not p.get("completed_at")
    ])

    not_started_assignments = (
        total_assignments - completed_assignments - in_progress_assignments
    )

    active_employees = len(
        set([
            p["user_id"]
            for p in progress
            if p.get("started_at")
        ])
    )
    
    # ----------------------------------
    # MODULE STATS
    # ----------------------------------

    module_stats = []

    for module in modules:

        module_id = module["module_id"]

        module_plans = [
            p for p in plans
            if p.get("module_id") == module_id
        ]

        total_assigned = len(module_plans)

        user_ids_for_module = set(
            p["user_id"]
            for p in module_plans
        )

        module_progress_rows = [
            p for p in progress
            if p.get("user_id") in user_ids_for_module
        ]

        completed = len([
            p for p in module_progress_rows
            if p.get("completed_at")
        ])

        in_progress = len([
            p for p in module_progress_rows
            if p.get("started_at")
            and not p.get("completed_at")
        ])

        not_started = max(
            total_assigned - completed - in_progress,
            0
        )

        completion_rate = (
            round(completed / total_assigned * 100)
            if total_assigned
            else 0
        )

        module_stats.append({
            "moduleId": module_id,
            "title": module["title"],
            "totalAssigned": total_assigned,
            "completed": completed,
            "inProgress": in_progress,
            "notStarted": not_started,
            "completionRate": completion_rate,
            "averageCompletionTime": 0,
            "averageScore": 0,
            "video_seconds_total": 0,
            "video_seconds_watched": 0
        })
    
    # ----------------------------------
    # ASSESSMENTS
    # ----------------------------------

    assessment_resp = (
        db.table("employee_assessments")
        .select("*")
        .in_("user_id", user_ids)
        .execute()
    )

    assessments = assessment_resp.data or []
    
    assessment_stats_map = {}

    for assessment in assessments:

        score = assessment.get("score")
        max_score = assessment.get("max_score")

        assessment_type = (
            assessment.get("type")
            or "Unknown"
        )

        key = assessment_type

        if key not in assessment_stats_map:
            assessment_stats_map[key] = {
                "type": assessment_type,
                "moduleTitle": assessment_type,
                "totalAttempts": 0,
                "completed": 0,
                "scores": []
            }

        stat = assessment_stats_map[key]

        stat["totalAttempts"] += 1

        if score is not None and max_score:
            stat["completed"] += 1
            stat["scores"].append(
                (score / max_score) * 100
            )

    assessment_stats = []

    for item in assessment_stats_map.values():

        assessment_stats.append({
            "type": item["type"],
            "moduleTitle": item["moduleTitle"],
            "totalAttempts": item["totalAttempts"],
            "completed": item["completed"],
            "completionRate": round(
                item["completed"]
                / item["totalAttempts"]
                * 100
            ) if item["totalAttempts"] else 0,
            "averageScore": round(
                sum(item["scores"])
                / len(item["scores"])
            ) if item["scores"] else 0
        })

    assessment_scores = []

    for a in assessments:

        score = a.get("score")
        max_score = a.get("max_score")

        if score is not None and max_score:
            assessment_scores.append(
                (score / max_score) * 100
            )

    average_assessment_score = (
        round(sum(assessment_scores) / len(assessment_scores))
        if assessment_scores
        else 0
    )

    # ----------------------------------
    # KPI STATS
    # ----------------------------------

    kpi_stats = []

    try:

        kpi_resp = (
            db.table("employee_kpi")
            .select("score")
            .eq("company_id", company_id)
            .execute()
        )

        kpis = kpi_resp.data or []

        avg_kpi = (
            round(
                sum(float(k["score"]) for k in kpis)
                / len(kpis)
            )
            if kpis
            else 0
        )

        kpi_stats.append({
            "kpiName": "Overall KPI",
            "averageScore": avg_kpi,
            "totalScores": len(kpis)
        })

    except Exception:
        pass

    response = {
    "overallStats": {
        "totalEmployees": total_employees,
        "activeEmployees": active_employees,
        "totalModules": len(modules),
        "totalAssignments": total_assignments,
        "completedAssignments": completed_assignments,
        "inProgressAssignments": in_progress_assignments,
        "notStartedAssignments": not_started_assignments,
        "averageAssessmentScore": average_assessment_score,
        "totalAssessments": len(assessments),
        "completedAssessments": len(
            [a for a in assessments if a.get("score") is not None]
        ),
        "averageKpiScore": (
            kpi_stats[0]["averageScore"]
            if kpi_stats
            else 0
        )
    },
    "learningStyles": style_map,
    "modules": modules,
    "moduleStats": module_stats,
    "assessmentStats": assessment_stats,
    "progressData": progress_data,
    "kpiStats": kpi_stats
}

    set_cache(
        cache_key,
        json.dumps(response),
        ttl=300
    )

    return response