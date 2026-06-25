import os
import torch
from sentence_transformers import SentenceTransformer
from ultralytics import YOLO
# CLIP removed — image_analyzer.py now uses photo_analysis/services/clip.py directly
# from transformers import CLIPProcessor, CLIPModel, pipeline
from transformers import pipeline

# Global model instances
yolo_model = None
# CLIP no longer loaded here — used from photo_analysis/services/clip.py
# clip_model = None
# clip_processor = None
whisper_pipeline = None
bge_model = None

def load_all_models():
    """
    Load all required AI models into memory once on server startup.
    """
    global yolo_model, whisper_pipeline, bge_model
    
    print("[AI Models] Startup: Initializing machine learning models...")
    
    # 1. YOLOv8
    try:
        print("[AI Models] Loading YOLOv8...")
        # yolov8n.pt is already present in Backend directory
        yolo_model = YOLO("yolov8n.pt")
        print("[AI Models] YOLOv8 loaded successfully.")
    except Exception as e:
        print("[AI Models] ERROR loading YOLOv8:", e)

    # 2. CLIP — REMOVED: now loaded in photo_analysis/services/clip.py
    # No longer duplicated here to save ~400MB RAM
    # try:
    #     print("[AI Models] Loading CLIP (openai/clip-vit-base-patch32)...")
    #     clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    #     clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    #     print("[AI Models] CLIP loaded successfully.")
    # except Exception as e:
    #     print("[AI Models] ERROR loading CLIP:", e)

    # 3. Whisper
    try:
        print("[AI Models] Loading Whisper (openai/whisper-tiny)...")
        whisper_pipeline = pipeline("automatic-speech-recognition", model="openai/whisper-tiny")
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
