import json
import logging
import asyncio
from fastapi import APIRouter, WebSocket
from websockets.asyncio.client import connect
from utils.supabase_client import supabase_admin
from fastapi import WebSocket, status
from utils.auth import _verify_firebase_token, resolve_user_context_from_claims
from utils.db import roleplay_db

from config import OPENAI_API_KEY, OPENAI_REALTIME_MODEL

router = APIRouter()

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

_OPENAI_API_KEY = OPENAI_API_KEY

if not _OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY not loaded")

if not _OPENAI_API_KEY.startswith("sk-"):
    raise ValueError(f"OPENAI_API_KEY has invalid prefix: {_OPENAI_API_KEY[:10]}")

# logger.warning("[Realtime] Key loaded: yes")
# logger.warning(f"[Realtime] Key prefix: {_OPENAI_API_KEY[:8]}")
# logger.warning(f"[Realtime] Key length: {len(_OPENAI_API_KEY)}")
# logger.warning(f"[Realtime] Model: {OPENAI_REALTIME_MODEL}")

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

    return f"""You are an AI actor in a role-play simulation.

YOUR ROLE: You are playing the {scenario_role}.
THE USER'S ROLE: The human is playing the {user_role}.
SCENARIO: "{scenario_context.get('scenario_title')}"

CRITICAL INSTRUCTIONS:
- You must ONLY speak and act as the {scenario_role}.
- NEVER play the user's role.
- Wait for the user to respond before speaking again.
- Keep your responses short, conversational, and natural (1-2 sentences).
- Do not provide coaching, evaluation, or advice. Just stay in character.
- Raise realistic objections or concerns based on the scenario.

CHARACTER TONE: {tone_instruction}
AI character personality/context: {ai_personality}
AI character objective: {ai_objectives}"""


