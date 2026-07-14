"""
FastAPI routes for Career Journey CRUD operations
Handles admin creation, editing, publishing and user retrieval of career journeys
"""

import os
import json
from datetime import datetime
from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
from supabase import create_client, Client
from utils.auth import (
    get_request_auth_required_from_request,
    get_effective_company_id,
    get_request_auth_required,
    RequestAuth
)
from utils.db.permissions import check_user_permission

router = APIRouter()

# Initialize Supabase client with error handling
try:
    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    
    if supabase_url and supabase_key:
        supabase: Client = create_client(supabase_url, supabase_key)
    else:
        print("[WARNING] Supabase environment variables not configured")
        supabase = None
except Exception as e:
    print(f"[WARNING] Failed to initialize Supabase client: {e}")
    supabase = None


@router.post("/career-journeys")
async def create_career_journey(
    request: Request,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    """
    Create a new career journey draft
    Requires: X-User-ID header (admin)
    """
    try:
        if not supabase:
            return JSONResponse(
                {"error": "Database service not available"},
                status_code=503
            )
        
        # auth_ctx already injected via Depends
        body = await request.json()

        # Validate required fields
        title = body.get("title", "").strip()
        description = body.get("description", "").strip()
        skills = body.get("skills", [])

        if not title:
            return JSONResponse(
                {"error": "Journey title is required"},
                status_code=400
            )

        if len(skills) == 0:
            return JSONResponse(
                {"error": "At least one skill is required"},
                status_code=400
            )

        # Create journey record
        journey_data = {
            "title": title,
            "description": description,
            "category": body.get("category", ""),
            "tags": body.get("tags", []),
            "skills": skills,
            "connections": body.get("connections", []),
            "thumbnail": body.get("thumbnail"),
            "status": "draft",
            "created_by": str(auth_ctx.user_id),
            "company_id": effective_company_id,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }

        resp = supabase.table("career_journeys").insert(journey_data).execute()

        if not resp.data:
            return JSONResponse(
                {"error": "Failed to create career journey"},
                status_code=500
            )

        return JSONResponse({
            "success": True,
            "data": resp.data[0] if isinstance(resp.data, list) else resp.data
        })

    except HTTPException as error:
        return JSONResponse({"error": error.detail}, status_code=error.status_code)
    except Exception as error:
        print("[career-journeys POST] Error:", error)
        return JSONResponse(
            {"error": "Failed to create career journey", "details": str(error)},
            status_code=500
        )


@router.get("/career-journeys")
async def list_career_journeys(
    request: Request,
    status: str = None,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    """
    List career journeys with optional status filter
    - Status=published: returns all published journeys (no auth required)
    - Status=draft: returns all draft journeys (admin only)
    """
    try:
        if not supabase:
            print("[career-journeys GET] Supabase client not initialized")
            return JSONResponse({
                "success": True,
                "data": []
            })
        
        # Determine the filter value
        filter_status = status if status else "published"
        
        # Try to fetch from Supabase
        try:
            resp = supabase.table("career_journeys") \
                .select("*") \
                .eq("status", filter_status) \
                .eq("company_id", effective_company_id) \
                .order("created_at", desc=True) \
                .execute()
            
            journeys = resp.data or []
            
        except Exception as db_error:
            print(f"[career-journeys GET] Database error: {db_error}")
            import traceback
            traceback.print_exc()
            # If table doesn't exist or there's a permissions issue, return empty list
            journeys = []
        
        return JSONResponse({
            "success": True,
            "data": journeys
        })

    except HTTPException as error:
        return JSONResponse({"error": error.detail}, status_code=error.status_code)
    except Exception as error:
        print("[career-journeys GET] Error:", error)
        import traceback
        traceback.print_exc()
        return JSONResponse(
            {"error": "Failed to fetch career journeys", "details": str(error)},
            status_code=500
        )


@router.get("/career-journeys/{journey_id}")
async def get_career_journey(
    request: Request,
    journey_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    """
    Get a single career journey by ID
    """
    try:

        resp = supabase.table("career_journeys").select("*").eq(
            "id", journey_id
        ).maybe_single().execute()

        if not resp.data:
            return JSONResponse(
                {"error": "Career journey not found"},
                status_code=404
            )

        journey = resp.data

        if str(journey.get("company_id")) != effective_company_id:
            return JSONResponse(
                {"error": "Journey does not belong to your company"},
                status_code=403
            )

        # Permission check: allow if user is creator or status is published
        is_creator = str(journey.get("created_by")) == str(auth_ctx.user_id)
        is_published = journey.get("status") == "published"

        if not is_creator and not is_published:
            return JSONResponse(
                {"error": "Access denied"},
                status_code=403
            )

        return JSONResponse({
            "success": True,
            "data": journey
        })

    except Exception as error:
        print("[career-journeys GET {id}] Error:", error)
        return JSONResponse(
            {"error": "Failed to fetch career journey", "details": str(error)},
            status_code=500
        )


@router.put("/career-journeys/{journey_id}")
async def update_career_journey(
    request: Request,
    journey_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    """
    Update an existing career journey draft
    Requires: X-User-ID header (admin)
    """
    try:
        # auth_ctx already injected via Depends
        body = await request.json()

        # Get existing journey
        resp = supabase.table("career_journeys").select("*").eq(
            "id", journey_id
        ).maybe_single().execute()

        if not resp.data:
            return JSONResponse(
                {"error": "Career journey not found"},
                status_code=404
            )

        journey = resp.data

        if str(journey.get("company_id")) != effective_company_id:
            return JSONResponse(
                {"error": "Journey does not belong to your company"},
                status_code=403
            )

        # Permission check: creator or company admin in same company can edit
        is_creator = str(journey.get("created_by")) == str(auth_ctx.user_id)
        is_admin = await check_user_permission(auth_ctx.user_id, "company_admin")
        if not is_creator and not is_admin:
            return JSONResponse(
                {"error": "Only the creator or a company admin can edit this draft"},
                status_code=403
            )

        # Prepare update data
        update_data = {
            "title": body.get("title", journey.get("title")),
            "description": body.get("description", journey.get("description")),
            "category": body.get("category", journey.get("category", "")),
            "tags": body.get("tags", journey.get("tags", [])),
            "skills": body.get("skills", journey.get("skills", [])),
            "connections": body.get("connections", journey.get("connections", [])),
            "thumbnail": body.get("thumbnail", journey.get("thumbnail")),
            "updated_at": datetime.utcnow().isoformat(),
        }

        update_resp = supabase.table("career_journeys").update(update_data).eq(
            "id", journey_id
        ).execute()

        if not update_resp.data:
            return JSONResponse(
                {"error": "Failed to update career journey"},
                status_code=500
            )

        return JSONResponse({
            "success": True,
            "data": update_resp.data[0] if isinstance(update_resp.data, list) else update_resp.data
        })

    except Exception as error:
        print("[career-journeys PUT] Error:", error)
        return JSONResponse(
            {"error": "Failed to update career journey", "details": str(error)},
            status_code=500
        )


@router.patch("/career-journeys/{journey_id}/publish")
async def publish_career_journey(
    request: Request,
    journey_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    """
    Publish a career journey (change status from draft to published)
    Requires: X-User-ID header (admin)
    """
    try:

        # Get existing journey
        resp = supabase.table("career_journeys").select("*").eq(
            "id", journey_id
        ).maybe_single().execute()

        if not resp.data:
            return JSONResponse(
                {"error": "Career journey not found"},
                status_code=404
            )

        journey = resp.data

        if str(journey.get("company_id")) != effective_company_id:
            return JSONResponse(
                {"error": "Journey does not belong to your company"},
                status_code=403
            )

        # Permission check: only creator can publish
        if str(journey.get("created_by")) != str(auth_ctx.user_id):
            return JSONResponse(
                {"error": "Only the creator can publish this journey"},
                status_code=403
            )

        # Check if already published
        if journey.get("status") == "published":
            return JSONResponse(
                {"error": "This journey is already published"},
                status_code=400
            )

        # Update status to published
        update_data = {
            "status": "published",
            "updated_at": datetime.utcnow().isoformat(),
        }

        update_resp = supabase.table("career_journeys").update(update_data).eq(
            "id", journey_id
        ).execute()

        if not update_resp.data:
            return JSONResponse(
                {"error": "Failed to publish career journey"},
                status_code=500
            )

        return JSONResponse({
            "success": True,
            "data": update_resp.data[0] if isinstance(update_resp.data, list) else update_resp.data
        })

    except Exception as error:
        print("[career-journeys PATCH /publish] Error:", error)
        return JSONResponse(
            {"error": "Failed to publish career journey", "details": str(error)},
            status_code=500
        )


@router.delete("/career-journeys/{journey_id}")
async def delete_career_journey(
    request: Request,
    journey_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    """
    Delete a career journey (drafts only)
    Requires: X-User-ID header (admin)
    """
    try:

        # Get existing journey
        resp = supabase.table("career_journeys").select("*").eq(
            "id", journey_id
        ).maybe_single().execute()

        if not resp.data:
            return JSONResponse(
                {"error": "Career journey not found"},
                status_code=404
            )

        journey = resp.data
        
        if str(journey.get("company_id")) != effective_company_id:
            return JSONResponse(
                {"error": "Journey does not belong to your company"},
                status_code=403
            )

        # Permission check: only creator can delete
        if str(journey.get("created_by")) != str(auth_ctx.user_id):
            return JSONResponse(
                {"error": "Only the creator can delete this journey"},
                status_code=403
            )

        # Delete journey (both drafts and published)
        del_resp = supabase.table("career_journeys").delete().eq(
            "id", journey_id
        ).execute()

        return JSONResponse({
            "success": True,
            "message": "Career journey deleted successfully"
        })

    except Exception as error:
        print("[career-journeys DELETE] Error:", error)
        return JSONResponse(
            {"error": "Failed to delete career journey", "details": str(error)},
            status_code=500
        )
