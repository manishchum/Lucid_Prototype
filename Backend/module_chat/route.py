from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, Depends
from fastapi.responses import JSONResponse
# from google.generativeai import GenerativeModel
# import google.generativeai as genai
# import os
import asyncio
from utils.supabase_client import supabase, supabase_admin
from utils.redis_limiter import check_rate_limit
from ai.ai_gateway import AI
from ai.types import AIRequest
import re

from utils.auth import RequestAuth, get_request_auth_optional, require_addon

router = APIRouter(dependencies=[Depends(require_addon("chat_in_studio"))])

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


_INTENT_ANCHORS = None

_NORM_MAPPINGS = {
    # Hinglish & Romanized Indic Pronouns and Question Words
    r"\b(kon|kaun)\b": "who",
    r"\b(tu|tum|aap|ap)\b": "you",
    r"\b(kaise|kaisa|kaisey)\b": "how",
    r"\b(kya)\b": "what",
    r"\b(kab)\b": "when",
    r"\b(kahan|kaha)\b": "where",
    r"\b(kyun|kyu)\b": "why",
    r"\b(hai|hain|ho|hoon|hu)\b": "is",
    r"\b(namaste|pranam)\b": "hello",
    r"\b(dhanyawad|shukriya)\b": "thanks",
    r"\b(badiya|accha|acha|thik|teek|sahi)\b": "good",
    r"\b(alvida)\b": "goodbye",
    # Hindi Devanagari mappings
    r"कौन": "who",
    r"(आप|तुम|तू)": "you",
    r"कैसे": "how",
    r"क्या": "what",
    r"नमस्ते": "hello",
    r"धन्यवाद|शुक्रिया": "thanks",
    r"अलविदा": "goodbye",
}


def _normalize_input_for_embedding(text: str) -> str:
    """Translates common Hinglish/Hindi keywords to English equivalents so English embedding model captures semantic intent accurately."""
    res = text.lower()
    for pattern, repl in _NORM_MAPPINGS.items():
        res = re.sub(pattern, repl, res)
    return res


def _get_intent_anchors():
    """Lazily loads and embeds clean English intent anchors for fast local similarity classification."""
    global _INTENT_ANCHORS
    if _INTENT_ANCHORS is not None:
        return _INTENT_ANCHORS

    try:
        from ingestion.embedder import get_model
        import numpy as np

        model = get_model()
        # Clean, minimal English-only anchor phrases (no multi-language bloating required!)
        anchors_def = [
            {
                "intent": "identity",
                "phrases": ["who are you what is your name who built you"],
                "responses": {
                    "hinglish": "Main Lucid hoon, aapka AI learning assistant! Iss training module ke baare mein koi bhi sawal pooch sakte hain.",
                    "hindi": "मैं ल्यूसिड हूँ, आपका एआई लर्निंग असिस्टेंट! इस ट्रेनिंग मॉड्यूल के बारे में आप कोई भी सवाल पूछ सकते हैं।",
                    "en": "I am Lucid, your AI learning assistant! How can I help you understand this training module today?"
                }
            },
            {
                "intent": "how_are_you",
                "phrases": ["how are you how r u how is it going how do you do"],
                "responses": {
                    "hinglish": "Main bilkul badhiya hoon! Aap bataiye, iss module mein kya samajhna hai?",
                    "hindi": "मैं बिल्कुल ठीक हूँ! आप बताइए, इस मॉड्यूल में क्या समझना चाहते हैं?",
                    "en": "I'm doing great and ready to help! What questions do you have about this training module?"
                }
            },
            {
                "intent": "greeting",
                "phrases": ["hello hi hey greetings good morning"],
                "responses": {
                    "hinglish": "Hello! Main Lucid hoon. Aaj iss module mein aapki kya help kar sakta hoon?",
                    "hindi": "नमस्ते! मैं ल्यूसिड हूँ। आज इस मॉड्यूल में आपकी क्या सहायता कर सकता हूँ?",
                    "en": "Hello! I'm Lucid, your AI learning assistant. How can I help you understand this training module today?"
                }
            },
            {
                "intent": "capabilities",
                "phrases": ["what can you do help me what do you do how can you help"],
                "responses": {
                    "hinglish": "Main iss module ke concepts samjha sakta hoon, questions ke answer de sakta hoon, aur summary bata sakta hoon.",
                    "hindi": "मैं इस मॉड्यूल के कॉन्सेप्ट समझा सकता हूँ, प्रश्नों के उत्तर दे सकता हूँ और सारांश बता सकता हूँ।",
                    "en": "I can explain module concepts, summarize sections, or answer specific questions from this training content."
                }
            },
            {
                "intent": "thanks",
                "phrases": ["thanks thank you thanks a lot"],
                "responses": {
                    "hinglish": "Aapka swagat hai! Agar koi aur sawal ho toh zaroor poochiye.",
                    "hindi": "आपका स्वागत है! यदि कोई और प्रश्न हो तो अवश्य पूछें।",
                    "en": "You're welcome! Feel free to ask if you need anything else."
                }
            },
            {
                "intent": "acknowledgment",
                "phrases": ["ok okay got it cool awesome good fine understood"],
                "responses": {
                    "hinglish": "Bahut badhiya! Jab bhi koi sawal ho, zaroor poochiyega.",
                    "hindi": "बहुत बढ़िया! जब भी कोई प्रश्न हो, अवश्य पूछें।",
                    "en": "Glad to hear! Let me know whenever you have more questions."
                }
            },
            {
                "intent": "farewell",
                "phrases": ["goodbye bye cya see ya take care"],
                "responses": {
                    "hinglish": "Goodbye! Achi tarah padhte rahiye.",
                    "hindi": "अलविदा! अच्छी तरह सीखते रहिए।",
                    "en": "Goodbye! Happy learning!"
                }
            }
        ]

        anchors_data = []
        for item in anchors_def:
            phrase_embs = model.encode(item["phrases"], normalize_embeddings=True, convert_to_numpy=True)
            avg_emb = np.mean(phrase_embs, axis=0)
            norm = np.linalg.norm(avg_emb)
            if norm > 0:
                avg_emb = avg_emb / norm
            anchors_data.append({
                "intent": item["intent"],
                "embedding": avg_emb,
                "responses": item["responses"]
            })

        _INTENT_ANCHORS = anchors_data
        return _INTENT_ANCHORS
    except Exception as err:
        print(f"[module-chat] Warning building intent anchors: {err}")
        return []


