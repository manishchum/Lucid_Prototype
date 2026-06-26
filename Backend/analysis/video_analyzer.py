import os
import cv2
# import tempfile
# import numpy as np
from analysis.models import yolo_model, whisper_pipeline, bge_model
from analysis.text_analyzer import cosine_similarity
from video_analysis.services.audio_extractor import extract_audio
from analysis.audio_analyzer import transcribe_audio_whisper

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
