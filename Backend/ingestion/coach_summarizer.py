# Backend/ingestion/coach_summarizer.py
"""
Lightweight AI Document Summarizer and Categorization Engine for Performance Coach.
Extracts a concise document summary, classification category tag, reporting period, 
and key topic competencies using gpt-4o-mini or gemini-1.5-flash, with robust heuristic fallbacks.
"""

import json
import re
from typing import List, Dict, Any, Optional

from config import OPENAI_API_KEY, GEMINI_API_KEY


SYSTEM_PROMPT = """You are an expert HR and Sales Performance Analytics AI.
Analyze the provided document excerpt, filename, and structural columns.
Generate a concise summary, classify the document into an appropriate category, detect the reporting period, and list key topics.

Return ONLY a valid JSON object with these exact keys:
{
  "summary": "2 to 3 concise, professional sentences explaining what this document tracks, who/what it covers, and key operational or feedback themes.",
  "category": "Choose exactly one: Sales KPI Tracker, Performance Appraisal, 1-on-1 Feedback, Sprint Retrospective, Training & Onboarding, Disciplinary & Compliance, Operational Report, Other",
  "document_period": "The reporting period if identifiable (e.g. 'October 2026', 'Q3 2024', 'FY26', 'Sprint 42') or null",
  "key_topics": ["3 to 5 short keyword tags (e.g. 'Quota Achievement', 'Discount %', 'Retailer Visits', 'Communication', 'Objection Handling')"]
}"""


def _heuristic_fallback(
    file_name: str,
    file_type: str,
    chunks: List[Dict[str, Any]],
    parsed_metadata: Dict[str, Any],
    detected_period: Optional[str] = None
) -> Dict[str, Any]:
    """Generates a high-quality heuristic summary and category if LLM API is unavailable."""
    fn_lower = file_name.lower()
    cols = [c.lower() for c in parsed_metadata.get("columns_detected", [])]
    total_rows = parsed_metadata.get("total_rows", 0)
    sheet_names = parsed_metadata.get("sheet_names", [])

    # 1. Determine Category
    if any(k in fn_lower or any(k in c for c in cols) for k in ["sales", "kpi", "target", "cases", "quota", "achievement", "retailer", "discount"]):
        category = "Sales KPI Tracker"
    elif any(k in fn_lower for k in ["review", "appraisal", "evaluation", "360", "rating"]):
        category = "Performance Appraisal"
    elif any(k in fn_lower for k in ["1on1", "1-on-1", "one-on-one", "feedback", "coaching", "meeting"]):
        category = "1-on-1 Feedback"
    elif any(k in fn_lower for k in ["sprint", "retro", "retrospective", "backlog"]):
        category = "Sprint Retrospective"
    elif any(k in fn_lower for k in ["training", "onboard", "guide", "playbook", "sop"]):
        category = "Training & Onboarding"
    elif any(k in fn_lower for k in ["policy", "compliance", "disciplinary", "conduct"]):
        category = "Disciplinary & Compliance"
    else:
        category = "Operational Report"

    # 2. Build Summary
    period_str = f" for period {detected_period}" if detected_period else ""
    if file_type in ["xlsx", "xls", "csv"]:
        col_summary = f" Columns include: {', '.join(parsed_metadata.get('columns_detected', [])[:6])}." if cols else ""
        summary = (
            f"Spreadsheet '{file_name}'{period_str} containing {total_rows} recorded entries across sheet tabs ({', '.join(sheet_names[:3])})."
            f"{col_summary} Tracks quantitative performance metrics and operational records."
        )
    else:
        num_chunks = len(chunks)
        summary = (
            f"Document '{file_name}'{period_str} with {num_chunks} parsed content blocks."
            f" Contains qualitative evaluation records and feedback for employee performance coaching."
        )

    # 3. Key Topics
    topics = [category]
    if detected_period:
        topics.append(detected_period)
    if cols:
        topics.extend([c.capitalize() for c in cols[:3]])

    return {
        "summary": summary,
        "category": category,
        "document_period": detected_period,
        "key_topics": topics[:5]
    }


