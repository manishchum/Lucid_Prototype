import sys
import os
import asyncio
import httpx
import websockets
import json

sys.path.append(os.path.abspath(os.path.dirname(__file__) + "/.."))

from utils.supabase_client import supabase

async def test_notifications():
    print("[TEST] Fetching a test active user from database...")
    # Fetch active users
    resp = supabase.table("users").select("*").eq("is_active", True).execute()
    users_with_phone = [u for u in (resp.data or []) if u.get("phone")]
    if not users_with_phone:
        print("[TEST] ERROR: No active users with phone numbers found in DB.")
        return
    
    test_user = users_with_phone[0]
    user_id = test_user["user_id"]
    company_id = test_user["company_id"]
    email = test_user.get("email")
    phone = test_user.get("phone")
    
    print(f"[TEST] Using test user: {test_user['name']} (ID: {user_id}, Email: {email}, Phone: {phone})")

    # Connect WebSocket client to local notifications WS endpoint
    ws_url = f"ws://127.0.0.1:8000/api/notifications/ws?user_id={user_id}"
    print(f"[TEST] Connecting WebSocket to {ws_url}...")
    
    try:
        async with websockets.connect(ws_url) as ws:
            print("[TEST] WebSocket connected! Triggering POST /api/notifications/assignment...")
            
            # Send assignment notification POST request using httpx
            payload = {
                "assignment_type": "sprint",
                "assignment_title": "Gemini Integration Sprint",
                "company_id": company_id,
                "target_type": "user",
                "target_ids": [user_id],
                "frontend_url": "http://127.0.0.1:3000"
            }
            
            async with httpx.AsyncClient() as client:
                res = await client.post("http://127.0.0.1:8000/api/notifications/assignment", json=payload)
                print(f"[TEST] API Response Status: {res.status_code}")
                print(f"[TEST] API Response Body: {res.text}")
                assert res.status_code == 200, "API request failed"
            
            # Wait for WebSocket frame
            print("[TEST] Waiting for WebSocket message...")
            ws_response = await asyncio.wait_for(ws.recv(), timeout=5.0)
            message = json.loads(ws_response)
            print(f"[TEST] WebSocket Message Received: {json.dumps(message, indent=2)}")
            
            assert message["event"] == "new_notification", "Invalid WebSocket event"
            assert message["data"]["user_id"] == user_id, "Notification user_id mismatch"
            assert "Gemini Integration Sprint" in message["data"]["message"], "Notification message content mismatch"
            
            print("[TEST] Checking Supabase notifications table...")
            db_res = supabase.table("notifications").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(1).execute()
            assert db_res.data, "No database notification record found"
            latest_notif = db_res.data[0]
            print(f"[TEST] Latest DB Notification: {json.dumps(latest_notif, indent=2)}")
            assert latest_notif["id"] == message["data"]["id"], "DB ID does not match WS payload ID"
            
            print("[TEST] SUCCESS: Notifications table insert, WebSocket broadcast, and REST APIs are working perfectly!")
            
    except Exception as e:
        print(f"[TEST] FAILED with exception: {e}")

if __name__ == "__main__":
    asyncio.run(test_notifications())
