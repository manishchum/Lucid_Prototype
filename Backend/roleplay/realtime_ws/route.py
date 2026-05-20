import os
import json
import logging
import asyncio
from fastapi import APIRouter, WebSocket
from websockets.asyncio.client import connect

router = APIRouter()

from config import OPENAI_API_KEY
OPENAI_REALTIME_MODEL = os.getenv("OPENAI_REALTIME_MODEL")
OPENAI_REALTIME_URL = f"wss://api.openai.com/v1/realtime?model={OPENAI_REALTIME_MODEL}"

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


def build_system_prompt(scenario_context: dict) -> str:
    tone_instructions = {
        "Friendly": "Be warm, encouraging, and supportive. Show enthusiasm and positivity.",
        "Neutral": "Maintain a professional and balanced demeanor.",
        "Aggressive": "Be challenging, skeptical, and push back on ideas.",
    }
    tone = scenario_context.get("tone", "Neutral")
    tone_instruction = tone_instructions.get(tone, tone_instructions["Neutral"])

    return f"""You are an expert role-play simulation engine.
You are roleplaying as a {scenario_context.get('scenario_role')} in a "{scenario_context.get('scenario_title')}" scenario.

CRITICAL RULES FOR CLARITY AND SPEED:
1. STAY IN CHARACTER as the {scenario_context.get('scenario_role')} at all times
2. NEVER break character or acknowledge you are an AI
3. NEVER provide coaching or advice to the user
4. KEEP RESPONSES EXTREMELY SHORT - 1-2 sentences ONLY. Be concise and direct.
5. Use simple, common words. Avoid complex vocabulary.
6. Speak in natural pauses. One thought per sentence.
7. Raise realistic objections and concerns
8. Show realistic emotions based on what the user says

CHARACTER TONE: {tone_instruction}
Your character background: {scenario_context.get('initial_prompt')}

IMPORTANT: Quality over quantity. Each sentence should be clear and easy to understand when spoken aloud."""


