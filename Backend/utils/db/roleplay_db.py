from datetime import datetime
from typing import Optional
from fastapi import HTTPException
from utils.supabase_client import supabase
from utils.auth_bridge import get_service_supabase_client

def normalize_scenario(db_scenario: dict) -> dict:
    """Convert database scenario format to frontend format"""
    # Normalize difficulty
    difficulty = db_scenario.get('difficulty', 'Medium')
    if isinstance(difficulty, str):
        difficulty_lower = difficulty.lower()
        if difficulty_lower == 'easy':
            difficulty = 'Easy'
        elif difficulty_lower == 'medium':
            difficulty = 'Medium'
        elif difficulty_lower == 'hard':
            difficulty = 'Hard'
    
    return {
        'scenario_id': db_scenario.get('scenario_id'),
        'title': db_scenario.get('title', ''),
        'description': db_scenario.get('description', ''),
        'role': db_scenario.get('role', ''),
        'difficulty': difficulty,
        'initialPrompt': db_scenario.get('initialPrompt', ''),
        'userRole': db_scenario.get('userRole', ''),
        'tone': db_scenario.get('tone', 'Neutral'),
        'learnerBrief': db_scenario.get('learnerBrief', ''),
        'aiObjectives': (
            db_scenario.get('aiObjective')[0] 
            if isinstance(db_scenario.get('aiObjective'), list) and db_scenario.get('aiObjective')
            else db_scenario.get('aiObjective')
        ),
        'maxDuration': (
            db_scenario.get('maxDuration')[0]
            if isinstance(db_scenario.get('maxDuration'), list) and db_scenario.get('maxDuration')
            else db_scenario.get('maxDuration')
        ),
        'minTurns': (
            db_scenario.get('minTurns')[0]
            if isinstance(db_scenario.get('minTurns'), list) and db_scenario.get('minTurns')
            else db_scenario.get('minTurns')
        ),
        'endConditions': (
            db_scenario.get('endConditions')[0]
            if isinstance(db_scenario.get('endConditions'), list) and db_scenario.get('endConditions')
            else db_scenario.get('endConditions')
        ),
        'evaluationParams': (
            db_scenario.get('evaluationParams')
            if isinstance(db_scenario.get('evaluationParams'), list)
            else db_scenario.get('evaluationParams')
        ),
        'passingScore': (
            db_scenario.get('passingScore')[0]
            if isinstance(db_scenario.get('passingScore'), list) and db_scenario.get('passingScore')
            else db_scenario.get('passingScore')
        ),
        'isCustom': True,
    }

def fetch_all_scenarios(company_id: str) -> tuple[list, dict | None]:
    """Fetch all scenarios from database for a specific company"""
    supabase = get_service_supabase_client()

    try:
        result = supabase.table("scenarios").select(
            "scenario_id, title, description, role, difficulty, initialPrompt, userRole, tone, learnerBrief, aiObjective, maxDuration, minTurns, endConditions, evaluationParams, passingScore, created_at"
        ).eq('company_id', company_id).order('created_at', desc=True).execute()
        return result.data, None
    except Exception as e:
        return [], {'code': 'DB_ERROR', 'message': str(e)}

def get_assigned_scenario_ids_for_user(user_id: str) -> tuple[list, dict | None]:
    """Get scenario IDs assigned to a user"""
    try:
        # Get user's company and functions
        user_meta, error = get_user_company_and_functions(user_id)
        if error:
            return [], error
            
        company_id = user_meta.get('company_id')
        function_id = user_meta.get('function_id')
        sub_function_id = user_meta.get('sub_function_id')
        
        # Check if user has admin roles
        role_result = supabase.table("user_role_assignments").select("role_id").eq("user_id", user_id).execute()
        
        if role_result.data and len(role_result.data) > 1:
            # User has multiple roles - likely admin
            all_scenarios = supabase.table("scenarios").select("scenario_id").order('created_at', desc=True).execute()
            scenario_ids = [s.get('scenario_id') for s in (all_scenarios.data or [])]
            return scenario_ids, None
        
        # Get user's direct assignments      
        return get_distinct_assigned_scenario_ids_for_user(user_id, company_id, function_id, sub_function_id)
    except Exception as e:
        return [], {'code': 'DB_ERROR', 'message': str(e)}

def get_company_roleplay_limits(company_id: str) -> tuple[dict, dict | None]:
    """Get roleplay limits for a company"""
    try:
        result = supabase.table("companies").select(
            "rate_limit_role_play, rate_limit_role_play_retries"
        ).eq("company_id", company_id).single().execute()
        
        if not result.data:
            return {}, None
        
        data = result.data
        return {
            'roleplayLimit': data.get('rate_limit_role_play', 5),
            'retryLimit': data.get('rate_limit_role_play_retries', 3),
        }, None
    except Exception as e:
        return {}, {'code': 'DB_ERROR', 'message': str(e)}

