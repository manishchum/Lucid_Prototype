import sys
import os
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from utils.supabase_client import supabase

try:
    # Fetch a single row to inspect its keys
    res = supabase.table("task_submissions").select("*").limit(1).execute()
    print("KEYS:", res.data[0].keys() if res.data else "No data returned")
except Exception as e:
    print("ERROR:", e)
