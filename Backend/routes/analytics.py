from fastapi import APIRouter, Header, Query
from utils.auth_bridge import get_service_supabase_client
from utils.redis_client import set_cache, get_cache
import json
from datetime import datetime, timedelta
from collections import defaultdict

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


@router.get("/dashboard/{company_id}")
async def get_dashboard_analytics(
    company_id: str,
    moduleId:str | None = Query(None),
    assessmentType:str | None = Query(None),
    timeRange:str | None = Query(None),
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

    cache_key = (
        f"analytics:{company_id}:"
        f"{moduleId or 'all'}:"
        f"{assessmentType or 'all'}:"
        f"{timeRange or 'all'}"
    )

    cached = get_cache(cache_key)
    if cached:
        print(f"Analytics cache hit for company_id: {company_id}")
        if isinstance(cached, str):
            return json.loads(cached)
        return cached
    else:
        print(f"Analytics cache miss for company_id: {company_id}")

    db = get_service_supabase_client()

    # ----------------------------------
    # USERS
    # ----------------------------------

    users_resp = (
        db.table("users")
        .select("user_id, name, email")
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
        .select("module_id,title,threshold_value")
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
    if timeRange and timeRange != "all":

        days = int(timeRange)

        cutoff = datetime.utcnow() - timedelta(days=days)

        plans = [
            p
            for p in plans
            if p.get("assigned_on")
            and datetime.fromisoformat(
                p["assigned_on"].replace("Z", "+00:00")
            ) >= cutoff
        ]
    
    if moduleId and moduleId != "all":
        plans = [
            p
            for p in plans
            if p["module_id"] == moduleId
        ]
        modules = [
            m
            for m in modules
            if m["module_id"] == moduleId
        ]

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
    if timeRange and timeRange != "all":
        progress = [
            p
            for p in progress
            if(
                p.get("started_at") or p.get("completed_at")
            )
        ]
    
    progress_lookup = {}

    for row in progress:

        key = (
            row["user_id"],
            row["processed_module_id"]
        )

        progress_lookup[key] = row
    
    user_lookup = {
        u["user_id"]: u
        for u in users
    }  
    
    module_lookup ={
        m["module_id"]:m
        for m in modules
    }
    
    progressData = []
    for plan in plans:
        user = user_lookup.get(plan["user_id"], {})

        module = module_lookup.get(plan["module_id"], {})

        progressData.append({

            **plan,

            "users": {
                "name": user.get("name"),
                "email": user.get("email")
            },

            "training_modules": {
                "module_id": module.get("module_id"),
                "title": module.get("title")
            },

            "started_at": plan.get("started_at"),

            "completed_at": plan.get("completed_at"),

            "completedItems": plan.get("completed_items", 0),

            "totalItems": plan.get("total_items", 0)
        })

    # completed_assignments = len(
    #     [p for p in progress if p.get("completed_at")]
    # )
    
    # in_progress_assignments = len([
    #     p for p in progress
    #     if p.get("started_at")
    #     and not p.get("completed_at")
    # ])

    # not_started_assignments = (
    #     total_assignments - completed_assignments - in_progress_assignments
    # )
    
    # ----------------------------------
    # THRESHOLD ACHIEVEMENT
    # ----------------------------------

    completed_above_threshold = 0
    completed_below_threshold = 0

    for plan in plans:

        if plan.get("status") != "COMPLETED":
            continue

        total = plan.get("total_items") or 0
        completed = plan.get("completed_items") or 0

        if total == 0:
            continue

        percentage = (completed / total) * 100

        threshold = (
            module_lookup
                .get(plan["module_id"], {})
                .get("threshold_value")
        ) or 0

        if percentage >= threshold:
            completed_above_threshold += 1
        else:
            completed_below_threshold += 1
            
    completed_assignments = sum(
        1
        for plan in plans
        if plan.get("status") == "COMPLETED"
    )

    in_progress_assignments = sum(
        1
        for plan in plans
        if plan.get("status") == "IN_PROGRESS"
    )

    not_started_assignments = sum(
        1
        for plan in plans
        if plan.get("status") == "ASSIGNED"
    )
            
    active_employees = len(
        set([
            p["user_id"]
            for p in progress
            if p.get("started_at")
        ])
    )
    
    # ----------------------------------
    # ASSESSMENTS
    # ----------------------------------

    assessment_resp = (
        db.table("employee_assessments")
        .select("""
                *,
                assessments(
                    type,
                    processed_module_id
                )
            """)
        .in_("user_id", user_ids)
        .execute()
    )

    assessments = assessment_resp.data or []
    # ----------------------------------
    # FETCH PROCESSED MODULES
    # ----------------------------------

    processed_module_ids = list({
        a.get("assessments", {}).get("processed_module_id")
        for a in assessments
        if a.get("assessments")
        and a["assessments"].get("processed_module_id")
    })

    processed_modules = {}

    if processed_module_ids:

        pm_resp = (
            db.table("processed_modules")
            .select("processed_module_id, original_module_id")
            .in_("processed_module_id", processed_module_ids)
            .execute()
        )

        for row in (pm_resp.data or []):
            processed_modules[row["processed_module_id"]] = row
            
    # ----------------------------------
    # MODULE STATS
    # ----------------------------------

    module_stats = []

    for module in modules:
        module_plans = [
            p
            for p in plans
            if p["module_id"] == module["module_id"]
        ]
        
        # -----------------------------
        # Average quiz score
        # -----------------------------
        scores = []

        for assessment in assessments:
            assessment_row = assessment.get("assessments") or {}

            processed_module_id = assessment_row.get("processed_module_id")

            original_module_id = (
                processed_modules
                    .get(processed_module_id, {})
                    .get("original_module_id")
            )

            if original_module_id != module["module_id"]:
                continue

            score = assessment.get("score")
            max_score = assessment.get("max_score")

            if score is not None and max_score:
                scores.append((score / max_score) * 100)

        average_score = (
            round(sum(scores) / len(scores))
            if scores
            else 0
        )
        
        completion_times = []

        for plan in module_plans:
            if (
                plan.get("status") == "COMPLETED"
                and plan.get("assigned_on")
                and plan.get("completed_at")
            ):
                assigned = datetime.fromisoformat(
                    plan["assigned_on"].replace("Z", "+00:00")
                )

                completed_dt = datetime.fromisoformat(
                    plan["completed_at"].replace("Z", "+00:00")
                )

                completion_times.append(
                    (completed_dt - assigned).days
                )

        average_completion_time = (
            round(sum(completion_times) / len(completion_times))
            if completion_times
            else 0
        )

        completed = sum(
            1
            for plan in module_plans
            if plan.get("status") == "COMPLETED"
        )

        in_progress = sum(
            1
            for plan in module_plans
            if plan.get("status") == "IN_PROGRESS"
        )
        
        not_started = sum(
            1
            for plan in module_plans
            if plan.get("status") == "ASSIGNED"
        )
            
        total_assigned = len(module_plans)
        completion_rate = (
            round(
                completed * 100 / total_assigned
            )
            if total_assigned
            else 0
        )
        
        module_stats.append(
        {
            "moduleId": module["module_id"],
            "title": module["title"],
            "totalAssigned": total_assigned,
            "completed": completed,
            "inProgress": in_progress,
            "notStarted": not_started,
            "completionRate": completion_rate,
            "averageScore": average_score,
            "averageCompletionTime": average_completion_time,
        }
        )
    
    # ----------------------------------
    # FETCH TRAINING MODULE TITLES
    # ----------------------------------

    original_module_ids = list({
        pm["original_module_id"]
        for pm in processed_modules.values()
    })

    training_titles = {}

    if original_module_ids:

        tm_resp = (
            db.table("training_modules")
            .select("module_id,title")
            .in_("module_id", original_module_ids)
            .execute()
        )

        for row in (tm_resp.data or []):
            training_titles[row["module_id"]] = row["title"]
    if assessmentType and assessmentType != "all":
        assessments = [
            a
            for a in assessments
            if a.get("type") == assessmentType
        ]
    
    assessment_stats_map = {}

    for assessment in assessments:

        score = assessment.get("score")
        max_score = assessment.get("max_score")

        assessment_row = assessment.get("assessments") or {}

        assessment_type = (
            assessment_row.get("type")
            or "Unknown"
        )

        processed_module_id = assessment_row.get("processed_module_id")

        original_module_id = (
            processed_modules
                .get(processed_module_id, {})
                .get("original_module_id")
        )

        module_title = training_titles.get(
            original_module_id,
            "Unknown"
        )

        key = f"{assessment_type}:{module_title}"

        if key not in assessment_stats_map:
            assessment_stats_map[key] = {
                "type": assessment_type,
                "moduleTitle": module_title,
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
        "progressData": progressData,
        "kpiStats": kpi_stats,
        "completedAboveThreshold": completed_above_threshold,
        "completedBelowThreshold": completed_below_threshold
    }

    set_cache(
        cache_key,
        json.dumps(response),
        ttl=300
    )
    # print("set_cache succesfull for analytics")

    return response