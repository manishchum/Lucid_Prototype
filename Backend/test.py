# test_realtime.py
import asyncio
import os
from dotenv import load_dotenv
from websockets.asyncio.client import connect

load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

async def test():
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "OpenAI-Beta": "realtime=v1",
    }
    
    # Test the correct model name
    url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17"
    
    print(f"Testing with key: {OPENAI_API_KEY[:20]}...")
    print(f"Connecting to: {url}")
    
    try:
        async with connect(url, additional_headers=headers) as ws:
            print("✅ SUCCESS — Realtime API connected!")
            msg = await ws.recv()
            print(f"Response: {msg[:300]}")
    except Exception as e:
        print(f"❌ FAILED: {e}")

asyncio.run(test())