def get_bootstrap_data(company_id: str):
    scenarios, _ = fetch_all_scenarios(company_id)

    functions = get_functions(company_id)
    sub_functions = get_sub_functions(company_id)
    users = get_active_company_users(company_id)

    company_limits, _ = get_company_roleplay_limits(company_id)

    return {
        "scenarios": scenarios or [],
        "assignmentTargets": {
            "functions": functions.data or [],
            "sub_functions": sub_functions.data or [],
            "users": users.data or [],
        },
        "companyLimits": company_limits,
    }
    
# def finish_roleplay_session(session_id: str):
#     return (
#         supabase
#         .table("roleplay_sessions")
#         .update({
#             "completed_at": datetime.utcnow().isoformat()
#         })
#         .eq("id", session_id)
#         .execute()
#     )
    
def get_user_company_and_functions(user_id: str) -> tuple[dict, dict | None]:
    """Get user's company and functions"""
    try:
        result = supabase.table("users").select("company_id, function_id, sub_function_id").eq("user_id", user_id).single().execute()
        if not result.data:
            return {}, {'code': 'USER_NOT_FOUND', 'message': 'User not found'}
        
        return result.data, None
    except Exception as e:
        return {}, {'code': 'DB_ERROR', 'message': str(e)}

def get_distinct_assigned_scenario_ids_for_user(
    user_id: str,
    company_id: str,
    function_id: Optional[str],
    sub_function_id: Optional[str]
) -> tuple[list, dict | None]:
    """Get distinct scenario IDs assigned to user (via user, function, or sub_function)"""
    try:
        # User direct assignments
        user_result = supabase.table("scenario_assignments").select("scenario_id").eq(
            "company_id", company_id
        ).eq("assignment_type", "user").eq("user_id", user_id).execute()
        
        user_ids = [a.get('scenario_id') for a in (user_result.data or [])]
        
        func_ids = []
        if function_id:
            func_result = supabase.table("scenario_assignments").select("scenario_id").eq(
                "company_id", company_id
            ).eq("assignment_type", "function").eq("target_id", function_id).execute()
            
            func_ids = [a.get('scenario_id') for a in (func_result.data or [])]
            
        # Sub-function assignments
        sub_func_ids = []
        if sub_function_id:
            sub_func_result = supabase.table("scenario_assignments").select("scenario_id").eq(
                "company_id", company_id
            ).eq("assignment_type", "sub_function").eq("target_id", sub_function_id).execute()
            
            sub_func_ids = [a.get('scenario_id') for a in (sub_func_result.data or [])]
        
        # Combine and deduplicate
        distinct_ids = list(set(user_ids + func_ids + sub_func_ids))
        return distinct_ids, None
    except Exception as e:
        return [], {'code': 'DB_ERROR', 'message': str(e)}


# ============================================================
# Scenario CRUD
# ============================================================

def create_scenario(payload):
    return(
        supabase
        .table("scenarios")
        .insert(payload)
        .execute()
    )
    
def get_scenario(scenario_id:str, company_id:str):
    return(
        supabase
        .table("scenarios")
        .select("scenario_id, company_id")
        .eq("scenario_id", scenario_id)
        .eq("company_id", company_id)
        .maybe_single()
        .execute()
    )


def require_company_scenario(scenario_id: str, company_id: str):
    result = get_scenario(scenario_id, company_id)
    if not result.data:
        raise HTTPException(status_code=404, detail="Scenario not found or access denied")
    return result

def update_scenario(
    scenario_id: str,
    payload: dict
):
    return (
        supabase
        .table("scenarios")
        .update(payload)
        .eq("scenario_id", scenario_id)
        .execute()
    )
      
def delete_scenario(
    scenario_id: str
):
    return (
        supabase
        .table("scenarios")
        .delete()
        .eq("scenario_id", scenario_id)
        .execute()
    )
    
# ============================================================
# Session CRUD
# ============================================================

# def get_user(
#     user_id: str
# ):
#     return (
#         supabase
#         .table("users")
#         .select("company_id, department_id")
#         .eq("user_id", user_id)
#         .execute()
#     )
    
# def get_company(
#     company_id: str
# ):
#     return (
#         supabase
#         .table("companies")
#         .select("rate_limit_role_play_retries")
#         .eq("company_id", company_id)
#         .execute()
#     )
    
def get_roleplay_sessions(
    employee_id: str,
    scenario_id: str
):
    return (
        supabase
        .table("roleplay_sessions")
        .select("id")
        .eq("employee_id", employee_id)
        .eq("scenario_id", scenario_id)
        .execute()
    )
    
