"""
Day 5: Slide Generator with Top-Left Company Logo (slide_renderer.py)

Milestone:
    High-definition slide PNGs (1280x720) with company branding watermark
    and semantic visual cards rendered via Playwright Chromium.

Features:
1. Modern HTML/CSS slide template:
   - Company Logo Watermark injected at:
     top: 36px; left: 44px; max-height: 48px; max-width: 180px; object-fit: contain; filter: drop-shadow(...)
   - Typography fallback to styled company name if no logo is available.
   - Left side: Segment title (gradient Outfit), 3-5 bullets, and key takeaway card.
   - Right side: Semantic visual card (matched image or abstract visual composition).
2. Semantic image matching:
   - Integrated with image_relevance.py to match images from vectordb_images.
   - Abstract gradient fallback for segments without images.
3. Playwright Chromium headless rendering (1280x720 PNG cards with transparent background).
"""
from __future__ import annotations

import base64
import html as html_lib
import logging
import mimetypes
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi.concurrency import run_in_threadpool
from playwright.sync_api import sync_playwright

from interactive_video.image_relevance import build_slide_query, select_best_candidate
from interactive_video.models import CourseManifest, ParsedDocumentContext, Segment

logger = logging.getLogger("interactive_video.slide_renderer")

# Slide dimensions
SLIDE_WIDTH = 1280
SLIDE_HEIGHT = 720


# ---------------------------------------------------------------------------
# Image & Data URI Helpers
# ---------------------------------------------------------------------------

def _url_to_data_uri(url: str, timeout: float = 12.0) -> Optional[str]:
    """
    Downloads an image and converts it to a base64 Data URI.
    Ensures Playwright renders images instantly with zero external network delays.
    """
    if not url:
        return None
    if url.startswith("data:"):
        return url
    if os.path.isfile(url):
        try:
            mime, _ = mimetypes.guess_type(url)
            mime = mime or "image/png"
            with open(url, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("utf-8")
            return f"data:{mime};base64,{b64}"
        except Exception as exc:
            logger.warning(f"[SlideRenderer] Failed reading local file {url}: {exc}")
            return None

    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "").split(";")[0].strip()
            if not content_type or not content_type.startswith("image/"):
                content_type = "image/png"
            b64 = base64.b64encode(resp.content).decode("utf-8")
            return f"data:{content_type};base64,{b64}"
    except Exception as exc:
        logger.warning(f"[SlideRenderer] Failed to convert image to Data URI from {url}: {exc}")
        return url  # Fallback to direct URL


def generate_gemini_slide_image(prompt: str, title: str, timeout: float = 60.0) -> Optional[str]:
    """
    Generates a high-definition corporate illustration using Google Gemini's native
    image generation model (gemini-2.5-flash-image) when vector image DB is empty
    or semantic similarity is low.
    Returns base64 encoded PNG string.
    """
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        logger.warning("[SlideRenderer] GEMINI_API_KEY not configured; skipping Gemini image generation")
        return None

    clean_prompt = (
        f"A modern, highly detailed corporate illustration representing: {prompt}. "
        f"Topic: {title}. Professional business education visual, sleek 3D or isometric data style, "
        f"rich vibrant colors, clean minimalist corporate lighting, 16:9 aspect ratio, strictly NO text, NO words, NO letters."
    )

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key={key}"
    payload = {
        "contents": [{
            "parts": [{"text": clean_prompt}]
        }]
    }

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, json=payload, headers={"Content-Type": "application/json"})
            if resp.status_code != 200:
                logger.warning(f"[SlideRenderer] Gemini image generation HTTP {resp.status_code}: {resp.text[:200]}")
                return None

            data = resp.json()
            candidates = data.get("candidates", [])
            if not candidates:
                return None

            parts = candidates[0].get("content", {}).get("parts", [])
            for p in parts:
                inline = p.get("inlineData")
                if inline and inline.get("data"):
                    logger.info(f"[SlideRenderer] Successfully generated Gemini image for '{title}' ({len(inline['data'])} b64 bytes)")
                    return inline["data"]

    except Exception as exc:
        logger.warning(f"[SlideRenderer] Gemini image generation failed for '{title}': {exc}")

    return None


