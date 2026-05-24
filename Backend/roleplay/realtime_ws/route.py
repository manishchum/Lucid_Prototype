import json
import logging
import asyncio
from fastapi import APIRouter, WebSocket
from websockets.asyncio.client import connect

from config import OPENAI_API_KEY, OPENAI_REALTIME_MODEL

router = APIRouter()

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

_OPENAI_API_KEY = OPENAI_API_KEY

if not _OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY not loaded")

if not _OPENAI_API_KEY.startswith("sk-"):
    raise ValueError(f"OPENAI_API_KEY has invalid prefix: {_OPENAI_API_KEY[:10]}")

logger.warning("[Realtime] Key loaded: yes")
logger.warning(f"[Realtime] Key prefix: {_OPENAI_API_KEY[:8]}")
logger.warning(f"[Realtime] Key length: {len(_OPENAI_API_KEY)}")
logger.warning(f"[Realtime] Model: {OPENAI_REALTIME_MODEL}")

OPENAI_REALTIME_URL = f"wss://api.openai.com/v1/realtime?model={OPENAI_REALTIME_MODEL}"


def build_system_prompt(scenario_context: dict) -> str:
    tone_instructions = {
        "Friendly": "Be warm, encouraging, and supportive. Show enthusiasm and positivity.",
        "Neutral": "Maintain a professional and balanced demeanor.",
        "Aggressive": "Be challenging, skeptical, and push back on ideas.",
    }
    tone = scenario_context.get("tone", "Neutral")
    tone_instruction = tone_instructions.get(tone, tone_instructions["Neutral"])

    scenario_role = scenario_context.get("scenario_role") or "role-play character"
    user_role = scenario_context.get("user_role") or "learner"
    initial_prompt = scenario_context.get("initial_prompt") or ""
    ai_personality = scenario_context.get("ai_personality") or ""
    ai_objectives = scenario_context.get("ai_objectives") or ""

    return f"""You are an expert role-play simulation engine.
You are roleplaying as the AI character: {scenario_role}.
The human learner is roleplaying as: {user_role}.
Scenario: "{scenario_context.get('scenario_title')}".

ROLE ASSIGNMENT - THIS IS NON-NEGOTIABLE:
- You speak ONLY as: {scenario_role}
- The human speaks as: {user_role}
- Never introduce yourself as the {user_role}
- Never say lines that belong to the {user_role}
- Never evaluate, coach, or explain the scenario during the live roleplay

CRITICAL RULES FOR CLARITY AND SPEED:
1. STAY IN CHARACTER as the {scenario_role} at all times
2. NEVER break character or acknowledge you are an AI
3. NEVER provide coaching or advice to the user
4. KEEP RESPONSES EXTREMELY SHORT - 1-2 sentences ONLY. Be concise and direct.
5. Use simple, common words. Avoid complex vocabulary.
6. Speak in natural pauses. One thought per sentence.
7. Raise realistic objections and concerns
8. Show realistic emotions based on what the user says
9. DO NOT roleplay as the {user_role}. That is the human learner's role.
10. DO NOT answer for the learner or tell the learner what to say.

CHARACTER TONE: {tone_instruction}
AI character personality/context: {ai_personality}
AI character objective: {ai_objectives}
Opening line or situation for the AI character ({scenario_role}) to express: {initial_prompt}

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
            "ai_personality": init_data.get("aiPersonality"),
            "ai_objectives": init_data.get("aiObjectives"),
            "learner_brief": init_data.get("learnerBrief"),
            "tone":           init_data.get("tone", "Neutral"),
            "employee_id":    init_data.get("employeeId"),
            "session_id":     init_data.get("sessionId"),
            "voice_gender":   init_data.get("voiceGender", "female"),
        }

        logger.info(f"✅ [Realtime] Session started: {scenario_context['session_id']}")
        logger.info(f"   Role: {scenario_context['scenario_role']}, Tone: {scenario_context['tone']}")
        logger.warning(
            "[Realtime] Role assignment: AI=%s | Learner=%s | Scenario=%s",
            scenario_context["scenario_role"],
            scenario_context["user_role"],
            scenario_context["scenario_title"],
        )

        if not OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY not set")

        if not _OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY is empty after stripping")

        logger.info(f"[Realtime] 🔑 API Key: {_OPENAI_API_KEY[:15]}...{_OPENAI_API_KEY[-5:]}")
        logger.info(f"[Realtime] 🌐 URL: {OPENAI_REALTIME_URL}")

        headers = {
            "Authorization": f"Bearer {_OPENAI_API_KEY}",
        }



        # ✅ FIX: Use additional_headers parameter with websockets library

        async with connect(OPENAI_REALTIME_URL, additional_headers=headers) as openai_ws:
            logger.info("[Realtime] ✅ Connected to OpenAI Realtime API")

            # ✅ FIX 8: Map voice gender to OpenAI voice options
            voice_map = {
                "female": "alloy",  # Female: alloy, shimmer, nova
                "male": "echo",     # Male: echo, onyx, fable
            }
            voice = voice_map.get(scenario_context.get("voice_gender", "female"), "alloy")
            logger.info(f"[Realtime] 🎙️ Voice gender: {scenario_context.get('voice_gender')}, selected voice: {voice}")

            # ✅ FIX 3: Added turn_detection (VAD) to session.update
            # ✅ FIX 4: Improved voice clarity - use selected voice
            # ✅ FIX 5: Temperature must be >= 0.6, use 0.6 for consistent speech
            # ✅ FIX 6: Added input_audio_transcription with Whisper-1 for user speech transcription
            await openai_ws.send(json.dumps({
                "type": "session.update",
                "session": {
                    "type": "realtime",
                    "model": OPENAI_REALTIME_MODEL,
                    "instructions": build_system_prompt(scenario_context),

                    "output_modalities": ["audio"],
                    "audio": {
                        "input": {
                            "format": {
                                "type": "audio/pcm",
                                "rate": 24000,
                            },
                            "turn_detection": {
                                "type": "server_vad",
                                "threshold": 0.6,  # Higher threshold to avoid interruptions
                                "silence_duration_ms": 800,  # Longer silence required before turn ends (slower speech)
                                "prefix_padding_ms": 500,  # More prefix padding for clarity
                            },
                            "transcription": {
                                "model": "whisper-1",
                            },
                        },
                        "output": {
                            "format": {
                                "type": "audio/pcm",
                                "rate": 24000,
                            },
                            "voice": voice,  # Dynamic voice selection based on gender
                        },

                    }
                }
            }))
            logger.info(f"[Realtime] ✅ Session configured — voice: {voice}")

            # ✅ FIX 2: Correct way to trigger opening greeting
            if scenario_context.get("initial_prompt"):
                await openai_ws.send(json.dumps({
                    "type": "response.create",
                    "response": {
                        "output_modalities": ["audio"],
                        "instructions": (
                            f"Start the roleplay now. Speak only as {scenario_context['scenario_role']}. "
                            f"The human learner is {scenario_context['user_role']}; do not speak as them. "
                            f"Say a short opening line from the perspective of {scenario_context['scenario_role']} "
                            f"using this situation: {scenario_context['initial_prompt']}"
                        ),
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
                            logger.info(f"[Realtime] 📞 Session end requested - transcript contains {len(conversation_transcript)} messages")

                            # Log the transcript structure for verification
                            user_msgs = [m for m in conversation_transcript if m.get("role") == "user"]
                            bot_msgs = [m for m in conversation_transcript if m.get("role") == "bot"]
                            logger.info(f"[Realtime] 📊 Transcript breakdown: {len(user_msgs)} user messages, {len(bot_msgs)} bot messages")

                            # Send complete transcript back to frontend
                            await websocket.send_json({
                                "type": "session_ended",
                                "transcript": conversation_transcript,
                                "session_id": scenario_context["session_id"]
                            })

                            logger.info(f"[Realtime] ✅ session_ended payload sent to frontend with {len(conversation_transcript)} messages")
                            break

                except Exception as e:
                    logger.error(f"[Realtime] ❌ Forward error: {e}")

            async def receive_openai_to_client():
                try:
                    while True:
                        response = json.loads(await openai_ws.recv())
                        response_type = response.get("type")

                        if response_type in ("response.output_audio.delta", "response.audio.delta"):
                            await websocket.send_json({
                                "type": "audio",
                                "audio": response.get("delta")
                            })

                        elif response_type in ("response.output_audio_transcript.delta", "response.audio_transcript.delta"):
                            # ✅ Correct event for bot speech transcript
                            await websocket.send_json({
                                "type": "transcript_chunk",
                                "text": response.get("delta", ""),
                                "role": "bot"
                            })

                        elif response_type in ("response.output_audio_transcript.done", "response.audio_transcript.done"):
                            text = response.get("transcript", "")
                            if text:
                                conversation_transcript.append({"role": "bot", "text": text})
                                logger.info(f"[Realtime] 💬 Bot: {text[:60]}...")
                                logger.info(f"[Realtime] 📝 Transcript count: {len(conversation_transcript)} messages")

                        elif response_type == "conversation.item.input_audio_transcription.completed":
                            # ✅ Correct event for user speech transcript
                            text = response.get("transcript", "")
                            if text:
                                conversation_transcript.append({"role": "user", "text": text})
                                logger.info(f"[Realtime] 👤 User: {text[:60]}...")
                                logger.info(f"[Realtime] 📝 Transcript count: {len(conversation_transcript)} messages")
                                await websocket.send_json({
                                    "type": "user_transcription",
                                    "text": text
                                })

                        elif response_type == "input_audio_buffer.speech_started":
                            logger.info("[Realtime] 🎙️ User started speaking")
                            await websocket.send_json({"type": "speech_started"})

                        elif response_type == "response.done":
                            logger.info("[Realtime] ✅ Response complete")

                        elif response_type == "error":
                            error_detail = response.get("error", {})
                            error_code = error_detail.get("code")
                            error_message = error_detail.get("message")
                            error_type = error_detail.get("type")
                            
                            logger.error(f"[Realtime] ❌ OpenAI API Error")
                            logger.error(f"   Type: {error_type}")
                            logger.error(f"   Code: {error_code}")
                            logger.error(f"   Message: {error_message}")
                            
                            if error_code == "invalid_api_key":
                                logger.error(f"[Realtime] 🔑 API Key Issue!")
                                logger.error(f"   - Check that your OpenAI API key is active")
                                logger.error(f"   - Verify the key has Realtime API access")
                                logger.error(f"   - Visit: https://platform.openai.com/account/api-keys")
                            
                            await websocket.send_json({
                                "type": "error",
                                "message": f"{error_code}: {error_message}" if error_code else error_message or "Unknown OpenAI error"
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
        logger.error(f"[Realtime] ❌ WebSocket error: {str(e)}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass

    finally:
        sid = scenario_context.get("session_id") if scenario_context else "unknown"
