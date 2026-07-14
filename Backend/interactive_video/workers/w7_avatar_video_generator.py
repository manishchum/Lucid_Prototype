"""
Worker 7: Avatar Video Generator
Composes per-segment MP4 files using ffmpeg.
Overlays: background image + glassmorphism slide + animated avatar bubble.
Avatar is a CSS-animated SVG rendered to PNG frames (no external API needed).
"""
from __future__ import annotations
import os
import subprocess
import shutil
from typing import Any, Dict, List, Optional

from fastapi.concurrency import run_in_threadpool
from playwright.sync_api import sync_playwright

# Resolve ffmpeg path
try:
    import static_ffmpeg
    _FFMPEG, _FFPROBE = static_ffmpeg.run.get_or_fetch_platform_executables_else_raise()
except ImportError:
    try:
        import imageio_ffmpeg
        _FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
        _FFPROBE = shutil.which("ffprobe")
    except ImportError:
        _FFMPEG = shutil.which("ffmpeg")
        _FFPROBE = shutil.which("ffprobe")


# ---------------------------------------------------------------------------
# Avatar frame rendering (CSS animated talking head)
# ---------------------------------------------------------------------------

_AVATAR_IDLE_HTML = """<!DOCTYPE html>
<html>
<head>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { width:320px; height:320px; background:transparent; display:flex; align-items:center; justify-content:center; }
.avatar-container {
  width:280px; height:280px; position:relative;
}
.avatar-ring {
  position:absolute; inset:0; border-radius:50%;
  border:3px solid rgba(99,179,237,0.6);
  box-shadow:0 0 30px rgba(99,179,237,0.3), inset 0 0 30px rgba(99,179,237,0.1);
  animation: pulse-ring 2s ease-in-out infinite;
}
@keyframes pulse-ring {
  0%,100% { box-shadow:0 0 20px rgba(99,179,237,0.3); }
  50% { box-shadow:0 0 45px rgba(99,179,237,0.6); }
}
.avatar-face {
  width:280px; height:280px; border-radius:50%;
  background: radial-gradient(circle at 40% 35%, #4a6fa5, #1a2a4a);
  display:flex; align-items:center; justify-content:center; overflow:hidden;
  position:relative;
}
.face-inner {
  width:200px; height:200px; border-radius:50%;
  background: radial-gradient(circle at 40% 30%, #5b7fb5, #2a3a5a);
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;
  position:relative;
}
.eyes { display:flex; gap:24px; }
.eye {
  width:18px; height:18px; border-radius:50%; background:#a8d8f0;
  position:relative;
  animation: blink 4s ease-in-out infinite;
}
@keyframes blink {
  0%,96%,100% { transform:scaleY(1); }
  98% { transform:scaleY(0.1); }
}
.mouth {
  width:40px; height:6px;
  background:#a8d8f0; border-radius:0 0 20px 20px;
  animation: talk 0.25s steps(1) infinite;
}
@keyframes talk {
  0% { height:6px; border-radius:0 0 20px 20px; }
  50% { height:14px; border-radius:0 0 20px 20px; }
}
.label {
  position:absolute; bottom:-8px; left:50%; transform:translateX(-50%);
  background:rgba(99,179,237,0.9); color:white; font-family:sans-serif;
  font-size:11px; font-weight:700; padding:4px 14px; border-radius:20px;
  white-space:nowrap; letter-spacing:1px; text-transform:uppercase;
}
</style>
</head>
<body>
<div class="avatar-container">
  <div class="avatar-ring"></div>
  <div class="avatar-face">
    <div class="face-inner">
      <div class="eyes"><div class="eye"></div><div class="eye"></div></div>
      <div class="mouth"></div>
    </div>
  </div>
  <div class="label">AI Instructor</div>
</div>
</body>
</html>"""


def _render_avatar_png_sync(out_path: str, cue: str = "explaining"):
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        try:
            page = browser.new_page()
            page.set_viewport_size({"width": 320, "height": 320})
            page.set_content(_AVATAR_IDLE_HTML, wait_until="domcontentloaded")
            page.screenshot(path=out_path, omit_background=True)
        finally:
            browser.close()


async def _render_avatar_png(out_path: str, cue: str = "explaining") -> str:
    await run_in_threadpool(_render_avatar_png_sync, out_path, cue)
    return out_path


# ---------------------------------------------------------------------------
# Background placeholder
# ---------------------------------------------------------------------------

_BG_HTML = """<!DOCTYPE html>
<html><head>
<style>
* {{ margin:0; padding:0; }}
body {{
  width:1280px; height:720px;
  background: {gradient};
  display:flex; align-items:center; justify-content:center;
  overflow:hidden;
}}
.grid {{
  position:absolute; inset:0;
  background-image: linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 60px 60px;
}}
.orb {{
  position:absolute;
  border-radius:50%;
  filter:blur(80px);
  opacity:0.4;
}}
.orb1 {{ width:400px; height:400px; top:-100px; right:-100px; background:rgba(99,179,237,0.3); }}
.orb2 {{ width:300px; height:300px; bottom:-50px; left:50px; background:rgba(159,122,234,0.3); }}
</style>
</head>
<body>
<div class="grid"></div>
<div class="orb orb1"></div>
<div class="orb orb2"></div>
</body></html>"""

