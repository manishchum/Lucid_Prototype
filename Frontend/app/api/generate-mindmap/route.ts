import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');

type MindGraph = {
  nodes: Array<{ id: string; label: string; x: number; y: number }>;
  edges: Array<{ from: string; to: string }>;
};

function splitIntoSections(content: string) {
  const sections: { title: string; text: string }[] = [];
  if (!content || !content.trim()) return sections;

  // Normalize
  const cleaned = content.replace(/\r/g, '\n');
  const lines = cleaned.split('\n');

  let currentTitle = '';
  let buffer: string[] = [];

  const pushBuffer = () => {
    const text = buffer.join('\n').trim();
    if (text) sections.push({ title: currentTitle || 'Detail', text });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) {
      if (buffer.length) buffer.push('');
      continue;
    }

    // Heading heuristics
    if (/^Learning Objectives?:/i.test(l)) {
      if (buffer.length) pushBuffer();
      currentTitle = 'Learning Objectives';
      continue;
    }
    if (/^Section\s+\d+/i.test(l)) {
      if (buffer.length) pushBuffer();
      currentTitle = l.replace(/^Section\s+\d+\s*:\s*/i, '').trim() || l;
      continue;
    }
    if (/^Activity\s+\d+/i.test(l)) {
      if (buffer.length) pushBuffer();
      currentTitle = l;
      continue;
    }
    if (/^Module Summary:/i.test(l)) {
      if (buffer.length) pushBuffer();
      currentTitle = 'Module Summary';
      continue;
    }
    if (/^Discussion Prompts?:/i.test(l)) {
      if (buffer.length) pushBuffer();
      currentTitle = 'Discussion Prompts';
      continue;
    }

    // If the line looks like a heading (all caps, or ends with ':'), treat accordingly
    if (/^[A-Z][A-Z\s]{3,}:$/.test(l) || /:$/.test(l)) {
      if (buffer.length) pushBuffer();
      currentTitle = l.replace(/:$/, '').trim();
      continue;
    }

    buffer.push(l);
  }

  if (buffer.length) pushBuffer();

  return sections;
}

