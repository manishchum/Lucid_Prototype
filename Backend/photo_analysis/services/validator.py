def validate_objects_with_task(instruction: str, object_evidence: dict):

    instruction = instruction.lower()

    detected_objects = [
        obj["label"].lower()
        for obj in object_evidence.get("objects", [])
    ]


    # YOLO names mapping
    aliases = {
        "phone": "cell phone",
        "mobile": "cell phone",
        "smartphone": "cell phone",
        "water bottle": "bottle",
        "teddy": "teddy bear",
    }


    required_objects = []


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


    # find required object from task
    for item in detectable_items:
        if item in instruction:
            required_objects.append(item)


    # alias matching
    for word, mapped in aliases.items():
        if word in instruction:
            required_objects.append(mapped)


    required_objects = list(set(required_objects))


    missing = []

    for obj in required_objects:
        if obj not in detected_objects:
            missing.append(obj)


    return {
        "required_objects": required_objects,
        "detected_objects": detected_objects,
        "missing_objects": missing,
        "object_check_passed": len(missing) == 0
    }