import cv2


def extract_frames(video_path, max_frames=20):

    cap = cv2.VideoCapture(video_path)

    total_frames = int(
        cap.get(cv2.CAP_PROP_FRAME_COUNT)
    )

    frames = []


    # sample throughout full video
    indexes = [

        int(i * total_frames / max_frames)

        for i in range(max_frames)

    ]


    for idx in indexes:

        cap.set(
            cv2.CAP_PROP_POS_FRAMES,
            idx
        )

        success, frame = cap.read()


        if success:

            _, buffer = cv2.imencode(
                ".jpg",
                frame
            )

            frames.append(
                buffer.tobytes()
            )


    cap.release()


    print(
        "VIDEO FRAMES SENT:",
        len(frames)
    )


    return frames