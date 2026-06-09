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