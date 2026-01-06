import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const label = (body?.label || '').toString();
    const source = (body?.source || '').toString();

    if (!label) return NextResponse.json({ summary: '' });

    const gemKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GENAI_API_KEY;
    if (gemKey) {
      try {
        // New system prompt: produce a short, practical learning card based on the label and module content.
        // Output plain text only. Structure the output as follows (use double newlines between sections):
        // 1) Definition: 1-2 sentence plain-language definition of the label, grounded in the provided content when possible.
        // 2) Key points: 3 concise bullet points (use leading hyphens) that summarize important facts or steps.
        // 3) Practical tip: one short actionable tip the learner can apply immediately.
        // If the provided content does not contain information to answer, fall back to short, accurate best-practice guidance and prepend the word "(Inferred)" to indicate it was inferred.
        // Keep total output under ~140 words. Do not produce JSON, HTML, or extra commentary. No apologies.
        const system = `You are a helpful learning assistant that creates short learning cards.
Output ONLY plain text with three sections separated by a blank line:\n\nDefinition: (1-2 sentences)\n\nKey points:\n- point 1\n- point 2\n- point 3\n\nPractical tip: (1 short actionable tip)\n\nWhen possible, ground content strictly in the provided module content. If the content lacks detail, provide concise, accurate best-practice guidance and prepend '\\(Inferred\\)' to the Definition line. Keep total length under 140 words. No JSON, no extra explanation.`;

        const prompt = `Label: ${label}\n\nContent:\n${source}`;
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        const result = await model.generateContent(`${system}\n\n${prompt}`);
        const response = await result.response;
        let aiText = '';
        try {
          aiText = await response.text();
        } catch (e) {
          aiText = '';
        }
        const trimmed = aiText.trim();
        if (trimmed) return NextResponse.json({ summary: trimmed });
      } catch (e) {
        console.error('Gemini summary error', e);
      }
    }

    // Fallback heuristic: return paragraph(s) containing label words or a sizeable excerpt
    const plain = source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const labelWords = label.toLowerCase().split(/\s+/).filter(Boolean).map((w: string) => w.replace(/[^a-z0-9]/gi, ''));

  const paragraphs = plain.split(/(?:\n\s*\n|\r\n\r\n)/).map((p: string) => p.trim()).filter(Boolean);
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
      const start = bestIdx;
      const end = Math.min(paragraphs.length, bestIdx + 2);
      return NextResponse.json({ summary: paragraphs.slice(start, end).join('\n\n') });
    }

    // Sentence-level fallback
  const sentences = plain.match(/[^.!?]+[.!?]+/g) || [plain];
    let bestSIdx = -1;
    bestScore = 0;
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i].toLowerCase();
      let score = 0;
      for (const w of labelWords) {
        if (w.length > 2 && s.includes(w)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestSIdx = i;
      }
    }
    if (bestSIdx >= 0 && bestScore > 0) {
      const start = Math.max(0, bestSIdx - 1);
      const end = Math.min(sentences.length, bestSIdx + 2);
      return NextResponse.json({ summary: sentences.slice(start, end).join(' ').trim() });
    }

    // final fallback
    return NextResponse.json({ summary: plain.slice(0, 1200) + (plain.length > 1200 ? ' ...' : '') });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
