from fastapi import APIRouter, Header, Query, HTTPException, Depends, File, UploadFile, Form
from pydantic import BaseModel
from typing import Optional, List
from utils.auth_bridge import get_service_supabase_client
import time


from utils.db.companies_db import (
    get_company_by_id,
    get_company_by_name,
    get_company_by_domain,
    list_all_companies,
    create_company,
    update_company,
    delete_company,
    search_companies,
    get_org_templates_from_sub_department,
    provision_company_functions,
)

from utils.exceptions import NotFoundError, ValidationError, ConflictError
from utils.redis_client import redis_client, set_cache, get_cache
from utils.db.permissions import check_user_permission
from utils.auth import get_request_auth_required, RequestAuth

router = APIRouter(prefix="/api/companies", tags=["companies"])


class CreateCompanyRequest(BaseModel):
    name: str
    domain: str
    company_logo: str
    learning_style: Optional[bool] = False


class UpdateCompanyRequest(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    company_logo: Optional[str] = None
    learning_style: Optional[bool] = None
    subscription_tier: Optional[str] = None
    subscription_addons: Optional[List[str]] = None


class CustomFunctionEntry(BaseModel):
    function_name: str
    sub_function_name: Optional[str] = None


class ProvisionCompanyFunctionsRequest(BaseModel):
    selected_department_ids: List[str] = []
    custom_entries: List[CustomFunctionEntry] = []


@router.get("/")
async def list_companies(
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    List all companies.
    Permission: Super admin only.
    """
    result = await list_all_companies(user_id)
    
    # Unwrap service layer response
    companies = result.get("data") or []
    
    return {
        "success": True,
        "data": {"companies": companies, "count": len(companies)},
        "error": result.get("error")
    }


@router.get("/search")
async def search_companies_route(
    q: str = Query(..., min_length=2, description="Search term (minimum 2 characters)"),
    limit: int = Query(10, ge=1, le=50, description="Maximum number of results"),
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Search companies by name (case-insensitive partial match).
    Permission: Public access (for signup), requires minimum 2 characters for privacy.
    """
    result = await search_companies(user_id, q, limit)
    
    # Unwrap service layer response
    companies = result.get("data") or []
    
    return {
        "success": True,
        "data": {"companies": companies, "count": len(companies)},
        "error": result.get("error")
    }


@router.get("/org-templates")
async def get_org_templates_route(
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Get default department/sub-department templates from sub_department.
    Permission: Super admin/developer.
    """
    result = await get_org_templates_from_sub_department(user_id)

    return {
        "success": True,
        "data": result.get("data") or [],
        "error": result.get("error")
    }


@router.get("/{company_id}")
async def get_company(
    company_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Get company by ID.
    Permission: Any authenticated user.
    """
    cache_key = f"company:{company_id}"

    cached = get_cache(cache_key)

    if cached:
        print(f"COMPANY CACHE HIT {cache_key}")
        return cached

    print(f"COMPANY CACHE MISS {cache_key}")

    result = await get_company_by_id(user_id, company_id)

    company = result.get("data") or None

    response_payload = {
        "success": True,
        "data": company,
        "error": result.get("error")
    }

    set_cache(
        cache_key,
        response_payload,
        ttl=3600
    )

    return response_payload


@router.get("/by-name/{company_name}")
async def get_company_by_name_route(
    company_name: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Get company by name (case-insensitive).
    Permission: Public access (for signup validation).
    """
    result = await get_company_by_name(user_id, company_name)
    
    # Unwrap service layer response
    company = result.get("data") or None
    
    return {
        "success": True,
        "data": company,
        "error": result.get("error")
    }


@router.get("/by-domain/{domain}")
async def get_company_by_domain_route(
    domain: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Get company by domain.
    Permission: Public access (for signup/email validation).
    """
    result = await get_company_by_domain(user_id, domain)
    
    # Unwrap service layer response
    company = result.get("data") or None
    
    return {
        "success": True,
        "data": company,
        "error": result.get("error")
    }



@router.post("/with-logo")
async def create_company_with_logo_route(
    name: str = Form(...),
    domain: str = Form(...),
    logo: UploadFile = File(...),
    learning_style: bool = Form(False),
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    supabase = get_service_supabase_client()
    
    safe_ext = "png"
    if logo.filename and "." in logo.filename:
        safe_ext = logo.filename.split(".")[-1].lower()
    
    safe_name = "".join([c if c.isalnum() else "-" for c in name.lower()]).strip("-")
    logo_path = f"companies/{safe_name}-{int(time.time()*1000)}.{safe_ext}"
    
    try:
        content = await logo.read()
        res = supabase.storage.from_("logos").upload(
            logo_path,
            content,
            {"content-type": logo.content_type, "upsert": "true"}
        )
        
        public_url = supabase.storage.from_("logos").get_public_url(logo_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to upload logo: {str(e)}")
        
    company_data = {
        "name": name,
        "domain": domain,
        "company_logo": public_url,
        "learning_style": learning_style
    }
    
    result = await create_company(user_id, company_data)
    company = result.get("data") or None
    
    return {
        "success": True,
        "data": company,
        "error": result.get("error")
    }

@router.post("/")
async def create_company_route(
    request: CreateCompanyRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Create a new company.
    Permission: Super admin OR public signup (no auth required).
    """
    company_data = request.dict()
    result = await create_company(user_id, company_data)
    
    # Unwrap service layer response
    company = result.get("data") or None
    
    return {
        "success": True,
        "data": company,
        "error": result.get("error")
    }


@router.post("/{company_id}/provision-functions")
async def provision_company_functions_route(
    company_id: str,
    request: ProvisionCompanyFunctionsRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Provision function/sub_function rows for a company based on selected
    sub_department templates and optional custom entries.
    Permission: Super admin/developer.
    """
    result = await provision_company_functions(
        user_id,
        company_id,
        request.selected_department_ids,
        [entry.dict() for entry in request.custom_entries],
    )

    return {
        "success": True,
        "data": result.get("data"),
        "error": result.get("error")
    }


@router.put("/{company_id}")
async def update_company_route(
    company_id: str,
    request: UpdateCompanyRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Update company details.
    Permission: Admin+ of the company.
    """
    update_data = request.dict(exclude_none=True)

    allowed_tiers = {"tier_1", "tier_2", "tier_3"}
    allowed_addons = {
        "lucid_studio",
        "lucid_studio_textual",
        "lucid_studio_podcast",
        "lucid_studio_video",
        "lucid_studio_mindmap",
        "lucid_studio_infographic",
        "lucid_studio_flashcard",
        "lucid_studio_flashcards",
        "chat_in_studio",
        "task_management",
        "kpi",
        "role_play",
    }
    allowed_language_codes = {
        "en",
        "hi",
        "de",
        "ru",
        "fr",
        "it",
        "es",
        "pl",
        "uk",
        "ro",
        "nl",
        "bn",
        "ta",
        "te",
        "mr",
        "kn",
        "pa",
        "gu",
        "ur",
        "or",
    }

    if "subscription_tier" in update_data:
        normalized_tier = str(update_data["subscription_tier"]).strip().lower()
        if normalized_tier not in allowed_tiers:
            raise HTTPException(
                status_code=400,
                detail="subscription_tier must be one of: tier_1, tier_2, tier_3"
            )
        update_data["subscription_tier"] = normalized_tier

    if "subscription_addons" in update_data:
        raw_addons = update_data.get("subscription_addons") or []
        normalized_addons = []
        for addon in raw_addons:
            normalized = str(addon).strip().lower().replace("-", "_").replace(" ", "_")
            if (normalized in allowed_addons or normalized in allowed_language_codes) and normalized not in normalized_addons:
                normalized_addons.append(normalized)

        # Ensure the parent lucid_studio addon is present when any child Lucid Studio feature is enabled.
        if any(child in normalized_addons for child in (
            "lucid_studio_textual",
            "lucid_studio_podcast",
            "lucid_studio_video",
            "lucid_studio_mindmap",
            "lucid_studio_infographic",
            "lucid_studio_flashcard",
            "lucid_studio_flashcards",
        )) and "lucid_studio" not in normalized_addons:
            normalized_addons.insert(0, "lucid_studio")

        update_data["subscription_addons"] = normalized_addons

    if "subscription_tier" in update_data or "subscription_addons" in update_data:
        is_developer = await check_user_permission(user_id, "developer")
        if not is_developer:
            raise HTTPException(
                status_code=403,
                detail="Permission denied: Developer access required for company access plans"
            )

    result = await update_company(user_id, company_id, update_data)
    
    redis_client.delete(f"company:{company_id}")  # Invalidate cache on update
    # Unwrap service layer response
    company = result.get("data") or None
    
    return {
        "success": True,
        "data": company,
        "error": result.get("error")
    }


@router.delete("/{company_id}")
async def delete_company_route(
    company_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Delete a company.
    Permission: Super admin only.
    """
    result = await delete_company(user_id, company_id)
    redis_client.delete(f"company:{company_id}")  # Invalidate cache on delete
    # Unwrap service layer response
    deleted = result.get("data") or None
    
    return {
        "success": True,
        "data": deleted,
        "error": result.get("error")
    }
