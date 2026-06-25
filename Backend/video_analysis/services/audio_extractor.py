import subprocess
import uuid
import os


def extract_audio(video_path):

    output_path = f"/tmp/{uuid.uuid4()}.wav"


    command = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        output_path
    ]


    subprocess.run(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )


    if not os.path.exists(output_path):
        raise Exception(
            "Audio extraction failed"
        )


    return output_path