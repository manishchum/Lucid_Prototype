# Backend/interactive_video/test_generate_sap_video.py
import os
import shutil
import tempfile
import subprocess
import wave
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FPS = 25
SCENE_SECONDS = 4
WIDTH, HEIGHT = 1280, 720

SCENES = [
    {"title": "SAP Login", "steps": ["Open SAP Logon", "Select System", "Enter Credentials"]},
    {"title": "Navigate to Sales Order", "steps": ["Go to T-code VA01", "Select Sales Org", "Click Create"]},
    {"title": "Create Line Item", "steps": ["Add material", "Set quantity", "Save document"]},
]

def make_frame(scene, scene_index, t_frac, idx, out_dir):
    img = Image.new("RGB", (WIDTH, HEIGHT), (22, 33, 58))
    d = ImageDraw.Draw(img)

    try:
        font_title = ImageFont.truetype("arial.ttf", 36)
        font_step = ImageFont.truetype("arial.ttf", 24)
        font_small = ImageFont.truetype("arial.ttf", 18)
    except Exception:
        font_title = ImageFont.load_default()
        font_step = ImageFont.load_default()
        font_small = ImageFont.load_default()

    d.rectangle([(0, 0), (WIDTH, 80)], fill=(10, 18, 32))
    d.text((20, 18), f"SAP - {scene['title']}", fill=(255, 255, 255), font=font_title)

    win_x0, win_y0 = 60, 120
    win_x1, win_y1 = WIDTH - 60, HEIGHT - 60
    d.rectangle([(win_x0, win_y0), (win_x1, win_y1)], fill=(240, 242, 245), outline=(180, 180, 180))

    nav_w = 300
    d.rectangle([(win_x0 + 10, win_y0 + 10), (win_x0 + nav_w, win_y1 - 10)], fill=(230, 232, 235))
    d.text((win_x0 + 20, win_y0 + 20), "Navigation", fill=(40, 40, 40), font=font_step)
    d.text((win_x0 + 20, win_y0 + 60), "SAP Modules", fill=(80, 80, 80), font=font_small)

    base_x = win_x0 + nav_w + 30
    y = win_y0 + 30
    total_steps = len(scene["steps"])
    active_step = min(int(t_frac * total_steps), total_steps - 1)
    for i, step in enumerate(scene["steps"]):
        box_color = (255, 250, 200) if i == active_step else (255, 255, 255)
        d.rectangle([(base_x - 10, y - 8), (win_x1 - 30, y + 34)], fill=box_color)
        d.text((base_x, y), f"{i+1}. {step}", fill=(20, 20, 20), font=font_step)
        y += 56

    progress_bar_x0 = win_x0 + 20
    progress_bar_x1 = win_x1 - 20
    progress_bar_y0 = win_y1 - 40
    progress_bar_h = 18
    d.rectangle([(progress_bar_x0, progress_bar_y0), (progress_bar_x1, progress_bar_y0 + progress_bar_h)], fill=(220, 220, 220))
    d.rectangle(
        [
            (progress_bar_x0, progress_bar_y0),
            (progress_bar_x0 + (progress_bar_x1 - progress_bar_x0) * t_frac, progress_bar_y0 + progress_bar_h),
        ],
        fill=(42, 135, 239),
    )
    d.text(
        (progress_bar_x0, progress_bar_y0 + progress_bar_h + 8),
        f"Scene {scene_index + 1} / {len(SCENES)}  •  Step {active_step + 1} of {total_steps}",
        fill=(35, 35, 35),
        font=font_small,
    )

    d.text((20, HEIGHT - 36), "Synthetic SAP simulation (test video)", fill=(200, 200, 200), font=font_step)

    path = out_dir / f"frame_{idx:06d}.png"
    img.save(path)

def generate_frames(tmp_dir: Path):
    frames_dir = tmp_dir / "frames"
    frames_dir.mkdir(exist_ok=True)
    idx = 0
    for scene_index, scene in enumerate(SCENES):
        frame_count = FPS * SCENE_SECONDS
        for f in range(frame_count):
            t_frac = f / max(1, frame_count - 1)
            make_frame(scene, scene_index, t_frac, idx, frames_dir)
            idx += 1
    return frames_dir, idx

def generate_mock_audio(total_seconds: int, out_wav: Path):
    sr = 22050
    t = np.linspace(0, total_seconds, int(sr * total_seconds), endpoint=False)
    audio = np.zeros_like(t)
    for i in range(0, len(t), int(sr * 0.6)):
        length = int(sr * 0.45)
        end = min(len(t), i + length)
        freq = 220 + (i // (sr * 0.6)) * 30
        audio[i:end] = 0.12 * np.sin(2 * math.pi * freq * t[i:end]) * np.hanning(end - i)
    if np.max(np.abs(audio)) > 0:
        audio = audio / np.max(np.abs(audio)) * 0.9
    audio_int16 = (audio * 32767).astype('int16')

    with wave.open(str(out_wav), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(audio_int16.tobytes())

def find_ffmpeg() -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg

    userprofile = os.environ.get("USERPROFILE")
    if userprofile:
        scoop_path = Path(userprofile) / "scoop" / "shims" / "ffmpeg.exe"
        if scoop_path.exists():
            return str(scoop_path)

    common_paths = [
        Path("C:/ffmpeg/bin/ffmpeg.exe"),
        Path("C:/ProgramData/chocolatey/bin/ffmpeg.exe"),
    ]
    for candidate in common_paths:
        if candidate.exists():
            return str(candidate)

    return None


def mux_frames_audio(frames_dir: Path, audio_wav: Path, out_mp4: Path):
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        raise FileNotFoundError(
            "ffmpeg not found on PATH. Install ffmpeg and add it to your PATH, or ensure Scoop shims are available."
        )

    cmd = [
        ffmpeg,
        "-y",
        "-framerate", str(FPS),
        "-i", str(frames_dir / "frame_%06d.png"),
        "-i", str(audio_wav),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-shortest",
        str(out_mp4),
    ]
    subprocess.check_call(cmd)

def main():
    tmp = Path(tempfile.mkdtemp(prefix="sap_test_vid_"))
    print("Working dir:", tmp)
    frames_dir, total_frames = generate_frames(tmp)
    total_seconds = math.ceil(total_frames / FPS)
    audio_wav = tmp / "mock_audio.wav"
    out_mp4 = tmp / "sap_simulation_test.mp4"

    print("Generating mock audio...")
    generate_mock_audio(total_seconds, audio_wav)

    print("Muxing frames + audio with ffmpeg...")
    mux_frames_audio(frames_dir, audio_wav, out_mp4)

    print("Done. Output video:", out_mp4)

if __name__ == "__main__":
    main()