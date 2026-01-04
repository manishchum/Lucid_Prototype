"use client";

import React, { useEffect, useRef, useState } from 'react';

type Node = { id: string; label: string; x: number; y: number };
type Edge = { from: string; to: string };

export default function MindmapViewer({
  data,
  source,
}: {
  data: { nodes: Node[]; edges: Edge[] } | null;
  source?: string;
}) {
  if (!data || !data.nodes) return null;
  const nodes = data.nodes;
  const edges = data.edges || [];

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs) - 100;
  const maxX = Math.max(...xs) + 100;
  const minY = Math.min(...ys) - 100;
  const maxY = Math.max(...ys) + 100;
  const naturalWidth = Math.max(600, maxX - minX);
  const naturalHeight = Math.max(400, maxY - minY);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [scale, setScale] = useState(1);
  const panRef = useRef({ dragging: false, startX: 0, startY: 0, originPanX: 0, originPanY: 0 });
  const touchRef = useRef({
    mode: 'none' as 'none' | 'pan' | 'pinch',
    startDist: 0,
    startScale: 1,
    startMidClientX: 0,
    startMidClientY: 0,
    originPanX: 0,
    originPanY: 0,
    startX: 0,
    startY: 0,
  });

  const [hovered, setHovered] = useState<{ id: string; x: number; y: number; label: string } | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [relatedFull, setRelatedFull] = useState<string | null>(null);

  // decode HTML entities (runs only in browser, this is a client component)
  const decodeHtmlEntities = (str: string) => {
    try {
      const txt = document.createElement('textarea');
      txt.innerHTML = str;
      return txt.value;
    } catch (e) {
      return str;
    }
  };

  useEffect(() => {
    // center the map initially
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    // center offsets so root roughly centered
    setPanX((cw - naturalWidth) / 2);
    setPanY((ch - naturalHeight) / 6);
    setScale(Math.min(cw / naturalWidth, ch / naturalHeight, 1));
  }, [naturalWidth, naturalHeight]);

  // Mouse handlers for panning
  const onMouseDown = (e: React.MouseEvent) => {
    if (!svgRef.current) return;
    panRef.current.dragging = true;
    panRef.current.startX = e.clientX;
    panRef.current.startY = e.clientY;
    panRef.current.originPanX = panX;
    panRef.current.originPanY = panY;
    // Some browsers/environments may not provide a pointerId for mouse events
    // and calling setPointerCapture without an active pointer throws. Guard and fail-safe.
    try {
      const pid = (e.nativeEvent as any)?.pointerId;
      if (pid !== undefined && (e.target as Element).setPointerCapture) {
        (e.target as Element).setPointerCapture(pid);
      }
    } catch (err) {
      // swallow - fallback to normal mouse handling
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!panRef.current.dragging) return;
    const dx = e.clientX - panRef.current.startX;
    const dy = e.clientY - panRef.current.startY;
    setPanX(panRef.current.originPanX + dx);
    setPanY(panRef.current.originPanY + dy);
  };

  const onMouseUp = () => {
    panRef.current.dragging = false;
  };

  // Touch handlers: single-touch pan and two-finger pinch
  const getTouchMidpoint = (t1: any, t2: any) => {
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  };

  const getTouchDistance = (t1: any, t2: any) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (!svgRef.current) return;
    e.preventDefault();
    const touches = e.touches;
    if (touches.length === 1) {
      // single finger - pan
      touchRef.current.mode = 'pan';
      touchRef.current.startX = touches[0].clientX;
      touchRef.current.startY = touches[0].clientY;
      touchRef.current.originPanX = panX;
      touchRef.current.originPanY = panY;
    } else if (touches.length === 2) {
      // pinch
      touchRef.current.mode = 'pinch';
      touchRef.current.startDist = getTouchDistance(touches[0], touches[1]);
      touchRef.current.startScale = scale;
      const mid = getTouchMidpoint(touches[0], touches[1]);
      touchRef.current.startMidClientX = mid.x;
      touchRef.current.startMidClientY = mid.y;
      touchRef.current.originPanX = panX;
      touchRef.current.originPanY = panY;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!svgRef.current) return;
    e.preventDefault();
    const touches = e.touches;
    const rect = svgRef.current.getBoundingClientRect();
    if (touches.length === 1 && touchRef.current.mode === 'pan') {
      const dx = touches[0].clientX - touchRef.current.startX;
      const dy = touches[0].clientY - touchRef.current.startY;
      setPanX(touchRef.current.originPanX + dx);
      setPanY(touchRef.current.originPanY + dy);
    } else if (touches.length === 2 && touchRef.current.mode === 'pinch') {
      const dist = getTouchDistance(touches[0], touches[1]);
      const ratio = dist / Math.max(1, touchRef.current.startDist);
      const newScale = Math.min(Math.max(0.2, touchRef.current.startScale * ratio), 4);

      const mid = getTouchMidpoint(touches[0], touches[1]);
      const mouseX = mid.x - rect.left;
      const mouseY = mid.y - rect.top;

      // compute svg-space coords of midpoint
      const svgX = (mouseX - touchRef.current.originPanX) / touchRef.current.startScale;
      const svgY = (mouseY - touchRef.current.originPanY) / touchRef.current.startScale;

      const newPanX = mouseX - svgX * newScale;
      const newPanY = mouseY - svgY * newScale;

      setScale(newScale);
      setPanX(newPanX);
      setPanY(newPanY);
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    // if fingers lifted, reset mode when no touches
    if (e.touches.length === 0) {
      touchRef.current.mode = 'none';
    }
  };

  // Wheel to zoom at cursor
  const onWheel = (e: React.WheelEvent) => {
    if (!svgRef.current) return;
    e.preventDefault();
    const delta = -e.deltaY;
    const zoomFactor = delta > 0 ? 1.12 : 0.88;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const svgX = (mouseX - panX) / scale;
    const svgY = (mouseY - panY) / scale;

    const newScale = Math.min(Math.max(0.2, scale * zoomFactor), 4);

    const newPanX = mouseX - svgX * newScale;
    const newPanY = mouseY - svgY * newScale;

    setScale(newScale);
    setPanX(newPanX);
    setPanY(newPanY);
  };

  const resetView = () => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setScale(Math.min(rect.width / naturalWidth, rect.height / naturalHeight, 1));
    setPanX((rect.width - naturalWidth) / 2);
    setPanY((rect.height - naturalHeight) / 6);
  };

  const findNode = (id: string) => nodes.find((n) => String(n.id) === String(id));

  // Tooltip position calculation
  const nodeScreenPos = (n: Node) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const sx = panX + n.x * scale + rect.left;
    const sy = panY + n.y * scale + rect.top;
    return { x: sx, y: sy };
  };

  return (
    <div className="relative w-full h-full bg-white select-none">
      <div className="absolute top-2 right-2 z-10 flex gap-2">
        <button
          onClick={() => setScale((s) => Math.min(s * 1.2, 4))}
          className="bg-white px-2 py-1 rounded shadow"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => setScale((s) => Math.max(s / 1.2, 0.2))}
          className="bg-white px-2 py-1 rounded shadow"
          title="Zoom out"
        >
          -
        </button>
        <button onClick={resetView} className="bg-white px-2 py-1 rounded shadow" title="Reset view">
          Reset
        </button>
      </div>

      <svg
        ref={svgRef}
        className="w-full h-full cursor-grab"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000" floodOpacity="0.12" />
          </filter>
        </defs>

        {/* group transformed by pan/zoom */}
        <g transform={`translate(${panX}, ${panY}) scale(${scale})`}>
          {/* edges */}
          {edges.map((e, i) => {
            const a = findNode(e.from);
            const b = findNode(e.to);
            if (!a || !b) return null;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#CBD5E1"
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })}

          {/* nodes */}
          {nodes.map((n) => {
            // Wrap long labels into multiple lines so full text is visible
            const wrapLabel = (text: string, maxChars = 36) => {
              const words = String(text).split(/\s+/);
              const lines: string[] = [];
              let cur = '';
              for (const w of words) {
                if ((cur + ' ' + w).trim().length <= maxChars) {
                  cur = (cur + ' ' + w).trim();
                } else {
                  if (cur) lines.push(cur);
                  cur = w;
                }
              }
              if (cur) lines.push(cur);
              return lines;
            };

            const lines = wrapLabel(n.label, 36);
            const longest = lines.reduce((a, b) => (b.length > a ? b.length : a), 0);
            const rectW = Math.max(80, Math.min(700, longest * 7 + 48));
            const lineHeight = 18;
            const rectH = Math.max(34, lines.length * lineHeight + 12);
            const x = n.x - rectW / 2;
            const y = n.y - rectH / 2;
            return (
              <g
                key={n.id}
                transform={`translate(${x}, ${y})`}
                onMouseEnter={(evt) => {
                  const pos = nodeScreenPos(n);
                  setHovered({ id: n.id, x: pos.x, y: pos.y, label: n.label });
                }}
                onMouseLeave={() => setHovered(null)}
                  onClick={() => {
                    // Center on node when clicked and open detail panel
                    if (!svgRef.current) return;
                    const rect = svgRef.current.getBoundingClientRect();
                    const targetScale = Math.min(2, Math.max(0.5, scale));
                    const newPanX = rect.width / 2 - n.x * targetScale;
                    const newPanY = rect.height / 2 - n.y * targetScale;
                    setScale(targetScale);
                    setPanX(newPanX);
                    setPanY(newPanY);
                    setSelectedNode(n);
                  }}
                style={{ cursor: 'pointer' }}
              >
                <rect width={rectW} height={rectH} rx={8} ry={8} fill="#0f172a" fillOpacity={0.95} filter="url(#shadow)" />
                <text
                  x={rectW / 2}
                  y={rectH / 2}
                  textAnchor="middle"
                  fill="#fff"
                  fontSize={12}
                  fontFamily="Inter, Arial, sans-serif"
                >
                  {lines.map((ln, idx) => (
                    <tspan key={idx} x={rectW / 2} dy={idx === 0 ? `-${(lines.length - 1) * (lineHeight / 2) - 4}` : lineHeight}>
                      {ln}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {/* Touch handlers are attached on the SVG element to avoid blocking mouse events */}

      {/* Tooltip */}
      {hovered && (
        <div
          className="absolute z-20 bg-black text-white text-sm px-2 py-1 rounded pointer-events-none"
          style={{ left: hovered.x + 12, top: hovered.y - 18, whiteSpace: 'nowrap' }}
        >
          {hovered.label}
        </div>
      )}

      {/* Node detail panel */}
      {selectedNode && (
        <div className="absolute right-0 top-0 h-full w-80 bg-background shadow-lg z-30 p-4 overflow-auto border-l border-border">
          <div className="relative pt-6">
            <button
              onClick={() => setSelectedNode(null)}
              className="absolute right-3 -top-3 text-gray-500 hover:text-gray-800 p-2 rounded-full bg-white/80 shadow-sm"
              aria-label="Close"
              style={{ lineHeight: 1 }}
            >
              ✕
            </button>
            <h3 className="text-lg font-bold text-black text-center w-full mt-1">{selectedNode.label}</h3>
          </div>
          <div className="mt-3 text-sm text-gray-700">
            {/* Short snippet */}
            <p className="mb-3 text-sm text-gray-800">{extractSnippetForLabel(selectedNode.label, source || '')}</p>

            {/* Show related content button */}
            {!relatedOpen ? (
              <button
                className="text-sm text-blue-600 hover:underline"
                onClick={async () => {
                  // Try server-side LLM summary first, fallback to local extraction
                  setRelatedOpen(true);
                  setRelatedFull('Loading related content...');
                  try {
                    const res = await fetch('/api/mindmap-node-summary', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ label: selectedNode.label, source }),
                    });
                    if (res.ok) {
                      const json = await res.json();
                      const text = (json?.summary || json?.text || '').toString();
                      if (text && text.trim()) {
                        setRelatedFull(text.trim());
                        return;
                      }
                    }
                  } catch (e) {
                    // ignore and fallback
                  }

                  // fallback local extraction
                  const full = extractFullSnippetForLabel(selectedNode.label, source || '');
                  setRelatedFull(full);
                }}
              >
                Show related content
              </button>
            ) : (
              <div className="mt-3 text-sm text-gray-800">
                <div className="whitespace-pre-line">{relatedFull}</div>
                <button
                  className="mt-3 text-sm text-blue-600 hover:underline"
                  onClick={() => {
                    setRelatedOpen(false);
                    setRelatedFull(null);
                  }}
                >
                  Hide related content
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper: extract a short snippet for node from source text
function renderNodeDetail(node: Node, source?: string) {
  if (!source || !source.trim()) {
    return <p>No additional content available.</p>;
  }

  const snippet = extractSnippetForLabel(node.label, source);
  return (
    <>
      <p className="mb-3 text-sm text-gray-800">{snippet}</p>
      <a className="text-xs text-blue-600 hover:underline" href="#" onClick={(e) => e.preventDefault()}>
        Show related content
      </a>
    </>
  );
}

function extractSnippetForLabel(label: string, source: string) {
  // decode entities then strip tags
  const decoded = (typeof document !== 'undefined') ? (document.createElement('textarea').innerHTML = source, document.createElement('textarea').value = source, decodeURIComponent(encodeURIComponent(source))) : source;
  // Use the decodeHtmlEntities helper if available (component scope), otherwise basic replace
  let plain = source;
  try {
    if (typeof document !== 'undefined') {
      const t = document.createElement('textarea');
      t.innerHTML = source;
      plain = t.value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } else {
      plain = source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  } catch (e) {
    plain = source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const labelWords = label
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[^a-z0-9]/gi, ''));
  if (!plain) return '';

  // Prefer a single sentence that matches most label words
  const sentences = plain.match(/[^.!?]+[.!?]+/g) || [plain];
  let bestSent = '';
  let bestScore = 0;
  for (const sent of sentences) {
    const low = sent.toLowerCase();
    let score = 0;
    for (const w of labelWords) {
      if (w.length > 2 && low.includes(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestSent = sent.trim();
    }
  }
  if (bestScore > 0) return bestSent;

  // Paragraph-level fallback
  const paragraphs = plain.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let bestPara = '';
  bestScore = 0;
  for (const p of paragraphs) {
    const low = p.toLowerCase();
    let score = 0;
    for (const w of labelWords) {
      if (w.length > 2 && low.includes(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPara = p;
    }
  }
  if (bestScore > 0) return (bestPara.split(/\n/)[0] || bestPara).slice(0, 400).trim();

  // final fallback: excerpt around first word
  const firstWord = labelWords.find((w) => w.length > 2) || labelWords[0] || '';
  const lc = plain.toLowerCase();
  const idx = firstWord ? lc.indexOf(firstWord) : -1;
  if (idx >= 0) {
    const start = Math.max(0, idx - 120);
    const end = Math.min(plain.length, idx + 300);
    return (start > 0 ? '... ' : '') + plain.slice(start, end).trim() + (end < plain.length ? ' ...' : '');
  }

  return plain.slice(0, 360) + (plain.length > 360 ? ' ...' : '');
}

function extractFullSnippetForLabel(label: string, source: string) {
  if (!source || !source.trim()) return 'No related content available.';
  const plain = source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const labelWords = label
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[^a-z0-9]/gi, ''));

  // Paragraph-based search: prefer a paragraph that contains multiple label words
  const paragraphs = plain.split(/(?:\n\s*\n|\r\n\r\n)/).map((p) => p.trim()).filter(Boolean);
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i].toLowerCase();
    let score = 0;
    for (const w of labelWords) {
      if (w.length > 2 && p.includes(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0 && bestScore > 0) {
    // return paragraph + next paragraph for context
    const start = bestIdx;
    const end = Math.min(paragraphs.length, bestIdx + 2);
    return paragraphs.slice(start, end).join('\n\n');
  }

  // As a fallback, look for sentence matches (broader)
  const sentences = plain.match(/[^.!?]+[.!?]+/g) || [plain];
  bestIdx = -1;
  bestScore = 0;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].toLowerCase();
    let score = 0;
    for (const w of labelWords) {
      if (w.length > 2 && s.includes(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0 && bestScore > 0) {
    const start = Math.max(0, bestIdx - 1);
    const end = Math.min(sentences.length, bestIdx + 2);
    return sentences.slice(start, end).join(' ').trim();
  }

  // Final fallback: return a larger extract to avoid tiny duplicates
  return plain.slice(0, 1200) + (plain.length > 1200 ? ' ...' : '');
}
