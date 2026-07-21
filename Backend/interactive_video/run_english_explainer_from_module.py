# Backend/interactive_video/run_english_explainer_from_module.py
from __future__ import annotations
import argparse
import os
import subprocess
import tempfile
import textwrap
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.append(str(ROOT))

from utils.supabase_client import supabase

FPS = 24
SLIDE_SECONDS = 4
WIDTH, HEIGHT = 1280, 720

MODULE_ID_DEFAULT = "5479a656-9197-4611-a966-01086cdb3c1f"


def find_ffmpeg() -> Optional[str]:
    from shutil import which

    exe = which("ffmpeg")
    if exe:
        return exe

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


def fetch_module(module_id: str) -> Dict[str, Any]:
    print(f"Fetching module {module_id} from processed_modules...")
    res = supabase.table("processed_modules").select("processed_module_id,title,content").eq("processed_module_id", module_id).maybe_single().execute()
    if not res.data:
        raise RuntimeError(f"Processed module {module_id} not found")
    return res.data


def normalize_text(text: str) -> str:
    return text.replace("\r\n", "\n").strip()


def make_slide_items(title: str, content: str, max_slides: int = 5) -> List[Dict[str, Any]]:
    if not content:
        return [{"heading": title or "Untitled Module", "lines": ["<no content available>"]}]

    body = normalize_text(content)
    paragraphs = [p.strip() for p in body.split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [body]

    slides: List[Dict[str, Any]] = [
        {
            "heading": title or "English Explainer",
            "subheading": "Generated explainer overview",
            "lines": [paragraphs[0][:180]] if paragraphs else ["Overview of the module content."],
        }
    ]

    for idx, paragraph in enumerate(paragraphs[1:max_slides]):
        lines = []
        for line in paragraph.split("\n"):
            if len(lines) >= 6:
                break
            wrapped = textwrap.wrap(line, width=42)
            lines.extend(wrapped)
        if not lines:
            continue
        slides.append(
            {
                "heading": f"Part {idx + 1}",
                "subheading": "Key points",
                "lines": lines[:8],
            }
        )

    if len(slides) < 4:
        slides.append({"heading": "Next Steps", "subheading": "Learn more", "lines": ["Review the module content and create interactive exercises."]})

    return slides


def make_frame(slide: Dict[str, Any], slide_index: int, frame_index: int, total_frames: int, slide_count: int, out_dir: Path) -> None:
    img = Image.new("RGB", (WIDTH, HEIGHT), (18, 30, 54))
    draw = ImageDraw.Draw(img)

    try:
        font_title = ImageFont.truetype("arialbd.ttf", 40)
        font_subtitle = ImageFont.truetype("arial.ttf", 24)
        font_body = ImageFont.truetype("arial.ttf", 22)
        font_small = ImageFont.truetype("arial.ttf", 18)
    except Exception:
        font_title = ImageFont.load_default()
        font_subtitle = ImageFont.load_default()
        font_body = ImageFont.load_default()
        font_small = ImageFont.load_default()

    draw.rectangle([(0, 0), (WIDTH, 100)], fill=(10, 17, 35))
    draw.text((36, 26), "SAP Explainer - English", fill=(241, 245, 249), font=font_title)
    draw.text((36, 84), "Module explainer for processed_module_id", fill=(148, 163, 184), font=font_small)

    bar_y = 100
    draw.rectangle([(0, bar_y), (WIDTH, bar_y + 6)], fill=(45, 55, 85))
    progress = (frame_index + 1) / max(1, total_frames)
    draw.rectangle([(0, bar_y), (int(WIDTH * progress), bar_y + 6)], fill=(56, 189, 248))

    panel_x0, panel_y0 = 70, 140
    panel_x1, panel_y1 = WIDTH - 70, HEIGHT - 130
    draw.rounded_rectangle([(panel_x0, panel_y0), (panel_x1, panel_y1)], radius=24, fill=(24, 38, 64), outline=(75, 85, 115), width=2)

    draw.text((panel_x0 + 40, panel_y0 + 32), slide["heading"], fill=(255, 255, 255), font=font_subtitle)
    draw.text((panel_x0 + 40, panel_y0 + 82), slide.get("subheading", "English explanation"), fill=(148, 163, 184), font=font_body)

    content_x = panel_x0 + 40
    content_y = panel_y0 + 140
    line_gap = 36
    for idx, line in enumerate(slide.get("lines", [])[:7]):
        draw.text((content_x, content_y + idx * line_gap), f"• {line}", fill=(226, 232, 240), font=font_body)

    corner_x = panel_x1 - 240
    corner_y = panel_y0 + 40
    draw.rectangle([(corner_x, corner_y), (corner_x + 180, corner_y + 120)], fill=(18, 30, 54), outline=(56, 189, 248), width=2)
    draw.text((corner_x + 18, corner_y + 16), "SAP UI Preview", fill=(206, 240, 255), font=font_body)
    draw.text((corner_x + 18, corner_y + 56), "* Enter transaction code", fill=(148, 163, 184), font=font_small)
    draw.text((corner_x + 18, corner_y + 86), "* Review screen items", fill=(148, 163, 184), font=font_small)

    footer_text = f"Slide {slide_index + 1} of {slide_count}    |    English explainer"
    draw.text((36, HEIGHT - 50), footer_text, fill=(148, 163, 184), font=font_small)

    out_path = out_dir / f"frame_{frame_index:06d}.png"
    img.save(out_path)


def generate_frames(slides: List[Dict[str, Any]], out_dir: Path) -> int:
    frame_index = 0
    total_frames = len(slides) * FPS * SLIDE_SECONDS
    total_slides = len(slides)
    for slide_index, slide in enumerate(slides):
        slide_frames = FPS * SLIDE_SECONDS
        for i in range(slide_frames):
            make_frame(slide, slide_index, frame_index, total_frames, total_slides, out_dir)
            frame_index += 1
    return frame_index


def generate_video(frames_dir: Path, out_path: Path) -> None:
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        raise FileNotFoundError("ffmpeg not found on PATH or in Scoop shims.")

    cmd = [
        ffmpeg,
        "-y",
        "-framerate",
        str(FPS),
        "-i",
        str(frames_dir / "frame_%06d.png"),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        str(out_path),
    ]
    subprocess.check_call(cmd)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create an English explainer video from a processed module")
    parser.add_argument("--processed-module-id", default=MODULE_ID_DEFAULT)
    args = parser.parse_args()

    module = fetch_module(args.processed_module_id)
    title = module.get("title") or "Module Explainer"
    content = module.get("content") or "No content available for this module."

    slides = make_slide_items(title, content)
    tmp_dir = Path(tempfile.mkdtemp(prefix="module_explainer_"))
    frames_dir = tmp_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    print(f"Generating {len(slides)} slides in {frames_dir}")
    total_frames = generate_frames(slides, frames_dir)
    output_video = tmp_dir / f"explainer_{args.processed_module_id[:8]}_en.mp4"

    print(f"Rendering video to {output_video}")
    generate_video(frames_dir, output_video)

    print("Done. Video created:")
    print(output_video)


if __name__ == "__main__":
    main()
