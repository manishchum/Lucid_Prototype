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
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    
    if not supabase_url:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL environment variable not set")
    if not supabase_key:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY environment variable not set")
    
    return create_client(supabase_url, supabase_key)


def get_rls_client(jwt: str | None) -> Client:
    """
    Get a Supabase client that uses the anon key plus the caller JWT for RLS.
    Existing code can keep using the exported service client where needed.
    """
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_anon_key = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")

    if not supabase_url:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL environment variable not set")
    if not supabase_anon_key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable not set")

    client = create_client(supabase_url, supabase_anon_key)
    if jwt:
        try:
            client.postgrest.auth(jwt)
        except Exception:
            pass
        try:
            client.storage._client.headers.update({"Authorization": f"Bearer {jwt}"})
        except Exception:
            pass
    return client

# Export a ready-to-use instance
supabase = get_supabase_client()