def _detect_message_language(user_message: str) -> str:
    """Detects whether user message is Hindi (Devanagari), Hinglish, or English/other."""
    if not user_message:
        return "en"

    # Check Devanagari Unicode range (\u0900-\u097F)
    if re.search(r"[\u0900-\u097F]", user_message):
        return "hindi"

    msg_lower = user_message.lower()
    hinglish_markers = {
        "kon", "kaun", "tu", "tum", "aap", "kya", "hai", "hain", "ho", "bhai",
        "kaise", "kaisey", "kaisa", "samajh", "batao", "batayein", "hoon", "hu",
        "thik", "teek", "accha", "acha", "badiya", "shukriya", "dhanyawad", "alvida",
        "par", "nhi", "nahi", "raha", "rahi", "karo", "karna"
    }
    words = set(re.findall(r"\b\w+\b", msg_lower))
    if len(words & hinglish_markers) > 0:
        return "hinglish"

    return "en"


def _get_greeting_response(user_message: str) -> str | None:
    """Returns instant response for small talk/greetings dynamically in English, Hinglish, or Hindi without calling LLM."""
    if not user_message:
        return None

    # Clean text: remove punctuation and collapse spaces
    msg_cleaned = re.sub(r"[^\w\s]", "", user_message.strip().lower())
    msg_cleaned = re.sub(r"\s+", " ", msg_cleaned).strip()

    if not msg_cleaned:
        return None

    # Fast Path A: Direct Exact Match Dictionary
    greetings = {
        "hi", "hello", "hey", "hlo", "ello", "hola", "namaste", "good morning", 
        "good afternoon", "good evening", "greetings", "hey there", "hi there",
        "whatsup", "whats up", "what up", "sup", "wbu", "what about you"
    }
    lang = _detect_message_language(user_message)

    if msg_cleaned in greetings:
        if lang == "hinglish":
            return "Hello! Main Lucid hoon. Aaj iss module mein aapki kya help kar sakta hoon?"
        elif lang == "hindi":
            return "नमस्ते! मैं ल्यूसिड हूँ। आज इस मॉड्यूल में आपकी क्या सहायता कर सकता हूँ?"
        return "Hello! I'm Lucid, your AI learning assistant. How can I help you understand this training module today?"

    how_are_you = {
        "how are you", "how r u", "how are u", "how r you", "how do you do", 
        "how is it going", "hows it going", "how it going", "how are things",
        "kaise ho", "kya haal hai", "kaise ho aap", "kaise ho bhai"
    }
    if msg_cleaned in how_are_you:
        if lang == "hinglish":
            return "Main bilkul badhiya hoon! Aap bataiye, iss module mein kya samajhna hai?"
        elif lang == "hindi":
            return "मैं बिल्कुल ठीक हूँ! आप बताइए, इस मॉड्यूल में क्या समझना चाहते हैं?"
        return "I'm doing great and ready to help! What questions do you have about this training module?"

    identity = {
        "who are you", "who r u", "who r you", "who are u", "what is your name", 
        "whats your name", "what your name", "who made you", "who built you",
        "kon hai tu", "kaun ho tum", "kon ho aap", "tu kaun hai", "kaun hai bhai"
    }
    if msg_cleaned in identity:
        if lang == "hinglish":
            return "Main Lucid hoon, aapka AI learning assistant! Iss training module ke baare mein koi bhi sawal pooch sakte hain."
        elif lang == "hindi":
            return "मैं ल्यूसिड हूँ, आपका एआई लर्निंग असिस्टेंट! इस ट्रेनिंग मॉड्यूल के बारे में आप कोई भी सवाल पूछ सकते हैं।"
        return "I am Lucid, your training assistant! I can explain concepts and answer questions directly from this module."

    thanks = {
        "thanks", "thank you", "thx", "thanku", "dhanyawad", "shukriya", "ty", "thank you so much"
    }
    if msg_cleaned in thanks:
        if lang == "hinglish":
            return "Aapka swagat hai! Agar koi aur sawal ho toh zaroor poochiye."
        elif lang == "hindi":
            return "आपका स्वागत है! यदि कोई और प्रश्न हो तो अवश्य पूछें।"
        return "You're welcome! Feel free to ask if you need anything else."

    # Fast Path B: Dynamic Semantic Vector Anchor Matching with Phonetic Normalization (<= 8 words)
    words = msg_cleaned.split()
    if len(words) <= 8:
        try:
            import numpy as np
            from ingestion.embedder import get_model
            
            # Normalize Hinglish/Hindi words to English before vectorizing
            normalized_query = _normalize_input_for_embedding(user_message)
            model = get_model()
            query_emb = model.encode(normalized_query, normalize_embeddings=True, convert_to_numpy=True)
            
            anchors = _get_intent_anchors()
            best_intent = None
            best_sim = 0.0
            
            for anchor in anchors:
                sim = float(np.dot(anchor["embedding"], query_emb))
                if sim > best_sim:
                    best_sim = sim
                    best_intent = anchor
            
            # If high semantic similarity (>= 0.72) to a small-talk intent anchor
            if best_intent and best_sim >= 0.72:
                print(f"[module-chat] Dynamic Multilingual Intent matched '{best_intent['intent']}' sim={best_sim:.4f} lang={lang}")
                responses = best_intent["responses"]
                return responses.get(lang, responses.get("en"))
        except Exception as e:
            print(f"[module-chat] Warning in dynamic intent vector classifier: {e}")

    return None


