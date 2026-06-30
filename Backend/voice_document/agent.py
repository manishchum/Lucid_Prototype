import asyncio
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from google import genai  # type: ignore
except Exception:  # pragma: no cover - optional dependency guard
    genai = None


VOICE_DOCUMENT_TYPES = [
    "meeting_minutes",
    "action_item_tracker",
    "status_report",
    "project_update",
    "training_notes",
    "follow_up_summary",
    "risk_register",
    "task_tracker",
    "business_report",
    "general_summary",
]


@dataclass
class VoiceDocumentDraft:
    transcript: str
    document_type: str
    suggested_title: str
    structured_json: Dict[str, Any]
    renderable_content: Dict[str, Any]
    output_format: str
    model_used: str


class VoiceDocumentAgent:
    """
    Lightweight agent orchestrator for the voice-to-document workflow.

    The repo does not currently ship the Google ADK package, so this class is
    implemented as an ADK-shaped backend orchestrator using Gemini SDK calls.
    It keeps the workflow separated into tool-like methods so we can swap the
    internals to ADK later without changing the route contract.
    """

    def __init__(self) -> None:
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is required for voice document processing")

        if genai is None:
            raise RuntimeError("google.genai is not available in this backend environment")

        self.client = genai.Client(api_key=api_key)
        self.model_name = os.getenv("VOICE_DOCUMENT_MODEL") or "gemini-2.5-flash"

    @staticmethod
    def _clean_json_text(raw_text: str) -> str:
        text = (raw_text or "").strip()
        if not text:
            return text

        if text.startswith("```"):
            start = text.find("\n")
            if start != -1:
                end = text.rfind("```")
                if end > start:
                    text = text[start:end].strip()

        first = text.find("{")
        last = text.rfind("}")
        if first != -1 and last != -1 and last > first:
            text = text[first:last + 1]

        return text.strip()

    @staticmethod
    def _safe_json_loads(raw_text: str) -> Optional[Dict[str, Any]]:
        cleaned = VoiceDocumentAgent._clean_json_text(raw_text)
        if not cleaned:
            return None

        try:
            parsed = json.loads(cleaned)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None

    @staticmethod
    def _sentence_split(text: str) -> List[str]:
        pieces = re.split(r"(?<=[.!?])\s+", (text or "").strip())
        return [piece.strip() for piece in pieces if piece.strip()]

    @staticmethod
    def _heuristic_classification(transcript: str, output_format: str) -> str:
        text = (transcript or "").lower()

        scores = {
            "meeting_minutes": len(re.findall(r"\b(meeting|minutes|discussed|attendees|agenda)\b", text)),
            "action_item_tracker": len(re.findall(r"\b(will|please|assign|owner|due|deadline|follow up|follow-up)\b", text)),
            "status_report": len(re.findall(r"\b(status|progress|blocked|completed|on track|at risk)\b", text)),
            "project_update": len(re.findall(r"\b(project|timeline|milestone|release|launch)\b", text)),
            "training_notes": len(re.findall(r"\b(training|learn|lesson|module|exercise)\b", text)),
            "follow_up_summary": len(re.findall(r"\b(follow up|follow-up|next step|next steps)\b", text)),
            "risk_register": len(re.findall(r"\b(risk|issue|concern|mitigation)\b", text)),
            "task_tracker": len(re.findall(r"\b(task|todo|to-do|action item|action items)\b", text)),
            "business_report": len(re.findall(r"\b(report|revenue|finance|budget|analysis)\b", text)),
            "general_summary": 1,
        }

        if output_format.lower() == "xlsx":
            scores["action_item_tracker"] += 2
            scores["task_tracker"] += 2
            scores["risk_register"] += 1
            scores["status_report"] += 1

        return max(scores.items(), key=lambda item: item[1])[0]

    @staticmethod
    def _heuristic_title(transcript: str, document_type: str) -> str:
        first_sentence = VoiceDocumentAgent._sentence_split(transcript)[:1]
        if first_sentence:
            base = re.sub(r"\s+", " ", first_sentence[0]).strip()
            base = base[:90]
        else:
            base = "Voice Document"

        type_label = document_type.replace("_", " ").title()
        return f"{type_label}: {base}" if base else type_label

    @staticmethod
    def _derive_sections(transcript: str) -> List[Dict[str, Any]]:
        sentences = VoiceDocumentAgent._sentence_split(transcript)
        if not sentences:
            return []

        chunks: List[List[str]] = []
        chunk: List[str] = []
        for sentence in sentences:
            chunk.append(sentence)
            if len(chunk) >= 3:
                chunks.append(chunk)
                chunk = []
        if chunk:
            chunks.append(chunk)

        sections: List[Dict[str, Any]] = []
        for index, chunk_sentences in enumerate(chunks, start=1):
            sections.append(
                {
                    "heading": f"Section {index}",
                    "body": " ".join(chunk_sentences).strip(),
                    "bullets": chunk_sentences,
                }
            )
        return sections

    @staticmethod
    def _extract_action_items(transcript: str) -> List[Dict[str, Any]]:
        action_items: List[Dict[str, Any]] = []
        sentences = VoiceDocumentAgent._sentence_split(transcript)

        for sentence in sentences:
            owner_match = re.search(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b", sentence)
            due_match = re.search(
                r"\b(by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|next week|this week|[A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?))\b",
                sentence,
                re.IGNORECASE,
            )
            task_text = sentence.strip()
            if any(keyword in sentence.lower() for keyword in [" will ", " needs to ", " should ", " please ", " by "]):
                action_items.append(
                    {
                        "owner": owner_match.group(1) if owner_match else None,
                        "task": task_text,
                        "due_date": due_match.group(1) if due_match else None,
                        "status": "open",
                    }
                )

        return action_items

    @staticmethod
    def _extract_risks(transcript: str) -> List[Dict[str, Any]]:
        risks: List[Dict[str, Any]] = []
        for sentence in VoiceDocumentAgent._sentence_split(transcript):
            if re.search(r"\b(risk|issue|blocked|delay|delay(ed)?|concern|problem)\b", sentence, re.IGNORECASE):
                risks.append(
                    {
                        "risk": sentence.strip(),
                        "mitigation": None,
                        "owner": None,
                    }
                )
        return risks

    @staticmethod
    def _extract_follow_ups(transcript: str) -> List[str]:
        follow_ups: List[str] = []
        for sentence in VoiceDocumentAgent._sentence_split(transcript):
            if re.search(r"\b(follow up|follow-up|next step|next steps|revisit|circle back)\b", sentence, re.IGNORECASE):
                follow_ups.append(sentence.strip())
        return follow_ups

    def _call_model_text(self, prompt: str) -> str:
        response = self.client.models.generate_content(
            model=self.model_name,
            contents=prompt,
        )
        return (getattr(response, "text", "") or "").strip()

    async def transcribe_audio(self, audio_path: str) -> str:
        audio_file = self.client.files.upload(file=audio_path)

        prompt = (
            "You are transcribing a business voice note.\n"
            "Return only the verbatim transcription text.\n"
            "Preserve names, dates, deadlines, numbers, and company names.\n"
            "Do not summarize or classify.\n"
        )

        def _run() -> str:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=[prompt, audio_file],
            )
            return (getattr(response, "text", "") or "").strip()

        transcript = await asyncio.to_thread(_run)
        if not transcript:
            raise RuntimeError("No transcription text was returned by the model")
        return transcript

    async def classify_document(self, transcript: str, output_format: str) -> Dict[str, Any]:
        prompt = f"""
You are the VoiceDocumentAgent document classifier.

Choose the best document type for the transcript from this exact list:
{json.dumps(VOICE_DOCUMENT_TYPES)}

The user selected output format is: {output_format.upper()}.
Output JSON only with this structure:
{{
  "document_type": "meeting_minutes",
  "document_type_label": "Meeting Minutes",
  "suggested_title": "A short professional title",
  "confidence": 0.0,
  "reasoning": "Short explanation"
}}

Transcript:
{transcript}
""".strip()

        def _run() -> Dict[str, Any]:
            raw = self._call_model_text(prompt)
            parsed = self._safe_json_loads(raw)
            if parsed:
                return parsed

            return {
                "document_type": self._heuristic_classification(transcript, output_format),
                "document_type_label": self._heuristic_classification(transcript, output_format).replace("_", " ").title(),
                "suggested_title": self._heuristic_title(transcript, self._heuristic_classification(transcript, output_format)),
                "confidence": 0.5,
                "reasoning": "Heuristic fallback classification",
            }

        return await asyncio.to_thread(_run)

    async def structure_document(
        self,
        transcript: str,
        output_format: str,
        document_type: str,
        suggested_title: str,
    ) -> Dict[str, Any]:
        prompt = f"""
You are the VoiceDocumentAgent structuring engine.

Convert the transcript into a professional business document draft.

Requirements:
- Use the document type: {document_type}
- Output format: {output_format.upper()}
- Return raw JSON only.
- Make the result editable and practical for human review.
- Do not generate a final DOCX/XLSX file yet.

Produce the following JSON keys:
{{
  "suggested_title": "string",
  "document_type": "one of {json.dumps(VOICE_DOCUMENT_TYPES)}",
  "summary": "string",
  "key_people": ["string"],
  "key_companies": ["string"],
  "important_dates": ["string"],
  "deadlines": ["string"],
  "decisions": ["string"],
  "action_items": [
    {{
      "owner": "string|null",
      "task": "string",
      "due_date": "string|null",
      "status": "open"
    }}
  ],
  "risks": [
    {{
      "risk": "string",
      "mitigation": "string|null",
      "owner": "string|null"
    }}
  ],
  "follow_ups": ["string"],
  "sections": [
    {{
      "heading": "string",
      "body": "string",
      "bullets": ["string"]
    }}
  ],
  "tables": [
    {{
      "name": "string",
      "columns": ["string"],
      "rows": [["string"]]
    }}
  ]
}}

Transcript:
{transcript}
""".strip()

        def _run() -> Dict[str, Any]:
            raw = self._call_model_text(prompt)
            parsed = self._safe_json_loads(raw)
            if parsed:
                return parsed

            fallback_document_type = self._heuristic_classification(transcript, output_format)
            action_items = self._extract_action_items(transcript)
            risks = self._extract_risks(transcript)
            follow_ups = self._extract_follow_ups(transcript)
            sections = self._derive_sections(transcript)

            tables: List[Dict[str, Any]] = []
            if output_format.lower() == "xlsx":
                if action_items:
                    tables.append(
                        {
                            "name": "Action Items",
                            "columns": ["Task", "Owner", "Due Date", "Status"],
                            "rows": [
                                [
                                    item.get("task") or "",
                                    item.get("owner") or "",
                                    item.get("due_date") or "",
                                    item.get("status") or "",
                                ]
                                for item in action_items
                            ],
                        }
                    )
                if risks:
                    tables.append(
                        {
                            "name": "Risks",
                            "columns": ["Risk", "Mitigation", "Owner"],
                            "rows": [
                                [risk.get("risk") or "", risk.get("mitigation") or "", risk.get("owner") or ""]
                                for risk in risks
                            ],
                        }
                    )

            return {
                "suggested_title": suggested_title,
                "document_type": fallback_document_type,
                "summary": "Auto-generated business draft based on the uploaded voice note.",
                "key_people": [],
                "key_companies": [],
                "important_dates": [],
                "deadlines": [],
                "decisions": [],
                "action_items": action_items,
                "risks": risks,
                "follow_ups": follow_ups,
                "sections": sections,
                "tables": tables,
            }

        return await asyncio.to_thread(_run)

    @staticmethod
    def build_renderable_content(structured_json: Dict[str, Any], output_format: str) -> Dict[str, Any]:
        output_format = output_format.lower().strip()

        sections = structured_json.get("sections") or []
        action_items = structured_json.get("action_items") or []
        risks = structured_json.get("risks") or []
        decisions = structured_json.get("decisions") or []
        follow_ups = structured_json.get("follow_ups") or []

        if output_format == "xlsx":
            sheets: List[Dict[str, Any]] = []

            if action_items:
                sheets.append(
                    {
                        "name": "Action Items",
                        "columns": ["Task", "Owner", "Due Date", "Status"],
                        "rows": [
                            [
                                item.get("task") or "",
                                item.get("owner") or "",
                                item.get("due_date") or "",
                                item.get("status") or "",
                            ]
                            for item in action_items
                        ],
                    }
                )

            if risks:
                sheets.append(
                    {
                        "name": "Risks",
                        "columns": ["Risk", "Mitigation", "Owner"],
                        "rows": [
                            [risk.get("risk") or "", risk.get("mitigation") or "", risk.get("owner") or ""]
                            for risk in risks
                        ],
                    }
                )

            if decisions:
                sheets.append(
                    {
                        "name": "Decisions",
                        "columns": ["Decision"],
                        "rows": [[decision] for decision in decisions],
                    }
                )

            if follow_ups:
                sheets.append(
                    {
                        "name": "Follow Ups",
                        "columns": ["Follow Up"],
                        "rows": [[item] for item in follow_ups],
                    }
                )

            if not sheets:
                sheets.append(
                    {
                        "name": "Summary",
                        "columns": ["Summary"],
                        "rows": [[structured_json.get("summary") or ""]],
                    }
                )

            return {
                "type": "xlsx",
                "sheets": sheets,
            }

        return {
            "type": "docx",
            "title": structured_json.get("suggested_title") or "Voice Document Draft",
            "sections": sections or [
                {
                    "heading": "Summary",
                    "body": structured_json.get("summary") or "",
                    "bullets": [],
                }
            ],
            "tables": structured_json.get("tables") or [],
            "action_items": action_items,
            "risks": risks,
            "follow_ups": follow_ups,
        }

    async def process_audio_file(self, audio_path: str, output_format: str) -> VoiceDocumentDraft:
        transcript = await self.transcribe_audio(audio_path)
        classification = await self.classify_document(transcript, output_format)
        suggested_title = classification.get("suggested_title") or self._heuristic_title(
            transcript,
            classification.get("document_type") or "general_summary",
        )
        document_type = classification.get("document_type") or self._heuristic_classification(transcript, output_format)

        structured_json = await self.structure_document(
            transcript=transcript,
            output_format=output_format,
            document_type=document_type,
            suggested_title=suggested_title,
        )

        structured_json["document_type"] = document_type
        structured_json["suggested_title"] = structured_json.get("suggested_title") or suggested_title
        structured_json["classification"] = classification
        structured_json["transcript"] = transcript

        renderable_content = self.build_renderable_content(structured_json, output_format)

        structured_json["renderable_content"] = renderable_content

        return VoiceDocumentDraft(
            transcript=transcript,
            document_type=document_type,
            suggested_title=suggested_title,
            structured_json=structured_json,
            renderable_content=renderable_content,
            output_format=output_format.lower().strip(),
            model_used=self.model_name,
        )
          