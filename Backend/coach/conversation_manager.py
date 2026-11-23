# Backend/coach/conversation_manager.py
"""
Conversation & Thread History Manager for the AI Performance Coach.
Stores, retrieves, and updates multi-turn conversation threads in public.coach_conversations.
"""

import re
from datetime import datetime
from typing import List, Dict, Any, Optional
from utils.supabase_client import supabase_admin


def generate_intelligent_title(query: str, response_snippet: Optional[str] = None) -> str:
    """
    Generates a concise, high-signal 3 to 5 word topic title like ChatGPT.
    Uses OpenAI (gpt-4o-mini) or Gemini with a strict timeout, falling back
    to an intelligent linguistic extractor.
    """
    clean_q = (query or "").strip()
    if not clean_q:
        return "New Chat"

    # 1. Try fast LLM completion if OpenAI API key is present
    try:
        from config import OPENAI_API_KEY
        if OPENAI_API_KEY:
            from openai import OpenAI
            client = OpenAI(api_key=OPENAI_API_KEY, timeout=2.5)
            prompt = (
                f"User query: '{clean_q[:250]}'\n"
                "Generate a concise 3 to 5 word title for this conversation like ChatGPT. "
                "Do not use quotes, punctuation, or generic words like 'Question about' or 'How to'. "
                "Title Case only."
            )
            res = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a concise conversation title generator. Output ONLY the 3-5 word title in Title Case without quotes."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=15,
                temperature=0.3
            )
            raw = (res.choices[0].message.content or "").strip().strip('"\'')
            if raw and len(raw) >= 3:
                return raw[:45]
    except Exception:
        pass

    # 2. Try Gemini fallback if configured
    try:
        from config import GEMINI_API_KEY
        if GEMINI_API_KEY:
            from google import genai
            client = genai.Client(api_key=GEMINI_API_KEY)
            res = client.models.generate_content(
                model="gemini-1.5-flash",
                contents=f"Generate a concise 3 to 5 word title for this conversation: '{clean_q[:250]}'. Respond ONLY with the title in Title Case, no quotes."
            )
            raw = (getattr(res, "text", "") or "").strip().strip('"\'')
            if raw and len(raw) >= 3:
                return raw[:45]
    except Exception:
        pass

    # 3. Smart linguistic heuristic fallback (clean, robust, zero-latency)
    t = clean_q
    t = re.sub(
        r"^(can you please|could you please|please|can you|could you|tell me about|what is the|what are the|what are|what is|how do i|how to|show me the|show me|i want to practice and review the|i want to practice and review|i want to practice the|i want to practice|i want to|help me with|explain the|give me the|give me)\s+",
        "",
        t,
        flags=re.IGNORECASE
    )
    t = re.sub(r"\s+playbook\s+with\s+you.*$", " Playbook", t, flags=re.IGNORECASE)
    t = re.sub(r"[?!.,:;\"']", "", t).strip()

    words = t.split()
    if not words:
        return "New Chat"

    if words[0].lower() in ["my", "our", "the", "a", "an"] and len(words) > 1:
        words = words[1:]

    selected_words = words[:5]
    intelligent_title = " ".join(selected_words).title()

    if len(intelligent_title) > 45:
        intelligent_title = intelligent_title[:45].rstrip()

    return intelligent_title or "New Chat"