_GRADIENTS = [
    "linear-gradient(135deg, #0f172a, #1e293b)",
    "linear-gradient(135deg, #0a0f1e, #162032)",
    "linear-gradient(135deg, #120823, #1a1040)",
]


def _render_bg_sync(out_path: str, idx: int = 0):
    gradient = _GRADIENTS[idx % len(_GRADIENTS)]
    html = _BG_HTML.format(gradient=gradient)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        try:
            page = browser.new_page()
            page.set_viewport_size({"width": 1280, "height": 720})
            page.set_content(html, wait_until="domcontentloaded")
            page.screenshot(path=out_path)
        finally:
            browser.close()


async def _render_bg(out_path: str, idx: int = 0) -> str:
    await run_in_threadpool(_render_bg_sync, out_path, idx)
    return out_path


# ---------------------------------------------------------------------------
# ffmpeg compose
# ---------------------------------------------------------------------------

def _compose_segment_sync(
    bg_path: str,
    slide_path: str,
    avatar_path: str,
    audio_path: str,
    out_path: str,
    duration: float,
) -> None:
    if not _FFMPEG:
        raise RuntimeError("ffmpeg not found")

    # Build filter complex:
    # [0:v] background 1280x720
    # [1:v] slide overlay (transparent PNG, same size)
    # [2:v] avatar bubble bottom-right
    # [3:a] audio track
    filter_complex = ";".join([
        "[0:v]scale=1280:720[bg]",
        "[1:v]scale=1280:720[slide]",
        "[bg][slide]overlay=0:0[with_slide]",
        "[2:v]scale=280:280[av]",
        "[with_slide][av]overlay=W-w-32:H-h-32[out]",
        "[3:a]apad=whole_dur={dur}[audio_out]".format(dur=duration),
    ])

    cmd = [
        _FFMPEG, "-y",
        "-loop", "1", "-t", str(duration), "-i", bg_path,
        "-loop", "1", "-t", str(duration), "-i", slide_path,
        "-loop", "1", "-t", str(duration), "-i", avatar_path,
        "-i", audio_path,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-map", "[audio_out]",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        "-t", str(duration),
        out_path,
    ]

    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", errors="ignore")[:2000])


async def _compose_segment(
    bg_path: str,
    slide_path: str,
    avatar_path: str,
    audio_path: str,
    out_path: str,
    duration: float,
) -> None:
    await run_in_threadpool(
        _compose_segment_sync, bg_path, slide_path, avatar_path, audio_path, out_path, duration
    )


def _concat_videos_sync(video_paths: List[str], list_file: str, out_path: str):
    with open(list_file, "w", encoding="utf-8") as f:
        for vp in video_paths:
            f.write(f"file '{vp.replace(chr(92), '/')}'\n")

    cmd = [
        _FFMPEG, "-y",
        "-f", "concat", "-safe", "0",
        "-i", list_file,
        "-c", "copy",
        out_path,
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", errors="ignore")[:2000])


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def run(voice_data: Dict[str, Any], tmp_dir: str) -> Dict[str, Any]:
    """
    W7: Avatar Video Generator

    Composes MP4 segment videos for each lecture segment.
    Quiz and simulation segments get a static slide video (no avatar narration).
    """
    print("[W7] Avatar Video Generator starting...")

    enriched_segments: List[Dict] = voice_data.get("enriched_segments", [])

    # Pre-render one avatar PNG (reused for all segments)
    avatar_path = os.path.join(tmp_dir, "avatar.png")
    await _render_avatar_png(avatar_path)

    for i, seg in enumerate(enriched_segments):
        seg_id = seg.get("id", f"seg_{i}")
        seg_type = seg.get("type", "lecture")

        if seg_type != "lecture":
            # Skip video composition for quiz_gate and simulation — rendered client-side
            continue

        slide_path = seg.get("slide_png")
        audio_en = seg.get("audio_en_path")
        audio_hi = seg.get("audio_hi_path")
        duration = seg.get("duration", 10.0)

        if not slide_path or not os.path.exists(slide_path):
            print(f"[W7] Skipping {seg_id} — no slide PNG")
            continue

        # Render background
        bg_path = os.path.join(tmp_dir, f"bg_{seg_id}.png")
        await _render_bg(bg_path, idx=i)

        # Compose EN video
        if audio_en and os.path.exists(audio_en):
            out_en = os.path.join(tmp_dir, f"seg_{seg_id}_en.mp4")
            try:
                await _compose_segment(
                    bg_path, slide_path, avatar_path, audio_en, out_en, seg.get("duration_en", duration)
                )
                seg["video_en_path"] = out_en
                print(f"[W7] EN video: {seg_id}")
            except Exception as e:
                print(f"[W7] EN compose failed {seg_id}: {e}")

        # Compose HI video
        if audio_hi and os.path.exists(audio_hi):
            out_hi = os.path.join(tmp_dir, f"seg_{seg_id}_hi.mp4")
            try:
                await _compose_segment(
                    bg_path, slide_path, avatar_path, audio_hi, out_hi, seg.get("duration_hi", duration)
                )
                seg["video_hi_path"] = out_hi
                print(f"[W7] HI video: {seg_id}")
            except Exception as e:
                print(f"[W7] HI compose failed {seg_id}: {e}")

    print("[W7] Done: all segment videos composed")
    return voice_data
