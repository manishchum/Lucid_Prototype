from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, Depends
from fastapi.responses import JSONResponse
# from google.generativeai import GenerativeModel
# import google.generativeai as genai
# import os
import asyncio
from utils.supabase_client import supabase
from utils.redis_limiter import check_rate_limit
from ai.ai_gateway import AI
from ai.types import AIRequest

from utils.auth import RequestAuth, get_request_auth_optional

router = APIRouter()

# genai.configure(api_key=os.environ.get("GEMINI_API_KEY"))
# ai = GenerativeModel("gemini-3.1-pro-preview")


# WebSocket connections store
connections = set()


def _resolve_company_id(user_id: str | None, fallback_company_id: str | None) -> str | None:
    if fallback_company_id:
        return fallback_company_id

    if not user_id:
        return None

    try:
        company_res = supabase.table("users") \
            .select("company_id") \
            .eq("user_id", user_id) \
            .single() \
            .execute()

        if company_res.data:
            return company_res.data.get("company_id")
    except Exception as lookup_error:
        print("[module-chat] Failed to resolve company_id:", lookup_error)

    return None


def _persist_conversation(
    processed_module_id: str,
    user_id: str | None,
    company_id: str | None,
    conversation_payload: list[dict],
) -> None:
    try:
        supabase.table("module_chat_conversations").insert({
            "company_id": company_id,
            "user_id": user_id,
            "processed_module_id": processed_module_id,
            "conversation": conversation_payload
        }).execute()
    except Exception as save_error:
        print("[module-chat] Failed to persist conversation:", save_error)


def _chunk_text(content: str, chunk_size: int = 1200, overlap: int = 200) -> list[str]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")

    if overlap < 0:
        raise ValueError("overlap must be non-negative")

    step = max(chunk_size - overlap, 1)
    chunks: list[str] = []
    start = 0

    while start < len(content):
        chunk = content[start:start + chunk_size].strip()

        if chunk:
            chunks.append(chunk)

        start += step

    return chunks


async def _resolve_sprint_module_context(
    module_id: str,
    user_message: str,
) -> tuple[dict, str]:
    try:
        import time
        import numpy as np
        from ingestion.embedder import get_model

        retrieval_start = time.perf_counter()

        # ---------------------------------------------------------
        # 1. Fetch all processed modules belonging to this sprint
        # ---------------------------------------------------------
        pm_query = (
            supabase.table("processed_modules")
            .select("processed_module_id, title, content")
            .eq("original_module_id", module_id)
            .execute()
        )

        pm_list = pm_query.data or []

        if not pm_list:
            raise ValueError("No processed modules found for this sprint")

        print(
            f"[module-chat] Sprint RAG: "
            f"{len(pm_list)} processed modules found"
        )

        # ---------------------------------------------------------
        # 2. Load embedding model ONCE
        # ---------------------------------------------------------
        model = get_model()

        # ---------------------------------------------------------
        # 3. Embed the user's question ONCE
        # ---------------------------------------------------------
        query_text = (
            "Represent this sentence for searching relevant passages: "
            f"{user_message}"
        )

        query_emb = model.encode(
            query_text,
            normalize_embeddings=True,
            convert_to_numpy=True
        )

        # ---------------------------------------------------------
        # 4. Create all chunks first
        # ---------------------------------------------------------
        chunk_records: list[dict] = []

        for pm in pm_list:
            content = pm.get("content") or ""

            if not content.strip():
                continue

            title = pm.get("title", "")
            processed_id = pm.get("processed_module_id")

            chunks = _chunk_text(
                content,
                chunk_size=1200,
                overlap=200
            )

            for chunk in chunks:
                chunk_records.append({
                    "processed_module_id": processed_id,
                    "title": title,
                    "content": chunk,
                })

        if not chunk_records:
            raise ValueError("No searchable content found in this sprint")

        print(
            f"[module-chat] Sprint RAG: "
            f"{len(chunk_records)} chunks created"
        )

        # ---------------------------------------------------------
        # 5. Build embedding texts
        # ---------------------------------------------------------
        embedding_texts = [
            (
                "Represent this training passage for retrieval: "
                f"{record['title']}. {record['content']}"
            )
            for record in chunk_records
        ]

        # ---------------------------------------------------------
        # 6. CRITICAL PERFORMANCE FIX
        #
        # OLD:
        #   model.encode() was called once PER chunk.
        #
        # NEW:
        #   Encode ALL chunks in batches.
        # ---------------------------------------------------------
        doc_embeddings = model.encode(
            embedding_texts,
            normalize_embeddings=True,
            convert_to_numpy=True,
            batch_size=64,
            show_progress_bar=False
        )

        # ---------------------------------------------------------
        # 7. Vectorized cosine similarity
        #
        # Because both query and document embeddings are normalized,
        # dot product == cosine similarity.
        # ---------------------------------------------------------
        scores = np.dot(doc_embeddings, query_emb)

        # ---------------------------------------------------------
        # 8. Attach scores to chunks
        # ---------------------------------------------------------
        for index, score in enumerate(scores):
            chunk_records[index]["score"] = float(score)

        # ---------------------------------------------------------
        # 9. Sort by semantic relevance
        # ---------------------------------------------------------
        chunk_records.sort(
            key=lambda item: item["score"],
            reverse=True
        )

        # ---------------------------------------------------------
        # 10. Determine the best processed module
        # ---------------------------------------------------------
        best_chunk = chunk_records[0]

        target_processed_module_id = (
            best_chunk["processed_module_id"]
        )

        # ---------------------------------------------------------
        # 11. Take only the strongest chunks from the
        #     winning processed module
        # ---------------------------------------------------------
        best_module_chunks = [
            item
            for item in chunk_records
            if item["processed_module_id"] == target_processed_module_id
        ]

        best_module_chunks.sort(
            key=lambda item: item["score"],
            reverse=True
        )

        best_module_chunks = best_module_chunks[:5]

        # ---------------------------------------------------------
        # 12. Build the final RAG context
        # ---------------------------------------------------------
        module_data = {
            "title": best_chunk.get("title", ""),
            "content": (
                "Retrieved context from sprint search:\n\n"
                + "\n\n--- Retrieved Passage ---\n\n".join(
                    item["content"]
                    for item in best_module_chunks
                )
            )
        }

        retrieval_time = time.perf_counter() - retrieval_start

        # ---------------------------------------------------------
        # 13. Debug information
        # ---------------------------------------------------------
        print(
            f"[module-chat] Sprint RAG matched "
            f"'{best_chunk['title']}' "
            f"processed_module_id={target_processed_module_id} "
            f"score={best_chunk['score']:.4f}"
        )

        print(
            "[module-chat] Retrieved chunk scores:",
            [
                round(item["score"], 4)
                for item in best_module_chunks
            ]
        )

        print(
            f"[module-chat] Sprint RAG retrieval time: "
            f"{retrieval_time:.2f}s"
        )

        return module_data, target_processed_module_id

    except Exception as error:
        print(
            f"[module-chat] Error finding best module for sprint: "
            f"{error}"
        )
        raise

