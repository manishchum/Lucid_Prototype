import os
import json
import httpx
from dotenv import load_dotenv

load_dotenv()

# Use service role key
api_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") + "/rest/v1/?apikey=" + api_key

try:
    resp = httpx.get(url)
    if resp.status_code == 200:
        spec = resp.json()
        print("PATHS (RPCs):")
        for path in spec.get("paths", {}).keys():
            if path.startswith("/rpc/"):
                print("  ", path)
        
        # Check task_submissions table schema in OpenAPI definitions
        definitions = spec.get("definitions", {})
        if "task_submissions" in definitions:
            properties = definitions["task_submissions"].get("properties", {})
            print("task_submissions properties:", list(properties.keys()))
        else:
            print("task_submissions not found in definitions")
    else:
        print("Failed to fetch OpenAPI spec:", resp.status_code, resp.text)
except Exception as e:
    print("ERROR:", e)