function topSentences(text: string, max = 3) {
  if (!text) return [];
  // Split by sentence-ending punctuation
  const s = text
    .replace(/\n+/g, ' ')
    .match(/[^.!?]+[.!?]?/g)
    ?.map((t) => t.trim())
    .filter(Boolean) || [];
  return s.slice(0, max).map((t) => t.replace(/["\'\`]+/g, '').trim());
}

function createMindGraph(content: string, title?: string, branchCount = 4): MindGraph {
  const nodes: MindGraph['nodes'] = [];
  const edges: MindGraph['edges'] = [];

  const rootId = '1';
  nodes.push({ id: rootId, label: (title || 'Study Material').trim().slice(0, 80) || 'Study Material', x: 250, y: 0 });

  const sections = splitIntoSections(content);

  // Determine branch labels (prefer sections with titles)
  let branchLabels: string[] = [];
  for (const s of sections) {
    if (s.title && s.title.trim() && branchLabels.length < branchCount) branchLabels.push(s.title.trim());
  }

  // If not enough titled sections, also use section text heads
  for (const s of sections) {
    if (branchLabels.length >= branchCount) break;
    if (!s.title || s.title === 'Detail') {
      const head = topSentences(s.text, 1)[0];
      if (head) branchLabels.push(head.slice(0, 60));
    }
  }

  // Fallback: split by paragraphs to create branches
  if (branchLabels.length < branchCount) {
    const paras = content.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
    for (const p of paras) {
      if (branchLabels.length >= branchCount) break;
      const s = topSentences(p, 1)[0] || p.slice(0, 60);
      if (s) branchLabels.push(s);
    }
  }

  // Ensure branchLabels length within 4..6
  if (branchLabels.length > 6) branchLabels = branchLabels.slice(0, 6);
  while (branchLabels.length < 4) branchLabels.push('Key Concept');

  // Layout branches evenly across X axis
  // Better layout: compute per-branch slot widths based on estimated label widths
  const estimateWidth = (text: string) => Math.max(80, Math.min(360, String(text).length * 7 + 40));

  // Precompute branch subnodes and widths
  const branchInfos: Array<{
    label: string;
    subPoints: string[];
    slotWidth: number;
  }> = [];

  for (const label of branchLabels) {
    const matching = sections.find((s) => (s.title || '').trim() === label);
    const subSource = matching ? matching.text : '';
    const points = topSentences(subSource || label, 4);
    const maxSub = Math.min(4, Math.max(2, points.length || 2));
    const subPoints = points.slice(0, maxSub).map((p) => p.slice(0, 80));

    // slot width should accommodate the branch label and the widest row of subnodes
    const labelW = estimateWidth(label.slice(0, 80));
    const subW = subPoints.reduce((acc, p) => Math.max(acc, estimateWidth(p)), 0);
    // slot width is max of label or (subnode width * count + gaps)
    const gap = 24;
    const subSpan = subPoints.length > 0 ? subPoints.length * subW + (subPoints.length - 1) * gap : subW;
    const slotWidth = Math.max(160, Math.min(1200, Math.max(labelW, subSpan) + 40));

    branchInfos.push({ label: label.slice(0, 80), subPoints, slotWidth });
  }

  const totalWidth = branchInfos.reduce((s, b) => s + b.slotWidth, 0);
  let cursorX = 50;

  for (const info of branchInfos) {
    const id = String(nodes.length + 1);
    const slotMid = Math.round(cursorX + info.slotWidth / 2);
    const y = 120;
    nodes.push({ id, label: info.label, x: slotMid, y });
    edges.push({ from: rootId, to: id });

    // place subnodes centered under the branch using their estimated widths
    const subCount = info.subPoints.length;
    const subWidths = info.subPoints.map((p) => estimateWidth(p));
    const totalSubWidth = subWidths.reduce((a, b) => a + b, 0);
    const gaps = subCount > 1 ? (subCount - 1) * 24 : 0;
    const startX = slotMid - Math.round((totalSubWidth + gaps) / 2);
    let sx = startX;
    for (let si = 0; si < subCount; si++) {
      const p = info.subPoints[si];
      const sid = String(nodes.length + 1);
      const w = subWidths[si];
      const nodeMid = sx + Math.round(w / 2);
      const sy = 240;
      nodes.push({ id: sid, label: p, x: nodeMid, y: sy });
      edges.push({ from: id, to: sid });
      sx += w + 24;
    }

    cursorX += info.slotWidth;
  }

  return { nodes, edges };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const content = (body?.content || '').toString();
    const title = (body?.title || '').toString();
    // If Gemini API key is available, try to generate richer labels via Gemini
    const gemKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GENAI_API_KEY;
    if (gemKey) {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        const system = `You are a helpful assistant that converts study material into a compact mind-map JSON suitable for NotebookLM.\nOutput ONLY valid JSON with two keys: nodes and edges. nodes is an array of { id, label, x, y } and edges is an array of { from, to }.\nConstraints: 1 root node (id \"1\") at y=0; 4 to 6 main branches (children of root) at y=120; each branch should have 2 to 4 sub-nodes at y=240.\nKeep labels short (<=80 chars), concise, and hierarchical. Do not include extra fields. Use numeric string ids (\"1\",\"2\",...). Position x coordinates should spread branches horizontally and subnodes near their parent.\nIf the content is long, prioritize main concepts, section headings, and key bullets. NEVER output explanations or text outside the JSON object.`;

        const prompt = `Title: ${title}\n\nContent:\n${content}`;

        const result = await model.generateContent(`${system}\n\n${prompt}`);
        const response = await result.response;
        let aiText = '';
        try {
          aiText = await response.text();
        } catch (e) {
          aiText = '';
        }

        let parsed: any = null;
        try {
          const firstChar = aiText.indexOf('{');
          const lastChar = aiText.lastIndexOf('}');
          const jsonText = firstChar !== -1 && lastChar !== -1 ? aiText.slice(firstChar, lastChar + 1) : aiText;
          parsed = JSON.parse(jsonText);
        } catch (e) {
          parsed = null;
        }

        if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges) && parsed.nodes.some((n: any) => String(n.id) === '1')) {
          return NextResponse.json(parsed);
        }
      } catch (gemErr) {
        console.error('Gemini mindmap generation failed:', gemErr);
        // fall back to heuristic
      }
    }

    // Fallback heuristic generator
    const graph = createMindGraph(content, title, 4);
    return NextResponse.json(graph);
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
