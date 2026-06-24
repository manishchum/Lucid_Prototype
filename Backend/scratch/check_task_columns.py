import sys
import os
sys.path.append(os.path.abspath(os.path.dirname(__file__) + "/.."))

from utils.supabase_client import supabase

try:
    res = supabase.table("tasks").select("*").limit(1).execute()
    print("KEYS in tasks table:", res.data[0].keys() if res.data else "No data returned")
except Exception as e:
    print("ERROR:", e)
