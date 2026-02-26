from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from google.generativeai import GenerativeModel
import google.generativeai as genai
from supabase import create_client, Client
import os
import asyncio

router = APIRouter()

genai.configure(api_key=os.environ.get("GEMINI_API_KEY"))

ai = GenerativeModel("gemini-3-pro-preview")

supabase: Client = create_client(
    os.environ["NEXT_PUBLIC_SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"]
)


# WebSocket connections store
connections = set()


# Process STT (mock)
async def processSTT(audioChunk: bytes) -> str:
    print("Processing audio chunk of size:", len(audioChunk))
    return "Hello, how can I help you with this training module?"


# Call LLM
async def callLLM(transcript: str) -> str:

    prompt = f"""
You are a real-time voice assistant helping a user during a training session.

User said:
"{transcript}"

Respond naturally, concisely, and in plain text.
Do NOT use markdown, HTML, or special formatting.
"""

    result = ai.generate_content(prompt)

    return result.text


# Stream TTS simulation
async def streamTTS(ws: WebSocket, text: str):

    await ws.send_json({
        "type": "text",
        "data": text
    })

    chunks = text.split(" ")

    for chunk in chunks:
        await ws.send_json({
            "type": "tts",
            "data": chunk
        })

        await asyncio.sleep(0.1)


# WebSocket endpoint
@router.websocket("/module-chat")
async def websocket_endpoint(ws: WebSocket):

    await ws.accept()
    connections.add(ws)

    print("New WebSocket connection for voice chat")

    try:
        while True:

            data = await ws.receive_bytes()

            try:
                transcript = await processSTT(data)

                llmResponse = await callLLM(transcript)

                await streamTTS(ws, llmResponse)

            except Exception as error:
                print("Error processing audio:", error)

                await ws.send_json({
                    "error": "Processing failed"
                })

    except WebSocketDisconnect:

        print("WebSocket connection closed")

        connections.remove(ws)


# POST route
@router.post("/module-chat")
async def POST(request: Request):

    try:

        body = await request.json()

        processed_module_id = body.get("processed_module_id")
        user_message = body.get("user_message")
        chat_history = body.get("chat_history")

        if not processed_module_id or not user_message:

            return JSONResponse(
                {"error": "Missing required fields"},
                status_code=400
            )

        try:
            moduleQuery = supabase.table("processed_modules") \
                .select("title, content") \
                .eq("processed_module_id", processed_module_id) \
                .single() \
                .execute()

            moduleData = moduleQuery.data

            if not moduleData:
                return JSONResponse(
                    {"error": "Module not found"},
                    status_code=404
                )
        except Exception as e:
            print(f"[module-chat] Error fetching module: {e}")
            return JSONResponse(
                {"error": "Module not found"},
                status_code=404
            )

        historyContext = ""

        if chat_history and len(chat_history) > 0:

            historyContext = "\n".join([
                f"{'User' if msg['role']=='user' else 'Assistant'}: {msg['content']}"
                for msg in chat_history
            ])

        prompt = f"""You are a helpful learning assistant. You are helping a user understand a training module.

Module Title: {moduleData['title']}

Module Content:
{moduleData['content']}

{"Previous conversation:" + chr(10) + historyContext if historyContext else ""}

User's question: {user_message}

Please provide a helpful, concise response based on the module content. If the question is not related to the module, politely redirect the user to ask questions about the module content.
Provide response in plain text. DO NOT include any HTML or markdown formatting. DO NOT ADD BOLD UNDERLINES OR ITALICS.
"""

        model = GenerativeModel("gemini-2.5-flash-lite")

        result = model.generate_content(prompt)

        assistantMessage = result.text

        return JSONResponse({
            "success": True,
            "message": assistantMessage
        })

    except Exception as error:

        print("[module-chat] Error:", error)

        return JSONResponse(
            {"error": str(error) if error else "Failed to process chat"},
            status_code=500
        )