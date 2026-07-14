"""
Worker 5: Slide Generator
Renders HTML slides for each lecture segment using Playwright → PNG screenshots.
Also renders quiz overlay slides and simulation placeholder screens.
"""
from __future__ import annotations
import os
import tempfile
from typing import Any, Dict, List

from playwright.sync_api import sync_playwright
from fastapi.concurrency import run_in_threadpool


# ---------------------------------------------------------------------------
# Slide HTML templates
# ---------------------------------------------------------------------------

def _lecture_slide_html(title: str, bullets: List[str], key_takeaway: str = "") -> str:
    bullet_items = "".join(
        f'<li><span class="arrow">→</span>{b}</li>' for b in bullets
    )
    takeaway_html = (
        f'<div class="takeaway"><span class="takeaway-icon">💡</span>{key_takeaway}</div>'
        if key_takeaway else ""
    )
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=Outfit:wght@600;800&display=swap" rel="stylesheet">
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: 'Inter', sans-serif;
      background: transparent;
      width: 1280px; height: 720px;
      display: flex; align-items: center; overflow: hidden;
    }}
    .content {{ padding: 60px 100px; width: 820px; }}
    .card {{
      background: rgba(8, 12, 36, 0.72);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(99, 179, 237, 0.3);
      border-radius: 28px;
      padding: 52px 60px;
      color: white;
      box-shadow: 0 25px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08);
    }}
    h1 {{
      font-family: 'Outfit', sans-serif;
      font-size: 42px; font-weight: 800;
      margin: 0 0 28px;
      background: linear-gradient(135deg, #63b3ed, #9f7aea);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      line-height: 1.2;
    }}
    ul {{ list-style: none; }}
    li {{
      font-size: 22px; line-height: 1.5;
      margin-bottom: 14px;
      display: flex; align-items: flex-start; gap: 12px;
      color: rgba(255,255,255,0.92);
    }}
    .arrow {{ color: #63b3ed; font-weight: bold; flex-shrink: 0; }}
    .takeaway {{
      margin-top: 28px;
      padding: 16px 20px;
      background: rgba(99,179,237,0.12);
      border-left: 3px solid #63b3ed;
      border-radius: 8px;
      font-size: 18px;
      color: rgba(255,255,255,0.85);
      display: flex; align-items: flex-start; gap: 10px;
    }}
    .takeaway-icon {{ font-size: 20px; flex-shrink: 0; }}
  </style>
</head>
<body>
  <div class="content">
    <div class="card">
      <h1>{title}</h1>
      <ul>{bullet_items}</ul>
      {takeaway_html}
    </div>
  </div>
</body>
</html>"""


def _quiz_slide_html(question_text: str, options: List[str]) -> str:
    opt_items = "".join(
        f'<li class="opt"><span class="letter">{chr(65+i)}</span>{o}</li>'
        for i, o in enumerate(options)
    )
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Outfit:wght@700&display=swap" rel="stylesheet">
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: 'Inter', sans-serif;
      background: transparent;
      width: 1280px; height: 720px;
      display: flex; align-items: center; justify-content: center;
    }}
    .card {{
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(24px);
      border: 1px solid rgba(167,139,250,0.35);
      border-radius: 28px;
      padding: 52px 64px;
      width: 960px;
      color: white;
      box-shadow: 0 32px 80px rgba(0,0,0,0.6);
    }}
    .quiz-label {{
      font-size: 13px; font-weight: 600;
      letter-spacing: 2px; text-transform: uppercase;
      color: #a78bfa; margin-bottom: 20px;
    }}
    h2 {{ font-family: 'Outfit'; font-size: 32px; font-weight: 700; margin-bottom: 32px; line-height: 1.3; }}
    ul {{ list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }}
    .opt {{
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 14px;
      padding: 18px 24px;
      display: flex; align-items: center; gap: 14px;
      font-size: 20px; color: rgba(255,255,255,0.9);
      cursor: pointer;
    }}
    .letter {{
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(167,139,250,0.2); border: 1.5px solid #a78bfa;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; color: #a78bfa; flex-shrink: 0;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="quiz-label">🧠 Knowledge Check</div>
    <h2>{question_text}</h2>
    <ul>{opt_items}</ul>
  </div>
</body>
</html>"""


def _simulation_slide_html(step_num: int, total: int, instruction: str, screen_desc: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Outfit:wght@700&display=swap" rel="stylesheet">
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: 'Inter', sans-serif;
      background: #0f172a;
      width: 1280px; height: 720px;
      display: flex; overflow: hidden;
    }}
    .sidebar {{
      width: 340px; flex-shrink: 0;
      background: rgba(15,23,42,0.95);
      border-right: 1px solid rgba(99,179,237,0.2);
      padding: 48px 36px;
      display: flex; flex-direction: column; gap: 24px;
    }}
    .step-badge {{
      font-size: 12px; font-weight: 700; letter-spacing: 2px;
      color: #63b3ed; text-transform: uppercase;
    }}
    h2 {{ font-family: 'Outfit'; font-size: 28px; color: white; line-height: 1.3; }}
    .instruction-box {{
      background: rgba(99,179,237,0.1);
      border: 1px solid rgba(99,179,237,0.3);
      border-radius: 12px; padding: 18px 20px;
      font-size: 17px; color: rgba(255,255,255,0.85); line-height: 1.5;
    }}
    .click-hint {{
      font-size: 15px; color: #63b3ed;
      display: flex; align-items: center; gap: 8px;
    }}
    .screen-area {{
      flex: 1;
      background: linear-gradient(145deg, #1e293b, #0f172a);
      display: flex; align-items: center; justify-content: center;
      position: relative;
    }}
    .screen-mock {{
      width: 820px; height: 540px;
      background: #1a2236;
      border-radius: 8px;
      border: 1px solid rgba(99,179,237,0.15);
      display: flex; align-items: center; justify-content: center;
      flex-direction: column; gap: 16px; padding: 32px;
    }}
    .screen-desc {{ font-size: 18px; color: rgba(255,255,255,0.5); text-align: center; }}
    .hotspot {{
      width: 160px; height: 48px;
      background: rgba(99,179,237,0.2);
      border: 2px solid #63b3ed;
      border-radius: 8px;
      animation: pulse 1.5s infinite;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; color: #63b3ed; font-weight: 600;
    }}
    @keyframes pulse {{
      0%, 100% {{ box-shadow: 0 0 0 0 rgba(99,179,237,0.4); }}
      50% {{ box-shadow: 0 0 0 12px rgba(99,179,237,0); }}
    }}
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="step-badge">Step {step_num} of {total}</div>
    <h2>Software Simulation</h2>
    <div class="instruction-box">{instruction}</div>
    <div class="click-hint">👆 Click the highlighted area to continue</div>
  </div>
  <div class="screen-area">
    <div class="screen-mock">
      <div class="screen-desc">{screen_desc}</div>
      <div class="hotspot">Click Here</div>
    </div>
  </div>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Playwright rendering (sync, run in threadpool)
# ---------------------------------------------------------------------------

def _render_html_to_png_sync(html: str, out_path: str, width: int = 1280, height: int = 720):
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        try:
            page = browser.new_page()
            page.set_viewport_size({"width": width, "height": height})
            page.set_content(html, wait_until="networkidle")
            page.screenshot(path=out_path, omit_background=True)
        finally:
            browser.close()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def render_lecture_slide(
    seg_id: str, title: str, bullets: List[str], key_takeaway: str, tmp_dir: str
) -> str:
    html = _lecture_slide_html(title, bullets, key_takeaway)
    out = os.path.join(tmp_dir, f"slide_{seg_id}.png")
    await run_in_threadpool(_render_html_to_png_sync, html, out)
    return out


async def render_quiz_slide(
    seg_id: str, question_text: str, options: List[str], q_idx: int, tmp_dir: str
) -> str:
    html = _quiz_slide_html(question_text, options)
    out = os.path.join(tmp_dir, f"quiz_{seg_id}_q{q_idx}.png")
    await run_in_threadpool(_render_html_to_png_sync, html, out)
    return out


async def render_simulation_slide(
    seg_id: str, step_num: int, total: int,
    instruction: str, screen_desc: str, tmp_dir: str
) -> str:
    html = _simulation_slide_html(step_num, total, instruction, screen_desc)
    out = os.path.join(tmp_dir, f"sim_{seg_id}_step{step_num}.png")
    await run_in_threadpool(_render_html_to_png_sync, html, out)
    return out


async def run(storyboard_data: Dict[str, Any], tmp_dir: str) -> Dict[str, Any]:
    """
    W5: Slide Generator

    Renders PNG slides for every enriched segment.
    Returns storyboard_data enriched with `slide_png` paths.
    """
    print("[W5] Slide Generator starting...")

    enriched_segments: List[Dict] = storyboard_data.get("enriched_segments", [])

    for seg in enriched_segments:
        seg_id = seg.get("id", "unknown")
        seg_type = seg.get("type", "lecture")

        try:
            if seg_type == "lecture":
                slide_path = await render_lecture_slide(
                    seg_id=seg_id,
                    title=seg.get("title", ""),
                    bullets=seg.get("slide_bullets", []),
                    key_takeaway=seg.get("key_takeaway", ""),
                    tmp_dir=tmp_dir,
                )
                seg["slide_png"] = slide_path
                print(f"[W5] Rendered lecture slide: {seg_id}")

            elif seg_type == "quiz_gate":
                questions = seg.get("quiz_questions", [])
                quiz_slides = []
                for qi, q in enumerate(questions):
                    sp = await render_quiz_slide(
                        seg_id=seg_id,
                        question_text=q.get("text", ""),
                        options=q.get("options", []),
                        q_idx=qi,
                        tmp_dir=tmp_dir,
                    )
                    quiz_slides.append(sp)
                seg["quiz_slide_pngs"] = quiz_slides
                print(f"[W5] Rendered {len(quiz_slides)} quiz slides: {seg_id}")

            elif seg_type == "simulation":
                steps = seg.get("simulation_steps", [])
                sim_slides = []
                for si, step in enumerate(steps):
                    sp = await render_simulation_slide(
                        seg_id=seg_id,
                        step_num=si + 1,
                        total=len(steps),
                        instruction=step.get("instruction", ""),
                        screen_desc=step.get("screen_description", ""),
                        tmp_dir=tmp_dir,
                    )
                    sim_slides.append(sp)
                seg["sim_slide_pngs"] = sim_slides
                print(f"[W5] Rendered {len(sim_slides)} simulation slides: {seg_id}")

        except Exception as e:
            print(f"[W5] WARNING: Slide render failed for {seg_id}: {e}")

    print(f"[W5] Done: slides rendered for {len(enriched_segments)} segments")
    return storyboard_data
