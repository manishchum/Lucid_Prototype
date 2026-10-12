import asyncio
import base64
import json
import logging
import math
import re
import struct
import numpy as np
from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import WebSocket
from websockets.asyncio.client import connect

from config import GEMINI_API_KEY
from utils.db import roleplay_db
from utils.supabase_client import supabase_admin
from ai.cost_calculator import CostCalculator
from ai.types import UsageLog
from ai.usage_tracker import UsageTracker

logger = logging.getLogger(__name__)


def resample_24k_to_16k(pcm_bytes: bytes) -> bytes:
    """
    Resample 24kHz PCM16 audio (sent by browser) to 16kHz PCM16 required by Gemini Live API.
    3:2 ratio conversion using fast linear interpolation (takes < 1ms).
    """
    num_samples = len(pcm_bytes) // 2
    if num_samples == 0:
        return b""
    in_samples = np.frombuffer(pcm_bytes, dtype=np.int16)
    out_len = int(num_samples * 16000 / 24000)
    x_in = np.arange(num_samples)
    x_out = np.linspace(0, num_samples - 1, out_len)
    out_samples = np.interp(x_out, x_in, in_samples).astype(np.int16)
    return out_samples.tobytes()


def log_event(emoji: str, message: str):
    """
    Ensures log is visible both in Python logger and directly flushed to stdout.
    """
    formatted = f"[Gemini Live] {emoji} {message}"
    logger.info(formatted)
    print(formatted, flush=True)


GEMINI_LIVE_BASE_URL = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent"
)

INDIAN_ACCENT_INSTRUCTION = """
CRITICAL VOICE & ACCENT REQUIREMENT:
- You MUST speak with an authentic, natural, and fluent Indian English accent, intonation, and rhythm throughout the entire conversation.
- Use natural Indian English phrasing where appropriate while maintaining high professionalism.
- Phonetics & Intonation: Syllable-timed cadence, clear retroflex consonants (t, d), and flat/rising intonation typical of Indian English.
- Under NO circumstances switch or revert to an American, British, or generic Western accent at any point in the conversation, even after multiple turns.
- Always respond actively, conversationally, and promptly in your assigned role (1-2 sentences).
"""

# Voice activity detection parameters for 24kHz PCM16
VAD_RMS_THRESHOLD = 500        # Sensitive enough for normal speech (>500), but above ambient fan noise (<300)
VAD_SILENCE_DURATION = 0.75    # Seconds of silence after speech before concluding turn
MIN_SPEECH_DURATION = 0.25     # Minimum speech duration (seconds) required to treat as genuine speech
ECHO_COOLDOWN_DURATION = 0.40  # Seconds to ignore mic input after bot finishes speaking
BUFFER_FLUSH_SIZE = 4800       # Aggregate tiny browser packets into 100ms chunks (2400 samples * 2 bytes)


def resolve_gemini_live_model(model_name: Optional[str]) -> str:
    """
    Ensure the model has the 'models/' prefix required by the Gemini Live API.
    Sanitizes any typos like 'modells/'.
    """
    if not model_name:
        return "models/gemini-3.8-live"
    name = model_name.strip()
    name = re.sub(r"^models?l*s?/", "", name)
    return f"models/{name}"


def get_gemini_voice(voice_gender: Optional[str]) -> str:
    """
    Map gender preference to Gemini Multimodal Live prebuilt voices.
    Prebuilt voices include: Aoede, Charon, Fenrir, Kore, Puck.
    Kore maintains Indian English prosody and pitch much more reliably than Aoede.
    """
    gender = (voice_gender or "female").lower()
    if gender == "male":
        return "Puck"
    return "Kore"


