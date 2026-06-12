"""
Database operations for employee_assessments table.
Handles CRUD operations with permission checks.
"""
from typing import Dict, Any, Optional, List
from datetime import datetime
from ..supabase_client import supabase
from ..auth_bridge import get_service_supabase_client
from .permissions import check_user_permission, check_company_access
from ..redis_client import get_cache, set_cache, delete_cache_pattern

async def get_user_company_id(user_id: str) -> Optional[str]:
    """Helper function to get user's company_id"""
    try:
        db = get_service_supabase_client()
        resp = db.table('users').select('company_id').eq(
            'user_id', user_id
        ).maybe_single().execute()
        return resp.data.get('company_id') if resp.data else None
    except Exception:
        return None


# ==================== EMPLOYEE ASSESSMENT OPERATIONS ====================

async def get_employee_assessment_by_id(
    requesting_user_id: str,
    employee_assessment_id: str
) -> Dict[str, Any]:
    """
    Get a single employee assessment by ID.
    Permission: Self OR manager+ in same company.
    """
    try:
        db = get_service_supabase_client()
        resp = db.table('employee_assessments').select(
            '*, users!inner(company_id, name, email), assessments(assessment_id, type, questions, processed_module_id, learning_style)'
        ).eq('employee_assessment_id', employee_assessment_id).single().execute()
        
        if not resp.data:
            return {"data": None, "error": "Employee assessment not found"}
        
        assessment = resp.data
        user_company = assessment.get('users', {}).get('company_id')
        assessment_user_id = assessment.get('user_id')
        
        # Check if requesting user is viewing their own assessment
        is_self = requesting_user_id == assessment_user_id
        
        if not is_self:
            # Must be manager+ in same company
            has_permission = await check_user_permission(requesting_user_id, 'manager')
            has_access = await check_company_access(requesting_user_id, user_company)
            
            if not has_permission or not has_access:
                return {"data": None, "error": "Permission denied: Insufficient privileges"}
        
        return {"data": assessment, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_employee_assessments_by_user(
    requesting_user_id: str,
    target_user_id: str,
    assessment_id: Optional[str] = None,
    limit: int = 100
) -> Dict[str, Any]:
    """
    Get all employee assessments for a specific user.
    Permission: Self OR manager+ in same company.
    Optional filter by assessment_id.
    """
    try:
        cache_key = (
            f"employee_assessments:"
            f"{target_user_id}:"
            f"{assessment_id or 'all'}:"
            f"{limit}"
        )
        cached = get_cache(cache_key)

        if cached:
            print(
                f"Employee Assessments Cache Hit: "
                f"{target_user_id}"
            )
            return {
                "data": cached,
                "error": None
            }
        print("Employee Assessments Cache miss")
        db = get_service_supabase_client()
        # Get target user's company to check permissions
        user_resp = db.table('users').select('company_id').eq(
            'user_id', target_user_id
        ).single().execute()
        
        if not user_resp.data:
            return {"data": None, "error": "User not found"}
        
        target_company = user_resp.data.get('company_id')
        is_self = requesting_user_id == target_user_id
        
        if not is_self:
            has_permission = await check_user_permission(requesting_user_id, 'manager')
            has_access = await check_company_access(requesting_user_id, target_company)
            
            if not has_permission or not has_access:
                return {"data": None, "error": "Permission denied: Insufficient privileges"}
        
        # Build query
        query = db.table('employee_assessments').select(
            '*, assessments(assessment_id, type, questions, processed_module_id, learning_style)'
        ).eq('user_id', target_user_id).order('completed_at', desc=True).limit(limit)
        
        if assessment_id:
            query = query.eq('assessment_id', assessment_id)
        
        resp = query.execute()

        set_cache(
            cache_key,
            resp.data,
            ttl=300
        )

        return {
            "data": resp.data,
            "error": None
        }
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_employee_assessments_by_assessment(
    requesting_user_id: str,
    assessment_id: str,
    limit: int = 100
) -> Dict[str, Any]:
    """
    Get all employee assessments for a specific assessment.
    Permission: Manager+ in the company that owns the assessment.
    """
    try:
        db = get_service_supabase_client()
        # Get assessment's company
        assessment_resp = db.table('assessments').select('company_id').eq(
            'assessment_id', assessment_id
        ).single().execute()
        
        if not assessment_resp.data:
            return {"data": None, "error": "Assessment not found"}
        
        assessment_company = assessment_resp.data.get('company_id')
        
        # Check permissions
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, assessment_company)
        
        if not has_permission or not has_access:
            return {"data": None, "error": "Permission denied: Manager access required"}
        
        resp = db.table('employee_assessments').select(
            '*, users!inner(name, email, user_id)'
        ).eq('assessment_id', assessment_id).order('completed_at', desc=True).limit(limit).execute()
        
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_employee_assessments_by_company(
    requesting_user_id: str,
    company_id: str,
    user_id: Optional[str] = None,
    assessment_id: Optional[str] = None,
    limit: int = 100
) -> Dict[str, Any]:
    """
    Get all employee assessments for a company.
    Permission: Manager+ in the company.
    Optional filters: user_id, assessment_id.
    """
    try:
        db = get_service_supabase_client()
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, company_id)
        
        if not has_permission or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Manager privileges required"
            }
        
        # Join with users to filter by company
        query = db.table('employee_assessments').select(
            '*, users!inner(company_id, name, email), assessments(assessment_id, type, processed_module_id, learning_style)'
        ).eq('users.company_id', company_id).order('completed_at', desc=True).limit(limit)
        
        if user_id:
            query = query.eq('user_id', user_id)
        
        if assessment_id:
            query = query.eq('assessment_id', assessment_id)
        
        resp = query.execute()
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def create_employee_assessment(
    requesting_user_id: str,
    assessment_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Create a new employee assessment.
    Permission: Self (user can only create their own assessment) OR admin+.
    Required fields: user_id, assessment_id, answers
    Optional fields: score, max_score, feedback, question_feedback
    """
    user_id = assessment_data.get('user_id')
    assessment_id = assessment_data.get('assessment_id')
    
    # Validate required fields
    if not user_id:
        return {"data": None, "error": "user_id is required"}
    
    if not assessment_id:
        return {"data": None, "error": "assessment_id is required"}
    
    if 'answers' not in assessment_data:
        return {"data": None, "error": "answers field is required"}
    
    # Check if user is creating their own assessment
    is_self = requesting_user_id == user_id
    
    if not is_self:
        # Only admin+ can create assessments for other users
        has_permission = await check_user_permission(requesting_user_id, 'admin')
        if not has_permission:
            return {
                "data": None,
                "error": "Permission denied: Can only create your own assessments"
            }
        
        # Check company access
        user_company = await get_user_company_id(user_id)
        if user_company:
            has_access = await check_company_access(requesting_user_id, user_company)
            if not has_access:
                return {"data": None, "error": "Permission denied: Company access required"}
    
    # Verify assessment exists and user has access to it
    try:
        assessment_resp = supabase.table('assessments').select('company_id').eq(
            'assessment_id', assessment_id
        ).single().execute()
        
        if not assessment_resp.data:
            return {"data": None, "error": "Assessment not found"}
        
        # Verify user belongs to same company as assessment
        user_company = await get_user_company_id(user_id)
        assessment_company = assessment_resp.data.get('company_id')
        
        if user_company != assessment_company:
            return {
                "data": None,
                "error": "User and assessment belong to different companies"
            }
    except Exception as e:
        return {"data": None, "error": f"Failed to verify assessment: {str(e)}"}
    
    try:
        response = supabase.table('employee_assessments').insert(assessment_data).execute()
        delete_cache_pattern(f"employee_assessments:{user_id}:*")
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_employee_assessment(
    requesting_user_id: str,
    employee_assessment_id: str,
    update_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Update an employee assessment.
    Permission: Self OR admin+ in same company.
    """
    # Get existing assessment to check permissions
    existing = await get_employee_assessment_by_id(requesting_user_id, employee_assessment_id)
    
    if existing["error"]:
        return existing
    
    assessment = existing["data"]
    assessment_user_id = assessment.get('user_id')
    is_self = requesting_user_id == assessment_user_id
    
    if not is_self:
        # Only admin+ can update other users' assessments
        has_permission = await check_user_permission(requesting_user_id, 'admin')
        if not has_permission:
            return {
                "data": None,
                "error": "Permission denied: Admin access required to update others' assessments"
            }
    
    # Don't allow changing user_id or assessment_id
    update_data.pop('user_id', None)
    update_data.pop('assessment_id', None)
    update_data.pop('employee_assessment_id', None)
    
    try:
        response = supabase.table('employee_assessments').update(update_data).eq(
            'employee_assessment_id', employee_assessment_id
        ).execute()
        delete_cache_pattern(f"employee_assessments:{requesting_user_id}:*")
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def delete_employee_assessment(
    requesting_user_id: str,
    employee_assessment_id: str
) -> Dict[str, Any]:
    """
    Delete an employee assessment.
    Permission: Admin+ in same company.
    """
    # Get the assessment first
    existing = await get_employee_assessment_by_id(requesting_user_id, employee_assessment_id)
    
    if existing["error"]:
        assessment = existing.get("data")
        assessment_user_id = assessment.get('user_id')
        return existing
    
    # Check if user has admin permission
    has_permission = await check_user_permission(requesting_user_id, 'admin')
    if not has_permission:
        return {"data": None, "error": "Permission denied: Admin access required"}
    
    try:
        response = supabase.table('employee_assessments').delete().eq(
            'employee_assessment_id', employee_assessment_id
        ).execute()
        delete_cache_pattern(f"employee_assessments:{requesting_user_id}:*")
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_assessment_statistics(
    requesting_user_id: str,
    assessment_id: str
) -> Dict[str, Any]:
    """
    Get statistics for an assessment (average score, completion rate, etc.).
    Permission: Manager+ in the company that owns the assessment.
    """
    try:
        db = get_service_supabase_client()
        # Get assessment's company
        assessment_resp = db.table('assessments').select('company_id').eq(
            'assessment_id', assessment_id
        ).single().execute()
        
        if not assessment_resp.data:
            return {"data": None, "error": "Assessment not found"}
        
        assessment_company = assessment_resp.data.get('company_id')
        
        # Check permissions
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, assessment_company)
        
        if not has_permission or not has_access:
            return {"data": None, "error": "Permission denied: Manager access required"}
        
        # Get all employee assessments for this assessment
        resp = db.table('employee_assessments').select('score, max_score').eq(
            'assessment_id', assessment_id
        ).execute()
        
        assessments = resp.data or []
        
        if not assessments:
            return {
                "data": {
                    "total_submissions": 0,
                    "average_score": None,
                    "average_percentage": None
                },
                "error": None
            }
        
        total = len(assessments)
        scores = [a['score'] for a in assessments if a.get('score') is not None]
        max_scores = [a['max_score'] for a in assessments if a.get('max_score') is not None]
        
        avg_score = sum(scores) / len(scores) if scores else None
        
        # Calculate average percentage if we have both scores and max_scores
        percentages = []
        for a in assessments:
            if a.get('score') is not None and a.get('max_score') and a['max_score'] > 0:
                percentages.append((a['score'] / a['max_score']) * 100)
        
        avg_percentage = sum(percentages) / len(percentages) if percentages else None
        
        return {
            "data": {
                "total_submissions": total,
                "average_score": round(avg_score, 2) if avg_score else None,
                "average_percentage": round(avg_percentage, 2) if avg_percentage else None
            },
            "error": None
        }
    except Exception as e:
        return {"data": None, "error": str(e)}
