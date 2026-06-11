from ultralytics import YOLO

# Load once when server starts
model = YOLO("yolov8n.pt")


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