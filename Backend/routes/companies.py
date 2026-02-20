from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional

from utils.db.companies_db import (
    get_company_by_id,
    get_company_by_name,
    get_company_by_domain,
    list_all_companies,
    create_company,
    update_company,
    delete_company
)

router = APIRouter(prefix="/api/companies", tags=["companies"])


class CreateCompanyRequest(BaseModel):
    name: str
    domain: str
    learning_style: Optional[bool] = False


class UpdateCompanyRequest(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    learning_style: Optional[bool] = None


@router.get("/")
async def list_companies(
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    List all companies.
    Permission: Super admin only.
    """
    result = await list_all_companies(user_id)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {"companies": result["data"], "count": len(result["data"] or [])}


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
    if result["error"]:
        status_code = 404 if result["error"] == "Company not found" else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    return {"company": result["data"]}


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
    if result["error"]:
        raise HTTPException(status_code=500, detail=result["error"])
    
    if not result["data"]:
        raise HTTPException(status_code=404, detail="Company not found")
    
    return {"company": result["data"]}


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
    if result["error"]:
        status_code = 404 if result["error"] == "Company not found" else 500
        raise HTTPException(status_code=status_code, detail=result["error"])
    return {"company": result["data"]}


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
    
    if result["error"]:
        status_code = 400 if "already exists" in result["error"] or "required" in result["error"] else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {"company": result["data"]}


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
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No update data provided")
    
    result = await update_company(user_id, company_id, update_data)
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {"company": result["data"]}


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
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {"message": "Company deleted successfully", "company": result["data"]}
