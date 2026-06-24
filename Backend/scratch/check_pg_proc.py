import sys
import os
sys.path.append(os.path.abspath(os.path.dirname(__file__) + "/.."))

from utils.supabase_client import supabase_admin

try:
    # Try querying list of functions or schemas
    res = supabase_admin.table("pg_proc").select("proname").limit(10).execute()
    print("SUCCESS pg_proc:", res.data)
except Exception as e:
    print("ERROR pg_proc:", e)
