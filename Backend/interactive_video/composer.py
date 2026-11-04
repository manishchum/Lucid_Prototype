"""
Video Composition Engine (Day 7: composer.py)
Composes high-definition MP4 videos from:
1. Neutral animated motion background (Ken Burns zoompan via FFmpeg).
2. Transparent 1280x720 glassmorphic slide overlay with company branding.
3. High-quality multi-language narration audio (English & Hinglish).
4. Seamless segment concatenation into final course videos.

COMPLETELY ELIMINATES ALL AVATAR CODE:
- No CSS avatar animations.
- No avatar PNG frame rendering.
- No talking head / mouth movement / eye blinking logic.
- Zero write/delete queries to the database.
"""
from __future__ import annotations
import os
import shutil
import subprocess
import logging
from typing import List, Optional, Tuple
from PIL import Image, ImageDraw, ImageFilter
from fastapi.concurrency import run_in_threadpool

from interactive_video.models import CourseManifest, Segment

logger = logging.getLogger("interactive_video.composer")

# ---------------------------------------------------------------------------
# FFmpeg & FFprobe Resolution via static_ffmpeg
# ---------------------------------------------------------------------------
try:
    import static_ffmpeg
    _FFMPEG, _FFPROBE = static_ffmpeg.run.get_or_fetch_platform_executables_else_raise()
except Exception as exc:
    logger.warning(f"[Composer] static_ffmpeg resolution failed ({exc}), falling back to PATH")
    _FFMPEG = shutil.which("ffmpeg")
    _FFPROBE = shutil.which("ffprobe")

if not _FFMPEG:
    raise RuntimeError("FFmpeg executable not found in static_ffmpeg or system PATH")


# ---------------------------------------------------------------------------
# Dynamic Background Plate Generation (PIL)
# ---------------------------------------------------------------------------
_PALETTES = [
    # Deep slate & blue
    {"bg": (10, 15, 28), "orb1": (37, 99, 235, 60), "orb2": (124, 58, 237, 50), "orb3": (14, 165, 233, 40)},
    # Midnight navy & teal
    {"bg": (8, 17, 32), "orb1": (13, 148, 136, 60), "orb2": (59, 130, 246, 50), "orb3": (99, 102, 241, 40)},
    # Charcoal & violet
    {"bg": (15, 15, 26), "orb1": (139, 92, 246, 60), "orb2": (236, 72, 153, 45), "orb3": (59, 130, 246, 40)},
]


