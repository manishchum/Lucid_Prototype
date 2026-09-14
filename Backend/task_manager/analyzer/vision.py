from PIL import Image
import torch
from transformers import CLIPProcessor, CLIPModel


# load once
model = CLIPModel.from_pretrained(
    "openai/clip-vit-base-patch32"
)

processor = CLIPProcessor.from_pretrained(
    "openai/clip-vit-base-patch32"
)


def validate_image_with_task(image_path: str, task: str):

    try:
        image = Image.open(image_path)

        labels = [
            task,
            "unrelated image",
            "random selfie",
            "wrong object"
        ]

        inputs = processor(
            text=labels,
            images=image,
            return_tensors="pt",
            padding=True
        )

        with torch.no_grad():
            outputs = model(**inputs)

        scores = outputs.logits_per_image.softmax(dim=1)

        confidence = float(scores[0][0])

        return {
            "clip_score": round(confidence, 4),
            "matched": confidence >= 0.50,
            "reason": (
                "Image matches task"
                if confidence >= 0.50
                else "Image does not match task"
            )
        }

    except Exception as e:

        print("CLIP ERROR:", e)

        return {
            "clip_score": 0,
            "matched": False,
            "error": str(e)
        }
import traceback
from typing import Any, Dict, List
import os
import uuid
import tempfile

try:
    import easyocr
except Exception:
    easyocr = None

try:
    import cv2
except Exception:
    cv2 = None

try:
    # rapidfuzz may already be in requirements; import defensively
    from rapidfuzz import process as rf_process
    from rapidfuzz import fuzz as rf_fuzz
except Exception:
    rf_process = None
    rf_fuzz = None


def _apply_preprocessing(img):
    """Apply grayscale, CLAHE, denoise, and sharpening to a cv2 image."""
    # Convert to grayscale
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    # CLAHE for contrast limited adaptive histogram equalization
    try:
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)
    except Exception:
        # If CLAHE fails, continue with original gray
        pass

    # Denoise - using fastNlMeansDenoising
    try:
        gray = cv2.fastNlMeansDenoising(gray, None, h=10, templateWindowSize=7, searchWindowSize=21)
    except Exception:
        try:
            gray = cv2.GaussianBlur(gray, (3, 3), 0)
        except Exception:
            pass

    # Sharpen: kernel
    try:
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        # Unsharp masking
        blurred = cv2.GaussianBlur(gray, (0, 0), sigmaX=1.0)
        sharpened = cv2.addWeighted(gray, 1.5, blurred, -0.5, 0)
        return sharpened
    except Exception:
        return gray


