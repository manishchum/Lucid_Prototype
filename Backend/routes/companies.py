from fastapi import APIRouter, Header, Query
from pydantic import BaseModel
from typing import Optional, List

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


class CustomFunctionEntry(BaseModel):
    function_name: str
    sub_function_name: Optional[str] = None


class ProvisionCompanyFunctionsRequest(BaseModel):
    selected_department_ids: List[str] = []
    custom_entries: List[CustomFunctionEntry] = []


@router.get("/")
async def list_companies(
    user_id: str = Header(..., alias="X-User-ID")
):
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
    user_id: Optional[str] = Header(None, alias="X-User-ID")
):
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
    user_id: Optional[str] = Header(None, alias="X-User-ID")
):
    """
    Get company by ID.
    Permission: Any authenticated user.
    """
    result = await get_company_by_id(user_id, company_id)
    
    # Unwrap service layer response
    company = result.get("data") or None
    
    return {
        "success": True,
        "data": company,
        "error": result.get("error")
    }


@router.get("/by-name/{company_name}")
async def get_company_by_name_route(
    company_name: str,
    user_id: Optional[str] = Header(None, alias="X-User-ID")
):
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
    user_id: Optional[str] = Header(None, alias="X-User-ID")
):
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


@router.post("/")
async def create_company_route(
    request: CreateCompanyRequest,
    user_id: Optional[str] = Header(None, alias="X-User-ID")
):
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
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Update company details.
    Permission: Admin+ of the company.
    """
    update_data = request.dict(exclude_none=True)
    result = await update_company(user_id, company_id, update_data)
    
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
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Delete a company.
    Permission: Super admin only.
    """
    result = await delete_company(user_id, company_id)
    
    # Unwrap service layer response
    deleted = result.get("data") or None
    
    return {
        "success": True,
        "data": deleted,
        "error": result.get("error")
    }