def count_roleplay_attempts(
    employee_id: str,
    session_ids: list
):
    return (
        supabase
        .table("roleplay_assessments")
        .select(
            "id",
            count="exact"
        )
        .eq(
            "employee_id",
            employee_id
        )
        .in_(
            "session_id",
            session_ids
        )
        .execute()
    )
    
def create_roleplay_session(
    insert_data: dict
):
    return (
        supabase
        .table("roleplay_sessions")
        .insert(insert_data)
        .execute()
    )
    
def update_roleplay_session(
    session_id: str,
    update_data: dict
):
    return (
        supabase
        .table("roleplay_sessions")
        .update(update_data)
        .eq("id", session_id)
        .execute()
    )
    
def save_roleplay_assessment(
    insert_data:dict
):
    return (
        supabase
        .table("roleplay_assessments")
        .insert(insert_data)
        .execute()
    )


def check_retry_limit(
    employee_id: str,
    scenario_id: str,
    company_id: str
):
    company_limits, error = get_company_roleplay_limits(company_id)

    if error:
        raise HTTPException(
            status_code=400,
            detail=error["message"]
        )

    retry_limit = company_limits.get("retryLimit", 3)

    if retry_limit <= 0:
        raise HTTPException(
            status_code=403,
            detail="Roleplay retries are disabled for your company."
        )

    sessions_res = get_roleplay_sessions(
        employee_id,
        scenario_id
    )

    session_ids = [
        s.get("id")
        for s in (sessions_res.data or [])
        if s.get("id")
    ]

    attempt_count = 0

    if session_ids:
        assess_res = count_roleplay_attempts(
            employee_id,
            session_ids
        )
        attempt_count = assess_res.count or 0

    if attempt_count >= retry_limit:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Roleplay retry limit reached. "
                f"You can attempt this scenario up to "
                f"{retry_limit} time(s)."
            )
        )

    return {
        "retry_limit": retry_limit,
        "attempt_count": attempt_count,
    }
    
def get_roleplay_session(session_id: str):
    return (
        supabase
        .table("roleplay_sessions")
        .select("""
            id,
            employee_id,
            scenario_id,
            conversation_transcript,
            message_count
        """)
        .eq("id", session_id)
        .single()
        .execute()
    )
    
def get_roleplay_scenario(scenario_id: str):
    return (
        supabase
        .table("scenarios")
        .select("""
            scenario_id,
            title,
            role,
            tone,
            userRole,
            learnerBrief,
            initialPrompt,
            aiPersonality,
            aiObjective,
            evaluationParams,
            passingScore
        """)
        .eq("scenario_id", scenario_id)
        .single()
        .execute()
    )
    
# def get_existing_user_assignments(
#     scenario_id: str, 
#     company_id: str,
#     target_ids: list[str]
# ):
#     return(
#         supabase
#         .table("scenario_assignments")
#         .select("user_id")
#         .eq("scenario_id", scenario_id)
#         .eq("company_id", company_id)
#         .eq("assignment_type", "user")
#         .in_("user_id", target_ids)
#         .execute()
#     )
    
# def insert_assignments(assignment: list):
#     return(
#         supabase
#         .table("scenario_assignments")
#         .insert(assignment)
#         .execute()
#     )
    
# def get_assignments(
#     scenario_id:str,
#     company_id: str
# ):
#     return(
#         supabase
#         .table("scenario_assignments")
#         .select(
#             "assignment_id, scenario_id, assignment_type, target_id, company_id, assigned_at, user_id"
#         )
#         .eq("company_id", company_id)
#         .eq("scenario_id", scenario_id)
#         .execute()
#     )
    
def get_scenarios_by_ids(
    scenario_ids: list[str]
):
    return (
        supabase
        .table("scenarios")
        .select(
            """
            scenario_id,
            title,
            description,
            role,
            difficulty,
            initialPrompt,
            userRole,
            tone,
            learnerBrief,
            aiObjective,
            maxDuration,
            minTurns,
            endConditions,
            evaluationParams,
            passingScore,
            created_at
            """
        )
        .in_("scenario_id", scenario_ids)
        .order("created_at", desc=True)
        .execute()
    )
    
# def verify_scenario_company(
#     scenario_id:str,
#     company_id:str
# ):
#     return(
#         supabase
#         .table("scenarios")
#         .select("scenario_id")
#         .eq("scenario_id", scenario_id)
#         .eq("company_id", company_id)
#         .execute()
#     )

# def save_transcript(
#     session_id: str,
#     transcript: list
# ):
#     return (
#         supabase
#         .table("roleplay_sessions")
#         .update({
#             "conversation_transcript": transcript,
#             "message_count": len(transcript)
#         })
#         .eq("id", session_id)
#         .execute()
#     )
    