@router.websocket("/roleplay/realtime")
async def websocket_realtime_roleplay(websocket: WebSocket):
    await websocket.accept()

    conversation_transcript = []
    scenario_context = None

    try:
        # 1. Receive initial session config
        init_data = json.loads(await websocket.receive_text())

        scenario_context = {
            "scenario_title": init_data.get("scenarioTitle"),
            "scenario_role":  init_data.get("scenarioRole"),
            "user_role":      init_data.get("userRole", "User"),
            "initial_prompt": init_data.get("initialPrompt"),
            "tone":           init_data.get("tone", "Neutral"),
            "employee_id":    init_data.get("employeeId"),
            "session_id":     init_data.get("sessionId"),
            "voice_gender":   init_data.get("voiceGender", "female"),
        }

        logger.info(f"✅ [Realtime] Session started: {scenario_context['session_id']}")
        logger.info(f"   Role: {scenario_context['scenario_role']}, Tone: {scenario_context['tone']}")

        if not OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY not set")

        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "OpenAI-Beta": "realtime=v1",
        }

        # ✅ FIXED: extra_headers (not additional_headers)
        async with connect(
    OPENAI_REALTIME_URL,
    additional_headers=[
        ("Authorization", f"Bearer {OPENAI_API_KEY}"),
        ("OpenAI-Beta", "realtime=v1"),
    ]
) as openai_ws:
            logger.info("[Realtime] ✅ Connected to OpenAI Realtime API")

            voice_map = {
                "female": "alloy",
                "male": "echo",
            }
            voice = voice_map.get(scenario_context.get("voice_gender", "female"), "alloy")
            logger.info(f"[Realtime] 🎙️ Voice gender: {scenario_context.get('voice_gender')}, selected voice: {voice}")

            await openai_ws.send(json.dumps({
                "type": "session.update",
                "session": {
                    "instructions": build_system_prompt(scenario_context),
                    "modalities": ["text", "audio"],
                    "voice": voice,
                    "input_audio_format": "pcm16",
                    "output_audio_format": "pcm16",
                    "temperature": 0.6,
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.6,
                        "silence_duration_ms": 800,
                        "prefix_padding_ms": 500
                    },
                    "input_audio_transcription": {
                        "model": "whisper-1"
                    }
                }
            }))
            logger.info(f"[Realtime] ✅ Session configured — voice: {voice}")

            # Trigger opening greeting
            if scenario_context.get("initial_prompt"):
                await openai_ws.send(json.dumps({
                    "type": "conversation.item.create",
                    "item": {
                        "type": "message",
                        "role": "user",
                        "content": [{
                            "type": "input_text",
                            "text": f"Start with a brief greeting as {scenario_context['scenario_role']}. Context: {scenario_context['initial_prompt']}"
                        }]
                    }
                }))
                await openai_ws.send(json.dumps({
                    "type": "response.create",
                    "response": {
                        "modalities": ["text", "audio"]
                    }
                }))
                logger.info("[Realtime] 🎤 Requested opening greeting")

            # --- Bidirectional tasks ---

            async def forward_client_to_openai():
                try:
                    while True:
                        msg = json.loads(await websocket.receive_text())
                        msg_type = msg.get("type")

                        if msg_type == "audio":
                            await openai_ws.send(json.dumps({
                                "type": "input_audio_buffer.append",
                                "audio": msg.get("audio")
                            }))

                        elif msg_type == "end_session":
                            logger.info(f"[Realtime] 📞 Session end requested — transcript has {len(conversation_transcript)} messages")

                            user_msgs = [m for m in conversation_transcript if m.get("role") == "user"]
                            bot_msgs  = [m for m in conversation_transcript if m.get("role") == "bot"]
                            logger.info(f"[Realtime] 📊 Breakdown: {len(user_msgs)} user, {len(bot_msgs)} bot messages")

                            await websocket.send_json({
                                "type": "session_ended",
                                "transcript": conversation_transcript,
                                "session_id": scenario_context["session_id"]
                            })

                            logger.info(f"[Realtime] ✅ session_ended sent with {len(conversation_transcript)} messages")
                            break

                except Exception as e:
                    logger.error(f"[Realtime] ❌ Forward error: {e}")

            async def receive_openai_to_client():
                try:
                    while True:
                        response = json.loads(await openai_ws.recv())
                        response_type = response.get("type")

                        if response_type == "response.audio.delta":
                            await websocket.send_json({
                                "type": "audio",
                                "audio": response.get("delta")
                            })

                        elif response_type == "response.audio_transcript.delta":
                            await websocket.send_json({
                                "type": "transcript_chunk",
                                "text": response.get("delta", ""),
                                "role": "bot"
                            })

                        elif response_type == "response.audio_transcript.done":
                            text = response.get("transcript", "")
                            if text:
                                conversation_transcript.append({"role": "bot", "text": text})
                                logger.info(f"[Realtime] 💬 Bot: {text[:60]}...")
                                logger.info(f"[Realtime] 📝 Transcript count: {len(conversation_transcript)}")

                        elif response_type == "conversation.item.input_audio_transcription.completed":
                            text = response.get("transcript", "")
                            if text:
                                conversation_transcript.append({"role": "user", "text": text})
                                logger.info(f"[Realtime] 👤 User: {text[:60]}...")
                                logger.info(f"[Realtime] 📝 Transcript count: {len(conversation_transcript)}")
                                await websocket.send_json({
                                    "type": "user_transcription",
                                    "text": text
                                })

                        elif response_type == "input_audio_buffer.speech_started":
                            logger.info("[Realtime] 🎙️ User started speaking")
                            await websocket.send_json({"type": "speech_started"})

                        elif response_type == "response.done":
                            logger.info("[Realtime] ✅ Response complete")
                            await websocket.send_json({"type": "response.done"})

                        elif response_type == "error":
                            logger.error(f"[Realtime] ❌ OpenAI error: {response}")
                            await websocket.send_json({
                                "type": "error",
                                "message": response.get("error", {}).get("message", "Unknown error")
                            })

                except Exception as e:
                    logger.error(f"[Realtime] ❌ Receive error: {e}")

            forward_task = asyncio.create_task(forward_client_to_openai())
            receive_task = asyncio.create_task(receive_openai_to_client())

            done, pending = await asyncio.wait(
                [forward_task, receive_task],
                return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    except Exception as e:
        logger.error(f"[Realtime] ❌ WebSocket error: {str(e)}", exc_info=True)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass

    finally:
        sid = scenario_context.get("session_id") if scenario_context else "unknown"
        logger.info(f"🔌 [Realtime] Session {sid} disconnected")