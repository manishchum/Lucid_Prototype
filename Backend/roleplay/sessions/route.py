from fastapi import APIRouter, Request, HTTPException, Depends
from datetime import datetime
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from utils.auth import get_request_auth_required
from utils.supabase_client import supabase_admin

router = APIRouter()

class CreateSessionRequest(BaseModel):
    employee_id: str
    scenario_id: str
    scenario_title: str
    scenario_role: str
    scenario_difficulty: str
    module_id: Optional[str] = None

class UpdateSessionRequest(BaseModel):
    messages: List[Dict[str, Any]]
    is_completed: bool = False

class AssessmentParameter(BaseModel):
    name: str
    score: int
    feedback: str

class CreateAssessmentRequest(BaseModel):
    session_id: str
    employee_id: str
    overallScore: int
    summary: str
    parameters: List[AssessmentParameter]
    recommendations: List[str]

@router.post("/roleplay/sessions/create")
async def create_roleplay_session(
    payload: CreateSessionRequest,
    auth_ctx = Depends(get_request_auth_required)
):
    try:
        if payload.employee_id != auth_ctx.user_id:
            raise HTTPException(status_code=403, detail="Not authorized to create sessions for other users")
        # Check attempts
        user_res = supabase_admin.table('users').select('company_id').eq('user_id', payload.employee_id).execute()
        if not user_res.data:
            raise HTTPException(status_code=400, detail="User not found")
            
        company_id = user_res.data[0]['company_id']
        
        comp_res = supabase_admin.table('companies').select('rate_limit_role_play_retries').eq('company_id', company_id).execute()
        if not comp_res.data:
            raise HTTPException(status_code=400, detail="Company not found")
            
        retry_limit = comp_res.data[0].get('rate_limit_role_play_retries')
        if retry_limit is None:
            retry_limit = 3
        else:
            retry_limit = int(retry_limit)
            
        if retry_limit <= 0:
            raise HTTPException(status_code=403, detail="Roleplay retries are disabled for your company.")
            
        sessions_res = supabase_admin.table('roleplay_sessions').select('id').eq('employee_id', payload.employee_id).eq('scenario_id', payload.scenario_id).execute()
        session_ids = [s['id'] for s in sessions_res.data] if sessions_res.data else []
        
        if session_ids:
            assess_res = supabase_admin.table('roleplay_assessments').select('id', count='exact').eq('employee_id', payload.employee_id).in_('session_id', session_ids).execute()
            attempt_count = assess_res.count or 0
            if attempt_count >= retry_limit:
                raise HTTPException(status_code=403, detail=f"Roleplay retry limit reached. You can attempt this scenario up to {retry_limit} time(s).")

        insert_data = {
            "employee_id": payload.employee_id,
            "scenario_id": payload.scenario_id,
            "scenario_title": payload.scenario_title,
            "scenario_role": payload.scenario_role,
            "scenario_difficulty": payload.scenario_difficulty,
            "conversation_transcript": [],
            "message_count": 0,
            "started_at": datetime.utcnow().isoformat()
        }
        if payload.module_id:
            insert_data["module_id"] = payload.module_id

        res = supabase_admin.table('roleplay_sessions').insert(insert_data).execute()
        if not res.data:
            raise HTTPException(status_code=500, detail="Failed to create session in database")
            
        return {"data": res.data[0]}

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/roleplay/sessions/{session_id}")
async def update_roleplay_session(
    session_id: str,
    payload: UpdateSessionRequest,
    auth_ctx = Depends(get_request_auth_required)
):
    try:
        update_data = {
            "conversation_transcript": payload.messages,
            "message_count": len(payload.messages)
        }
        if payload.is_completed:
            update_data["completed_at"] = datetime.utcnow().isoformat()

        res = supabase_admin.table('roleplay_sessions').update(update_data).eq('id', session_id).execute()
        if not res.data:
            raise HTTPException(status_code=500, detail="Failed to update session in database")
            
        return {"data": res.data[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/roleplay/assessments/create")
async def create_roleplay_assessment(
    payload: CreateAssessmentRequest,
    auth_ctx = Depends(get_request_auth_required)
):
    try:
        if payload.employee_id != auth_ctx.user_id:
            raise HTTPException(status_code=403, detail="Not authorized to create assessments for other users")
        insert_data = {
            "session_id": payload.session_id,
            "employee_id": payload.employee_id,
            "overall_score": payload.overallScore,
            "summary": payload.summary,
            "parameters": [p.model_dump() for p in payload.parameters],
            "recommendations": payload.recommendations
        }
        res = supabase_admin.table('roleplay_assessments').insert(insert_data).execute()
        if not res.data:
            raise HTTPException(status_code=500, detail="Failed to create assessment in database")
            
        return {"data": res.data[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