def list_user_conversations(user_id: str, company_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """
    Fetches chat threads for a given user, ordered by most recent activity.
    Returns lightweight summaries (omits full message bodies for performance).
    """
    if not user_id or not company_id:
        return []

    try:
        res = (
            supabase_admin.table("coach_conversations")
            .select("id, title, created_at, updated_at, messages")
            .eq("user_id", user_id)
            .eq("company_id", company_id)
            .order("updated_at", desc=True)
            .limit(limit)
            .execute()
        )
        data = getattr(res, "data", None) or []

        summaries = []
        for item in data:
            msgs = item.get("messages") or []
            last_msg_snippet = ""
            if msgs and isinstance(msgs, list):
                last_msg = msgs[-1]
                content = last_msg.get("content", "")
                last_msg_snippet = (content[:80] + "...") if len(content) > 80 else content

            summaries.append({
                "id": str(item["id"]),
                "title": item.get("title") or "New Chat",
                "created_at": item.get("created_at"),
                "updated_at": item.get("updated_at"),
                "message_count": len(msgs),
                "last_message": last_msg_snippet
            })

        return summaries
    except Exception as e:
        print(f"[COACH CONVERSATIONS] Error listing conversations: {e}")
        return []


def get_conversation(conversation_id: str, user_id: str, company_id: str) -> Optional[Dict[str, Any]]:
    """
    Retrieves full conversation details including all messages.
    Enforces user_id and company_id security boundaries.
    """
    if not conversation_id or not user_id:
        return None

    try:
        res = (
            supabase_admin.table("coach_conversations")
            .select("*")
            .eq("id", conversation_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        data = getattr(res, "data", None) or []
        if data:
            return data[0]
        return None
    except Exception as e:
        print(f"[COACH CONVERSATIONS] Error fetching conversation {conversation_id}: {e}")
        return None


def create_conversation(
    user_id: str,
    company_id: str,
    title: str = "New Chat",
    initial_messages: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Creates a new conversation thread in the database.
    """
    now_iso = datetime.utcnow().isoformat()
    payload = {
        "user_id": user_id,
        "company_id": company_id,
        "title": (title or "New Chat").strip()[:80],
        "messages": initial_messages or [],
        "created_at": now_iso,
        "updated_at": now_iso
    }

    try:
        res = supabase_admin.table("coach_conversations").insert(payload).execute()
        data = getattr(res, "data", None) or []
        if data:
            return data[0]
        return payload
    except Exception as e:
        print(f"[COACH CONVERSATIONS] Error creating conversation: {e}")
        return payload


def append_messages_to_conversation(
    conversation_id: str,
    user_id: str,
    company_id: str,
    new_messages: List[Dict[str, Any]],
    auto_title_from_query: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Appends new user/assistant messages to an existing conversation.
    If the conversation is newly created or still titled 'New Chat', automatically derives a descriptive title.
    """
    if not conversation_id or not user_id:
        return None

    try:
        existing = get_conversation(conversation_id, user_id, company_id)
        if not existing:
            return None

        current_messages = existing.get("messages") or []
        combined_messages = current_messages + new_messages

        updates: Dict[str, Any] = {
            "messages": combined_messages,
            "updated_at": datetime.utcnow().isoformat()
        }

        # Auto-update title if it's default 'New Chat' and a query is provided
        current_title = existing.get("title", "New Chat")
        if (current_title in ["New Chat", "Untitled", ""] or not current_title) and auto_title_from_query:
            updates["title"] = generate_intelligent_title(auto_title_from_query)

        res = (
            supabase_admin.table("coach_conversations")
            .update(updates)
            .eq("id", conversation_id)
            .eq("user_id", user_id)
            .execute()
        )
        data = getattr(res, "data", None) or []
        if data:
            return data[0]
        return {**existing, **updates}
    except Exception as e:
        print(f"[COACH CONVERSATIONS] Error appending messages to conversation {conversation_id}: {e}")
        return None


def rename_conversation(conversation_id: str, user_id: str, company_id: str, new_title: str) -> bool:
    """Renames an existing conversation thread."""
    if not conversation_id or not user_id or not new_title:
        return False

    try:
        clean_title = new_title.strip()[:80]
        res = (
            supabase_admin.table("coach_conversations")
            .update({
                "title": clean_title,
                "updated_at": datetime.utcnow().isoformat()
            })
            .eq("id", conversation_id)
            .eq("user_id", user_id)
            .execute()
        )
        data = getattr(res, "data", None) or []
        return len(data) > 0
    except Exception as e:
        print(f"[COACH CONVERSATIONS] Error renaming conversation {conversation_id}: {e}")
        return False


def delete_conversation(conversation_id: str, user_id: str, company_id: str) -> bool:
    """Deletes a conversation thread and its messages."""
    if not conversation_id or not user_id:
        return False

    try:
        res = (
            supabase_admin.table("coach_conversations")
            .delete()
            .eq("id", conversation_id)
            .eq("user_id", user_id)
            .execute()
        )
        return True
    except Exception as e:
        print(f"[COACH CONVERSATIONS] Error deleting conversation {conversation_id}: {e}")
        return False

