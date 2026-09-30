
from sentence_transformers import SentenceTransformer
from ultralytics import YOLO
from transformers import pipeline
yolo_model = None
whisper_pipeline = None
bge_model = None

def load_all_models():
    """
    Load all required AI models into memory once on server startup.
    """
    global yolo_model, whisper_pipeline, bge_model
    
    print("[AI Models] Startup: Initializing machine learning models...")

    try:
        print("[AI Models] Loading YOLOv8...")
        
        yolo_model = YOLO("yolov8n.pt")
        print("[AI Models] YOLOv8 loaded successfully.")
    except Exception as e:
        print("[AI Models] ERROR loading YOLOv8:", e)

    # 3. Whisper
    try:
        print("[AI Models] Loading Whisper (openai/whisper-small)...")
        whisper_pipeline = pipeline(
        "automatic-speech-recognition",
        model="openai/whisper-small",)

        print("[AI Models] Whisper loaded successfully.")
    except Exception as e:
        print("[AI Models] ERROR loading Whisper:", e)

    # 4. BGE
    try:
        print("[AI Models] Loading BGE-base-en-v1.5 (BAAI/bge-base-en-v1.5)...")
        bge_model = SentenceTransformer('BAAI/bge-base-en-v1.5')
        print("[AI Models] BGE loaded successfully.")
    except Exception as e:
        print("[AI Models] ERROR loading BGE:", e)

    print("[AI Models] Startup initialization completed.")
