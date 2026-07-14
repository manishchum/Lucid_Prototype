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
    text = re.sub(r"```json|```", "", text).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object found in Gemini response")
    return json.loads(text[start : end + 1])


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

    model = genai.GenerativeModel("gemini-1.5-flash")
    response = model.generate_content(
        _PROMPT.format(content=content),
        generation_config=genai.GenerationConfig(
            temperature=0.2,
            max_output_tokens=4096,
        ),
    )

    raw = response.text or ""
    topics_data = _extract_json(raw)

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
