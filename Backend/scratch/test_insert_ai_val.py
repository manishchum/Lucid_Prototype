import sys
import os
sys.path.append(os.path.abspath(os.path.dirname(__file__) + "/.."))

from utils.supabase_client import supabase

try:
    # Try selecting a column named ai_validation
    res = supabase.table("task_submissions").select("ai_validation").limit(1).execute()
    print("SUCCESS: column exists!", res.data)
except Exception as e:
    print("ERROR:", e)
