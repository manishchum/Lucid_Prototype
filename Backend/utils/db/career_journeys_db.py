from typing import Dict, Any, Optional, List
from ..auth_bridge import get_service_supabase_client
from .permissions import check_user_permission, check_company_access

async def create_career_journey(
    requesting_user_id: str,
    journey_data: Dict[str, Any],
    auth_claims: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create a new career journey as a draft.
    """
    # Enforce draft status on creation
    journey_data['status'] = 'draft'
    
    try:
        db = get_service_supabase_client()
        response = db.table('career_journeys').insert(journey_data).execute()
        
        # response.data is typically a list of inserted rows, return the first one if available
        data = response.data[0] if response.data and len(response.data) > 0 else response.data
        return {"data": data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def update_career_journey(
    requesting_user_id: str,
    journey_id: str,
    journey_data: Dict[str, Any],
    auth_claims: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Update an existing career journey draft.
    """
    # Prevent updating the ID
    journey_data.pop('id', None)
    
    try:
        db = get_service_supabase_client()
        response = db.table('career_journeys').update(journey_data).eq('id', journey_id).execute()
        
        data = response.data[0] if response.data and len(response.data) > 0 else response.data
        return {"data": data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def get_draft_journeys(
    requesting_user_id: str,
    auth_claims: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get all draft career journeys (admin view).
    """
    try:
        db = get_service_supabase_client()
        response = db.table('career_journeys').select('*').eq('status', 'draft').order('created_at', desc=True).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def get_career_journey_by_id(
    requesting_user_id: str,
    journey_id: str,
    auth_claims: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get a single career journey by ID.
    """
    try:
        db = get_service_supabase_client()
        response = db.table('career_journeys').select('*').eq('id', journey_id).maybe_single().execute()
        
        if not response.data:
            return {"data": None, "error": "Career journey not found"}
            
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def publish_career_journey(
    requesting_user_id: str,
    journey_id: str,
    auth_claims: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Publish a career journey (changes status from draft to published).
    """
    try:
        db = get_service_supabase_client()
        response = db.table('career_journeys').update({'status': 'published'}).eq('id', journey_id).execute()
        
        data = response.data[0] if response.data and len(response.data) > 0 else response.data
        return {"data": data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def get_published_journeys(
    auth_claims: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get all published career journeys.
    """
    try:
        db = get_service_supabase_client()
        response = db.table('career_journeys').select('*').eq('status', 'published').order('created_at', desc=True).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def delete_career_journey(
    requesting_user_id: str,
    journey_id: str,
    auth_claims: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Delete a career journey draft.
    """
    try:
        db = get_service_supabase_client()
        response = db.table('career_journeys').delete().eq('id', journey_id).execute()
        
        return {"success": True, "error": None}
    except Exception as e:
        return {"success": False, "error": str(e)}
