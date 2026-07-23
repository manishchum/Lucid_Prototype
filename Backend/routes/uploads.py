from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from utils.auth import RequestAuth, get_request_auth_required
from utils.supabase_client import supabase_admin
import uuid

router = APIRouter(
    tags=["Uploads"]
)

@router.get("/generate-upload-url")
async def generate_upload_url(
    file_name: str,
    content_type: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Generate a pre-signed URL to upload files directly to Supabase storage.
    """
    try:
        if not file_name or not content_type:
            raise HTTPException(status_code=400, detail="file_name and content_type are required")

        # Generate a unique path for the file
        file_ext = file_name.split('.')[-1] if '.' in file_name else ''
        unique_file_name = f"{uuid.uuid4()}.{file_ext}" if file_ext else str(uuid.uuid4())
        
        # Determine bucket based on typical uses or just use a generic 'uploads' bucket
        # We can use the 'content library' bucket or a new one like 'task-submissions'
        bucket_name = "task-submissions" 
        file_path = f"{auth_ctx.user_id}/{unique_file_name}"

        # Note: Supabase python client (storage3) supports create_signed_upload_url
        res = supabase_admin.storage.from_(bucket_name).create_signed_upload_url(file_path)
        
        if not res:
            raise Exception("Failed to generate upload URL")
            
        # The response usually contains 'signedUrl' or similar, we need to return it and the public url
        signed_url = res.get('signedUrl') if isinstance(res, dict) else res
        
        # Also generate the public URL or token URL so the frontend knows where it will be
        public_url = supabase_admin.storage.from_(bucket_name).get_public_url(file_path)

        return {
            "upload_url": signed_url,
            "file_url": public_url,
            "path": file_path
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