async def _resolve_single_module_context(
    processed_module_id: str,
    user_message: str,
) -> dict:
    """Retrieves top-K vector passages or direct pre-generated Q&A answers for a single processed module with vernacular expansion and confidence checks."""
    try:
        from ingestion.embedder import get_model
        from ingestion.processed_module_rag import _expand_vernacular_query

        expanded_user_message = _expand_vernacular_query(user_message)
        model = get_model()
        query_text = f"Represent this sentence for searching relevant passages: {expanded_user_message}"
        query_emb = model.encode(query_text, normalize_embeddings=True, convert_to_numpy=True).tolist()

        rpc_res = supabase_admin.rpc("match_processed_module_chunks", {
            "query_embedding": query_emb,
            "p_processed_module_id": processed_module_id,
            "match_count": 5
        }).execute()

        matches = getattr(rpc_res, "data", []) or []

        # Fetch title for title variable
        title_res = supabase_admin.table("processed_modules").select("title, content").eq("processed_module_id", processed_module_id).execute()
        title_rows = getattr(title_res, "data", []) or []
        pm_data = title_rows[0] if title_rows else {}
        title = pm_data.get("title", "")

        if matches:
            top_match = matches[0]
            similarity = float(top_match.get("similarity", 0.0))
            metadata = top_match.get("metadata") or {}

            # DIRECT Q&A MATCH: If top match similarity is high (>= 0.72) and has a pre-generated answer, return directly with 0 LLM calls!
            if similarity >= 0.72 and metadata.get("answer"):
                print(f"[module-chat] DIRECT Q&A MATCH! similarity={similarity:.4f}. Returning pre-generated answer without calling LLM.")
                answer_with_citation = f"{metadata.get('answer')}\n\n📌 Verified Source: Module '{title}'"
                return {
                    "title": title,
                    "content": top_match.get("content", ""),
                    "is_direct_match": True,
                    "direct_answer": answer_with_citation
                }

            is_low_confidence = similarity < 0.60
            passages = "\n\n--- Relevant Module Passage ---\n\n".join(m["content"] for m in matches)
            if is_low_confidence:
                passages += "\n\n⚠️ LOW CONFIDENCE WARNING: Vector similarity is low (<0.60). Please verify safety instructions with senior staff before taking action."

            print(f"[module-chat] RAG vector search found {len(matches)} matching chunks (top sim={similarity:.4f}) for processed_module_id={processed_module_id}")
            return {"title": title, "content": passages, "is_low_confidence": is_low_confidence}
        
        # Fallback to full content if vectors are not ingested yet
        print(f"[module-chat] Notice: No vector chunks found for {processed_module_id}, using fallback full content.")
        return {"title": title, "content": pm_data.get("content", "")}

    except Exception as err:
        print(f"[module-chat] Vector retrieval error for {processed_module_id}: {err}")
        # Fallback
        pm = supabase_admin.table("processed_modules").select("title, content").eq("processed_module_id", processed_module_id).execute()
        pm_rows = getattr(pm, "data", []) or []
        data = pm_rows[0] if pm_rows else {}
        return {"title": data.get("title", ""), "content": data.get("content", "")}


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
        # Fast Path: Try Supabase pre-embedded pgvector search first
        # ---------------------------------------------------------
        try:
            model = get_model()
            query_text = f"Represent this sentence for searching relevant passages: {user_message}"
            query_emb = model.encode(query_text, normalize_embeddings=True, convert_to_numpy=True).tolist()

            rpc_res = supabase_admin.rpc("match_sprint_module_chunks", {
                "query_embedding": query_emb,
                "p_original_module_id": module_id,
                "match_count": 5
            }).execute()

            vector_matches = getattr(rpc_res, "data", []) or []
            if vector_matches:
                best_match = vector_matches[0]
                similarity = float(best_match.get("similarity", 0.0))
                metadata = best_match.get("metadata") or {}
                target_processed_module_id = best_match["processed_module_id"]

                pm_res = supabase_admin.table("processed_modules").select("title").eq("processed_module_id", target_processed_module_id).execute()
                pm_rows = getattr(pm_res, "data", []) or []
                pm_title = pm_rows[0].get("title", "") if pm_rows else ""

                if similarity >= 0.72 and metadata.get("answer"):
                    print(f"[module-chat] DIRECT SPRINT Q&A MATCH! similarity={similarity:.4f}.")
                    module_data = {
                        "title": pm_title,
                        "content": best_match.get("content", ""),
                        "is_direct_match": True,
                        "direct_answer": metadata.get("answer")
                    }
                    return module_data, target_processed_module_id

                module_chunks = [m for m in vector_matches if m["processed_module_id"] == target_processed_module_id]

                retrieval_time = time.perf_counter() - retrieval_start
                print(f"[module-chat] Sprint RAG vector match '{pm_title}' in {retrieval_time:.3f}s")
                module_data = {
                    "title": pm_title,
                    "content": "Retrieved context from sprint search:\n\n" + "\n\n--- Retrieved Passage ---\n\n".join(m["content"] for m in module_chunks)
                }
                return module_data, target_processed_module_id
        except Exception as vector_err:
            print(f"[module-chat] Pre-embedded Sprint RAG error, falling back to dynamic search: {vector_err}")

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
    greeting = _get_greeting_response(transcript)
    if greeting:
        return greeting

    module_data = await _resolve_single_module_context(
        processed_module_id=processed_module_id,
        user_message=transcript,
    )

    if not module_data or not module_data.get("title"):
        raise ValueError("Module not found")

    if module_data.get("is_direct_match") and module_data.get("direct_answer"):
        return module_data.get("direct_answer")

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
                moduleData = await _resolve_single_module_context(
                    processed_module_id=processed_module_id,
                    user_message=user_message,
                )

                if not moduleData or not moduleData.get("title"):
                    return JSONResponse(
                        {"error": "Module not found"},
                        status_code=404
                    )
            except Exception as e:
                print(f"[module-chat] Error resolving single module context: {e}")
                return JSONResponse(
                    {"error": "Module context error"},
                    status_code=500
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
        
        # 1. FAST PATH A: Greeting & Small Talk Check (0 LLM / 0 RAG calls)
        greeting = _get_greeting_response(user_message)
        if greeting:
            print(f"[module-chat] Greeting detected ('{user_message}'). Returning instant response with 0 LLM calls.")
            assistantMessage = greeting
        # 2. FAST PATH B: Direct Pre-generated Q&A Match (0 LLM calls)
        elif moduleData.get("is_direct_match") and moduleData.get("direct_answer"):
            print(f"[module-chat] Returning pre-generated Q&A answer directly with 0 LLM calls.")
            assistantMessage = moduleData.get("direct_answer")
        else:
            # 3. Dynamic RAG LLM Execution (Pinpointed top-K passages context)
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
                    generation_config={
                        "max_output_tokens": 300,
                        "temperature": 0.3,
                    },
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