def generate_document_summary_and_category(
    file_name: str,
    file_type: str,
    chunks: List[Dict[str, Any]],
    spreadsheet_rows: Optional[List[Dict[str, Any]]] = None,
    parsed_metadata: Optional[Dict[str, Any]] = None,
    target_employee_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Auto-generates document summary, category tag, and key topics using a lightweight LLM (gpt-4o-mini / gemini).
    Falls back gracefully to deterministic heuristics if API keys are absent or network calls fail.
    """
    metadata = parsed_metadata or {}
    detected_period = metadata.get("document_period")

    # Assemble representative excerpt (up to ~3,500 characters)
    excerpt_parts = []
    
    if target_employee_name:
        excerpt_parts.append(f"Target Employee: {target_employee_name}")
    if detected_period:
        excerpt_parts.append(f"Detected Period: {detected_period}")

    cols = metadata.get("columns_detected", [])
    if cols:
        excerpt_parts.append(f"Detected Table Columns: {', '.join(cols[:20])}")
        
    total_rows = metadata.get("total_rows")
    if total_rows:
        excerpt_parts.append(f"Total Table Rows: {total_rows}")

    # Add first few chunks
    sample_chunks = chunks[:4] if chunks else []
    for idx, c in enumerate(sample_chunks, 1):
        content_snippet = c.get("content", "").strip()[:500]
        if content_snippet:
            excerpt_parts.append(f"--- Sample Content Block {idx} ---\n{content_snippet}")

    # Add sample spreadsheet rows if available
    if spreadsheet_rows:
        sample_rows = spreadsheet_rows[:3]
        rows_text = []
        for r in sample_rows:
            r_data = r.get("row_data", {})
            r_str = " | ".join([f"{k}: {v}" for k, v in list(r_data.items())[:8]])
            if r_str:
                rows_text.append(r_str)
        if rows_text:
            excerpt_parts.append("--- Sample Data Rows ---\n" + "\n".join(rows_text))

    full_excerpt = "\n\n".join(excerpt_parts)[:4000]

    user_prompt = (
        f"File Name: {file_name}\n"
        f"File Type: {file_type}\n\n"
        f"Document Excerpt:\n{full_excerpt}\n\n"
        "Generate the summary, category, period, and key topics in strict JSON format."
    )

    # 1. Try OpenAI (gpt-4o-mini)
    if OPENAI_API_KEY:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=OPENAI_API_KEY)
            
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.2,
                max_tokens=300
            )
            raw_text = response.choices[0].message.content or "{}"
            data = json.loads(raw_text.strip())
            
            if data.get("summary") and data.get("category"):
                print(f"[COACH SUMMARIZER] [OK] Successfully generated summary via gpt-4o-mini for '{file_name}' (Category: {data.get('category')})")
                return {
                    "summary": data.get("summary", "").strip(),
                    "category": data.get("category", "Operational Report").strip(),
                    "document_period": data.get("document_period") or detected_period,
                    "key_topics": data.get("key_topics", [])
                }
        except Exception as e:
            print(f"[COACH SUMMARIZER] OpenAI gpt-4o-mini generation failed: {e}")

    # 2. Try Gemini (gemini-1.5-flash)
    if GEMINI_API_KEY:
        try:
            from google import genai
            from google.genai.types import GenerateContentConfig

            client = genai.Client(api_key=GEMINI_API_KEY)
            config = GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=300,
                response_mime_type="application/json"
            )
            gemini_prompt = f"{SYSTEM_PROMPT}\n\n{user_prompt}"
            res = client.models.generate_content(
                model="gemini-1.5-flash",
                contents=gemini_prompt,
                config=config
            )
            raw_text = res.text or "{}"
            data = json.loads(raw_text.strip())
            if data.get("summary") and data.get("category"):
                print(f"[COACH SUMMARIZER] [OK] Successfully generated summary via gemini-1.5-flash for '{file_name}'")
                return {
                    "summary": data.get("summary", "").strip(),
                    "category": data.get("category", "Operational Report").strip(),
                    "document_period": data.get("document_period") or detected_period,
                    "key_topics": data.get("key_topics", [])
                }
        except Exception as e:
            print(f"[COACH SUMMARIZER] Gemini generation failed: {e}")

    # 3. Deterministic Heuristic Fallback
    print(f"[COACH SUMMARIZER] Using rule-based heuristic summary for '{file_name}'")
    return _heuristic_fallback(file_name, file_type, chunks, metadata, detected_period)