def log_gemini_image_usage(
    company_id: Optional[str],
    user_id: Optional[str],
    prompt: str,
    latency_ms: int,
    status: str = "success",
    error_message: Optional[str] = None,
) -> None:
    """
    Logs Gemini image generation usage to ai_usage_logs.
    Uses feature video_scene_generation (or fallback) with unit='images'.
    """
    if not company_id:
        return
    try:
        from ai.usage_tracker import UsageTracker
        from ai.types import UsageLog
        from ai.cost_calculator import USD_TO_INR
        from decimal import Decimal

        cost_usd = 0.030
        cost_inr = round(float(Decimal(str(cost_usd)) * USD_TO_INR), 4)
        feature_id = "a3b7c9e1-5f42-4d8a-91c6-2e7b4a0f13d8"  # video_scene_generation

        UsageTracker.log(
            UsageLog(
                company_id=str(company_id),
                user_id=str(user_id or "system"),
                feature_id=feature_id,
                provider="gemini",
                model="gemini-2.5-flash-image",
                route="/api/interactive-video",
                prompt_version=1,
                input_tokens=len(prompt.split()),
                output_tokens=0,
                total_tokens=len(prompt.split()),
                cost_usd=cost_usd,
                cost_inr=cost_inr,
                latency_ms=latency_ms,
                status=status,
                error_message=error_message,
                usage_quantity=1.0,
                usage_unit="images",
            )
        )
        logger.info(f"[SlideRenderer] Logged Gemini image usage: ${cost_usd} USD (₹{cost_inr} INR)")
    except Exception as exc:
        logger.warning(f"[SlideRenderer] Failed to log Gemini image usage: {exc}")


# ---------------------------------------------------------------------------
# HTML Slide Template Generation
# ---------------------------------------------------------------------------