def render_background_plate(out_path: str, variant_idx: int = 0) -> str:
    """
    Renders an ultra-clean 1920x1080 background plate with subtle ambient orbs
    and micro-grid lines using PIL in ~100ms.
    """
    w, h = 1920, 1080
    palette = _PALETTES[variant_idx % len(_PALETTES)]

    base_img = Image.new("RGB", (w, h), color=palette["bg"])

    # Ambient glowing orbs
    orb_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    orb_draw = ImageDraw.Draw(orb_layer)

    # Three soft focal points of light
    orb_draw.ellipse([w - 650, -150, w + 350, 750], fill=palette["orb1"])
    orb_draw.ellipse([-200, h - 550, 600, h + 250], fill=palette["orb2"])
    orb_draw.ellipse([w // 2 - 250, h // 2 - 250, w // 2 + 450, h // 2 + 450], fill=palette["orb3"])

    # Heavy blur for organic light dispersion
    orb_layer = orb_layer.filter(ImageFilter.GaussianBlur(130))
    base_img.paste(orb_layer, (0, 0), orb_layer)

    # Subtle tech grid pattern
    grid_draw = ImageDraw.Draw(base_img)
    for x in range(0, w, 64):
        grid_draw.line([(x, 0), (x, h)], fill=(255, 255, 255, 5), width=1)
    for y in range(0, h, 64):
        grid_draw.line([(0, y), (w, y)], fill=(255, 255, 255, 5), width=1)

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    base_img.save(out_path, "PNG")
    return out_path


# ---------------------------------------------------------------------------
# Segment Video Composition (FFmpeg Filtergraph)
# ---------------------------------------------------------------------------

def compose_segment_sync(
    bg_image_path: str,
    slide_png_path: str,
    audio_path: str,
    out_path: str,
    duration: float,
) -> str:
    """
    Composes a single segment MP4 video:
    - [0:v] 1920x1080 background plate with Ken Burns zoompan.
    - [1:v] 1280x720 glassmorphic slide overlay with company logo and 0.5s fade-in.
    - [2:a] Narration audio timeline trimmed & padded to exact segment duration.
    """
    duration = max(duration, 3.0)
    fps = 25
    total_frames = int(round(duration * fps))

    # Ken Burns filter on 1920x1080 background plate -> output 1280x720:
    # Slow subtle zoom from 1.0 to 1.12 over the segment duration
    zoom_step = round(0.12 / max(total_frames, 1), 6)
    if zoom_step <= 0:
        zoom_step = 0.0005

    # Filter complex:
    # 1. zoompan over background
    # 2. fade-in on slide overlay
    # 3. overlay slide on background
    # 4. pad audio to exact duration
    filter_complex = ";".join([
        f"[0:v]zoompan=z='min(zoom+{zoom_step},1.15)':d={total_frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps={fps}[bg]",
        "[1:v]format=rgba,fade=t=in:st=0:d=0.5:alpha=1[slide]",
        "[bg][slide]overlay=0:0[outv]",
        f"[2:a]atrim=0:{duration:.3f},asetpts=PTS-STARTPTS,apad=whole_dur={duration:.3f}[outa]",
    ])

    cmd = [
        _FFMPEG, "-y",
        "-i", bg_image_path,
        "-loop", "1", "-t", f"{duration:.3f}", "-i", slide_png_path,
        "-i", audio_path,
        "-filter_complex", filter_complex,
        "-map", "[outv]",
        "-map", "[outa]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "22",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-t", f"{duration:.3f}",
        out_path,
    ]

    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        err_msg = result.stderr.decode("utf-8", errors="ignore")
        logger.error(f"[Composer] FFmpeg segment failed: {err_msg[:1000]}")
        raise RuntimeError(f"FFmpeg composition failed for {out_path}: {err_msg[:400]}")

    return out_path


def concat_videos_sync(segment_video_paths: List[str], out_path: str) -> str:
    """
    Concatenates a list of segment MP4 files into a single unified course video.
    Uses FFmpeg concat demuxer with fast stream copy, falling back to re-encode if needed.
    """
    if not segment_video_paths:
        raise ValueError("No segment videos to concatenate")

    if len(segment_video_paths) == 1:
        shutil.copyfile(segment_video_paths[0], out_path)
        return out_path

    concat_list_file = os.path.join(os.path.dirname(out_path), f"concat_list_{os.path.basename(out_path)}.txt")
    with open(concat_list_file, "w", encoding="utf-8") as f:
        for vp in segment_video_paths:
            normalized = vp.replace("\\", "/")
            f.write(f"file '{normalized}'\n")

    # Fast stream copy concat
    cmd_copy = [
        _FFMPEG, "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concat_list_file,
        "-c", "copy",
        out_path,
    ]
    res = subprocess.run(cmd_copy, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 1000:
        try:
            os.remove(concat_list_file)
        except OSError:
            pass
        return out_path

    # Fallback re-encode concat
    logger.info("[Composer] Stream copy concat failed; falling back to re-encode concat...")
    cmd_reencode = [
        _FFMPEG, "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concat_list_file,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "192k",
        "-pix_fmt", "yuv420p",
        out_path,
    ]
    res_re = subprocess.run(cmd_reencode, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        os.remove(concat_list_file)
    except OSError:
        pass

    if res_re.returncode != 0:
        err = res_re.stderr.decode("utf-8", errors="ignore")
        raise RuntimeError(f"FFmpeg concat re-encode failed: {err[:500]}")

    return out_path


# ---------------------------------------------------------------------------
# Public Orchestrator
# ---------------------------------------------------------------------------

async def compose_course_videos(
    manifest: CourseManifest,
    output_dir: str,
) -> CourseManifest:
    """
    Composes full MP4 videos for all segments and concatenates them into
    unified course MP4s (English and Hinglish).

    Updates:
    - seg.video_en_path
    - seg.video_hi_path
    - manifest.final_video_en_path
    - manifest.final_video_hi_path
    """
    os.makedirs(output_dir, exist_ok=True)
    logger.info(f"[Composer] Starting video composition for {len(manifest.segments)} segments...")

    en_segment_videos: List[str] = []
    hi_segment_videos: List[str] = []

    for i, seg in enumerate(manifest.segments):
        seg_id = seg.id or f"seg_{i + 1}"
        slide_path = seg.slide_image_path
        if not slide_path or not os.path.exists(slide_path):
            logger.warning(f"[Composer] Segment {seg_id} missing slide_image_path; skipping composition.")
            continue

        # Render background plate with subtle palette rotation
        bg_plate_path = os.path.join(output_dir, f"bg_{seg_id}.png")
        await run_in_threadpool(render_background_plate, bg_plate_path, i)

        # 1. Compose English segment
        if seg.audio_en_path and os.path.exists(seg.audio_en_path):
            en_dur = seg.duration_en or seg.duration or 30.0
            out_en = os.path.join(output_dir, f"seg_{i+1:03d}_{seg_id}_en.mp4")
            await run_in_threadpool(
                compose_segment_sync,
                bg_plate_path,
                slide_path,
                seg.audio_en_path,
                out_en,
                en_dur,
            )
            seg.video_en_path = out_en
            en_segment_videos.append(out_en)
            logger.info(f"[Composer] Segment {i + 1} EN video rendered: {out_en} ({en_dur:.1f}s)")

        # 2. Compose Hinglish segment (if available)
        if seg.audio_hi_path and os.path.exists(seg.audio_hi_path):
            hi_dur = seg.duration_hi or seg.duration or 30.0
            out_hi = os.path.join(output_dir, f"seg_{i+1:03d}_{seg_id}_hi.mp4")
            await run_in_threadpool(
                compose_segment_sync,
                bg_plate_path,
                slide_path,
                seg.audio_hi_path,
                out_hi,
                hi_dur,
            )
            seg.video_hi_path = out_hi
            hi_segment_videos.append(out_hi)
            logger.info(f"[Composer] Segment {i + 1} HI video rendered: {out_hi} ({hi_dur:.1f}s)")

    # 3. Concatenate final English video
    if en_segment_videos:
        final_en = os.path.join(output_dir, "final_en.mp4")
        logger.info(f"[Composer] Concatenating {len(en_segment_videos)} segments into {final_en}...")
        await run_in_threadpool(concat_videos_sync, en_segment_videos, final_en)
        manifest.final_video_en_path = final_en

    # 4. Concatenate final Hinglish video
    if hi_segment_videos:
        final_hi = os.path.join(output_dir, "final_hinglish.mp4")
        logger.info(f"[Composer] Concatenating {len(hi_segment_videos)} segments into {final_hi}...")
        await run_in_threadpool(concat_videos_sync, hi_segment_videos, final_hi)
        manifest.final_video_hi_path = final_hi

    logger.info("[Composer] Course video composition completed successfully.")
    return manifest
