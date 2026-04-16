import asyncio
import os
import sys

from utils.auth_bridge import get_service_supabase_client
from utils.auth import _ensure_firebase_admin_initialized
from firebase_admin import auth

async def main():
    _ensure_firebase_admin_initialized()
    db = get_service_supabase_client()
    users_resp = db.table('users').select('user_id, email').is_('firebase_uid', 'null').execute()
    print(users_resp.data)
    for u in users_resp.data:
        try:
            fb_u = auth.get_user_by_email(u['email'])
            db.table('users').update({'firebase_uid': fb_u.uid}).eq('user_id', u['user_id']).execute()
            print(f"Updated {u['email']} with {fb_u.uid}")
        except Exception as e:
            print(f"Failed for {u['email']}: {e}")

asyncio.run(main())
