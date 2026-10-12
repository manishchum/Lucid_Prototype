import os

# Ensure bundled ffmpeg binaries are on PATH before Whisper or any subprocess uses ffmpeg.
# static_ffmpeg is in requirements.txt and ships its own ffmpeg binary — no system install needed.
try:
    import static_ffmpeg
    static_ffmpeg.add_paths()
    print("[AI Models] static_ffmpeg paths added to PATH.")
except Exception as _ffmpeg_err:
    print(f"[AI Models] WARNING: static_ffmpeg not available ({_ffmpeg_err}). Audio/video processing may fail.")

yolo_model = None
whisper_pipeline = None
bge_model = None


def get_yolo_model():
    """Lazily load and return YOLO model."""
    global yolo_model
    if yolo_model is None:
        try:
            print("[AI Models] Lazy loading YOLOv8...")
            from ultralytics import YOLO
            yolo_model = YOLO("yolov8n.pt")
            print("[AI Models] YOLOv8 loaded successfully.")
        except Exception as e:
            print("[AI Models] ERROR loading YOLOv8:", e)
    return yolo_model


def get_whisper_pipeline():
    """Lazily load and return Whisper pipeline."""
    global whisper_pipeline
    if whisper_pipeline is None:
        try:
            print("[AI Models] Lazy loading Whisper (openai/whisper-small)...")
            from transformers import pipeline
            whisper_pipeline = pipeline(
                "automatic-speech-recognition",
                model="openai/whisper-small",
            )
            print("[AI Models] Whisper loaded successfully.")
        except Exception as e:
            print("[AI Models] ERROR loading Whisper:", e)
    return whisper_pipeline


def get_bge_model():
    """Lazily load and return BGE model."""
    global bge_model
    if bge_model is None:
        try:
            print("[AI Models] Lazy loading BGE-base-en-v1.5 (BAAI/bge-base-en-v1.5)...")
            from sentence_transformers import SentenceTransformer
            bge_model = SentenceTransformer('BAAI/bge-base-en-v1.5')
            print("[AI Models] BGE loaded successfully.")
        except Exception as e:
            print("[AI Models] ERROR loading BGE:", e)
    return bge_model


def load_all_models():
    """
    Load all required AI models into memory on server startup.
    """
    print("[AI Models] Startup: Initializing machine learning models...")
    get_yolo_model()
    get_whisper_pipeline()
    get_bge_model()
    print("[AI Models] Startup initialization completed.")

