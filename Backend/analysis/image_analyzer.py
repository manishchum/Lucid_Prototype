import os
from PIL import Image
import torch
from analysis.models import yolo_model, clip_model, clip_processor

def detect_objects_yolo(image_path: str) -> list:
    """
    Detect objects using cached YOLO model.
    """
    if not yolo_model:
        print("[Image Analyzer] YOLO model not initialized")
        return []
    
    try:
        results = yolo_model(image_path)
        objects = []
        for result in results:
            for box in result.boxes:
                confidence = float(box.conf[0])
                if confidence < 0.25:
                    continue
                class_id = int(box.cls[0])
                label = result.names[class_id]
                objects.append({
                    "label": label,
                    "confidence": round(confidence, 4)
                })
        return objects
    except Exception as e:
        print("[Image Analyzer] YOLO detection error:", e)
        return []

def calculate_clip_similarity(image_path: str, instruction: str) -> float:
    """
    Calculate image-instruction similarity using cached CLIP model.
    """
    if not clip_model or not clip_processor:
        print("[Image Analyzer] CLIP model or processor not initialized")
        return 0.0
    
    try:
        image = Image.open(image_path)
        labels = [
            instruction,
            "unrelated image",
            "random selfie",
            "wrong object"
        ]
        
        inputs = clip_processor(
            text=labels,
            images=image,
            return_tensors="pt",
            padding=True
        )
        
        with torch.no_grad():
            outputs = clip_model(**inputs)
            
        scores = outputs.logits_per_image.softmax(dim=1)
        confidence = float(scores[0][0])
        return round(confidence, 4)
    except Exception as e:
        print("[Image Analyzer] CLIP similarity error:", e)
        return 0.0

def validate_objects_with_task(instruction: str, detected_objects_list: list) -> dict:
    instruction_lower = instruction.lower()
    detected_labels = [obj["label"].lower() for obj in detected_objects_list]
    
    aliases = {
        "phone": "cell phone",
        "mobile": "cell phone",
        "smartphone": "cell phone",
        "water bottle": "bottle",
        "teddy": "teddy bear",
    }
    
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
    
    required_objects = []
    for item in detectable_items:
        if item in instruction_lower:
            required_objects.append(item)
            
    for word, mapped in aliases.items():
        if word in instruction_lower:
            required_objects.append(mapped)
            
    required_objects = list(set(required_objects))
    missing = [obj for obj in required_objects if obj not in detected_labels]
    
    return {
        "required_objects": required_objects,
        "detected_objects": detected_labels,
        "missing_objects": missing,
        "passed": len(missing) == 0
    }

def analyze_image(image_path: str, instruction: str) -> dict:
    """
    Silent image submission analyzer.
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

    # 1. YOLOv8 Detections
    objects = detect_objects_yolo(image_path)
    
    # 2. CLIP Similarity
    clip_similarity = calculate_clip_similarity(image_path, instruction)
    
    # 3. Object validation
    obj_val = validate_objects_with_task(instruction, objects)
    
    # 4. Score logic
    clip_score = int(clip_similarity * 100)
    score = clip_score
    
    issues = []
    recommendations = []
    strengths = []
    weaknesses = []
    
    if not obj_val["passed"]:
        # Penalize if required objects are missing
        score = min(score, 45)
        for missing_obj in obj_val["missing_objects"]:
            issues.append(f"Required object '{missing_obj}' was not detected in the image.")
            recommendations.append(f"Ensure that the '{missing_obj}' is clearly visible in the image frame.")
            weaknesses.append(f"Missing required item: {missing_obj}")
    else:
        if obj_val["required_objects"]:
            strengths.append(f"Verified presence of: {', '.join(obj_val['required_objects'])}.")
            
    if clip_similarity >= 0.55:
        strengths.append("High visual similarity with task requirements.")
    else:
        weaknesses.append("Image does not structurally match the expected task scene.")
        issues.append("Low semantic match score.")
        recommendations.append("Make sure the scene composition matches the task prompt instructions.")
        score = min(score, 55)

    if score >= 60:
        strengths.append("Fulfillment verification criteria passed.")
    else:
        weaknesses.append("Verification criteria check failed.")

    if not strengths:
        strengths.append("Image submission received and analyzed.")

    score = max(0, min(100, score))

    return {
        "overall_score": score,
        "metrics": {
            "detected_objects": [obj["label"] for obj in objects],
            "clip_similarity": clip_similarity,
            "score": score,
            "issues": issues,
            "recommendations": recommendations
        },
        "strengths": strengths,
        "weaknesses": weaknesses,
        "detected_issues": issues,
        "improvement_points": recommendations,
        "model_output": {
            "yolo_objects": objects,
            "clip_score": clip_similarity
        }
    }