async def run_gemini_live_loop(
    websocket: WebSocket,
    scenario_context: dict,
    auth_context: Any,
    realtime_model_config: Any,
    build_system_prompt_fn: Any,
):
    """
    Executes the Gemini Live Multimodal API loop (Speech-to-Speech via WebSockets).
    Implements 100ms chunk aggregation, noise-filtering VAD, and eliminates speaker feedback loops.
    """
    session_id = scenario_context.get("session_id", "unknown")
    api_key = GEMINI_API_KEY

    if not api_key:
        log_event("❌", "GEMINI_API_KEY not configured in environment")
        await websocket.send_json({
            "type": "error",
            "message": "GEMINI_API_KEY not configured on backend."
        })
        await websocket.close(code=1008)
        return

    model_code = resolve_gemini_live_model(getattr(realtime_model_config, "model", None))
    voice = get_gemini_voice(scenario_context.get("voice_gender"))
    gemini_ws_url = f"{GEMINI_LIVE_BASE_URL}?key={api_key}"

    # Build prompt and sandwich with Indian accent instructions so context attenuation over long calls does not drift accent
    base_prompt = build_system_prompt_fn(scenario_context)
    full_system_prompt = f"{INDIAN_ACCENT_INSTRUCTION}\n\n{base_prompt}\n\n{INDIAN_ACCENT_INSTRUCTION}"

    log_event("🎙️", f"Starting session {session_id} | Model={model_code} | Voice={voice} | Accent=Indian English")

    conversation_transcript: List[Dict[str, str]] = []
    current_turn_bot_text: List[str] = []
    current_turn_user_text: List[str] = []
    realtime_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    realtime_started_at = asyncio.get_running_loop().time()

    # VAD & Stream State tracking
    user_is_speaking = False
    ai_is_generating = False
    bot_is_speaking = False
    bot_finished_at = 0.0
    last_speech_time = 0.0
    speech_start_time = 0.0
    consecutive_speech_chunks = 0
    accumulated_speech_chunks = 0
    audio_packet_count = 0
    outgoing_audio_buffer = bytearray()

    # Thread-safe lock for Gemini WebSocket sends
    gemini_send_lock = asyncio.Lock()

    async def safe_send_gemini(payload: dict, label: str = ""):
        async with gemini_send_lock:
            await gemini_ws.send(json.dumps(payload))
            if label:
                log_event("📤", f"Sent [{label}] to Gemini")

    try:
        async with connect(gemini_ws_url) as gemini_ws:
            log_event("✅", "Connected to Gemini Live WebSocket")

            # 1. Send Setup Handshake with full audio modalities and transcription
            setup_payload = {
                "setup": {
                    "model": model_code,
                    "generationConfig": {
                        "responseModalities": ["AUDIO"],
                        "speechConfig": {
                            "voiceConfig": {
                                "prebuiltVoiceConfig": {
                                    "voiceName": voice
                                }
                            }
                        }
                    },
                    "systemInstruction": {
                        "parts": [
                            {"text": full_system_prompt}
                        ]
                    },
                    "inputAudioTranscription": {},
                    "outputAudioTranscription": {}
                }
            }
            await safe_send_gemini(setup_payload, label="setup")
            log_event("🚀", f"Setup message sent (voice: {voice})")

            # Wait for setup acknowledgement
            raw_setup_resp = await gemini_ws.recv()
            log_event("⚙️", f"Setup confirmed by Gemini: {raw_setup_resp.decode() if isinstance(raw_setup_resp, bytes) else raw_setup_resp}")

            # 2. Trigger Opening Line if present
            initial_prompt_val = scenario_context.get("initial_prompt")
            if initial_prompt_val and str(initial_prompt_val).strip():
                bot_is_speaking = True
                ai_is_generating = True
                opening_line = str(initial_prompt_val).strip()
                log_event("🗣️", f"AI TRIGGERED OPENING GREETING: \"{opening_line}\"")
                opening_turn = {
                    "clientContent": {
                        "turns": [
                            {
                                "role": "user",
                                "parts": [
                                    {
                                        "text": (
                                            f"The roleplay has started. Say your opening line now to the user:\n"
                                            f"\"{opening_line}\""
                                        )
                                    }
                                ]
                            }
                        ],
                        "turnComplete": True
                    }
                }
                await safe_send_gemini(opening_turn, label="opening_turn")
            else:
                log_event("👂", "AI ready. Listening for user to start speaking...")

            # 3. VAD Silence Monitor: Detects genuine end of user speech and triggers Gemini turnComplete
                      # 3. VAD Silence Monitor & Watchdog
            turn_requested_at = 0.0

            async def vad_silence_monitor():
                nonlocal user_is_speaking, last_speech_time, speech_start_time
                nonlocal consecutive_speech_chunks, accumulated_speech_chunks, ai_is_generating
                nonlocal outgoing_audio_buffer, turn_requested_at, bot_is_speaking
                try:
                    while True:
                        await asyncio.sleep(0.05)
                        now = asyncio.get_running_loop().time()

                        # Watchdog: if Gemini takes >12s to respond, unlock UI and resume listening
                        if ai_is_generating and turn_requested_at > 0 and (now - turn_requested_at > 12.0) and not bot_is_speaking:
                            log_event("⚠️", "Gemini response generation timed out after 12s. Resetting state and unlocking UI...")
                            ai_is_generating = False
                            user_is_speaking = False
                            turn_requested_at = 0.0
                            await websocket.send_json({"type": "response.done"})
                            continue

                        # Client-side VAD detection: track when user speaks and stops speaking
                        if user_is_speaking and last_speech_time > 0 and not ai_is_generating:
                            elapsed_silence = now - last_speech_time
                            if elapsed_silence >= VAD_SILENCE_DURATION:
                                total_speech_sec = max(0.1, (last_speech_time - speech_start_time)) if speech_start_time > 0 else (accumulated_speech_chunks * 0.0053)

                                if total_speech_sec >= MIN_SPEECH_DURATION:
                                    log_event(
                                        "⏹️",
                                        f"USER FINISHED SPEAKING ({total_speech_sec:.2f}s speech, {elapsed_silence:.2f}s silence). Natural pause detected."
                                    )

                                    # Flush any residual audio buffer to Gemini as 16kHz
                                    if len(outgoing_audio_buffer) >= 2:
                                        even_len = len(outgoing_audio_buffer) - (len(outgoing_audio_buffer) % 2)
                                        chunk_24k = bytes(outgoing_audio_buffer[:even_len])
                                        outgoing_audio_buffer.clear()
                                        chunk_16k = resample_24k_to_16k(chunk_24k)
                                        b64 = base64.b64encode(chunk_16k).decode("utf-8")
                                        gemini_audio_msg = {
                                            "realtimeInput": {
                                                "audio": {
                                                    "mimeType": "audio/pcm;rate=16000",
                                                    "data": b64
                                                }
                                            }
                                        }
                                        await safe_send_gemini(gemini_audio_msg)
                                    else:
                                        outgoing_audio_buffer.clear()
                                else:
                                    log_event(
                                        "⚠️",
                                        f"Discarded short sound ({total_speech_sec:.2f}s < {MIN_SPEECH_DURATION}s minimum)."
                                    )

                                # Reset VAD tracking; allow Gemini's native VAD to complete the turn
                                user_is_speaking = False
                                last_speech_time = 0.0
                                speech_start_time = 0.0
                                consecutive_speech_chunks = 0
                                accumulated_speech_chunks = 0
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    log_event("❌", f"VAD monitor error: {e}")

            # 4. Forward Client Audio to Gemini (with 100ms buffering & 24kHz->16kHz resampling)
            async def forward_client_to_gemini():
                nonlocal conversation_transcript, user_is_speaking, last_speech_time
                nonlocal speech_start_time, consecutive_speech_chunks, accumulated_speech_chunks
                nonlocal audio_packet_count, ai_is_generating, bot_is_speaking
                nonlocal outgoing_audio_buffer

                try:
                    while True:
                        raw_msg = await websocket.receive_text()
                        msg = json.loads(raw_msg)
                        msg_type = msg.get("type")

                        if msg_type == "audio":
                            audio_b64 = msg.get("audio")
                            if not audio_b64:
                                continue

                            audio_packet_count += 1
                            now = asyncio.get_running_loop().time()

                            # Decode raw PCM16 bytes
                            try:
                                pcm_bytes = base64.b64decode(audio_b64)
                                num_samples = len(pcm_bytes) // 2
                                if num_samples > 0:
                                    samples = struct.unpack(f"<{num_samples}h", pcm_bytes)
                                    rms = math.sqrt(sum(s * s for s in samples) / num_samples)
                                else:
                                    rms = 0.0
                            except Exception:
                                rms = 0.0

                            # Prevent speaker-to-mic feedback loop while bot is actively speaking:
                            # Only forward if user is speaking loudly to interrupt (barge-in)
                            if bot_is_speaking and rms < (VAD_RMS_THRESHOLD * 2):
                                continue

                            # Echo cooldown immediately after bot stops speaking
                            if (now - bot_finished_at < ECHO_COOLDOWN_DURATION) and rms < (VAD_RMS_THRESHOLD * 1.5):
                                continue

                            # Periodic debug log
                            if audio_packet_count % 50 == 0:
                                log_event(
                                    "📥",
                                    f"Mic streaming: chunk #{audio_packet_count} | RMS={rms:.0f} | speaking={user_is_speaking}"
                                )

                            # Append PCM bytes to the outgoing 100ms buffer
                            outgoing_audio_buffer.extend(pcm_bytes)

                            # When buffer reaches 100ms (4800 bytes / 2400 samples at 24kHz), resample to 16kHz and flush to Gemini
                            if len(outgoing_audio_buffer) >= BUFFER_FLUSH_SIZE:
                                chunk_to_send_24k = bytes(outgoing_audio_buffer[:BUFFER_FLUSH_SIZE])
                                outgoing_audio_buffer = outgoing_audio_buffer[BUFFER_FLUSH_SIZE:]

                                chunk_16k = resample_24k_to_16k(chunk_to_send_24k)
                                b64 = base64.b64encode(chunk_16k).decode("utf-8")
                                gemini_audio_msg = {
                                    "realtimeInput": {
                                        "audio": {
                                            "mimeType": "audio/pcm;rate=16000",
                                            "data": b64
                                        }
                                    }
                                }
                                await safe_send_gemini(gemini_audio_msg)

                            # Client VAD speech detection
                            if rms > VAD_RMS_THRESHOLD:
                                consecutive_speech_chunks += 1
                                accumulated_speech_chunks += 1
                                last_speech_time = now

                                if consecutive_speech_chunks >= 2 and not user_is_speaking:
                                    user_is_speaking = True
                                    speech_start_time = now
                                    log_event("🎙️", f"USER STARTED SPEAKING (RMS={rms:.0f}) -> Switching UI to Listening...")
                                    await websocket.send_json({"type": "speech_started"})
                            else:
                                consecutive_speech_chunks = 0

                        elif msg_type == "end_session":
                            log_event("📞", f"Session end requested - transcript has {len(conversation_transcript)} messages")

                            if session_id and session_id != "unknown":
                                try:
                                    update_data = {
                                        "conversation_transcript": conversation_transcript,
                                        "message_count": len(conversation_transcript),
                                        "completed_at": datetime.utcnow().isoformat()
                                    }
                                    if len(conversation_transcript) >= 2:
                                        try:
                                            start_time = datetime.fromisoformat(
                                                conversation_transcript[0]["timestamp"].replace("Z", "+00:00")
                                            )
                                            end_time = datetime.fromisoformat(
                                                conversation_transcript[-1]["timestamp"].replace("Z", "+00:00")
                                            )
                                            update_data["duration_seconds"] = int(
                                                (end_time - start_time).total_seconds()
                                            )
                                        except Exception:
                                            pass

                                    supabase_admin.table("roleplay_sessions").update(update_data).eq("id", session_id).execute()
                                    log_event("💾", f"Session transcript updated in DB on end_session ({len(conversation_transcript)} messages)")
                                except Exception as e:
                                    log_event("❌", f"Failed to save transcript on end_session: {e}")

                            await websocket.send_json({
                                "type": "session_ended",
                                "transcript": conversation_transcript
                            })
                            break

                except Exception as e:
                    log_event("❌", f"Client forward error: {e}")

            # 5. Receive Gemini Responses and Stream to Client
            async def receive_gemini_to_client():
                nonlocal conversation_transcript, current_turn_bot_text, current_turn_user_text
                nonlocal realtime_usage, bot_is_speaking, bot_finished_at, ai_is_generating
                nonlocal turn_requested_at
                first_audio_chunk_logged = False

                try:
                    while True:
                        raw_resp = await gemini_ws.recv()
                        if isinstance(raw_resp, bytes):
                            raw_resp = raw_resp.decode("utf-8")
                        response = json.loads(raw_resp)

                        # 1. Check for top-level errors or goAway from Gemini
                        if "error" in response:
                            err = response["error"]
                            log_event("❌", f"Gemini Live returned ERROR: {err}")
                            await websocket.send_json({"type": "error", "message": f"Gemini error: {err.get('message', str(err))}"})
                            ai_is_generating = False
                            bot_is_speaking = False
                            turn_requested_at = 0.0
                            await websocket.send_json({"type": "response.done"})
                            continue

                        # 2. Handle voiceActivity signals from Gemini Live
                        voice_activity = response.get("voiceActivity")
                        if voice_activity:
                            va_type = voice_activity.get("type")
                            if va_type == "ACTIVITY_START":
                                log_event("🎙️", "Gemini detected user started speaking (ACTIVITY_START)")
                                user_is_speaking = True
                                await websocket.send_json({"type": "speech_started"})
                            elif va_type == "ACTIVITY_END":
                                log_event("⏹️", "Gemini detected user finished speaking (ACTIVITY_END)")
                                user_is_speaking = False
                                ai_is_generating = True
                                turn_requested_at = asyncio.get_running_loop().time()

                        # 3. Handle serverContent
                        server_content = response.get("serverContent")
                        if server_content:
                            # User interruption / barge-in acknowledged by Gemini
                            if server_content.get("interrupted"):
                                log_event("⚡", "Gemini confirmed model interrupted by user speech")
                                bot_is_speaking = False
                                ai_is_generating = False
                                turn_requested_at = 0.0
                                await websocket.send_json({"type": "speech_started"})
                                current_turn_bot_text.clear()

                            # User speech transcription (from Gemini inputTranscription)
                            input_transcription = server_content.get("inputTranscription") or server_content.get("inputAudioTranscription")
                            if input_transcription and "text" in input_transcription:
                                u_text = input_transcription["text"]
                                current_turn_user_text.append(u_text)
                                log_event("👤", f"USER Speech Recognized: \"{u_text}\"")
                                await websocket.send_json({
                                    "type": "user_transcription",
                                    "text": "".join(current_turn_user_text)
                                })

                            # Model speech transcription chunk
                            output_transcription = server_content.get("outputTranscription")
                            if output_transcription and "text" in output_transcription:
                                text_chunk = output_transcription["text"]
                                clean_chunk = re.sub(r"<no\s*speech.*?>|\{pause\}|<pause>", "", text_chunk, flags=re.IGNORECASE)
                                if clean_chunk:
                                    current_turn_bot_text.append(clean_chunk)
                                    log_event("💬", f"AI speech transcript: \"{clean_chunk}\"")
                                    await websocket.send_json({
                                        "type": "transcript_chunk",
                                        "text": clean_chunk,
                                        "role": "bot"
                                    })

                            # Model Turn (Audio chunks and inline text)
                            model_turn = server_content.get("modelTurn")
                            if model_turn:
                                if not bot_is_speaking:
                                    bot_is_speaking = True
                                    ai_is_generating = False
                                    turn_requested_at = 0.0
                                    first_audio_chunk_logged = False
                                    log_event("🗣️", "AI STARTED SPEAKING (Audio streaming to client)...")

                                for part in model_turn.get("parts", []):
                                    inline_data = part.get("inlineData")
                                    if inline_data and inline_data.get("data"):
                                        if not first_audio_chunk_logged:
                                            first_audio_chunk_logged = True
                                            log_event("🔊", "AI output audio packets streaming...")
                                        await websocket.send_json({
                                            "type": "audio",
                                            "audio": inline_data["data"]
                                        })

                                    if "text" in part and not output_transcription:
                                        t_chunk = part["text"]
                                        clean_t = re.sub(r"<no\s*speech>|\{pause\}|<pause>", "", t_chunk, flags=re.IGNORECASE)
                                        if clean_t:
                                            current_turn_bot_text.append(clean_t)
                                            await websocket.send_json({
                                                "type": "transcript_chunk",
                                                "text": clean_t,
                                                "role": "bot"
                                            })

                            # Turn Complete
                            if server_content.get("turnComplete"):
                                bot_is_speaking = False
                                ai_is_generating = False
                                turn_requested_at = 0.0
                                bot_finished_at = asyncio.get_running_loop().time()

                                raw_bot_text = "".join(current_turn_bot_text).strip()
                                final_bot_text = re.sub(r"<no\s*speech>|\{pause\}|<pause>", "", raw_bot_text, flags=re.IGNORECASE).strip()
                                if final_bot_text:
                                    log_event("💬", f"AI TURN FINISHED: \"{final_bot_text}\"")
                                    conversation_transcript.append({
                                        "role": "avatar",
                                        "text": final_bot_text,
                                        "timestamp": datetime.utcnow().isoformat()
                                    })
                                    await websocket.send_json({
                                        "type": "bot_transcription",
                                        "text": final_bot_text
                                    })
                                current_turn_bot_text.clear()

                                final_user_text = "".join(current_turn_user_text).strip()
                                if final_user_text:
                                    conversation_transcript.append({
                                        "role": "user",
                                        "text": final_user_text,
                                        "timestamp": datetime.utcnow().isoformat()
                                    })
                                current_turn_user_text.clear()

                                # Tell the frontend that the bot has finished speaking its response
                                await websocket.send_json({"type": "response.done"})
                                log_event("👂", "AI STOPPED SPEAKING (response.done sent). RESUMING audio stream & listening for user...")

                        # Handle token usage
                        usage_metadata = response.get("usageMetadata")
                        if usage_metadata:
                            realtime_usage["input_tokens"] += int(usage_metadata.get("promptTokenCount", 0))
                            realtime_usage["output_tokens"] += int(usage_metadata.get("candidatesTokenCount", 0))
                            realtime_usage["total_tokens"] += int(usage_metadata.get("totalTokenCount", 0))

                except Exception as e:
                    log_event("❌", f"Gemini receive error: {e}")

            forward_task = asyncio.create_task(forward_client_to_gemini())
            receive_task = asyncio.create_task(receive_gemini_to_client())
            vad_task = asyncio.create_task(vad_silence_monitor())

            done, pending = await asyncio.wait(
                [forward_task, receive_task, vad_task],
                return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    except Exception as e:
        log_event("❌", f"Gemini Live WebSocket error: {str(e)}")
        try:
            await websocket.send_json({"type": "error", "message": f"Gemini Live error: {str(e)}"})
        except Exception:
            pass

    finally:
        log_event("🔌", f"Disconnected, session {session_id}. Final transcript has {len(conversation_transcript)} messages.")

        # Auto-save transcript to database
        if session_id and session_id != "unknown" and conversation_transcript:
            try:
                log_event("💾", f"Auto-saving {len(conversation_transcript)} messages to DB via supabase_admin...")
                supabase_admin.table("roleplay_sessions").update({
                    "conversation_transcript": conversation_transcript,
                    "message_count": len(conversation_transcript)
                }).eq("id", session_id).execute()
                log_event("✅", "Transcript safely saved to DB.")
            except Exception as e:
                log_event("❌", f"Failed to auto-save transcript: {e}")

        # Log AI Usage
        if realtime_model_config:
            try:
                duration_sec = asyncio.get_running_loop().time() - realtime_started_at
                in_tokens = realtime_usage["input_tokens"]
                out_tokens = realtime_usage["output_tokens"]
                tot_tokens = realtime_usage["total_tokens"]

                cost_usd, cost_inr = CostCalculator.calculate(
                    input_tokens=in_tokens,
                    output_tokens=out_tokens,
                    input_cost_per_million=getattr(realtime_model_config, "input_cost_per_million", 0.0),
                    output_cost_per_million=getattr(realtime_model_config, "output_cost_per_million", 0.0),
                )

                UsageTracker.log(
                    UsageLog(
                        company_id=str(getattr(auth_context, "company_id", "unknown")),
                        user_id=str(getattr(auth_context, "user_id", "unknown")),
                        feature_id=getattr(realtime_model_config, "feature_id", "unknown"),
                        provider=getattr(realtime_model_config, "provider", "gemini"),
                        model=getattr(realtime_model_config, "model", "gemini-3.8-live"),
                        route="/roleplay/realtime",
                        prompt_version=0,
                        input_tokens=in_tokens,
                        output_tokens=out_tokens,
                        total_tokens=tot_tokens,
                        cost_usd=cost_usd,
                        cost_inr=cost_inr,
                        latency_ms=0,
                        status="success",
                        usage_quantity=duration_sec / 60,
                        usage_unit="session_minutes",
                        duration_seconds=duration_sec,
                    )
                )
                log_event("📊", f"Usage logged: input={in_tokens} output={out_tokens} duration={duration_sec:.1f}s")
            except Exception as e:
                log_event("❌", f"Failed to log usage: {e}")
