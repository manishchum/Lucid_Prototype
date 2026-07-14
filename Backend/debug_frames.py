from video_analysis.services.frame_extractor import extract_frames


frames = extract_frames(
    "sample.mp4"
)


for i,f in enumerate(frames):

    with open(
        f"frame_{i}.jpg",
        "wb"
    ) as file:

        file.write(f)


print("saved")