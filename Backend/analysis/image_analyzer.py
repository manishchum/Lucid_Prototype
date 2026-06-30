import os
import json

from google import genai
from google.genai import types

# Import the FULL photo_analysis services pipeline
from photo_analysis.services.yolo import detect_objects
from photo_analysis.services.clip import validate_image_with_task
from photo_analysis.services.pose import detect_pose
from photo_analysis.services.validator import validate_objects_with_task
from photo_analysis.services.scoring import apply_verification_rules
from photo_analysis.services.ocr import extract_text


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
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[
                    types.Part(text=instruction_text)
                ],
                config=types.GenerateContentConfig(
                    thinking_config=types.ThinkingConfig(thinking_budget=0)
                ),
            )

            # ---- TOKEN USAGE LOGGING ----
            if hasattr(response, 'usage_metadata') and response.usage_metadata:
                meta = response.usage_metadata
                print("\n========== GEMINI TOKEN USAGE (image_analyzer.py) ==========")
                print(f"  Input tokens:    {getattr(meta, 'prompt_token_count', 'N/A')}")
                print(f"  Output tokens:   {getattr(meta, 'candidates_token_count', 'N/A')}")
                print(f"  Thinking tokens: {getattr(meta, 'thoughts_token_count', 'N/A')}")
                print(f"  TOTAL tokens:    {getattr(meta, 'total_token_count', 'N/A')}")
                print("============================================================\n")
            # ---- END TOKEN USAGE LOGGING ----

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
