import os
from dotenv import load_dotenv
from supabase import create_client, Client

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