def _build_slide_html(
    segment: Segment,
    company_name: str,
    company_logo_uri: Optional[str],
    matched_image_uri: Optional[str],
    segment_number: int,
    total_segments: int,
) -> str:
    """
    Generates the complete HTML for a 1280x720 slide card.
    """
    # Safe text escapes
    title_esc = html_lib.escape(segment.title or f"Segment {segment_number}")
    takeaway_esc = html_lib.escape(segment.key_takeaway or "")
    company_name_esc = html_lib.escape(company_name or "Workfloww")

    # Watermark HTML: Logo or styled typography fallback
    if company_logo_uri:
        watermark_html = f"""
        <div class="company-watermark">
          <img src="{company_logo_uri}" class="company-logo" alt="{company_name_esc}" />
        </div>
        """
    else:
        watermark_html = f"""
        <div class="company-watermark">
          <div class="company-name-fallback">{company_name_esc}</div>
        </div>
        """

    # Bullet items HTML
    bullets = segment.slide_bullets or []
    if not bullets:
        bullets = ["Overview of key concept", "Core operational guidelines", "Summary takeaway for learners"]
    
    bullet_items_html = "\n".join(
        f"""
        <li class="bullet-item">
          <span class="bullet-icon">✦</span>
          <span class="bullet-text">{html_lib.escape(b)}</span>
        </li>
        """
        for b in bullets[:5]
    )

    # Key Takeaway section
    takeaway_html = ""
    if takeaway_esc:
        takeaway_html = f"""
        <div class="takeaway-box">
          <span class="takeaway-icon">💡</span>
          <div class="takeaway-text">{takeaway_esc}</div>
        </div>
        """

    # Right side visual: Matched Image vs Abstract Aesthetic Composition
    if matched_image_uri:
        visual_html = f"""
        <div class="visual-card">
          <img src="{matched_image_uri}" class="visual-image" alt="{title_esc}" />
        </div>
        """
    else:
        # Abstract motion-ready visual card
        prompt_snippet = html_lib.escape((segment.visual_prompt or "Visual concept representation")[:120])
        visual_html = f"""
        <div class="visual-card">
          <div class="abstract-visual">
            <div class="abstract-grid"></div>
            <div class="abstract-badge">
              <span>●</span> Concept Diagram
            </div>
            <div class="abstract-center">
              <div class="abstract-icon-wrap">⚡</div>
              <div class="abstract-topic">{title_esc}</div>
              <div class="abstract-desc">{prompt_snippet}...</div>
            </div>
            <div class="abstract-footer">
              <span class="tag">Module Overview</span>
              <span class="tag">Step {segment_number} of {total_segments}</span>
            </div>
          </div>
        </div>
        """

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700;800&display=swap" rel="stylesheet">
  <style>
    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}
    html, body {{
      width: {SLIDE_WIDTH}px;
      height: {SLIDE_HEIGHT}px;
      overflow: hidden;
      background: transparent;
      font-family: 'Inter', -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
    }}

    /* Top-Left Company Logo / Watermark */
    .company-watermark {{
      position: absolute;
      top: 36px;
      left: 44px;
      z-index: 100;
      display: flex;
      align-items: center;
    }}
    .company-logo {{
      max-height: 48px;
      max-width: 180px;
      object-fit: contain;
      filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.45));
    }}
    .company-name-fallback {{
      font-family: 'Outfit', sans-serif;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 1.5px;
      color: #f8fafc;
      text-transform: uppercase;
      background: rgba(15, 23, 42, 0.72);
      backdrop-filter: blur(16px);
      padding: 8px 18px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    }}

    /* Main Slide Card Container */
    .slide-wrapper {{
      position: relative;
      width: {SLIDE_WIDTH}px;
      height: {SLIDE_HEIGHT}px;
      padding: 96px 44px 36px 44px;
      display: flex;
      align-items: center;
      justify-content: center;
    }}

    .master-card {{
      width: 100%;
      height: 100%;
      background: linear-gradient(145deg, rgba(13, 20, 42, 0.88) 0%, rgba(9, 14, 30, 0.94) 100%);
      backdrop-filter: blur(36px);
      -webkit-backdrop-filter: blur(36px);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 28px;
      padding: 36px 42px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.12);
      display: grid;
      grid-template-columns: 1.18fr 0.82fr;
      gap: 36px;
      overflow: hidden;
    }}

    /* Left Column */
    .left-col {{
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 100%;
      min-width: 0;
    }}

    .header-area {{
      margin-bottom: 16px;
    }}

    .segment-index {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #38bdf8;
      margin-bottom: 8px;
    }}

    .slide-title {{
      font-family: 'Outfit', sans-serif;
      font-size: 38px;
      font-weight: 800;
      line-height: 1.16;
      background: linear-gradient(135deg, #ffffff 30%, #e2e8f0 70%, #94a3b8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin: 0;
      word-wrap: break-word;
    }}

    /* Bullet Points */
    .bullet-list {{
      list-style: none;
      padding: 0;
      margin: 0 0 auto 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }}

    .bullet-item {{
      display: flex;
      align-items: flex-start;
      gap: 14px;
      font-size: 19px;
      line-height: 1.48;
      color: rgba(248, 250, 252, 0.94);
      font-weight: 400;
    }}

    .bullet-icon {{
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      margin-top: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #facc15;
      font-size: 14px;
    }}

    .bullet-text {{
      word-wrap: break-word;
    }}

    /* Key Takeaway Badge */
    .takeaway-box {{
      margin-top: 16px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(250, 204, 21, 0.28);
      border-left: 5px solid #facc15;
      border-radius: 16px;
      padding: 12px 18px;
      display: flex;
      align-items: center;
      gap: 14px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    }}

    .takeaway-icon {{
      font-size: 22px;
      flex-shrink: 0;
    }}

    .takeaway-text {{
      font-size: 15px;
      line-height: 1.45;
      font-weight: 500;
      color: #fef08a;
    }}

    /* Right Column (Visual) */
    .right-col {{
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      min-width: 0;
    }}

    .visual-card {{
      width: 100%;
      height: 100%;
      border-radius: 22px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9));
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05), 0 16px 36px rgba(0, 0, 0, 0.35);
      display: flex;
      flex-direction: column;
      position: relative;
    }}

    .visual-image {{
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      border-radius: 20px;
    }}

    /* Abstract Visual Fallback */
    .abstract-visual {{
      width: 100%;
      height: 100%;
      position: relative;
      background: radial-gradient(circle at 75% 25%, rgba(56, 189, 248, 0.18) 0%, transparent 60%),
                  radial-gradient(circle at 25% 75%, rgba(250, 204, 21, 0.12) 0%, transparent 60%),
                  linear-gradient(135deg, #090d1a 0%, #111827 100%);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 26px;
      overflow: hidden;
    }}

    .abstract-grid {{
      position: absolute;
      inset: 0;
      background-image: linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
      background-size: 32px 32px;
      mask-image: radial-gradient(circle at center, black 40%, transparent 80%);
      -webkit-mask-image: radial-gradient(circle at center, black 40%, transparent 80%);
      pointer-events: none;
    }}

    .abstract-badge {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 999px;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 600;
      color: #38bdf8;
      width: fit-content;
      z-index: 2;
    }}

    .abstract-center {{
      margin: auto 0;
      z-index: 2;
    }}

    .abstract-icon-wrap {{
      width: 58px;
      height: 58px;
      border-radius: 16px;
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.25), rgba(250, 204, 21, 0.18));
      border: 1px solid rgba(255, 255, 255, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      margin-bottom: 14px;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.3);
    }}

    .abstract-topic {{
      font-family: 'Outfit', sans-serif;
      font-size: 22px;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.3;
      margin-bottom: 8px;
    }}

    .abstract-desc {{
      font-size: 14px;
      color: rgba(255, 255, 255, 0.65);
      line-height: 1.48;
    }}

    .abstract-footer {{
      display: flex;
      align-items: center;
      gap: 10px;
      z-index: 2;
    }}

    .tag {{
      font-size: 12px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.5);
      background: rgba(255, 255, 255, 0.05);
      padding: 4px 10px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }}
  </style>