# ============================================================
# Assignment CRUD
# ============================================================

def get_functions(company_id: str):
    return (
        supabase
        .table("function")
        .select(
            "function_id,function_name"
        )
        .eq("company_id", company_id)
        .order("function_name")
        .execute()
    )


def get_sub_functions(company_id: str):
    return (
        supabase.table("sub_function")
        .select("""
            sub_function_id,function_id,sub_function_name,
            function!inner(
                function_id,
                function_name,
                company_id
            )
        """)
        .eq("function.company_id", company_id)
        .eq("is_active", True)
        .execute()
    )
    
def get_active_company_users(company_id: str):
    return (
        supabase
        .table("users")
        .select(
            "user_id,name,email,function_id,sub_function_id"
        )
        .eq("company_id", company_id)
        .eq("is_active", True)
        .execute()
    )
    
def get_existing_assignments(
    scenario_id: str,
    company_id:str,
    assignment_type: str,
    target_ids: list
):
    query = (
        supabase
        .table("scenario_assignments")
        .select("*")
        .eq("scenario_id", scenario_id)
        .eq("assignment_type", assignment_type)
        .eq("company_id", company_id)
    )

    if assignment_type == "user":
        query = query.in_("user_id", target_ids)
    
    else:
        query = query.in_("target_id", target_ids)

    return query.execute()

def create_scenario_assignments(assignments: list):
    return (
        supabase
        .table("scenario_assignments")
        .insert(assignments)
        .execute()
    )
    
def delete_scenario_assignment(
    scenario_id: str
):
    return (
        supabase
        .table("scenario_assignments")
        .delete()
        .eq("scenario_id", scenario_id)
        .execute()
    )
    
def get_user_by_email(email: str):
    return (
        supabase
        .table("users")
        .select("user_id, company_id")
        .eq("email", email)
        .execute()
    )
    
# def get_scenarios_by_ids(
#     scenario_ids: list
# ):
#     return(
#         supabase.table("scenarios").select(
#             "scenario_id, title, description, role, difficulty, initialPrompt, userRole, tone, learnerBrief, aiObjective, maxDuration, minTurns, endConditions, evaluationParams, passingScore, created_at"
#         ).in_(
#             "scenario_id", scenario_ids
#         ).order('created_at', desc=True).execute()
#     )
    
def get_scenario_assignments(
    scenario_id: str,
    company_id: str
):
    return (
        supabase
        .table("scenario_assignments")
        .select(
            "assignment_id, scenario_id, assignment_type, target_id, company_id, assigned_at, user_id"
        )
        .eq("company_id", company_id)
        .eq("scenario_id", scenario_id)
        .execute()
    )
    
def get_employee_roleplay_stats(
    employee_id: str,
):

    sessions = (
        supabase
        .table("roleplay_sessions")
        .select("id,scenario_id,completed_at")
        .eq("employee_id", employee_id)
        .not_.is_("completed_at", None)
        .execute()
    )

    assessments = (
        supabase
        .table("roleplay_assessments")
        .select("overall_score,created_at")
        .eq("employee_id", employee_id)
        .execute()
    )

    session_rows = sessions.data or []
    assessment_rows = assessments.data or []

    stats = {
        "total_sessions": len(session_rows),
        "completed_sessions": len(
            [s for s in session_rows if s.get("completed_at")]
        ),
        "average_score": round(
            sum(a["overall_score"] for a in assessment_rows) / len(assessment_rows)
        ) if assessment_rows else 0,
        "best_score": max(
            (a["overall_score"] for a in assessment_rows),
            default=0,
        ),
        "recent_sessions": session_rows[:5],
    }

    return stats
    
def get_employee_roleplay_sessions(
    employee_id: str,
    limit: int,
):
    return (
        supabase
        .table("roleplay_sessions")
        .select("""
            id,
            employee_id,
            module_id,
            scenario_id,
            scenario_title,
            scenario_role,
            scenario_difficulty,
            conversation_transcript,
            started_at,
            completed_at,
            duration_seconds,
            message_count,
            roleplay_assessments(
                id,
                overall_score,
                summary,
                parameters,
                recommendations,
                created_at
            )
        """)
        .eq("employee_id", employee_id)
        .not_.is_("completed_at", None)
        .order("completed_at", desc=True)
        .limit(limit)
        .execute()
    )
    
def get_employee_roleplay_reports(
    employee_id: str,
    limit: int = 20
):
    sessions = get_employee_roleplay_sessions(
        employee_id,
        limit
    )

    stats = get_employee_roleplay_stats(
        employee_id
    )

    return {
        "sessions": sessions.data or [],
        "stats": stats or {}
    }