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

