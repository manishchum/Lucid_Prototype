import asyncio
from utils.auth_bridge import get_service_supabase_client
supabase = get_service_supabase_client()
user_id = 'd8e79fb1-01ee-4b8b-ab7d-4dc52376b796'
learning_style_res = supabase.table("employee_learning_style").select("learning_style").eq("user_id", user_id).maybe_single().execute()
print(learning_style_res)
