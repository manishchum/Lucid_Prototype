import os
import re
import json
from typing import List, Dict, Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import google.generativeai as genai

router = APIRouter()

genAI = genai.GenerativeModel("gemini-2.5-flash-lite") if (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")) else None


# ------------------------------------------------------------------
# TYPES
# ------------------------------------------------------------------

MindGraph = Dict[str, List[Dict[str, Any]]]


# ------------------------------------------------------------------
# SPLIT INTO SECTIONS
# ------------------------------------------------------------------

def splitIntoSections(content: str):
    sections = []
    if not content or not content.strip():
        return sections

    cleaned = content.replace("\r", "\n")
    lines = cleaned.split("\n")

    currentTitle = ""
    buffer = []

    def pushBuffer():
        nonlocal buffer
        text = "\n".join(buffer).strip()
        if text:
            sections.append({"title": currentTitle or "Detail", "text": text})
        buffer = []

    for l in lines:
        l = l.strip()
        if not l:
            if buffer:
                buffer.append("")
            continue

        if re.match(r"^Learning Objectives?:", l, re.I):
            if buffer: pushBuffer()
            currentTitle = "Learning Objectives"
            continue

        if re.match(r"^Section\s+\d+", l, re.I):
            if buffer: pushBuffer()
            currentTitle = re.sub(r"^Section\s+\d+\s*:\s*", "", l, flags=re.I).strip() or l
            continue

        if re.match(r"^Activity\s+\d+", l, re.I):
            if buffer: pushBuffer()
            currentTitle = l
            continue

        if re.match(r"^Module Summary:", l, re.I):
            if buffer: pushBuffer()
            currentTitle = "Module Summary"
            continue

        if re.match(r"^Discussion Prompts?:", l, re.I):
            if buffer: pushBuffer()
            currentTitle = "Discussion Prompts"
            continue

        if re.match(r"^[A-Z][A-Z\s]{3,}:$", l) or l.endswith(":"):
            if buffer: pushBuffer()
            currentTitle = l.rstrip(":").strip()
            continue

        buffer.append(l)

    if buffer:
        pushBuffer()

    return sections


# ------------------------------------------------------------------
# TOP SENTENCES
# ------------------------------------------------------------------

def topSentences(text: str, max=3):
    if not text:
        return []
    s = re.findall(r"[^.!?]+[.!?]?", text.replace("\n", " "))
    return [t.strip().replace('"', '').replace("'", "").replace("`", "") for t in s[:max]]


# ------------------------------------------------------------------
# CREATE MIND GRAPH (HEURISTIC)
# ------------------------------------------------------------------

def createMindGraph(content: str, title: str = "", branchCount=4) -> MindGraph:
    nodes = []
    edges = []

    rootId = "1"
    nodes.append({
        "id": rootId,
        "label": (title or "Study Material").strip()[:80] or "Study Material",
        "x": 250,
        "y": 0
    })

    sections = splitIntoSections(content)

    branchLabels = []
    for s in sections:
        if s["title"].strip() and len(branchLabels) < branchCount:
            branchLabels.append(s["title"].strip())

    for s in sections:
        if len(branchLabels) >= branchCount:
            break
        if not s["title"] or s["title"] == "Detail":
            head = topSentences(s["text"], 1)
            if head:
                branchLabels.append(head[0][:60])

    if len(branchLabels) < branchCount:
        paras = [p.strip() for p in re.split(r"\n\s*\n+", content) if p.strip()]
        for p in paras:
            if len(branchLabels) >= branchCount:
                break
            s = topSentences(p, 1)
            if s:
                branchLabels.append(s[0])

    if len(branchLabels) > 6:
        branchLabels = branchLabels[:6]
    while len(branchLabels) < 4:
        branchLabels.append("Key Concept")

    def estimateWidth(text: str):
        return max(80, min(360, len(text) * 7 + 40))

    branchInfos = []
    for label in branchLabels:
        matching = next((s for s in sections if s["title"].strip() == label), None)
        subSource = matching["text"] if matching else ""
        points = topSentences(subSource or label, 4)
        maxSub = min(4, max(2, len(points) or 2))
        subPoints = [p[:80] for p in points[:maxSub]]

        labelW = estimateWidth(label[:80])
        subW = max([estimateWidth(p) for p in subPoints], default=80)
        gap = 24
        subSpan = len(subPoints) * subW + (len(subPoints) - 1) * gap if subPoints else subW
        slotWidth = max(160, min(1200, max(labelW, subSpan) + 40))

        branchInfos.append({"label": label[:80], "subPoints": subPoints, "slotWidth": slotWidth})

    cursorX = 50

    for info in branchInfos:
        id = str(len(nodes) + 1)
        slotMid = round(cursorX + info["slotWidth"] / 2)
        nodes.append({"id": id, "label": info["label"], "x": slotMid, "y": 120})
        edges.append({"from": rootId, "to": id})

        subWidths = [estimateWidth(p) for p in info["subPoints"]]
        totalSubWidth = sum(subWidths)
        gaps = (len(subWidths) - 1) * 24 if len(subWidths) > 1 else 0
        startX = slotMid - round((totalSubWidth + gaps) / 2)

        sx = startX
        for p, w in zip(info["subPoints"], subWidths):
            sid = str(len(nodes) + 1)
            nodeMid = sx + round(w / 2)
            nodes.append({"id": sid, "label": p, "x": nodeMid, "y": 240})
            edges.append({"from": id, "to": sid})
            sx += w + 24

        cursorX += info["slotWidth"]

    return {"nodes": nodes, "edges": edges}


# ------------------------------------------------------------------
# ROUTE
# ------------------------------------------------------------------

@router.post("/generate-mindmap")
async def POST(req: Request):
    try:
        body = await req.json()
        content = str(body.get("content") or "")
        title = str(body.get("title") or "")

        gemKey = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or os.getenv("GENAI_API_KEY")

        if gemKey:
            try:
                genai.configure(api_key=gemKey)
                model = genai.GenerativeModel("gemini-2.5-flash-lite")

                system = """You are a helpful assistant that converts study material into a compact mind-map JSON suitable for NotebookLM.
Output ONLY valid JSON with two keys: nodes and edges. nodes is an array of { id, label, x, y } and edges is an array of { from, to }.
Constraints: 1 root node (id "1") at y=0; 4 to 6 main branches (children of root) at y=120; each branch should have 2 to 4 sub-nodes at y=240.
Keep labels short (<=80 chars), concise, and hierarchical. Do not include extra fields. Use numeric string ids ("1","2",...).
If content is long, prioritize main concepts, section headings, and key bullets."""

                prompt = f"Title: {title}\n\nContent:\n{content}"
                result = model.generate_content(system + "\n\n" + prompt)
                aiText = result.text or ""

                try:
                    firstChar = aiText.find("{")
                    lastChar = aiText.rfind("}")
                    jsonText = aiText[firstChar:lastChar + 1] if firstChar != -1 and lastChar != -1 else aiText
                    parsed = json.loads(jsonText)
                except:
                    parsed = None

                if parsed and isinstance(parsed.get("nodes"), list) and isinstance(parsed.get("edges"), list) and any(str(n.get("id")) == "1" for n in parsed["nodes"]):
                    return JSONResponse(parsed)

            except Exception as gemErr:
                print("Gemini mindmap generation failed:", gemErr)

        graph = createMindGraph(content, title, 4)
        return JSONResponse(graph)

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