@router.websocket("/roleplay/realtime")
async def websocket_realtime_roleplay(websocket: WebSocket):
    # Security: Grab the token from the URL query
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008)
        return
        
    # Security: Verify the token is real
    try:
        claims = _verify_firebase_token(token)
        resolve_user_context_from_claims(claims) 
    except Exception as e:
        await websocket.close(code=1008)
        return

    # If the token is valid, accept the connection!
    await websocket.accept()

    conversation_transcript = []
    items_dict = {}
    item_ids_order = []
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

        logger.info("[Realtime] 🔑 API Key: loaded and verified")
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
            # ✅ FIX 6: Added input_audio_transcription with Whisper-1 for user speech transcription
            # ✅ FIX 7: Updated to OpenAI Realtime API GA schema (nested audio object, no temperature)
            await openai_ws.send(json.dumps({
                "type": "session.update",
                "session": {
                    "type": "realtime",
                    "instructions": build_system_prompt(scenario_context),
                    "audio": {
                        "output": {
                            "voice": voice
                        },
                        "input": {
                            "transcription": {
                                "model": "whisper-1"
                            },
                            "turn_detection": {
                                "type": "server_vad",
                                "threshold": 0.7,
                                "prefix_padding_ms": 300,
                                "silence_duration_ms": 600
                            }
                        }
                    }
                }
            }))
            logger.info(f"[Realtime] ✅ Session configured — voice: {voice}")

            # Trigger the opening greeting without overriding the session system prompt
            if scenario_context.get("initial_prompt"):
                # 1. Add a system message telling it to start WITH THE FULL PROMPT
                full_prompt = build_system_prompt(scenario_context)
                await openai_ws.send(json.dumps({
                    "type": "conversation.item.create",
                    "item": {
                        "type": "message",
                        "role": "system",
                        "content": [
                            {
                                "type": "input_text",
                                "text": f"{full_prompt}\n\nPlease begin the roleplay now. Say your opening line based on this context: {scenario_context['initial_prompt']}"
                            }
                        ]
                    }
                }))
                
                # 2. Tell it to generate a response
                await openai_ws.send(json.dumps({
                    "type": "response.create"
                }))
                logger.info("[Realtime] 🎤 Requested opening greeting")

            # --- Bidirectional tasks ---

            async def forward_client_to_openai():
                nonlocal conversation_transcript
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
                            final_transcript = []
                            for iid in item_ids_order:
                               if iid in items_dict:
                                   msg_text = items_dict[iid]["text"].strip()
                                   if msg_text:
                                       final_transcript.append({
                                           "role": items_dict[iid]["role"],
                                           "text": msg_text
                                        })
                            if not final_transcript and conversation_transcript:
                               final_transcript = conversation_transcript
                            conversation_transcript = final_transcript

                            logger.info(
                                f"[Realtime] 📞 Session end requested - transcript contains {len(conversation_transcript)} messages"
                            )

                            # -----------------------------
                            # Persist transcript
                            # -----------------------------
                            if scenario_context and scenario_context.get("session_id"):
                                session_id = scenario_context["session_id"]

                                try:
                                    logger.info(
                                        f"[Realtime] 💾 Saving transcript for session {session_id}"
                                    )

                                    update_data = {
                                        "conversation_transcript": final_transcript,
                                        "message_count": len(final_transcript),
                                        "completed_at": datetime.utcnow().isoformat()
                                    }

                                    # Calculate duration exactly like frontend did
                                    if len(final_transcript) >= 2:
                                        try:
                                            start_time = datetime.fromisoformat(
                                                final_transcript[0]["timestamp"].replace("Z", "+00:00")
                                            )
                                            end_time = datetime.fromisoformat(
                                                final_transcript[-1]["timestamp"].replace("Z", "+00:00")
                                            )

                                            update_data["duration_seconds"] = int(
                                                (end_time - start_time).total_seconds()
                                            )
                                        except Exception as e:
                                            logger.warning(
                                                f"[Realtime] Could not calculate duration: {e}"
                                            )

                                    supabase_admin.table("roleplay_sessions").update(update_data)\
                                        .eq("id", session_id)\
                                        .execute()

                                    logger.info("[Realtime] ✅ Transcript saved")

                                except Exception as e:
                                    logger.error(f"[Realtime] ❌ Failed to save transcript: {e}")

                            await websocket.send_json({
                                "type": "session_ended",
                                "transcript": final_transcript
                            })

                            break

                except Exception as e:
                    logger.error(f"[Realtime] ❌ Forward error: {e}")

            async def receive_openai_to_client():
                nonlocal conversation_transcript
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

                        elif response_type == "conversation.item.created":
                            item = response.get("item", {})
                            item_id = item.get("id")
                            role = item.get("role")
                            if item_id and role in ("user", "assistant"):
                               mapped_role = "user" if role == "user" else "bot"
                               items_dict[item_id] = {"role": mapped_role, "text": ""}
                               item_ids_order.append(item_id)

                        elif response_type in ("response.output_audio_transcript.done", "response.audio_transcript.done"):
                           text = response.get("transcript", "")
                           item_id = response.get("item_id")
                           if item_id and item_id in items_dict:
                               items_dict[item_id]["text"] = text
                           elif text:
                               conversation_transcript.append({"role": "bot", "text": text})
                           logger.info(f"[Realtime] 💬 Bot: {text[:60]}...")
                           await websocket.send_json({
                               "type": "bot_transcription",
                               "text": text
                           })

                        elif response_type == "conversation.item.input_audio_transcription.completed":
                           text = response.get("transcript", "")
                           item_id = response.get("item_id")
                           if item_id and item_id in items_dict:
                               items_dict[item_id]["text"] = text
                           elif text:
                               conversation_transcript.append({"role": "user", "text": text})
                           logger.info(f"[Realtime] 👤 User: {text[:60]}...")
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
        
        # Build the final transcript robustly if it wasn't requested via end_session
        final_transcript = []
        for iid in item_ids_order:
            if iid in items_dict:
                msg_text = items_dict[iid]["text"].strip()
                if msg_text:
                    final_transcript.append({
                        "role": items_dict[iid]["role"],
                        "text": msg_text
                    })
        if not final_transcript and conversation_transcript:
            final_transcript = conversation_transcript
            
        logger.info(f"[Realtime] 🔌 Disconnected, session {sid}. Final backend transcript has {len(final_transcript)} messages.")
        if len(final_transcript) > 0:
            logger.info(f"[Realtime] Last message: {final_transcript[-1]['text'][:100]}")
                    # --- START PHASE 2 ENTERPRISE STATE MANAGEMENT ---
        if sid != "unknown":
                try:
                    logger.info(f"[Realtime] 💾 Auto-saving {len(final_transcript)} messages to DB for session {sid}...")
                    supabase_admin.table('roleplay_sessions').update({
                        "conversation_transcript": final_transcript,
                        "message_count": len(final_transcript)
                    }).eq('id', sid).execute()
                    logger.info("[Realtime] ✅ Transcript safely stored on disconnect.")
                except Exception as e:
                    logger.error(f"[Realtime] ❌ Failed to auto-save transcript: {str(e)}")
            # --- END PHASE 2 ENTERPRISE STATE MANAGEMENT ---