# Process STT (mock)
async def processSTT(audioChunk: bytes) -> str:
    print("Processing audio chunk of size:", len(audioChunk))
    return "Hello, how can I help you with this training module?"


# Call LLM
# async def callLLM(transcript: str) -> str:

#     prompt = f"""
# You are a real-time voice assistant helping a user during a training session.

# User said:
# "{transcript}"

# Respond naturally, concisely, and in plain text.
# Do NOT use markdown, HTML, or special formatting.
# """

#     result = ai.generate_content(prompt)

#     return result.text

async def callLLM(
    transcript: str,
    user_id: str,
    company_id: str,
    processed_module_id: str,
) -> str:

    module_query = (
        supabase.table("processed_modules")
        .select("title, content")
        .eq("processed_module_id", processed_module_id)
        .single()
        .execute()
    )

    module_data = module_query.data

    if not module_data:
        raise ValueError("Module not found")

    ai_response = await AI.execute(
        AIRequest(
            feature="module_chat",
            company_id=str(company_id),
            user_id=str(user_id),
            route="/module-chat",
            prompt_type="default",
            variables={
                "moduleTitle": module_data.get("title", ""),
                "moduleContent": module_data.get("content", ""),
                "conversationContext": "",
                "userMessage": transcript,
            },
            response_format="text",
        )
    )

    return str(ai_response.content or "")

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

    auth_ctx = get_request_auth_optional(
        authorization=ws.headers.get("Authorization"),
        x_user_id=ws.headers.get("X-User-ID"),
    )
    processed_module_id = ws.query_params.get("processed_module_id")
    fallback_user_id = ws.query_params.get("user_id")
    fallback_company_id = ws.query_params.get("company_id")
    user_id = auth_ctx.user_id or fallback_user_id
    company_id = _resolve_company_id(user_id, fallback_company_id)

    if not processed_module_id or not user_id or not company_id:
        await ws.send_json({
            "error": "Missing required identifiers",
            "details": {
                "processed_module_id": processed_module_id,
                "user_id": user_id,
                "company_id": company_id
            }
        })
        await ws.close(code=1008)
        connections.remove(ws)
        return

    print("New WebSocket connection for voice chat")

    try:
        while True:

            data = await ws.receive_bytes()

            try:
                transcript = await processSTT(data)

                llmResponse = await callLLM(
                    transcript=transcript,
                    user_id=user_id,
                    company_id=company_id,
                    processed_module_id=processed_module_id,
                )

                await streamTTS(ws, llmResponse)

                if processed_module_id:
                    _persist_conversation(
                        processed_module_id=processed_module_id,
                        user_id=user_id,
                        company_id=company_id,
                        conversation_payload=[
                            {"role": "user", "content": transcript},
                            {"role": "assistant", "content": llmResponse}
                        ]
                    )
                else:
                    print("[module-chat] WebSocket missing processed_module_id; skipping persistence")

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
async def POST(
    request: Request,
    auth_ctx: RequestAuth = Depends(get_request_auth_optional),
):

    try:

        body = await request.json()

        processed_module_id = body.get("processed_module_id")
        module_id = body.get("module_id")
        user_message = body.get("user_message")
        chat_history = body.get("chat_history")
        fallback_user_id = body.get("user_id")
        fallback_company_id = body.get("company_id")

        user_id = auth_ctx.user_id or fallback_user_id
        company_id = _resolve_company_id(user_id, fallback_company_id)

        if not user_id or not company_id:
            return JSONResponse(
                {
                    "error": "Missing required identifiers",
                    "details": {
                        "user_id": user_id,
                        "company_id": company_id
                    }
                },
                status_code=400
            )

        await check_rate_limit(
            user_id=user_id,
            endpoint="module-chat"
        )

        if not user_message:
            return JSONResponse({"error": "Missing user message"}, status_code=400)

        if not processed_module_id and not module_id:
            return JSONResponse({"error": "Missing required fields: processed_module_id or module_id"}, status_code=400)

        moduleData = None
        target_processed_module_id = processed_module_id

        if module_id and not processed_module_id:
            try:
                moduleData, target_processed_module_id = await _resolve_sprint_module_context(
                    module_id=module_id,
                    user_message=user_message,
                )
            except ValueError as error:
                return JSONResponse({"error": str(error)}, status_code=404)
            except Exception:
                return JSONResponse({"error": "Failed to find best module context"}, status_code=500)
        else:
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

