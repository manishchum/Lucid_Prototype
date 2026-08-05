from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from typing import List, Optional
import uuid
from utils.supabase_client import supabase_admin
from utils.auth import RequestAuth, get_request_auth_required, get_effective_company_id
from utils.redis_client import get_cache, set_cache, delete_cache_pattern

router = APIRouter(
    prefix="/api/content-library",
    tags=["Content Library"]
)

@router.get("/categories")
async def get_categories(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    """
    Get predefined categories for the company.
    """
    cache_key = f"content_library:{effective_company_id}:categories"
    cached = get_cache(cache_key)
    if cached:
        return cached

    try:
        result = (
            supabase_admin
            .table("content_categories")
            .select("id,company_id,name,created_at,updated_at")
            .eq("company_id", effective_company_id)
            .order("name", desc=False)
            .execute()
        )
        response_payload = {"success": True, "data": result.data or []}
        set_cache(cache_key, response_payload, ttl=300)
        return response_payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/items")
async def get_content_items(
    category_id: Optional[str] = None,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    """
    Get uploaded content items for the company, optionally filtered by category.
    """
    cache_key = f"content_library:{effective_company_id}:items:{category_id or 'all'}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    try:
        query = supabase_admin.table("content_library_items").select("id,title,description,category_id,file_url,file_type,file_size,uploaded_by,created_at").eq("company_id", effective_company_id)
        if category_id:
            query = query.eq("category_id", category_id)
            
        result = query.order("created_at", desc=True).execute()
        response_payload = {"success": True, "data": result.data or []}
        set_cache(cache_key, response_payload, ttl=300)
        return response_payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload")
async def upload_content(
    category_id: str = Form(...),
    title: str = Form(...),
    description: Optional[str] = Form(""),
    file: UploadFile = File(...),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    """
    Upload a file to the content library bucket and save the record in DB.
    """
    try:
        # Validate category belongs to company
        cat_result = supabase_admin.table("content_categories").select("id").eq("id", category_id).eq("company_id", effective_company_id).execute()
        if not cat_result.data:
            raise HTTPException(status_code=400, detail="Invalid category ID")

        # Read file bytes
        file_bytes = await file.read()
        
        # Unique file path to avoid collisions
        file_name = getattr(file, "filename", None) or "upload"
        file_ext = file_name.split('.')[-1] if '.' in file_name else ''
        file_name_clean = file_name.replace(' ', '_')
        storage_path = f"raw_content/{effective_company_id}/{uuid.uuid4()}_{file_name_clean}"
        
        # Upload to Supabase Storage Bucket
        bucket_name = "content library"
        content_type = getattr(file, "content_type", None) or "application/octet-stream"
        
        upload_res = supabase_admin.storage.from_(bucket_name).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": content_type}
        )
        
        # Get public URL
        url_res = supabase_admin.storage.from_(bucket_name).get_public_url(storage_path)
        public_url = url_res

        # Get the auth.users id from token claims (usually 'sub' or 'uid')
        auth_user_id = None
        if auth_ctx.claims:
            claim_id = auth_ctx.claims.get("sub") or auth_ctx.claims.get("uid")
            if claim_id:
                # Check if it's a valid UUID (Supabase Auth). If it's a Firebase UID, leave as None.
                try:
                    uuid.UUID(str(claim_id))
                    auth_user_id = claim_id
                except ValueError:
                    pass
        
        # Save to database
        db_insert = supabase_admin.table("content_library_items").insert({
            "category_id": category_id,
            "company_id": effective_company_id,
            "title": title,
            "description": description,
            "file_url": public_url,
            "file_type": content_type,
            "file_size": len(file_bytes),
            "uploaded_by": auth_user_id
        }).execute()

        if not db_insert.data:
            raise Exception("Failed to insert record into content_library_items")

        delete_cache_pattern(f"content_library:{effective_company_id}:*")
        return {"success": True, "data": db_insert.data[0]}

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to upload content: {str(e)}")


@router.delete("/items/{item_id}")
async def delete_content(
    item_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    """
    Delete a content item and its file from storage.
    """
    try:
        # Get the item
        item_res = supabase_admin.table("content_library_items").select("id,title,description,category_id,file_url,file_type,file_size,uploaded_by,created_at").eq("id", item_id).eq("company_id", effective_company_id).execute()
        if not item_res.data:
            raise HTTPException(status_code=404, detail="Content item not found")
        
        item = item_res.data[0]
        
        # Delete from DB
        supabase_admin.table("content_library_items").delete().eq("id", item_id).execute()
        
        # Optionally, delete from storage if we can parse the path
        # Assuming file_url looks like: https://<project>.supabase.co/storage/v1/object/public/content library/company_id/uuid_filename.ext
        # But URLs encode spaces as %20. So check both string formats just in case.
        bucket_name = "content library"
        if f"/public/{bucket_name}/" in item["file_url"]:
            path = item["file_url"].split(f"/public/{bucket_name}/")[-1]
            supabase_admin.storage.from_(bucket_name).remove([path])
        elif f"/public/content%20library/" in item["file_url"]:
            path = item["file_url"].split(f"/public/content%20library/")[-1]
            supabase_admin.storage.from_(bucket_name).remove([path])
            
        delete_cache_pattern(f"content_library:{effective_company_id}:*")
        return {"success": True, "message": "Content deleted successfully"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
