import os
from dotenv import load_dotenv
from typing import Optional
from supabase import create_client, Client
from supabase.lib.client_options import SyncClientOptions

# Load environment variables
load_dotenv()

def get_supabase_client() -> Client:
    """
    Get Supabase client instance.
    """
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    # No-bypass mode: always use anon key so RLS is enforced.
    supabase_key = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.getenv("SUPABASE_ANON_KEY")
    
    if not supabase_url:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL environment variable not set")
    if not supabase_key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable not set")
    
    return create_client(supabase_url.rstrip("/") + "/", supabase_key)

def get_user_supabase_client(user_id: Optional[str] = None, company_id: Optional[str] = None) -> Client:
    """
    Get Supabase client instance scoped to a user and company using the ANON key.
    Passes x-user-id and x-company-id headers so PostgREST RLS functions (current_app_user_id,
    current_app_company_id, can_access_company, can_access_user) work under RLS enforcement.
    """
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.getenv("SUPABASE_ANON_KEY")
    
    if not supabase_url:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL environment variable not set")
    if not supabase_key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable not set")
        
    headers = {}
    if user_id:
        headers["x-user-id"] = str(user_id)
    if company_id:
        headers["x-company-id"] = str(company_id)
        
    options = SyncClientOptions(headers=headers) if headers else None
    return create_client(supabase_url.rstrip("/") + "/", supabase_key, options=options)

def get_supabase_admin() -> Client:
    """
    Get Supabase admin instance (bypasses RLS) for specific backend operations.
    """
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")
    
    if not supabase_url:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL environment variable not set")
    if not supabase_key:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY environment variable not set")
        
    return create_client(supabase_url.rstrip("/") + "/", supabase_key)

# Export ready-to-use instances
supabase = get_supabase_client()

supabase_admin = get_supabase_admin()