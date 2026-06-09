import os
import json
import base64
import uuid
from typing import Optional
from datetime import datetime
from utils.supabase_client import supabase
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from fastapi.responses import JSONResponse

# Gemini SDK
from google import genai
from google.genai import types

# OCR service
# OCR + Vision services
from photo_analysis.services.ocr import extract_text
from photo_analysis.services.yolo import detect_objects
from photo_analysis.services.validator import validate_objects_with_task
from photo_analysis.services.scoring import apply_verification_rules
from photo_analysis.services.pose import detect_pose
from photo_analysis.services.clip import validate_image_with_task

router = APIRouter()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY") or "")


class PhotoRequest(BaseModel):
    image: str
    instruction: str
    # Optional identifiers to associate the analysis with a task/submission
    task_id: Optional[str] = None
    assignment_id: Optional[str] = None
    user_id: Optional[str] = None
    company_id: Optional[str] = None


@router.post("/")
async def analyze_photo(payload: PhotoRequest):
    # Accept either data URL (data:image/..) or direct http(s) URL
    image_input = (payload.image or "").strip()
    if not image_input:
        raise HTTPException(status_code=400, detail="Missing image payload")

    image_bytes: Optional[bytes] = None
    mime_type = "image/jpeg"

    try:
        if image_input.startswith("http://") or image_input.startswith("https://"):
            # Fetch remote image
            async with httpx.AsyncClient(timeout=30.0) as client_http:
                resp = await client_http.get(image_input)
                resp.raise_for_status()
                image_bytes = resp.content
                # try to derive mime from headers
                content_type = resp.headers.get("content-type")
                if content_type:
                    mime_type = content_type.split(";")[0]

        elif "," in image_input and image_input.split(",")[0].startswith("data:"):
            # data URL
            base64_data = image_input.split(",", 1)[1]
            image_bytes = base64.b64decode(base64_data)
            # try to get mime type from header
            header = image_input.split(",", 1)[0]
            if header.startswith("data:") and ";" in header:
                mime_type = header.split("data:")[1].split(";")[0]

        else:
            # Try to treat as raw base64 string
            try:
                image_bytes = base64.b64decode(image_input)
            except Exception:
                raise HTTPException(status_code=400, detail="Unsupported image format or invalid data")

        if not image_bytes:
            raise HTTPException(status_code=400, detail="Could not retrieve image bytes")

        # Save image temporarily for OCR and debugging
        tmp_dir = "/tmp/photo_analysis"
        try:
            os.makedirs(tmp_dir, exist_ok=True)
        except Exception:
            pass

        image_id = str(uuid.uuid4())
        # Default to .jpg
        image_path = os.path.join(tmp_dir, f"{image_id}.jpg")
        try:
            with open(image_path, "wb") as f:
                f.write(image_bytes)
        except Exception:
            # If writing fails, continue without OCR file but keep processing
            image_path = None

        # Run OCR (non-blocking to Gemini correctness) and build evidence
        ocr_evidence = {"detected_text": []}

        # YOLO objects
        object_evidence = detect_objects(image_path)

        # CLIP validation
        clip_evidence = validate_image_with_task(
            image_path,
            payload.instruction
        )

        # MediaPipe hand/body detection
        pose_evidence = detect_pose(image_path)

        # Rule validation
        object_validation = validate_objects_with_task(
            payload.instruction,
            object_evidence
    )
        try:
            if image_path:
                ocr_res = extract_text(image_path)
                # Ensure returned structure
                if isinstance(ocr_res, dict):
                    ocr_evidence = ocr_res
                else:
                    ocr_evidence = {"detected_text": []}
            else:
                ocr_evidence = {"detected_text": [], "error": "OCR unavailable"}
        except Exception:
            ocr_evidence = {"detected_text": [], "error": "OCR unavailable"}

        # Build instruction incorporating OCR evidence
        instruction_text = (
    "You are an enterprise task verification AI.\n\n"

    "User Task:\n"
    f"{payload.instruction}\n\n"

    "OCR Evidence:\n"
    f"{json.dumps(ocr_evidence)}\n\n"

    "YOLO Object Detection Evidence:\n"
    f"{json.dumps(object_evidence)}\n\n"

    "CLIP Semantic Match Evidence:\n"
    f"{json.dumps(clip_evidence)}\n\n"

    "Pose / Hand Detection Evidence:\n"
    f"{json.dumps(pose_evidence)}\n\n"

    "Object Validation Result:\n"
    f"{json.dumps(object_validation)}\n\n"

    "Analyze image + OCR + YOLO evidence together.\n\n"

    "Rules:\n"
    "- Image understanding is primary\n"
    "- YOLO detected objects are strong evidence\n"
    "- If required object is missing, fail submission\n"
    "- If wrong object is present, reject\n"
    "- Explain missing requirements clearly\n"
    "- Use pose evidence for left/right hand validation\n"
    "- If required hand side is wrong, reject\n"
    "- If required expression/action missing, reject\n\n"

    "Return STRICT JSON ONLY:\n"
    "{\n"
    " \"passed\": true/false,\n"
    " \"score\": 0-100,\n"
    " \"feedback\": \"short explanation\"\n"
    "}\n"
)

        # Call Gemini Vision via generate_content
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=mime_type,
                ),
                types.Part(text=instruction_text),
            ]
        )

        # The SDK usually exposes text on response.text
        result_text = getattr(response, "text", None) or None
        if not result_text:
            # Try JSON attribute
            try:
                return JSONResponse(content=json.loads(response))
            except Exception:
                raise HTTPException(status_code=500, detail="Empty response from Gemini")

        # Parse JSON from model text
        try:
            parsed = json.loads(result_text)
            parsed = apply_verification_rules(
                parsed,
                object_validation
        )
        except Exception:
            # Try to extract JSON substring
            try:
                start = result_text.find('{')
                end = result_text.rfind('}')
                if start != -1 and end != -1:
                    parsed = json.loads(result_text[start:end+1])
                else:
                    raise
            except Exception:
                raise HTTPException(status_code=500, detail="Unable to parse Gemini response as JSON")

        # Persist AI report to Supabase (lightweight report table)
        try:
            report_row = {
                "image_input": (image_input[:2000] + "...") if len(image_input) > 2000 else image_input,
                "instruction": payload.instruction,
                "task_id": payload.task_id,
                "assignment_id": payload.assignment_id,
                "user_id": payload.user_id,
                "company_id": payload.company_id,
                "passed": parsed.get("passed") if isinstance(parsed, dict) else None,
                "score": parsed.get("score") if isinstance(parsed, dict) else None,
                "feedback": parsed.get("feedback") if isinstance(parsed, dict) else None,
                "raw_response": parsed,
                "evidence": {"ocr": ocr_evidence},
                "created_at": datetime.utcnow().isoformat(),
            }

            # Insert into a table named `photo_analysis_reports`. Ensure this table exists in Supabase.
            try:
                sup_res = supabase.table("photo_analysis_reports").insert(report_row).execute()
                # If the insert returns data, attach insertion result id for debug
                if getattr(sup_res, "data", None):
                    report_row["saved"] = True
                    report_row["saved_rows"] = sup_res.data
                else:
                    report_row["saved"] = False
                    report_row["error"] = getattr(sup_res, "error", None)
            except Exception as sup_exc:
                # Don't fail the whole request if DB insert fails; log and continue
                print(f"[photo_analysis] Supabase insert failed: {sup_exc}")
                report_row["saved"] = False
                report_row["error"] = str(sup_exc)

        except Exception as exc_insert:
            print(f"[photo_analysis] report persistence error: {exc_insert}")

        # Attach OCR evidence to the returned response while keeping
        # top-level keys ('passed', 'score', 'feedback') intact for
        # backward compatibility with the frontend.
        try:
            if isinstance(parsed, dict):
                parsed.setdefault("evidence", {})
                parsed["evidence"]["ocr"] = ocr_evidence
                parsed["evidence"]["objects"] = object_evidence
                parsed["evidence"]["clip"] = clip_evidence
                parsed["evidence"]["validation"] = object_validation
                parsed["evidence"]["pose"] = pose_evidence
        except Exception:
            # If merging evidence fails for any reason, continue and
            # return the original parsed response to avoid breaking
            # the client.
            try:
                print("[photo_analysis] failed to attach OCR evidence to response")
            except Exception:
                pass

        return JSONResponse(content=parsed)

    except HTTPException:
        raise
    except Exception as exc:
        # Log and return error
        try:
            print(f"[photo_analysis] error: {exc}")
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=str(exc))
