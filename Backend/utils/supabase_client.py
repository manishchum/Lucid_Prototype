import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

def get_supabase_client() -> Client:
    """
    Get Supabase client instance using the SERVICE ROLE KEY.

    The backend never holds a Supabase Auth session (it uses Firebase for identity).
    RLS policies require auth.uid() which is always NULL for backend requests, so
    the anon key would block every query. Service role bypasses RLS safely because
    the backend enforces permissions in Python (check_user_permission / check_company_access).
    """
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    # Always use service role on the backend — Firebase auth means no Supabase JWT.
    supabase_key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")  # last-resort fallback only
        or os.getenv("SUPABASE_ANON_KEY")
    )

    if not supabase_url:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL environment variable not set")
    if not supabase_key:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY environment variable not set")

    return create_client(supabase_url, supabase_key)

def get_supabase_admin() -> Client:
    """
    Get Supabase admin instance (bypasses RLS) for specific backend operations.
    Identical to get_supabase_client() now; kept for backwards compatibility.
    """
    return get_supabase_client()

# Export ready-to-use instances
supabase = get_supabase_client()
supabase_admin = get_supabase_admin()