</head>
<body>
  {watermark_html}

  <div class="slide-wrapper">
    <div class="master-card">
      <div class="left-col">
        <div class="header-area">
          <div class="segment-index">Segment {segment_number} of {total_segments}</div>
          <h1 class="slide-title">{title_esc}</h1>
        </div>
        <ul class="bullet-list">
          {bullet_items_html}
        </ul>
        {takeaway_html}
      </div>
      <div class="right-col">
        {visual_html}
      </div>
    </div>
  </div>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Slide Rendering Engine (Playwright)
# ---------------------------------------------------------------------------

def render_course_slides(
    manifest: CourseManifest,
    ctx: ParsedDocumentContext,
    output_dir: Optional[str] = None,
    enable_usage_logging: bool = False,
) -> CourseManifest:
    """
    Day 5 Milestone: Batch renders high-definition slide PNGs (1280x720)
    for all segments in a CourseManifest using Playwright Chromium.

    Args:
        manifest: CourseManifest returned by planner.py.
        ctx: ParsedDocumentContext containing module metadata and company branding.
        output_dir: Destination folder for rendered PNG cards. If None, creates a tempdir.

    Returns:
        Updated CourseManifest with segment.slide_image_path and segment.matched_image_url populated.
    """
    if not output_dir:
        output_dir = tempfile.mkdtemp(prefix=f"slides_{manifest.processed_module_id[:8]}_")
    os.makedirs(output_dir, exist_ok=True)

    logger.info(
        "[SlideRenderer] Rendering %d slides for '%s' into %s",
        len(manifest.segments),
        manifest.title,
        output_dir,
    )

    # 1. Resolve company branding watermark (Logo converted to Data URI)
    company_name = ctx.company_name or "Workfloww"
    company_logo_uri: Optional[str] = None
    if ctx.company_logo:
        logger.info("[SlideRenderer] Resolving company logo Data URI: %s", ctx.company_logo)
        company_logo_uri = _url_to_data_uri(ctx.company_logo)

    # 2. Match semantic images and prepare HTML for each segment
    slides_data: List[Dict[str, Any]] = []
    total_segments = len(manifest.segments)

    for idx, seg in enumerate(manifest.segments):
        # Semantic image matching
        matched_url = seg.matched_image_url
        if not matched_url and ctx.images:
            query = build_slide_query(
                title=seg.title,
                bullets=seg.slide_bullets,
                key_takeaway=seg.key_takeaway or "",
                prompt=seg.visual_prompt or "",
            )
            best_match = select_best_candidate(query, ctx.images, threshold=0.20)
            if best_match:
                matched_url = best_match["url"]
                seg.matched_image_url = matched_url
                logger.info(
                    "[SlideRenderer] Matched image (score=%.2f) for segment '%s': %s",
                    best_match["match_score"],
                    seg.title,
                    matched_url,
                )

        matched_image_uri: Optional[str] = None
        if matched_url:
            matched_image_uri = _url_to_data_uri(matched_url)

        # Fallback to Google Gemini Image generation if vector DB has no match
        if not matched_image_uri:
            logger.info(
                "[SlideRenderer] No vector image match for segment '%s'. Generating with Google Gemini Image...",
                seg.title,
            )
            t_img_start = time.time()
            prompt_str = seg.visual_prompt or seg.title
            gemini_b64 = generate_gemini_slide_image(
                prompt=prompt_str,
                title=seg.title,
            )
            img_latency_ms = int((time.time() - t_img_start) * 1000)
            if gemini_b64:
                matched_image_uri = f"data:image/png;base64,{gemini_b64}"
                local_visual_path = os.path.join(output_dir, f"visual_{idx + 1:03d}_{seg.id}.png")
                try:
                    with open(local_visual_path, "wb") as vf:
                        vf.write(base64.b64decode(gemini_b64))
                    seg.matched_image_url = local_visual_path
                    logger.info("[SlideRenderer] Saved Gemini visual to %s", local_visual_path)
                except Exception as save_err:
                    logger.warning("[SlideRenderer] Could not save local visual file: %s", save_err)

                if enable_usage_logging and ctx.company_id:
                    log_gemini_image_usage(
                        company_id=ctx.company_id,
                        user_id=ctx.uploaded_by,
                        prompt=prompt_str,
                        latency_ms=img_latency_ms,
                        status="success",
                    )

        # Output PNG path
        out_filename = f"slide_{idx + 1:03d}_{seg.id}.png"
        out_path = os.path.join(output_dir, out_filename)

        html_content = _build_slide_html(
            segment=seg,
            company_name=company_name,
            company_logo_uri=company_logo_uri,
            matched_image_uri=matched_image_uri,
            segment_number=idx + 1,
            total_segments=total_segments,
        )

        slides_data.append({
            "segment": seg,
            "out_path": out_path,
            "html": html_content,
        })

    # 3. Batch render via Playwright Chromium (Reusing single browser session for speed)
    logger.info("[SlideRenderer] Launching Playwright Chromium headless...")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        try:
            page = browser.new_page()
            page.set_viewport_size({"width": SLIDE_WIDTH, "height": SLIDE_HEIGHT})

            for item in slides_data:
                seg = item["segment"]
                out_path = item["out_path"]
                html_content = item["html"]

                page.set_content(html_content, wait_until="load")
                page.screenshot(path=out_path, omit_background=True)

                seg.slide_image_path = str(out_path)
                logger.info("[SlideRenderer] Rendered slide %s -> %s", seg.id, out_path)

        finally:
            browser.close()

    logger.info(
        "[SlideRenderer] Successfully completed rendering %d slides in %s",
        len(manifest.segments),
        output_dir,
    )
    return manifest


async def render_course_slides_async(
    manifest: CourseManifest,
    ctx: ParsedDocumentContext,
    output_dir: Optional[str] = None,
    enable_usage_logging: bool = False,
) -> CourseManifest:
    """Async wrapper for render_course_slides."""
    return await run_in_threadpool(render_course_slides, manifest, ctx, output_dir, enable_usage_logging)
