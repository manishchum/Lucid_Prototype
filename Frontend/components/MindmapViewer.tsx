"use client";

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Download } from 'lucide-react';

type Node = { id: string; label: string; x: number; y: number };
type Edge = { from: string; to: string };

export default function MindmapViewer({
  data,
  source,
  onDownloadReady,
}: {
  data: { nodes: Node[]; edges: Edge[] } | null;
  source?: string;
  onDownloadReady?: (fn: () => void) => void;
}) {
  if (!data || !data.nodes) return null;
  const nodes = data.nodes;
  const edges = data.edges || [];

  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const [viewport, setViewport] = useState({ w: 800, h: 600 });

  // Compute a deterministic top-down tree layout once per data change.
  // This replaces any incoming x/y coordinates and forces a single
  // hierarchical layout (root at top, children beneath in columns) so
  // the viewer always shows the same layout style (matching the attachment).
  // Compute a deterministic top-down tree layout once per data change.
  // This replaces any incoming x/y coordinates and forces a single
  // hierarchical layout (root at top, children beneath in columns). The
  // layout also estimates node sizes and spaces leaves so node rectangles
  // do not overlap horizontally. Vertical spacing is sized to avoid
  // overlap based on node heights.
  const layoutNodes = useMemo(() => {
    if (!nodes || nodes.length === 0) return nodes;

    const sanitizeLabel = (lbl: string) => {
      return String(lbl || '')
        .replace(/<\/?[^>]+(>|$)/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    };

    const idKey = (id: any) => String(id);

    // Build children and parent maps
    const children = new Map<string, string[]>();
    const parent = new Map<string, string | null>();
    for (const n of nodes) {
      const id = idKey(n.id);
      children.set(id, []);
      parent.set(id, null);
    }
    for (const e of edges) {
      const p = idKey(e.from);
      const c = idKey(e.to);
      if (!children.has(p)) children.set(p, []);
      children.get(p)!.push(c);
      parent.set(c, p);
    }

    // Prune children of collapsed nodes
    const visibleNodes = new Set<string>();
    const dfsVisible = (id: string) => {
      visibleNodes.add(id);
      if (!collapsedNodes.has(id)) {
        for (const c of children.get(id) || []) dfsVisible(c);
      }
    };

    // Find root (node without a parent) or fallback to first node
    const roots = nodes.filter((n) => parent.get(idKey(n.id)) === null).map((n) => idKey(n.id));
    const rootId = roots[0] || idKey(nodes[0].id);

    dfsVisible(rootId);

    // Adjust `children` map to hide children of collapsed nodes
    for (const [id, ch] of children.entries()) {
      if (collapsedNodes.has(id)) {
        children.set(id, []);
      }
    }

    // Helper to estimate rect size for a label (matches render logic)
    const estimateRect = (label: string) => {
      const words = String(label || '').split(/\s+/);
      const lines: string[] = [];
      let cur = '';
      const maxChars = 36;
      for (const w of words) {
        if ((cur + ' ' + w).trim().length <= maxChars) {
          cur = (cur + ' ' + w).trim();
        } else {
          if (cur) lines.push(cur);
          cur = w;
        }
      }
      if (cur) lines.push(cur);
      const longest = lines.reduce((a, b) => (b.length > a ? b.length : a), 0);
      const rectW = Math.max(80, Math.min(700, longest * 7 + 48));
      const lineHeight = 18;
      const rectH = Math.max(34, lines.length * lineHeight + 12);
      return { rectW, rectH };
    };

    // Precompute rect sizes for all nodes
    const rectSizes = new Map<string, { w: number; h: number }>();
    for (const n of nodes) {
      const cleanLbl = sanitizeLabel(n.label || '');
      const e = estimateRect(cleanLbl);
      rectSizes.set(idKey(n.id), { w: e.rectW, h: e.rectH });
    }

    // Compute depth for each node
    const depths = new Map<string, number>();
    const dfsDepth = (id: string, d: number) => {
      depths.set(id, d);
      for (const c of children.get(id) || []) dfsDepth(c, d + 1);
    };
    dfsDepth(rootId, 0);

    // Choose vertical spacing based on max node height across all levels
    let maxRectH = 0;
    for (const n of nodes) {
      const est = estimateRect(n.label || '');
      if (est.rectH > maxRectH) maxRectH = est.rectH;
    }
    const levelHeight = Math.max(100, maxRectH + 48);

    // --- Buchheim/Walker-inspired layout ---
    // We do a bottom-up subtree width calculation then top-down placement,
    // pushing sibling subtrees apart so nodes at every level are gap-separated.
    const minGap = 32; // minimum horizontal gap between adjacent node rects

    // Step 1: compute the "natural width" of the subtree rooted at each node.
    // This is the total horizontal span needed so all descendants don't overlap.
    const subtreeWidth = new Map<string, number>();
    const computeSubtreeWidth = (id: string): number => {
      const ch = children.get(id) || [];
      const selfW = (rectSizes.get(id)?.w ?? 120);
      if (ch.length === 0) {
        subtreeWidth.set(id, selfW);
        return selfW;
      }
      // Sum of children subtree widths + gaps between them
      const childWidths = ch.map((c) => computeSubtreeWidth(c));
      const total = childWidths.reduce((a, b) => a + b, 0) + (ch.length - 1) * minGap;
      // Subtree width must also fit the node itself
      const w = Math.max(selfW, total);
      subtreeWidth.set(id, w);
      return w;
    };
    computeSubtreeWidth(rootId);

    // Step 2: top-down assignment of x positions.
    // Each subtree is centered over its allotted horizontal span.
    const xMap = new Map<string, number>();
    const assignPositions = (id: string, centerX: number) => {
      xMap.set(id, centerX);
      const ch = children.get(id) || [];
      if (ch.length === 0) return;

      // Total width consumed by children subtrees
      const childWidths = ch.map((c) => subtreeWidth.get(c) ?? 120);
      const totalChildW = childWidths.reduce((a, b) => a + b, 0) + (ch.length - 1) * minGap;

      // Start from the left edge of the children band
      let curX = centerX - totalChildW / 2;
      for (let i = 0; i < ch.length; i++) {
        const cw = childWidths[i];
        assignPositions(ch[i], curX + cw / 2);
        curX += cw + minGap;
      }
    };
    assignPositions(rootId, 0);

    // Step 3: build final node list with x/y
    const built = nodes
      .filter((n) => visibleNodes.has(idKey(n.id)))
      .map((n) => {
      const id = idKey(n.id);
      const x = xMap.get(id) ?? 0;
      const y = (depths.get(id) ?? 0) * levelHeight;
      const cleanLbl = sanitizeLabel(n.label || '');
      return { ...n, label: cleanLbl, x, y };
    });

    // Center the whole layout around x=0
    const xsList = built.map((n) => n.x);
    const minX = Math.min(...xsList);
    const maxX = Math.max(...xsList);
    const center = (minX + maxX) / 2;
    return built.map((n) => ({ ...n, x: n.x - center }));
  }, [nodes, edges, collapsedNodes]);

  const xs = layoutNodes.map((n) => n.x);
  const ys = layoutNodes.map((n) => n.y);
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

    // Auto-load summary when node is selected
    useEffect(() => {
      if (!selectedNode) {
        setRelatedOpen(false);
        setRelatedFull(null);
        return;
      }

      const loadSummary = async () => {
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
      };

      loadSummary();
    }, [selectedNode, source]);

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
      // center the map whenever the layout or container size changes
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const cw = rect.width;
      const ch = rect.height;
      // Compute scale to fit, then center content (so user doesn't have to pan)
      const s = Math.min(cw / naturalWidth, ch / naturalHeight, 1);
      setScale(s);
      // content center (we already padded min/max earlier)
      const contentCenterX = (minX + maxX) / 2;
      const contentCenterY = (minY + maxY) / 2;
      // translate such that content center maps to viewport center
      setPanX(cw / 2 - contentCenterX * s);
      setPanY(ch / 2 - contentCenterY * s);
    }, [naturalWidth, naturalHeight, nodes.length, edges.length]);

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

    // Native handlers: attach with passive: false to allow preventDefault without console warnings.
    const handleNativeTouchStart = (e: TouchEvent) => {
      if (!svgRef.current) return;
      // prevent scrolling while interacting with the mindmap
      e.preventDefault();
      const touches = e.touches;
      if (touches.length === 1) {
        touchRef.current.mode = 'pan';
        touchRef.current.startX = touches[0].clientX;
        touchRef.current.startY = touches[0].clientY;
        touchRef.current.originPanX = panX;
        touchRef.current.originPanY = panY;
      } else if (touches.length === 2) {
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

    const handleNativeTouchMove = (e: TouchEvent) => {
      if (!svgRef.current) return;
      // preventDefault to stop page scroll
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

    const handleNativeTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        touchRef.current.mode = 'none';
      }
    };

    // Attach native listeners with passive:false to allow preventDefault
    React.useEffect(() => {
      const el = svgRef.current;
      if (!el) return;
      el.addEventListener('touchstart', handleNativeTouchStart, { passive: false });
      el.addEventListener('touchmove', handleNativeTouchMove, { passive: false });
      el.addEventListener('touchend', handleNativeTouchEnd, { passive: false });
      el.addEventListener('touchcancel', handleNativeTouchEnd, { passive: false });
      return () => {
        el.removeEventListener('touchstart', handleNativeTouchStart);
        el.removeEventListener('touchmove', handleNativeTouchMove);
        el.removeEventListener('touchend', handleNativeTouchEnd);
        el.removeEventListener('touchcancel', handleNativeTouchEnd);
      };
    }, [svgRef, panX, panY, scale]);

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
      const s = Math.min(rect.width / naturalWidth, rect.height / naturalHeight, 1);
      setScale(s);
      const contentCenterX = (minX + maxX) / 2;
      const contentCenterY = (minY + maxY) / 2;
      setPanX(rect.width / 2 - contentCenterX * s);
      setPanY(rect.height / 2 - contentCenterY * s);
    };

  const findNode = (id: string) => layoutNodes.find((n) => String(n.id) === String(id));

    // Tooltip position calculation
    const nodeScreenPos = (n: Node) => {
      if (!svgRef.current) return { x: 0, y: 0 };
      const rect = svgRef.current.getBoundingClientRect();
      const sx = panX + n.x * scale + rect.left;
      const sy = panY + n.y * scale + rect.top;
      return { x: sx, y: sy };
    };

    // Build and expose the download function to the parent
    const downloadPNG = useCallback(async () => {
      if (!svgRef.current) return;
      try {
        const svg = svgRef.current;
        const group = svg.querySelector('g');
        const defs = svg.querySelector('defs')?.outerHTML || '';
        const inner = group?.innerHTML || '';
        const bg = `<rect x="${minX}" y="${minY}" width="${naturalWidth}" height="${naturalHeight}" fill="#ffffff"/>`;
        const svgStr = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${naturalWidth}\" height=\"${naturalHeight}\" viewBox=\"${minX} ${minY} ${naturalWidth} ${naturalHeight}\">${defs}${bg}${inner}</svg>`;

        const svg64 = btoa(unescape(encodeURIComponent(svgStr)));
        const imgSrc = 'data:image/svg+xml;base64,' + svg64;

        const baseDPR = Math.max(1, window.devicePixelRatio || 1);
        const DPR = Math.min(3, Math.round(baseDPR * 1.5));

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(naturalWidth * DPR);
        canvas.height = Math.round(naturalHeight * DPR);
        canvas.style.width = naturalWidth + 'px';
        canvas.style.height = naturalHeight + 'px';
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas not supported');
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

        const img = new Image();
        img.onload = () => {
          try {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, naturalWidth, naturalHeight);
            ctx.drawImage(img, 0, 0, naturalWidth, naturalHeight);
            canvas.toBlob((blob) => {
              if (!blob) return;
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'mindmap.png';
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 5000);
            }, 'image/png');
          } catch (e) {
            console.error('Failed to rasterize SVG', e);
          }
        };
        img.onerror = (ev) => console.error('Image load failed for SVG rasterization', ev);
        img.src = imgSrc;
      } catch (e) {
        console.error('Failed to download PNG', e);
      }
    }, [minX, minY, naturalWidth, naturalHeight]);

    useEffect(() => {
      if (onDownloadReady) onDownloadReady(downloadPNG);
    }, [downloadPNG, onDownloadReady]);

    useEffect(() => {
      if (!svgRef.current) return;
      const observer = new ResizeObserver((entries) => {
        setViewport({ w: entries[0].contentRect.width, h: entries[0].contentRect.height });
      });
      observer.observe(svgRef.current);
      return () => observer.disconnect();
    }, []);

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
          onClick={(e) => {
            if (e.target === svgRef.current) setSelectedNode(null);
          }}
        >
          <defs>
            <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000" floodOpacity="0.12" />
            </filter>
            {/* gradients matching flashcard cards (soft blue and soft purple) */}
            <linearGradient id="grad-blue" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#EFF6FF" />
              <stop offset="100%" stopColor="#EEF2FF" />
            </linearGradient>
            <linearGradient id="grad-purple" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#F5F3FF" />
              <stop offset="100%" stopColor="#FEF2F8" />
            </linearGradient>
          </defs>

          {/* group transformed by pan/zoom */}
          <g transform={`translate(${panX}, ${panY}) scale(${scale})`} style={{ transition: 'transform 0.4s ease-out' }}>
            {/* edges */}
            {edges.map((e, i) => {
              const a = findNode(e.from);
              const b = findNode(e.to);
              if (!a || !b) return null;
              
              const isFaded = selectedNode && (a.id !== selectedNode.id && b.id !== selectedNode.id);

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
                  style={{ opacity: isFaded ? 0.15 : 1, transition: 'opacity 0.4s ease-out' }}
                />
              );
            })}

            {/* nodes */}
            {layoutNodes.map((n, idx) => {
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
              const gradFill = idx % 2 === 0 ? 'url(#grad-blue)' : 'url(#grad-purple)';
              // Use a solid black border for node rectangles per design request
              const stroke = '#000';
              
              const isFaded = selectedNode && selectedNode.id !== n.id;
              const hasHiddenChildren = collapsedNodes.has(n.id) && edges.some(e => String(e.from) === String(n.id));

              return (
                <g
                  key={n.id}
                  transform={`translate(${x}, ${y})`}
                  onMouseEnter={() => {
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
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setCollapsedNodes(prev => {
                      const next = new Set(prev);
                      if (next.has(n.id)) next.delete(n.id);
                      else next.add(n.id);
                      return next;
                    });
                  }}
                  style={{ cursor: 'pointer', opacity: isFaded ? 0.3 : 1, transition: 'opacity 0.4s ease-out' }}
                >
                  <rect width={rectW} height={rectH} rx={8} ry={8} fill={gradFill} stroke={stroke} strokeWidth={1.5} />
                  <text
                    x={rectW / 2}
                    y={rectH / 2}
                    textAnchor="middle"
                    fill="#0f172a"
                    fontSize={12}
                    fontFamily="Inter, Arial, sans-serif"
                  >
                    {lines.map((ln, lidx) => (
                      <tspan key={lidx} x={rectW / 2} dy={lidx === 0 ? `-${(lines.length - 1) * (lineHeight / 2) - 4}` : lineHeight}>
                        {ln}
                      </tspan>
                    ))}
                  </text>
                  
                  {hasHiddenChildren && (
                    <g transform={`translate(${rectW / 2}, ${rectH})`}>
                      <circle cx={0} cy={0} r={10} fill="#fff" stroke="#000" strokeWidth={1.5} />
                      <text x={0} y={4} fontSize={14} textAnchor="middle" fontWeight="bold" fill="#000" style={{ pointerEvents: 'none' }}>+</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        {/* Touch handlers are attached on the SVG element to avoid blocking mouse events */}

        {/* Tooltip */}
        {hovered && (
          <div
            className="absolute z-20 bg-black text-white text-sm px-2 py-1 rounded pointer-events-none text-left"
            style={{ left: hovered.x + 12, top: hovered.y - 18, whiteSpace: 'nowrap', textAlign: 'left' }}
          >
            {hovered.label}
          </div>
        )}

        {/* Node detail panel */}
        {selectedNode && (
          <div
            className="absolute right-0 top-0 h-full w-80 bg-background shadow-lg z-30 p-4 overflow-auto border-l border-border text-left"
            style={{ textAlign: 'left' }}
          >
            <div className="relative pt-6 text-left">
              <button
                onClick={() => setSelectedNode(null)}
                className="absolute right-3 -top-3 text-gray-500 hover:text-gray-800 p-2 rounded-full bg-white/80 shadow-sm"
                aria-label="Close"
                style={{ lineHeight: 1 }}
              >
                ✕
              </button>
              <h3 className="text-lg font-bold text-black text-left w-full mt-1" style={{ textAlign: 'left' }}>{selectedNode.label}</h3>
            </div>
            <div className="mt-3 text-sm text-gray-700 text-left" style={{ textAlign: 'left' }}>
              {/* Show crunchable content */}
              {relatedOpen && (
                <div className="text-sm text-gray-800 text-left" style={{ textAlign: 'left' }}>
                  <div className="whitespace-pre-line text-left leading-relaxed text-gray-600" style={{ textAlign: 'left' }}>
                    {relatedFull}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}


      </div>
    );
  }

  // Helper: strip HTML preserving paragraph breaks, then return clean plain text paragraphs
  function htmlToPlainParagraphs(source: string): string[] {
    let text = source;
    try {
      // Decode entities first, then replace block-level tags with newlines to preserve structure
      text = text
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/<\/?(p|div|br|h[1-6]|ul|ol|li|table|tr|td|th|section|article|blockquote)[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');
    } catch (e) {
      text = source.replace(/<[^>]+>/g, ' ');
    }
    // Normalize line endings, collapse multiple blank lines into one, trim each line
    return text
      .split(/\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  // Score how well a text block matches the label words (weighted: exact phrase > individual words)
  function scoreMatch(text: string, labelWords: string[], labelRaw: string): number {
    const low = text.toLowerCase();
    // Bonus for exact label phrase match
    const phraseBonus = low.includes(labelRaw.toLowerCase()) ? labelWords.length * 2 : 0;
    let wordScore = 0;
    for (const w of labelWords) {
      if (w.length > 2 && low.includes(w)) wordScore += 1;
    }
    return phraseBonus + wordScore;
  }

  function extractSnippetForLabel(label: string, source: string) {
    const lines = htmlToPlainParagraphs(source);
    if (!lines.length) return '';

    const labelWords = label
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[^a-z0-9]/gi, ''))
      .filter((w) => w.length > 2);

    if (!labelWords.length) return lines[0].slice(0, 360);

    // Score each line and return the best matching one (capped to ~360 chars)
    let best = '';
    let bestScore = 0;
    for (const line of lines) {
      const s = scoreMatch(line, labelWords, label);
      if (s > bestScore) {
        bestScore = s;
        best = line;
      }
    }
    if (bestScore > 0) return best.slice(0, 360) + (best.length > 360 ? ' ...' : '');

    // Sentence-level fallback within the first match by first keyword
    const plain = lines.join(' ');
    const lc = plain.toLowerCase();
    const firstWord = labelWords[0] || '';
    const idx = firstWord ? lc.indexOf(firstWord) : -1;
    if (idx >= 0) {
      const start = Math.max(0, idx - 80);
      const end = Math.min(plain.length, idx + 280);
      return (start > 0 ? '... ' : '') + plain.slice(start, end).trim() + (end < plain.length ? ' ...' : '');
    }

    return lines[0].slice(0, 360);
  }

  function extractFullSnippetForLabel(label: string, source: string) {
    if (!source || !source.trim()) return 'No related content available.';

    const lines = htmlToPlainParagraphs(source);
    if (!lines.length) return 'No related content available.';

    const labelWords = label
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[^a-z0-9]/gi, ''))
      .filter((w) => w.length > 2);

    if (!labelWords.length) return lines.slice(0, 5).join('\n');

    // Score every line, pick the best-scoring one and return it plus its neighbours for context
    const scores = lines.map((line) => scoreMatch(line, labelWords, label));
    const bestIdx = scores.indexOf(Math.max(...scores));
    const bestScore = scores[bestIdx];

    if (bestScore > 0) {
      // Find the first substantive paragraph starting from bestIdx to avoid just returning short headings
      let contentIdx = bestIdx;
      while (contentIdx < lines.length && lines[contentIdx].split(/\s+/).length < 10) {
        contentIdx++;
      }
      if (contentIdx >= lines.length) contentIdx = bestIdx;

      // Return a window of lines from the substantive match
      const start = contentIdx;
      const end = Math.min(lines.length, contentIdx + 3);
      const summary = lines.slice(start, end).join('\n\n');
      return `Definition:\n${summary}`;
    }

    // Final fallback: first occurrence of any keyword
    const plain = lines.join(' ');
    const lc = plain.toLowerCase();
    const firstWord = labelWords[0] || '';
    const idx = firstWord ? lc.indexOf(firstWord) : -1;
    if (idx >= 0) {
      const start = Math.max(0, idx - 200);
      const end = Math.min(plain.length, idx + 800);
      return (start > 0 ? '...' : '') + plain.slice(start, end).trim() + (end < plain.length ? '...' : '');
    }

    return lines.slice(0, 6).join('\n');
  }