def preprocess_image(image_path: str) -> List[str]:
    """Create multiple preprocessed image variants and return their paths.

    Variants:
      - original
      - rotated 90 CW
      - rotated 90 CCW
      - rotated 180

    Each variant is processed with grayscale, CLAHE, denoise, sharpen and saved
    to a temporary file. Returns list of file paths.
    """
    processed_paths: List[str] = []

    if cv2 is None:
        # Cannot preprocess without OpenCV; return original path
        return [image_path]

    try:
        img = cv2.imread(image_path)
        if img is None:
            return [image_path]

        # Define rotations in degrees
        rotations = [0, 90, -90, 180]

        tmp_dir = os.path.join(tempfile.gettempdir(), "photo_analysis")
        try:
            os.makedirs(tmp_dir, exist_ok=True)
        except Exception:
            pass

        for deg in rotations:
            try:
                if deg == 0:
                    cand = img.copy()
                else:
                    # Rotate around center
                    (h, w) = img.shape[:2]
                    center = (w // 2, h // 2)
                    M = cv2.getRotationMatrix2D(center, deg, 1.0)
                    cand = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

                proc = _apply_preprocessing(cand)

                # Save to temp file
                fname = f"ocr_{uuid.uuid4().hex}_{deg}.png"
                fpath = os.path.join(tmp_dir, fname)
                # Ensure image is uint8
                try:
                    if proc.dtype != 'uint8':
                        proc = proc.astype('uint8')
                except Exception:
                    pass
                cv2.imwrite(fpath, proc)
                processed_paths.append(fpath)
            except Exception:
                # If a rotation fails, skip it
                try:
                    traceback.print_exc()
                except Exception:
                    pass
                continue

        # Ensure at least the original is present
        if not processed_paths:
            return [image_path]

        return processed_paths
    except Exception:
        try:
            traceback.print_exc()
        except Exception:
            pass
        return [image_path]


def clean_ocr_results(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Clean OCR results by removing garbage and applying fuzzy corrections.

    Steps:
    - remove specific symbols
    - strip whitespace
    - drop short detections (<3 chars)
    - drop detections with low alphabet ratio (<0.6)
    - apply fuzzy correction from a small known-phrases dictionary
    """
    cleaned: List[Dict[str, Any]] = []

    # Common correction mapping
    corrections = {
        "2 bold": "Be bold",
        "b bold": "Be bold",
        "ith purpose": "with purpose",
        "himpact": "impact",
        "TANT": "IMPORTANT",
    }

    # Precompute correction keys for fuzzy matching
    correction_keys = list(corrections.keys())

    for item in results:
        text = item.get("text", "")
        conf = float(item.get("confidence", 0.0) or 0.0)

        if not isinstance(text, str):
            continue

        # Remove symbols
        for ch in [":", ";", "|", "[", "]", "{", "}"]:
            text = text.replace(ch, "")

        text = text.strip()

        # Drop short
        if len(text) < 3:
            continue

        # Alphabet ratio filter
        alpha_chars = sum(1 for c in text if c.isalpha())
        ratio = alpha_chars / max(len(text), 1)
        if ratio < 0.6:
            continue

        # Apply fuzzy correction if rapidfuzz available
        if rf_process is not None and correction_keys:
            try:
                match, score, _ = rf_process.extractOne(text, correction_keys, scorer=rf_fuzz.ratio)
                # rapidfuzz returns score in 0-100 scale
                if score and score >= 75:
                    corrected = corrections.get(match)
                    if corrected:
                        text = corrected
            except Exception:
                try:
                    traceback.print_exc()
                except Exception:
                    pass

        cleaned.append({"text": text, "confidence": round(conf, 4)})

    return cleaned


def extract_text(image_path: str) -> Dict[str, Any]:
    """Extract text from image using EasyOCR with preprocessing.

    Runs OCR on multiple preprocessed variants and selects the candidate with
    the highest average confidence. Filters out short/low-confidence results.
    """
    # If easyocr missing, keep API stable
    if easyocr is None:
        return {"detected_text": [], "error": "OCR unavailable"}

    try:
        reader = easyocr.Reader(["en"], gpu=False)

        candidates = preprocess_image(image_path)

        best_candidate: List[Dict[str, Any]] = []
        best_avg_conf = -1.0

        for cand_path in candidates:
            try:
                results = reader.readtext(cand_path)
            except Exception:
                # If OCR fails for this variant, skip
                try:
                    traceback.print_exc()
                except Exception:
                    pass
                continue

            detected = []
            confidences = []
            for res in results:
                try:
                    text = res[1]
                    confidence = float(res[2]) if len(res) > 2 else 0.0
                except Exception:
                    text = str(res)
                    confidence = 0.0

                # Filter garbage: length and confidence thresholds
                if not isinstance(text, str):
                    continue
                if len(text.strip()) < 2:
                    continue
                if confidence < 0.3:
                    continue

                detected.append({"text": text.strip(), "confidence": round(confidence, 4)})
                confidences.append(confidence)

            avg_conf = (sum(confidences) / len(confidences)) if confidences else 0.0

            if avg_conf > best_avg_conf and detected:
                best_avg_conf = avg_conf
                best_candidate = detected

        # If we found detections, run cleaning and fuzzy correction,
        # then return the cleaned best set
        if best_candidate:
            try:
                cleaned = clean_ocr_results(best_candidate)
                return {"detected_text": cleaned}
            except Exception:
                # On any cleaning error, return raw best candidate
                try:
                    traceback.print_exc()
                except Exception:
                    pass
                return {"detected_text": best_candidate}

        # If no detections across variants, return empty list
        return {"detected_text": []}

    except Exception:
        # Keep API stable on unexpected errors
        try:
            traceback.print_exc()
        except Exception:
            pass
        return {"detected_text": [], "error": "OCR unavailable"}


"""MediaPipe-based pose/hand detection with graceful degradation.

If `mediapipe` or `cv2` are not installed in the environment we avoid
raising at import time so the app can start. The `detect_pose` function
returns a JSON-serializable dict containing either detection results or
an `error` field explaining why detection is unavailable.
"""

from typing import Dict, Any

try:
    import cv2
except Exception:  # pragma: no cover - environment dependent
    cv2 = None

try:  # mediapipe may be heavy or optional in some deploys
    import mediapipe as mp  # type: ignore
    mp_hands = mp.solutions.hands
    # load once
    _hands_model = mp_hands.Hands(
        static_image_mode=True,
        max_num_hands=2,
        min_detection_confidence=0.5,
    )
except Exception:  # pragma: no cover - environment dependent
    mp = None
    _hands_model = None


def detect_pose(image_path: str) -> Dict[str, Any]:
    """Detect left/right hands using MediaPipe.

    Returns a JSON-safe dict. If dependencies are missing or the image
    cannot be read, returns an `error` key explaining the problem.
    """

    if mp is None or _hands_model is None:
        return {
            "hands": [],
            "error": "mediapipe not installed or not available in this environment"
        }

    if cv2 is None:
        return {
            "hands": [],
            "error": "opencv (cv2) not installed or not available in this environment"
        }

    try:
        image = cv2.imread(image_path)

        if image is None:
            return {
                "hands": [],
                "error": "image not readable"
            }

        # OpenCV BGR -> RGB
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        results = _hands_model.process(rgb)

        detected_hands = []

        if getattr(results, "multi_handedness", None):
            for hand in results.multi_handedness:
                info = hand.classification[0]
                detected_hands.append(
                    {
                        "side": info.label,  # Left / Right
                        "confidence": round(float(info.score), 4),
                    }
                )

        return {"hands": detected_hands}

    except Exception as e:
        # Don't crash the import or caller; return an informative error
        try:
            print("POSE ERROR:", e)
        except Exception:
            pass
        return {"hands": [], "error": "Pose unavailable"}
def apply_verification_rules(ai_result, object_validation):
    """
    Final authority layer after Gemini.
    """

    if not object_validation.get("object_check_passed", True):

        ai_result["passed"] = False

        ai_result["score"] = min(
            ai_result.get("score", 0),
            40
        )

        ai_result["feedback"] = (
            object_validation.get("reason")
            or ai_result.get("feedback")
        )

    return ai_result
def validate_objects_with_task(instruction: str, object_evidence: dict):

    instruction = instruction.lower()

    detected_objects = [
        obj["label"].lower()
        for obj in object_evidence.get("objects", [])
    ]


    # YOLO names mapping
    aliases = {
        "phone": "cell phone",
        "mobile": "cell phone",
        "smartphone": "cell phone",
        "water bottle": "bottle",
        "teddy": "teddy bear",
    }


    required_objects = []


    detectable_items = [
        "bottle",
        "cell phone",
        "laptop",
        "book",
        "cup",
        "chair",
        "person",
        "teddy bear",
    ]


    # find required object from task
    for item in detectable_items:
        if item in instruction:
            required_objects.append(item)


    # alias matching
    for word, mapped in aliases.items():
        if word in instruction:
            required_objects.append(mapped)


    required_objects = list(set(required_objects))


    missing = []

    for obj in required_objects:
        if obj not in detected_objects:
            missing.append(obj)


    return {
        "required_objects": required_objects,
        "detected_objects": detected_objects,
        "missing_objects": missing,
        "object_check_passed": len(missing) == 0
    }
from .models import yolo_model, whisper_pipeline, bge_model
def detect_objects(image_path: str):
    """
    Detect objects from image using YOLO.
    Always return safe JSON.
    """

    try:
        results = model(image_path)

        objects = []

        for result in results:
            for box in result.boxes:

                confidence = float(box.conf[0])

                # ignore weak detections
                if confidence < 0.25:
                    continue

                class_id = int(box.cls[0])
                label = result.names[class_id]

                objects.append({
                    "label": label,
                    "confidence": round(confidence, 4)
                })

        return {
            "objects": objects
        }

    except Exception as e:
        print("YOLO ERROR:", e)

        return {
            "objects": [],
            "error": "YOLO unavailable"
        }
import subprocess
import uuid
import os


def extract_audio(video_path):

    output_path = f"/tmp/{uuid.uuid4()}.wav"


    command = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        output_path
    ]


    subprocess.run(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )


    if not os.path.exists(output_path):
        raise Exception(
            "Audio extraction failed"
        )


    return output_path
import cv2


def extract_frames(video_path, max_frames=20):

    cap = cv2.VideoCapture(video_path)

    total_frames = int(
        cap.get(cv2.CAP_PROP_FRAME_COUNT)
    )

    frames = []


    # sample throughout full video
    indexes = [

        int(i * total_frames / max_frames)

        for i in range(max_frames)

    ]


    for idx in indexes:

        cap.set(
            cv2.CAP_PROP_POS_FRAMES,
            idx
        )

        success, frame = cap.read()


        if success:

            _, buffer = cv2.imencode(
                ".jpg",
                frame
            )

            frames.append(
                buffer.tobytes()
            )


    cap.release()


    print(
        "VIDEO FRAMES SENT:",
        len(frames)
    )


    return frames
import os
import json

from dotenv import load_dotenv

from google import genai
from google.genai import types


load_dotenv()


client = genai.Client(
    api_key=os.getenv(
        "GEMINI_API_KEY"
    )
)

import time
from .gemini_usage import extract_gemini_usage



def analyze_video_frames(
        frames,
        task_description
):


    prompt = f"""
You are an employee performance evaluator.

Analyze these video frames for the employee task.

Task:
{task_description}


IMPORTANT RULES:
- A person may appear in a small part of the frame.
- A person may appear along with slides, screen, product, or objects.
- If ANY human face/body/person is visible in ANY frame, person_visible MUST be true.
- Do NOT mark person_visible false just because slides or animations are present.
- Evaluate the visible employee only.


Return ONLY valid JSON:

{{
 "task_completed": true/false,

 "person_visible": true/false,

 "visual_score": 0-100,

 "eye_contact_score":0-100,

 "body_language_score":0-100,

 "professionalism_score":0-100,

 "engagement_score":0-100,


 "strengths":[
 ],

 "weaknesses":[
 ],

 "feedback":""
}}


Scoring:
- visual_score means how well the employee performed the task visually.
- eye_contact_score means looking towards camera/audience.
- body_language_score means posture, gestures, confidence.
- professionalism_score means appearance and presentation.
- engagement_score means energy and involvement.

If employee is visible:
Never return all visual scores as 0.
"""


    content = [
        prompt
    ]


    for frame in frames:

        content.append(

            types.Part.from_bytes(
                data=frame,
                mime_type="image/jpeg"
            )

        )



    start_time = time.time()
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=content
    )
    end_time = time.time()

    usage = extract_gemini_usage(response, "gemini-2.5-flash", start_time, end_time)
    print(f"\n========== GEMINI USAGE: vision.py (analyze_video_frames) ==========")
    print(f"Model: {usage['model']} | Duration: {usage['duration_ms']}ms")
    print(f"Tokens: Input {usage['prompt_tokens']} | Output {usage['output_tokens']} | Total {usage['total_tokens']}")
    if usage['pricing_available']:
        print(f"Cost: ${usage['total_cost_usd']} | INR ₹{usage['total_cost_inr']}")
    print("====================================================================\n")



    clean = (
        response.text
        .replace("```json","")
        .replace("```","")
        .strip()
    )


    return json.loads(clean)

# from fastapi import (
#     APIRouter,
#     UploadFile,
#     File,
#     Form,
#     Depends
# )

# import tempfile
# import os
# from typing import Dict, Any

# 
# 

# from utils.auth import get_request_auth_required
# from utils.supabase_client import supabase


# router = APIRouter(prefix="/api/video-analysis", tags=["Video Analysis"])


# @router.post("/submit")
# async def submit_video_task(
#     task_id: str = Form(...),
#     video: UploadFile = File(...),
#     auth = Depends(get_request_auth_required),
# ):
#     """Endpoint to accept an uploaded video, analyze it, and store the AI result."""

#     # save temp video
#     suffix = video.filename.split(".")[-1]
#     with tempfile.NamedTemporaryFile(delete=False, suffix=f".{suffix}") as tmp:
#         tmp.write(await video.read())
#         video_path = tmp.name

#     # get task details (graceful if missing)
#     from utils.task_resolver import resolve_task_details
#     task = resolve_task_details(task_id, auth.company_id)
#     task_description = task.get("description", "")

#     resolved_task_id = task.get("parent_task_id") or task_id
#     db_answers = []
#     if task.get("parent_task_id"):
#         db_answers.append({"child_task_id": task_id})

#     result = analyze_video(video_path, task_description)

#     # save result
#     supabase.table("task_submissions").insert(
#         {
#             "task_id": resolved_task_id,
#             "user_id": auth.user_id,
#             "submission_type": "video",
#             "score": result.get("overall_score", 0),
#             "ai_analysis": result,
#             "status": "completed",
#             "answers": db_answers,
#         }
#     ).execute()

#     try:
#         os.remove(video_path)
#     except Exception:
#         pass

#     return result


# def analyze_video(video_path: str, task_description: str) -> Dict[str, Any]:
#     """Extract frames from a video and call the gemini analyzer.

#     Returns the parsed JSON result as a dict. Ensures an `overall_score` key exists.
#     """

#     frames = extract_frames(video_path, max_frames=20)
#     result = analyze_video_frames(frames, task_description)

#     if isinstance(result, dict) and "overall_score" not in result:
#         vs = result.get("visual_score") or 0
#         try:
#             result["overall_score"] = int(vs)
#         except Exception:
#             result["overall_score"] = 0

#     return result
import os
import json

from google import genai
from google.genai import types

# Import the FULL photo_analysis services pipeline








def _get_gemini_client():
    api_key = os.getenv("GEMINI_API_KEY") or ""
    if not api_key:
        return None
    return genai.Client(api_key=api_key)


def analyze_image(image_path: str, instruction: str) -> dict:
    """
    Full image analysis pipeline using photo_analysis services.

    Flow:
      1. YOLO   → detect objects
      2. CLIP   → semantic similarity with task
      3. Pose   → hand/body detection
      4. Validator → check required objects vs detected
      5. OCR    → extract text from image
      6. Build compact evidence context (text only)
      7. Send evidence to Gemini → get pass/fail/score/feedback
      8. Apply scoring verification rules as final authority

    Only a small text summary (~200-500 tokens) goes to Gemini.
    No image bytes are sent.
    """

    if not os.path.exists(image_path):
        return {
            "overall_score": 0,
            "metrics": {
                "detected_objects": [],
                "clip_similarity": 0.0,
                "score": 0,
                "issues": ["Image file not found on disk."],
                "recommendations": ["Re-upload image file."]
            },
            "strengths": [],
            "weaknesses": ["Media file missing."],
            "detected_issues": ["Image file not found on disk."],
            "improvement_points": ["Re-upload image file."],
            "model_output": {}
        }

    # ──────────────────────────────────────────────
    # 1. YOLO — object detection
    # ──────────────────────────────────────────────
    object_evidence = detect_objects(image_path)
    print("[image_analyzer] YOLO evidence:", object_evidence)

    # ──────────────────────────────────────────────
    # 2. CLIP — semantic similarity
    # ──────────────────────────────────────────────
    clip_evidence = validate_image_with_task(image_path, instruction)
    print("[image_analyzer] CLIP evidence:", clip_evidence)

    # ──────────────────────────────────────────────
    # 3. Pose — hand/body detection
    # ──────────────────────────────────────────────
    pose_evidence = detect_pose(image_path)
    print("[image_analyzer] Pose evidence:", pose_evidence)

    # ──────────────────────────────────────────────
    # 4. Validator — required vs detected objects
    # ──────────────────────────────────────────────
    object_validation = validate_objects_with_task(instruction, object_evidence)
    print("[image_analyzer] Validation:", object_validation)

    # ──────────────────────────────────────────────
    # 5. OCR — text extraction
    # ──────────────────────────────────────────────
    ocr_evidence = {"detected_text": []}
    try:
        ocr_res = extract_text(image_path)
        if isinstance(ocr_res, dict):
            ocr_evidence = ocr_res
        else:
            ocr_evidence = {"detected_text": []}
        print("[image_analyzer] OCR evidence:", ocr_evidence)
    except Exception:
        ocr_evidence = {"detected_text": [], "error": "OCR unavailable"}

    # ──────────────────────────────────────────────
    # 6. Build compact evidence context (TEXT ONLY)
    #    This is the ONLY thing sent to Gemini
    # ──────────────────────────────────────────────
    gemini_context = {
        "task": instruction,

        "objects": list(set([
            obj["label"]
            for obj in object_evidence.get("objects", [])
            if obj.get("confidence", 0) > 0.5
        ]))[:20],

        "clip_match": (
            clip_evidence.get("clip_score")
            or clip_evidence.get("score")
            or clip_evidence.get("similarity")
        ),

        "pose": pose_evidence.get("activity"),

        "ocr": ocr_evidence.get("detected_text", [])[:5],

        "validation": object_validation
    }

    instruction_text = f"""
You are an enterprise task verification AI.

Analyze whether the uploaded task proof satisfies the task.

Evidence summary:
{json.dumps(gemini_context)}

Rules:
- Use detected objects as visual proof
- Use CLIP score for semantic similarity
- Use OCR only when text matters
- Use pose/activity when relevant
- Missing required objects should reduce score
- Reject fake or unrelated submissions

Return STRICT JSON ONLY:

{{
 "passed": true/false,
 "score": 0-100,
 "feedback": "short explanation"
}}
"""

    # ──────────────────────────────────────────────
    # 7. Send to Gemini (TEXT ONLY — no image bytes)
    # ──────────────────────────────────────────────
    gemini_result = None
    client = _get_gemini_client()

    if client:
        try:
            start_time = time.time()
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[
                    types.Part(text=instruction_text)
                ],
                config=types.GenerateContentConfig(
                    thinking_config=types.ThinkingConfig(thinking_budget=0)
                ),
            )
            end_time = time.time()

            usage = extract_gemini_usage(response, "gemini-2.5-flash", start_time, end_time)
            gemini_usage_report = usage
            
            print(f"\n========== GEMINI USAGE: vision.py (analyze_image) ==========")
            print(f"Model: {usage['model']} | Duration: {usage['duration_ms']}ms")
            print(f"Tokens: Input {usage['prompt_tokens']} | Output {usage['output_tokens']} | Total {usage['total_tokens']}")
            if usage['pricing_available']:
                print(f"Cost: ${usage['total_cost_usd']} | INR ₹{usage['total_cost_inr']}")
            print("=============================================================\n")

            result_text = getattr(response, "text", None) or ""
            try:
                gemini_result = json.loads(result_text)
            except Exception:
                # Try to extract JSON substring
                start = result_text.find('{')
                end = result_text.rfind('}')
                if start != -1 and end != -1:
                    try:
                        gemini_result = json.loads(result_text[start:end + 1])
                    except Exception:
                        pass

        except Exception as e:
            print(f"[image_analyzer] Gemini call failed: {e}")

    # ──────────────────────────────────────────────
    # 8. Apply scoring verification rules
    # ──────────────────────────────────────────────
    clip_score_val = clip_evidence.get("clip_score", 0)

    if gemini_result and isinstance(gemini_result, dict):
        # Apply verification rules as final authority
        gemini_result = apply_verification_rules(gemini_result, object_validation)
        overall_score = gemini_result.get("score", 0)
        passed = gemini_result.get("passed", False)
        feedback = gemini_result.get("feedback", "")
    else:
        # Fallback: score locally if Gemini fails
        overall_score = int(clip_score_val * 100)
        if not object_validation.get("object_check_passed", True):
            overall_score = min(overall_score, 45)
        passed = overall_score >= 60
        feedback = "Evaluated using local models (Gemini unavailable)."

    # Build strengths/weaknesses from evidence
    strengths = []
    weaknesses = []
    issues = []
    recommendations = []

    # Object validation
    if object_validation.get("object_check_passed", True):
        required = object_validation.get("required_objects", [])
        if required:
            strengths.append(f"Verified presence of: {', '.join(required)}.")
    else:
        for missing_obj in object_validation.get("missing_objects", []):
            issues.append(f"Required object '{missing_obj}' was not detected.")
            recommendations.append(f"Ensure '{missing_obj}' is clearly visible.")
            weaknesses.append(f"Missing required item: {missing_obj}")

    # CLIP similarity
    if clip_score_val >= 0.55:
        strengths.append("High visual similarity with task requirements.")
    else:
        weaknesses.append("Image does not match the expected task scene.")
        issues.append("Low semantic match score.")
        recommendations.append("Make sure the scene matches the task prompt.")

    # Pose
    hands = pose_evidence.get("hands", [])
    if hands:
        hand_labels = [h.get("side", "unknown") for h in hands]
        strengths.append(f"Detected hands: {', '.join(hand_labels)}.")

    # Overall
    if passed:
        strengths.append("Fulfillment verification criteria passed.")
    else:
        weaknesses.append("Verification criteria check failed.")

    if not strengths:
        strengths.append("Image submission received and analyzed.")

    if feedback:
        strengths.insert(0, feedback)

    overall_score = max(0, min(100, overall_score))

    detected_objects_list = [
        obj["label"]
        for obj in object_evidence.get("objects", [])
    ]

    return {
        "overall_score": overall_score,
        "metrics": {
            "detected_objects": detected_objects_list,
            "clip_similarity": clip_score_val,
            "score": overall_score,
            "issues": issues,
            "recommendations": recommendations
        },
        "strengths": strengths,
        "weaknesses": weaknesses,
        "detected_issues": issues,
        "improvement_points": recommendations,
        "model_output": {
            "yolo_objects": object_evidence.get("objects", []),
            "clip_score": clip_score_val,
            "clip_matched": clip_evidence.get("matched", False),
            "pose": pose_evidence,
            "ocr": ocr_evidence,
            "object_validation": object_validation,
            "gemini_verdict": gemini_result
        }
    }

import os
import cv2
# import tempfile
# import numpy as np
from .models import yolo_model, whisper_pipeline, bge_model
from .text import cosine_similarity, extract_keywords

from .audio import transcribe_audio_whisper, analyze_audio

def analyze_video(video_path: str, task_title: str, task_description: str, expected_answer: str | None) -> dict:
    """
    Silent video submission analyzer using OpenCV, YOLO, Whisper, and BGE.
    """
    if not os.path.exists(video_path):
        return {
            "overall_score": 0,
            "metrics": {
                "visual_score": 0,
                "communication_score": 0,
                "transcript": "",
                "detected_objects": [],
                "final_score": 0
            },
            "strengths": [],
            "weaknesses": ["Media file missing."],
            "detected_issues": ["Video file not found on disk."],
            "improvement_points": ["Re-upload video file."],
            "model_output": {}
        }

    # 1. Frames Extraction and Visual analysis with YOLOv8
    detected_objects = set()
    person_frames_count = 0
    total_sampled_frames = 0
    
    cap = cv2.VideoCapture(video_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    # Sample up to 10 frames uniformly throughout the video
    max_frames = 10
    sample_indexes = []
    if total_frames > 0:
        sample_indexes = [int(i * total_frames / max_frames) for i in range(max_frames)]
        
    for idx in sample_indexes:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        success, frame = cap.read()
        if not success:
            continue
            
        total_sampled_frames += 1
        
        # Run YOLO on the numpy array directly
        if yolo_model:
            try:
                results = yolo_model(frame, verbose=False)
                for r in results:
                    for box in r.boxes:
                        confidence = float(box.conf[0])
                        if confidence < 0.25:
                            continue
                        class_id = int(box.cls[0])
                        label = r.names[class_id]
                        detected_objects.add(label)
                        if label == "person":
                            person_frames_count += 1
            except Exception as e:
                print(f"[Video Analyzer] YOLO frame detection failed: {e}")
                
    cap.release()

    # Calculate visual score
    # High score if person is visible (compliance check) and required objects are present
    person_visible = person_frames_count > 0
    visual_score = 50
    if person_visible:
        visual_score = 80 + int((person_frames_count / max(total_sampled_frames, 1)) * 20)
        visual_score = min(100, visual_score)
        
    # Check for expected objects in task instructions
    instruction_lower = f"{task_title} {task_description}".lower()
    detectable_items = ["bottle", "cell phone", "laptop", "book", "cup", "chair"]
    expected_objs = [item for item in detectable_items if item in instruction_lower]
    
    missing_expected_objs = []
    if expected_objs:
        for obj in expected_objs:
            # Map common user terms
            mapped = obj
            if obj == "cell phone" and "phone" in detected_objects:
                continue
            if obj not in detected_objects:
                missing_expected_objs.append(obj)
                
        if missing_expected_objs:
            # Penalize visual score if requested item is missing
            visual_score = max(30, visual_score - len(missing_expected_objs) * 20)

    # 2. Audio extraction
    temp_wav_path = ""
    audio_extracted = False
    try:
        temp_wav_path = extract_audio(video_path)
        audio_extracted = True
    except Exception as e:
        print("[Video Analyzer] Audio extraction failed:", e)

    # 3. Speech analysis (Whisper transcription of extracted audio)
    transcript = ""
    if audio_extracted and temp_wav_path:
        transcript = transcribe_audio_whisper(temp_wav_path)
        # Clean up temp wav file immediately
        try:
            os.unlink(temp_wav_path)
        except Exception:
            pass

    # 4. Transcript Relevance with BGE
    communication_score = 0
    sim = 0.0
    if transcript:
        comparison_text = expected_answer.strip() if (expected_answer and expected_answer.strip()) else f"{task_title}\n{task_description}".strip()
        try:
            emb_comp = bge_model.encode(comparison_text)
            emb_trans = bge_model.encode(transcript)
            sim = cosine_similarity(emb_comp, emb_trans)
            communication_score = int(max(0, min(100, (sim - 0.4) / 0.6 * 100)))
        except Exception as e:
            print("[Video Analyzer] BGE embedding failed:", e)
            communication_score = 50
            sim = 0.5
    else:
        # If no speech transcribed, communication score is low
        communication_score = 30 if audio_extracted else 0

    # Final overall score
    final_score = int((visual_score + communication_score) / 2)
    final_score = max(0, min(100, final_score))

    # Compile feedback, issues and recommendations
    issues = []
    improvement_points = []
    strengths = []
    weaknesses = []

    if person_visible:
        strengths.append("Employee presence verified in video frames.")
    else:
        issues.append("No human presence could be verified in the video frames.")
        weaknesses.append("Subject is not visible in the camera frame.")
        improvement_points.append("Ensure the employee is clearly in the frame while performing the task.")

    if missing_expected_objs:
        for m_obj in missing_expected_objs:
            issues.append(f"Expected object '{m_obj}' was not detected in video frames.")
            weaknesses.append(f"Missing required visual cue: {m_obj}")
            improvement_points.append(f"Show the '{m_obj}' clearly to the camera.")

    if transcript:
        strengths.append("Transcribed speech content processed successfully.")
        if communication_score >= 70:
            strengths.append("Speech topics show strong alignment with requirements.")
        else:
            weaknesses.append("Spoken content deviates from expected prompts.")
            improvement_points.append("Ensure your spoken explanation covers the expected task topics.")
    else:
        if audio_extracted:
            issues.append("No spoken speech could be transcribed from the audio track.")
            weaknesses.append("Silent presentation track.")
            improvement_points.append("Provide a clear verbal explanation during the presentation.")

    if not strengths:
        strengths.append("Video submission recorded successfully.")

    return {
        "overall_score": final_score,
        "metrics": {
            "visual_score": visual_score,
            "communication_score": communication_score,
            "transcript": transcript,
            "detected_objects": list(detected_objects),
            "final_score": final_score
        },
        "strengths": strengths,
        "weaknesses": weaknesses,
        "detected_issues": issues,
        "improvement_points": improvement_points,
        "model_output": {
            "yolo_detections": list(detected_objects),
            "whisper_transcript": transcript,
            "bge_relevance": round(float(sim), 4),
            "person_frames": f"{person_frames_count}/{total_sampled_frames}"
        }
    }

