"""
Worker 2: Topic Extractor
Uses Gemini to identify named topics, learning objectives, and segment boundary suggestions.
"""
from __future__ import annotations
import json
import os
import re
from typing import Any, Dict, List

import google.generativeai as genai

genai.configure(api_key=os.getenv("GEMINI_API_KEY") or "")


_PROMPT = """
You are an expert instructional content analyst.

Given the training document below, extract:
1. A list of distinct TOPICS (named concepts, processes, or skills covered)
2. For each topic: learning objectives (what the learner will be able to do)
3. Suggested segment boundaries (which paragraphs/headings belong to which topic)
4. Whether a software SIMULATION would be appropriate after the topic (e.g., SAP transaction, tool walkthrough)

Return ONLY valid JSON with this structure:
{{
  "course_title": "...",
  "topics": [
    {{
      "id": "t1",
      "title": "...",
      "objectives": ["...", "..."],
      "paragraph_indices": [0, 1, 2],
      "needs_simulation": false,
      "simulation_hint": ""
    }}
  ],
  "quiz_after_topics": ["t1", "t3"],
  "total_estimated_minutes": 15
}}

Rules:
- 3 to 8 topics max
- Each topic should represent 3-8 minutes of learning content
- Place a quiz gate after every 2-3 topics
- Mark needs_simulation=true only for procedural/software topics

DOCUMENT:
{content}
"""


def _extract_json(text: str) -> Dict:
    cleaned = re.sub(r"```json|```", "", (text or "")).strip()
    if not cleaned:
        raise ValueError("No JSON object found in Gemini response")

    first_open = cleaned.find("{")
    if first_open == -1:
        raise ValueError("No JSON object found in Gemini response")

    brace_depth = 0
    for idx in range(first_open, len(cleaned)):
        if cleaned[idx] == "{":
            brace_depth += 1
        elif cleaned[idx] == "}":
            brace_depth -= 1
            if brace_depth == 0:
                candidate = cleaned[first_open : idx + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    continue

    # Final attempt: try to parse the cleaned string directly if it looks like JSON
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        raise ValueError("No JSON object found in Gemini response")


def _fallback_topic_extraction(parsed_doc: Dict[str, Any]) -> Dict[str, Any]:
    paragraphs = parsed_doc.get("paragraphs", [])
    title = parsed_doc.get("title", "Training Module")
    chunk_size = max(1, len(paragraphs) // 3)
    topics = []
    for i in range(3):
        start = i * chunk_size
        end = start + chunk_size
        segment_text = "\n\n".join(paragraphs[start:end]).strip()
        if not segment_text:
            continue
        topics.append({
            "id": f"t{i+1}",
            "title": f"Topic {i+1}: {segment_text[:50].rstrip()}",
            "objectives": [
                "Explain the key idea from this section.",
                "Summarize the main sales or training point.",
            ],
            "paragraph_indices": list(range(start, min(end, len(paragraphs)))),
            "needs_simulation": False,
            "simulation_hint": "",
            "content_text": segment_text,
        })

    if not topics:
        topics = [{
            "id": "t1",
            "title": title,
            "objectives": ["Understand the module content."],
            "paragraph_indices": list(range(len(paragraphs))),
            "needs_simulation": False,
            "simulation_hint": "",
            "content_text": parsed_doc.get("clean_text", ""),
        }]

    return {
        "course_title": title,
        "topics": topics,
        "quiz_after_topics": [topics[i]["id"] for i in range(0, len(topics), 2) if i < len(topics)],
        "total_estimated_minutes": max(5, len(topics) * 3),
    }


def run(parsed_doc: Dict[str, Any]) -> Dict[str, Any]:
    """
    W2: Topic Extractor

    Args:
        parsed_doc: Output from W1 document parser.

    Returns:
        Enriched dict with topics + segment plan passed to W3.
    """
    print("[W2] Topic Extractor starting...")

    content = parsed_doc["clean_text"]
    # Truncate to avoid token limits
    if len(content) > 12000:
        content = content[:12000] + "\n\n[...content truncated for analysis...]"

    model = genai.GenerativeModel("gemini-2.5-flash")
    response = model.generate_content(
        _PROMPT.format(content=content),
        generation_config=genai.GenerationConfig(
            temperature=0.2,
            max_output_tokens=4096,
        ),
    )

    raw = response.text or ""
    if not raw.strip():
        print("[W2] Gemini returned an empty response for topic extraction, using fallback generate.")
        topics_data = _fallback_topic_extraction(parsed_doc)
    else:
        try:
            topics_data = _extract_json(raw)
        except ValueError as exc:
            print("[W2] Gemini raw response:\n" + raw)
            print(f"[W2] WARNING: Failed to parse Gemini topics JSON: {exc}. Falling back to simple topic extraction.")
            topics_data = _fallback_topic_extraction(parsed_doc)

    topics: List[Dict] = topics_data.get("topics", [])
    quiz_after: List[str] = topics_data.get("quiz_after_topics", [])

    # Attach paragraph text to each topic
    paragraphs = parsed_doc.get("paragraphs", [])
    for topic in topics:
        indices = topic.get("paragraph_indices", [])
        topic["content_text"] = "\n\n".join(
            paragraphs[i] for i in indices if i < len(paragraphs)
        )
        if not topic["content_text"]:
            # Fallback: use whole text divided equally
            chunk_size = max(1, len(paragraphs) // len(topics))
            start_i = topics.index(topic) * chunk_size
            topic["content_text"] = "\n\n".join(
                paragraphs[start_i : start_i + chunk_size]
            )

    result = {
        **parsed_doc,
        "course_title": topics_data.get("course_title", parsed_doc["title"]),
        "topics": topics,
        "quiz_after_topics": quiz_after,
        "total_estimated_minutes": topics_data.get("total_estimated_minutes", 15),
    }

    print(
        f"[W2] Done: {len(topics)} topics, "
        f"quiz gates after: {quiz_after}"
    )
    return result
