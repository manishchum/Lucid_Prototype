from typing import Dict, Any, Optional, List
from ..auth_bridge import get_service_supabase_client
from .permissions import check_user_permission, check_company_access
from ..supabase_client import supabase

# ==================== ASSESSMENT OPERATIONS ====================

async def create_assessment(
    requesting_user_id: str,
    assessment_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Create a new assessment.
    Permission: User must have access to the company.
    """
    company_id = assessment_data.get('company_id')
    
    if not company_id:
        return {"data": None, "error": "company_id is required"}
    
    # Check company access
    has_access = await check_company_access(requesting_user_id, company_id)
    if not has_access:
        return {
            "data": None,
            "error": "Permission denied: Company access required"
        }
    
    try:
        response = supabase.table('assessments').insert(assessment_data).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_assessment_by_id(
    requesting_user_id: str,
    assessment_id: str
) -> Dict[str, Any]:
    """
    Get a single assessment by ID.
    Permission: User must have access to the company.
    """
    try:
        resp = supabase.table('assessments').select('*').eq('assessment_id', assessment_id).maybe_single().execute()
        if not resp.data:
            return {"data": None, "error": "Assessment not found"}
        
        assessment = resp.data
        company_id = assessment.get('company_id')
        
        # Check company access
        if company_id:
            has_access = await check_company_access(requesting_user_id, company_id)
            if not has_access:
                return {"data": None, "error": "Permission denied"}
        
        return {"data": assessment, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def get_assessments_batch(
    requesting_user_id: str,
    assessment_ids: List[str]
) -> Dict[str, Any]:

    if not assessment_ids:
        return {"data": [], "error": None}

    try:
        resp = (
            supabase
            .table("assessments")
            .select("*")
            .in_("assessment_id", assessment_ids)
            .execute()
        )

        assessments = resp.data or []

        return {
            "data": assessments,
            "error": None
        }

    except Exception as e:
        return {
            "data": None,
            "error": str(e)
        }

async def get_assessments_by_company(
    requesting_user_id: str,
    company_id: str,
    assessment_type: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get all assessments for a company, optionally filtered by type.
    Permission: Manager+ in the company.
    """
    has_permission = await check_user_permission(requesting_user_id, 'manager')
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_permission or not has_access:
        return {
            "data": None,
            "error": "Permission denied: Manager privileges required"
        }
    
    try:
        query = supabase.table('assessments').select('*').eq('company_id', company_id)
        
        if assessment_type:
            query = query.eq('type', assessment_type)
        
        response = query.order('created_at', desc=True).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_assessment_by_filters(
    requesting_user_id: str,
    company_id: Optional[str] = None,
    assessment_type: Optional[str] = None,
    processed_module_id: Optional[str] = None,
    original_module_id: Optional[str] = None,
    learning_style: Optional[str] = None,
    user_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get assessments matching specific filters.
    Permission: User must have company access.
    """
    if company_id:
        has_access = await check_company_access(requesting_user_id, company_id)
        if not has_access:
            return {"data": None, "error": "Permission denied"}
    
    try:
        query = supabase.table('assessments').select('*')
        
        if company_id:
            query = query.eq('company_id', company_id)
        if assessment_type:
            query = query.eq('type', assessment_type)
        if processed_module_id:
            query = query.eq('processed_module_id', processed_module_id)
        if original_module_id:
            query = query.eq('original_module_id', original_module_id)
        if learning_style:
            query = query.eq('learning_style', learning_style)
        
        # If user_id filter is provided, we need to filter by processed_modules that belong to that user
        # Since processed_modules doesn't have user_id, we need to join through module_progress
        if user_id:
            # Get processed_module_ids for this user from module_progress table
            progress_resp = supabase.table('module_progress').select('processed_module_id').eq('user_id', user_id).execute()
            
            if progress_resp.data:
                user_processed_module_ids = [p['processed_module_id'] for p in progress_resp.data if p.get('processed_module_id')]
                
                if user_processed_module_ids:
                    query = query.in_('processed_module_id', user_processed_module_ids)
                else:
                    # No processed modules for this user, return empty
                    return {"data": [], "error": None}
            else:
                return {"data": [], "error": None}
        
        response = query.order('created_at', desc=True).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_baseline_assessment(
    requesting_user_id: str,
    company_id: str,
    original_module_id: str
) -> Dict[str, Any]:
    """
    Get baseline assessment for a company and module.
    Permission: User must have company access.
    """
    has_access = await check_company_access(requesting_user_id, company_id)
    if not has_access:
        return {"data": None, "error": "Permission denied"}
    
    try:
        response = supabase.table('assessments').select('*').eq(
            'type', 'baseline'
        ).eq('company_id', company_id).eq(
            'original_module_id', original_module_id
        ).limit(1).maybe_single().execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_module_assessment(
    requesting_user_id: str,
    processed_module_id: str,
    learning_style: str,
    user_id: str
) -> Dict[str, Any]:
    """
    Get module assessment for a specific processed module and learning style.
    Permission: Self or manager+.
    """
    is_self = requesting_user_id == user_id
    if not is_self:
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        if not has_permission:
            return {"data": None, "error": "Permission denied"}
    
    try:
        # First verify that this processed_module belongs to the user via module_progress
        progress_resp = supabase.table('module_progress').select('processed_module_id').eq(
            'user_id', user_id
        ).eq('processed_module_id', processed_module_id).maybe_single().execute()
        
        if not progress_resp.data:
            return {"data": None, "error": "Processed module not found for this user"}
        
        # Now fetch the assessment
        response = supabase.table('assessments').select('*').eq(
            'type', 'module'
        ).eq('processed_module_id', processed_module_id).eq(
            'learning_style', learning_style
        ).maybe_single().execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_assessment(
    requesting_user_id: str,
    assessment_id: str,
    update_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Update an assessment.
    Permission: Manager+ in the same company.
    """
    # First get the assessment to check company
    try:
        resp = supabase.table('assessments').select('company_id').eq('assessment_id', assessment_id).maybe_single().execute()
        if not resp.data:
            return {"data": None, "error": "Assessment not found"}
        
        company_id = resp.data.get('company_id')
        
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, company_id)
        
        if not has_permission or not has_access:
            return {"data": None, "error": "Permission denied"}
        
        response = supabase.table('assessments').update(update_data).eq('assessment_id', assessment_id).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def delete_assessment(
    requesting_user_id: str,
    assessment_id: str
) -> Dict[str, Any]:
    """
    Delete an assessment.
    Permission: Admin+ in the same company.
    """
    try:
        resp = supabase.table('assessments').select('company_id').eq('assessment_id', assessment_id).maybe_single().execute()
        if not resp.data:
            return {"data": None, "error": "Assessment not found"}
        
        company_id = resp.data.get('company_id')
        
        has_permission = await check_user_permission(requesting_user_id, 'admin')
        has_access = await check_company_access(requesting_user_id, company_id)
        
        if not has_permission or not has_access:
            return {"data": None, "error": "Permission denied"}
        
        response = supabase.table('assessments').delete().eq('assessment_id', assessment_id).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