#         prompt = f"""
# You are Lucid, a helpful learning assistant helping a user understand a training module.

# Module Title:
# {moduleData['title']}

# Module Content:
# {moduleData['content']}

# {"Previous conversation:" + chr(10) + historyContext if historyContext else ""}

# User's question:
# {user_message}

# IMPORTANT LANGUAGE RULES:

# - Detect the language of the user's latest message.
# - ALWAYS reply in the SAME language as the user's latest message.
# - If the user writes in English, reply in English.
# - If the user writes in Hindi (Devanagari), reply in Hindi.
# - If the user writes in Hinglish (Hindi written using English letters), reply in Hinglish.
# - Never translate the user's language unless explicitly asked.
# - Keep technical terms like API, JWT, Redis, SQL, Python, etc. in English where appropriate.

# Answer ONLY using the information in the training module.
# If the question is unrelated to the module, politely redirect the user back to the module.

# Keep the answer:
# - concise
# - conversational
# - natural
# - plain text only

# Do NOT use HTML.
# Do NOT use Markdown.
# Do NOT use bold, italics, or bullet formatting unless explicitly requested.
# """

        # model = GenerativeModel("gemini-2.5-flash-lite")

        # result = model.generate_content(prompt)

        # assistantMessage = result.text
        
        ai_response = await AI.execute(
            AIRequest(
                feature="module_chat",
                company_id=str(company_id),
                user_id=str(user_id),
                route="/module-chat",
                prompt_type="default",
                variables={
                    "moduleTitle": moduleData.get("title", ""),
                    "moduleContent": moduleData.get("content", ""),
                    "conversationContext": (
                        "Previous conversation:\n" + historyContext
                        if historyContext
                        else ""
                    ),
                    "userMessage": user_message,
                },
                response_format="text",
            )
        )

        assistantMessage = str(ai_response.content or "")

        conversation_payload = []

        if chat_history and len(chat_history) > 0:
            conversation_payload.extend(chat_history)

        conversation_payload.append({
            "role": "user",
            "content": user_message
        })

        conversation_payload.append({
            "role": "assistant",
            "content": assistantMessage
        })

        # user_id = auth_ctx.user_id or fallback_user_id
        # company_id = _resolve_company_id(user_id, fallback_company_id)

        # if not user_id or not company_id:
        #     return JSONResponse(
        #         {
        #             "error": "Missing required identifiers",
        #             "details": {
        #                 "user_id": user_id,
        #                 "company_id": company_id
        #             }
        #         },
        #         status_code=400
        #     )

        _persist_conversation(
            processed_module_id=target_processed_module_id,
            user_id=user_id,
            company_id=company_id,
            conversation_payload=conversation_payload
        )

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