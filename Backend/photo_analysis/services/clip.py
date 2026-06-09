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