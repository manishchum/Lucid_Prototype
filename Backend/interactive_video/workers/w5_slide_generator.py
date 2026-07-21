"""
Worker 5: Slide Generator
Renders HTML slides for each lecture segment using Playwright → PNG screenshots.
Also renders quiz overlay slides and simulation placeholder screens.
"""
from __future__ import annotations
import base64
import os
import tempfile
from typing import Any, Dict, List

import httpx
from google import genai
from playwright.sync_api import sync_playwright
from fastapi.concurrency import run_in_threadpool
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps
from .image_relevance import build_slide_query, rank_candidates, select_best_candidate


REMOTE_IMAGE_MODEL = "gemini-2.5-flash-image"
LEGACY_IMAGE_MODEL = "imagen-4.0-fast-generate-001"
IMAGE_OUTPUT_COST_USD = 0.039


# ---------------------------------------------------------------------------
# Slide HTML templates
# ---------------------------------------------------------------------------

def _lecture_slide_html(title: str, bullets: List[str], key_takeaway: str = "", slide_text: str = "", image_url: str = "") -> str:
    bullet_items = "".join(
        f'<li><span class="arrow">→</span>{b}</li>' for b in bullets
    )
    takeaway_html = (
        f'<div class="takeaway"><span class="takeaway-icon">💡</span>{key_takeaway}</div>'
        if key_takeaway else ""
    )
    image_html = ""
    if image_url:
        image_html = f"""
      <div class=\"image-container\">
        <img src=\"{image_url}\" alt=\"Module related image\" />
      </div>
    """
    else:
        image_html = """
      <div class=\"image-placeholder\">
        <div class=\"placeholder-icon\">🖼️</div>
        <div class=\"placeholder-text\">Add a relevant image here</div>
      </div>
    """
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=Outfit:wght@600;800&display=swap" rel="stylesheet">
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    html, body {{
      width: 1280px; height: 720px;
      background: transparent;
    }}
    body {{
      font-family: 'Inter', sans-serif;
      display: flex; align-items: center; justify-content: center; overflow: hidden;
    }}
    .content {{ display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 32px; width: 1180px; padding: 40px; }}
    .card {{
      background: rgba(8, 12, 36, 0.54);
      backdrop-filter: blur(42px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 28px;
      padding: 44px 50px;
      color: white;
      box-shadow: 0 30px 80px rgba(0,0,0,0.22);
    }}
    h1 {{
      font-family: 'Outfit', sans-serif;
      font-size: 44px; font-weight: 800;
      margin: 0 0 24px;
      background: linear-gradient(135deg, #63b3ed, #fcd34d);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      line-height: 1.1;
    }}
    ul {{ list-style: none; padding: 0; margin: 0; }}
    li {{
      font-size: 22px; line-height: 1.6;
      margin-bottom: 14px;
      display: flex; align-items: flex-start; gap: 14px;
      color: rgba(255,255,255,0.92);
    }}
    .arrow {{ color: #facc15; font-weight: bold; flex-shrink: 0; margin-top: 4px; }}
    .takeaway {{
      margin-top: 30px;
      padding: 18px 22px;
      background: rgba(255,255,255,0.07);
      border-left: 4px solid #facc15;
      border-radius: 14px;
      font-size: 18px;
      color: rgba(255,255,255,0.95);
      display: flex; align-items: flex-start; gap: 12px;
    }}
    .takeaway-icon {{ font-size: 22px; flex-shrink: 0; }}
    .visual {{
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 30px;
      padding: 24px;
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 20px;
      overflow: hidden;
    }}
    .visual-title {{ font-size: 26px; font-weight: 700; color: white; margin-bottom: 0; }}
    .image-container {{
      position: relative;
      width: 100%;
      min-height: 260px;
      border-radius: 24px;
      overflow: hidden;
      background: linear-gradient(180deg, rgba(9, 16, 34, 0.96), rgba(20, 30, 52, 0.98));
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
      padding: 14px;
    }}
    .image-container img {{
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      border-radius: 18px;
      background: rgba(255,255,255,0.02);
    }}
    .image-placeholder {{
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      min-height: 260px;
      color: rgba(255,255,255,0.6);
      font-size: 18px;
      background: rgba(15, 23, 42, 0.75);
      border-radius: 24px;
      border: 1px dashed rgba(255,255,255,0.22);
      gap: 16px;
      padding: 24px;
    }}
    .placeholder-icon {{ font-size: 48px; }}
    .placeholder-text {{ max-width: 260px; font-weight: 600; }}
  </style>
</head>
<body>
  <div class="content">
    <div class="card">
      <h1>{title}</h1>
      <ul>{bullet_items}</ul>
      {takeaway_html}
    </div>
    <div class="visual">
      {image_html}
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


def _download_image_as_data_uri(url: str, out_path: str) -> str:
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(url)
            response.raise_for_status()
        with open(out_path, "wb") as f:
            f.write(response.content)
        _enhance_slide_image_sync(out_path, out_path)
        return _data_uri_from_file(out_path)
    except Exception as exc:
        raise RuntimeError(f"Failed to download module image from {url}: {exc}")


def _build_image_prompt(prompt: str, slide_text: str, title: str = "") -> str:
    context_bits = [bit for bit in [title, slide_text] if bit]
    context = ". ".join(context_bits[:2]).strip()
    """Domain-neutral image prompt; all subject matter comes from caller context."""
    style_hint = (
        "Create a high-resolution 1:1 visual with strong contrast, clear educational composition, "
        "subtle depth, and a polished professional style. Preserve the subject and setting implied by "
        "the provided context. Keep it text-free, label-free, and free of unrelated generic imagery."
    )
    if prompt:
        if context:
            return f"{prompt}. Relevant to: {context}. {style_hint}"
        return f"{prompt}. {style_hint}"
    if context:
        return f"A high-resolution professional illustration for an enterprise training slide about: {context}. {style_hint}"
    return f"A polished enterprise training illustration based on the module context. {style_hint}"


def _looks_placeholder(text: str) -> bool:
    normalized = (text or "").strip().lower()
    return not normalized or normalized.startswith("key concept") or "placeholder" in normalized


def _looks_placeholder_bullets(bullets: List[str]) -> bool:
    if not bullets:
        return True
    return all(_looks_placeholder(b) for b in bullets[:3])


def _derive_bullets_from_content(content: str, max_items: int = 3) -> List[str]:
    lines: List[str] = []
    for raw_line in (content or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#"):
            line = re.sub(r"^#+\s*", "", line).strip()
        if len(line) < 24:
            continue
        if line not in lines:
            lines.append(line)
        if len(lines) >= max_items:
            return lines[:max_items]

    sentences = re.split(r"(?<=[.!?])\s+", content or "")
    for sentence in sentences:
        sentence = sentence.strip()
        if len(sentence) < 24:
            continue
        if sentence not in lines:
            lines.append(sentence)
        if len(lines) >= max_items:
            break
    return lines[:max_items]


def _extract_content_excerpt(content: str, title: str = "", limit: int = 260) -> str:
    parts = []
    if title:
        parts.append(title)
    text = " ".join((content or "").split())
    if text:
        parts.append(text[:limit])
    return ". ".join(parts).strip()


def _enhance_slide_image_sync(src_path: str, out_path: str) -> str:
    """Upscale and color-balance a slide image so it reads well in the video frame."""
    with Image.open(src_path) as source:
        image = source.convert("RGBA")

    canvas_size = 1400
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (10, 18, 36, 255))
    overlay = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay, "RGBA")
    overlay_draw.ellipse((-120, -120, 720, 720), fill=(52, 124, 196, 80))
    overlay_draw.ellipse((720, 860, 1480, 1480), fill=(229, 168, 37, 68))
    overlay_draw.ellipse((180, 840, 960, 1460), fill=(77, 181, 176, 50))
    canvas = Image.alpha_composite(canvas, overlay)

    resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.BICUBIC)
    fit = ImageOps.contain(image, (1120, 1120), method=resample)
    fit = ImageEnhance.Color(fit).enhance(1.12)
    fit = ImageEnhance.Contrast(fit).enhance(1.08)
    fit = ImageEnhance.Sharpness(fit).enhance(1.18)

    shadow = Image.new("RGBA", (fit.width + 46, fit.height + 46), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow, "RGBA")
    shadow_draw.rounded_rectangle((18, 18, shadow.width - 8, shadow.height - 8), radius=42, fill=(0, 0, 0, 72))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))

    x = (canvas_size - shadow.width) // 2
    y = (canvas_size - shadow.height) // 2
    canvas.alpha_composite(shadow, (x, y))

    mask = Image.new("L", fit.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle((0, 0, fit.width - 1, fit.height - 1), radius=36, fill=255)
    x = (canvas_size - fit.width) // 2
    y = (canvas_size - fit.height) // 2
    canvas.paste(fit, (x, y), mask)

    border_draw = ImageDraw.Draw(canvas, "RGBA")
    border_draw.rounded_rectangle(
        (x - 2, y - 2, x + fit.width + 1, y + fit.height + 1),
        radius=38,
        outline=(255, 255, 255, 120),
        width=2,
    )

    canvas.convert("RGB").save(out_path, "PNG")
    return out_path


def _extract_image_bytes_from_response(response: Any) -> bytes | None:
    def _normalize_bytes(candidate: Any) -> bytes | None:
        if isinstance(candidate, bytes):
            return candidate
        if isinstance(candidate, str):
            try:
                return base64.b64decode(candidate)
            except Exception:
                return None
        return None

    def _extract_from_part(item: Any) -> bytes | None:
        if item is None:
            return None
        if isinstance(item, dict):
            for key in ("inline_data", "inlineData"):
                inline = item.get(key)
                if isinstance(inline, dict):
                    for nested_key in ("data", "b64_json", "image", "b64_image", "content"):
                        normalized = _normalize_bytes(inline.get(nested_key))
                        if normalized:
                            return normalized
            for key in ("data", "b64_json", "image", "b64_image", "content"):
                normalized = _normalize_bytes(item.get(key))
                if normalized:
                    return normalized
            return None

        for attr in ("inline_data", "inlineData"):
            inline = getattr(item, attr, None)
            if inline is not None:
                for nested_attr in ("data", "b64_json", "image", "b64_image", "content"):
                    normalized = _normalize_bytes(getattr(inline, nested_attr, None))
                    if normalized:
                        return normalized

        for attr in ("data", "b64_json", "image", "b64_image", "content"):
            normalized = _normalize_bytes(getattr(item, attr, None))
            if normalized:
                return normalized
        return None

    if hasattr(response, "parts"):
        parts = getattr(response, "parts")
        if parts:
            for item in parts:
                normalized = _extract_from_part(item)
                if normalized:
                    return normalized

    if hasattr(response, "candidates"):
        candidates = getattr(response, "candidates")
        if candidates:
            for candidate in candidates:
                content = getattr(candidate, "content", None)
                if content is None and isinstance(candidate, dict):
                    content = candidate.get("content")
                if content is None:
                    continue
                parts = getattr(content, "parts", None)
                if parts is None and isinstance(content, dict):
                    parts = content.get("parts")
                if parts:
                    for item in parts:
                        normalized = _extract_from_part(item)
                        if normalized:
                            return normalized

    if hasattr(response, "generated_images"):
        generated_images = getattr(response, "generated_images")
        if generated_images:
            for item in generated_images:
                image_obj = getattr(item, "image", None)
                if image_obj is None and isinstance(item, dict):
                    image_obj = item.get("image")
                if image_obj is None:
                    continue
                for attr in ("image_bytes", "bytes", "data"):
                    value = getattr(image_obj, attr, None)
                    normalized = _normalize_bytes(value)
                    if normalized:
                        return normalized
                if hasattr(image_obj, "save"):
                    try:
                        tmp_path = getattr(response, "_codex_tmp_path", None) or ""
                        if tmp_path:
                            image_obj.save(tmp_path)
                            with open(tmp_path, "rb") as f:
                                return f.read()
                    except Exception:
                        pass

    if hasattr(response, "images"):
        images = getattr(response, "images")
        if images:
            for item in images:
                if isinstance(item, dict):
                    for key in ["b64_json", "image", "b64_image", "content"]:
                        maybe = item.get(key)
                        normalized = _normalize_bytes(maybe)
                        if normalized:
                            return normalized
                else:
                    normalized = _normalize_bytes(item)
                    if normalized:
                        return normalized

    if hasattr(response, "output"):
        output = getattr(response, "output")
        if output:
            for item in output:
                normalized = _extract_from_part(item)
                if normalized:
                    return normalized

    if hasattr(response, "data"):
        data = getattr(response, "data")
        if isinstance(data, list) and data:
            for item in data:
                normalized = _extract_from_part(item)
                if normalized:
                    return normalized

    if isinstance(response, dict):
        for key in ["images", "data", "output"]:
            value = response.get(key)
            if isinstance(value, list) and value:
                for item in value:
                    normalized = _extract_from_part(item)
                    if normalized:
                        return normalized
        for key in ["parts", "candidates"]:
            value = response.get(key)
            if isinstance(value, list) and value:
                for item in value:
                    normalized = _extract_from_part(item)
                    if normalized:
                        return normalized
        for key in ["b64_json", "image", "b64_image", "content", "text"]:
            normalized = _normalize_bytes(response.get(key))
            if normalized:
                return normalized

    return None


def _render_local_fallback_image_sync(prompt: str, out_path: str) -> str:
    """Create a deterministic abstract illustration if all remote image APIs fail."""
    width, height = 1024, 1024
    img = Image.new("RGB", (width, height), (14, 23, 42))
    draw = ImageDraw.Draw(img, "RGBA")

    gradients = [
        ((32, 64, 128, 90), (980, 120, 680, 640)),
        ((246, 190, 0, 70), (650, 740, 980, 980)),
        ((86, 174, 255, 70), (120, 540, 480, 920)),
    ]
    for color, box in gradients:
        draw.ellipse(box, fill=color)

    draw.rounded_rectangle((60, 72, 964, 952), radius=42, outline=(255, 255, 255, 28), width=3)
    draw.rounded_rectangle((102, 146, 592, 410), radius=28, fill=(20, 30, 58, 210), outline=(255, 255, 255, 22), width=2)
    draw.rounded_rectangle((620, 146, 920, 410), radius=28, fill=(25, 38, 72, 220), outline=(255, 255, 255, 18), width=2)
    draw.rounded_rectangle((102, 454, 920, 840), radius=28, fill=(18, 28, 52, 220), outline=(255, 255, 255, 18), width=2)

    try:
        title_font = ImageFont.truetype("arialbd.ttf", 34)
        body_font = ImageFont.truetype("arial.ttf", 22)
        small_font = ImageFont.truetype("arial.ttf", 18)
    except Exception:
        title_font = ImageFont.load_default()
        body_font = ImageFont.load_default()
        small_font = ImageFont.load_default()

    prompt_text = (prompt or "Generated learning visual").strip()
    prompt_text = prompt_text[:140] + ("..." if len(prompt_text) > 140 else "")
    draw.text((128, 188), "Auto-generated visual", font=title_font, fill=(235, 242, 255, 255))
    draw.multiline_text((128, 248), prompt_text, font=body_font, fill=(205, 218, 236, 255), spacing=8)
    draw.text((128, 510), "Remote image generation failed, so a local fallback was rendered.", font=small_font, fill=(180, 191, 208, 255))
    draw.text((128, 546), "This keeps the slide filled instead of leaving a placeholder box.", font=small_font, fill=(180, 191, 208, 255))

    # Add a simple abstract chart-like motif.
    for idx, h in enumerate((120, 210, 160, 260)):
        x = 680 + idx * 44
        draw.rounded_rectangle((x, 720 - h, x + 24, 720), radius=8, fill=(99, 179, 237, 200))

    img.save(out_path, "PNG")
    return out_path


def _generate_image_from_gemini_flash_sync(prompt: str, out_path: str) -> str:
    api_key = (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("Google API key not found for image generation")

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(model=REMOTE_IMAGE_MODEL, contents=prompt)

    image_bytes = _extract_image_bytes_from_response(response)
    if not image_bytes:
        raise RuntimeError(f"Gemini image generation returned no image bytes: {response}")

    with open(out_path, "wb") as f:
        f.write(image_bytes)

    return out_path


def _generate_image_from_legacy_imagen_sync(prompt: str, out_path: str) -> str:
    api_key = (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("Google API key not found for image generation")

    client = genai.Client(api_key=api_key)
    response = client.models.generate_images(
        model=LEGACY_IMAGE_MODEL,
        prompt=prompt,
        size="1024x1024",
    )

    image_bytes = _extract_image_bytes_from_response(response)
    if not image_bytes:
        raise RuntimeError(f"Image generation returned no image bytes: {response}")

    with open(out_path, "wb") as f:
        f.write(image_bytes)

    return out_path


async def _generate_image_from_google(prompt: str, out_path: str) -> str:
    try:
        return await run_in_threadpool(_generate_image_from_gemini_flash_sync, prompt, out_path)
    except Exception as flash_exc:
        print(f"[W5] WARNING: Gemini 2.5 Flash image generation failed: {flash_exc}")
        try:
            return await run_in_threadpool(_generate_image_from_legacy_imagen_sync, prompt, out_path)
        except Exception as imagen_exc:
            print(f"[W5] WARNING: Imagen fallback failed: {imagen_exc}")
            return await run_in_threadpool(_render_local_fallback_image_sync, prompt, out_path)


def _data_uri_from_file(path: str) -> str:
    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("utf-8")
    return f"data:image/png;base64,{encoded}"


async def _resolve_slide_image(
    seg_id: str,
    prompt: str,
    slide_text: str,
    title: str,
    module_content: str,
    tmp_dir: str,
    module_images: List[Any],
    slide_query: str,
) -> Dict[str, Any]:
    out_path = os.path.join(tmp_dir, f"slide_image_{seg_id}.png")

    if module_images:
        best = select_best_candidate(slide_query, module_images, threshold=0.25)
        if best and best.get("url"):
            try:
                _download_image_as_data_uri(best["url"], out_path)
                print(
                    f"[W5] Using matched uploaded image for segment {seg_id} "
                    f"(score={best['match_score']:.3f})"
                )
                return {
                    "image_url": _data_uri_from_file(out_path),
                    "image_source": "uploaded_match",
                    "image_cost_usd": 0.0,
                    "image_match_score": best["match_score"],
                    "matched_image_url": best["url"],
                }
            except Exception as exc:
                print(
                    f"[W5] WARNING: Failed to download matched uploaded image, "
                    f"falling back to generated image: {exc}"
                )

        ranked = rank_candidates(slide_query, module_images)
        if ranked:
            print(
                f"[W5] Best uploaded image score for segment {seg_id}: "
                f"{ranked[0]['match_score']:.3f}"
            )

    content_excerpt = _extract_content_excerpt(module_content, title=title)
    prompt_text = slide_text or content_excerpt or title
    context_for_image = ". ".join(
        part for part in [title, prompt_text, content_excerpt[:1200]] if part
    )
    image_prompt = _build_image_prompt(prompt, context_for_image, title=title)
    try:
        await _generate_image_from_google(image_prompt, out_path)
        _enhance_slide_image_sync(out_path, out_path)
        print(f"[W5] Generated slide image for segment {seg_id} from prompt: {image_prompt}")
        return {
            "image_url": _data_uri_from_file(out_path),
            "image_source": "generated",
            "image_cost_usd": IMAGE_OUTPUT_COST_USD,
            "image_match_score": 0.0,
            "matched_image_url": "",
        }
    except Exception as exc:
        print(f"[W5] WARNING: Slide image generation failed: {exc}")
        return {
            "image_url": "",
            "image_source": "none",
            "image_cost_usd": 0.0,
            "image_match_score": 0.0,
            "matched_image_url": "",
        }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def render_lecture_slide(
    seg_id: str,
    title: str,
    bullets: List[str],
    key_takeaway: str,
    slide_text: str,
    module_content: str,
    tmp_dir: str,
    module_images: List[Any],
    prompt: str,
) -> Dict[str, Any]:
    effective_bullets = bullets
    if _looks_placeholder_bullets(effective_bullets):
        effective_bullets = _derive_bullets_from_content(module_content, max_items=3)
    if not effective_bullets:
        effective_bullets = ["Key point 1", "Key point 2", "Key point 3"]

    slide_query = build_slide_query(
        title=title,
        bullets=effective_bullets,
        key_takeaway=key_takeaway,
        slide_text=slide_text or module_content,
        prompt=prompt,
    )
    image_result = await _resolve_slide_image(
        seg_id,
        prompt,
        slide_text,
        title,
        module_content,
        tmp_dir,
        module_images,
        slide_query,
    )
    image_url = image_result["image_url"]
    html = _lecture_slide_html(title, effective_bullets, key_takeaway, "", image_url)
    out = os.path.join(tmp_dir, f"slide_{seg_id}.png")
    await run_in_threadpool(_render_html_to_png_sync, html, out)
    image_result["slide_png"] = out
    return image_result


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

    print(f"[W5] Module images available: {len(storyboard_data.get('module_images', []))}")
    for seg in enriched_segments:
        seg_id = seg.get("id", "unknown")
        seg_type = seg.get("type", "lecture")

        try:
            if seg_type == "lecture":
                slide_result = await render_lecture_slide(
                    seg_id=seg_id,
                    title=seg.get("title", ""),
                    bullets=seg.get("slide_bullets", []),
                    key_takeaway=seg.get("key_takeaway", ""),
                    slide_text=seg.get("slide_text", ""),
                    module_content=storyboard_data.get("clean_text", ""),
                    tmp_dir=tmp_dir,
                    module_images=seg.get("module_images", []),
                    prompt=seg.get("visual_prompt", seg.get("title", "")),
                )
                seg["slide_png"] = slide_result.get("slide_png", "")
                seg["slide_image_source"] = slide_result.get("image_source", "none")
                seg["slide_image_cost_usd"] = slide_result.get("image_cost_usd", 0.0)
                seg["slide_image_match_score"] = slide_result.get("image_match_score", 0.0)
                seg["matched_slide_image_url"] = slide_result.get("matched_image_url", "")
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
