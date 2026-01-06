import { NextRequest, NextResponse } from 'next/server'
import { callGemini } from '@/lib/gemini-helper'

// Normalize Gemini output to [{ heading, points: string[] }]
function normalizeFlashcardsShape(parsed: any): Array<{ heading: string; points: string[] }>|null {
  if (!parsed) return null
  if (!Array.isArray(parsed)) {
    if (Array.isArray(parsed?.cards)) parsed = parsed.cards
    else if (Array.isArray(parsed?.sections)) parsed = parsed.sections
    else return null
  }

  const out: Array<{ heading: string; points: string[] }> = []
  const maxCards = 8
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const heading = String(item.heading || item.title || item.front || '').trim()
    if (!heading) continue
    let points: string[] = []
    if (Array.isArray(item.points)) points = item.points.map((p: any)=>String(p))
    else if (Array.isArray(item.bullets)) points = item.bullets.map((p: any)=>String(p))
    else if (typeof item.points === 'string') points = item.points.split(/\n|;|\.|\u2022/).map((s:string)=>s.trim()).filter(Boolean)
  // Keep only up to 4 concise bullets per card (user requested 3-4 bullets)
  points = points.map(p => String(p).trim()).filter(Boolean).slice(0,4)
    out.push({ heading: heading.split(/\s+/).slice(0,10).join(' '), points })
    if (out.length >= maxCards) break
  }
  return out.length ? out : null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const content = (body?.content || '').toString()
    console.log('[generate-flashcards-gemini] request content length:', content.length)

    if (!content || content.trim().length === 0) {
      return NextResponse.json({ error: 'no_content_provided' }, { status: 400 })
    }

    if (!process.env.GEMINI_API_KEY) {
      console.warn('[generate-flashcards-gemini] missing GEMINI_API_KEY')
      // In development, return a small sample so the frontend can be tested without an API key.
      if (process.env.NODE_ENV !== 'production') {
        console.log('[generate-flashcards-gemini] returning dev fallback sample response')
        const sample = [
          { heading: 'Key Concepts', points: ['Understand core idea', 'Recall main steps', 'Apply in practice'] },
          { heading: 'Best Practices', points: ['Use short examples', 'Prefer visuals', 'Test often'] },
          { heading: 'Quick Tips', points: ['Summarize each section', 'Highlight actions'] },
        ]
        return NextResponse.json(sample)
      }
      return NextResponse.json({ error: 'no_gemini_key' }, { status: 500 })
    }

    const prompt = `You are an assistant that converts study text into concise flashcards.
Output ONLY valid JSON between BEGIN_JSON and END_JSON markers.

Return an ARRAY of 4 to 8 card objects. Each object should have: { "heading": string, "points": string[] }.
- heading: short title (<= 6 words).
- points: 3-4 bullets; each bullet should be a concise fact or action (<= 12 words).

Example:
BEGIN_JSON
[
  {"heading":"Navigating Excel","points":["Use ribbon tabs","Edit in formula bar","Cells are A1-style"]},
  {"heading":"Formatting","points":["Align text","Format numbers","Use cell styles"]}
]
END_JSON

Study Text:
${content}`

    const resp = await callGemini(prompt, { maxOutputTokens: 800 })
    console.log('[generate-flashcards-gemini] callGemini ok:', !!resp?.ok, 'model:', resp?.model)
    if (!resp || !resp.ok) {
      return NextResponse.json({ error: 'gemini_call_failed', detail: resp?.text || resp?.status || null }, { status: 502 })
    }

    const text = resp.data?.text || ''
    console.log('[generate-flashcards-gemini] raw preview:', text.slice(0,1000))

    const markerMatch = text.match(/BEGIN_JSON\s*([\s\S]*?)\s*END_JSON/im)
    if (markerMatch && markerMatch[1]) {
      try {
        const parsed = JSON.parse(markerMatch[1])
        const normalized = normalizeFlashcardsShape(parsed)
        if (normalized) return NextResponse.json(normalized)
      } catch (err) {
        console.warn('[generate-flashcards-gemini] failed parse between markers', err)
      }
    }

    try {
      const parsed = JSON.parse(text)
      const normalized = normalizeFlashcardsShape(parsed)
      if (normalized) return NextResponse.json(normalized)
    } catch (_) {}

    const arrayMatch = text.match(/\[([\s\S]*?)\]/m)
    if (arrayMatch && arrayMatch[0]) {
      try {
        const parsed = JSON.parse(arrayMatch[0])
        const normalized = normalizeFlashcardsShape(parsed)
        if (normalized) return NextResponse.json(normalized)
      } catch (err) {
        console.warn('[generate-flashcards-gemini] failed to parse extracted array', err)
      }
    }

    return NextResponse.json({ error: 'invalid_json_from_gemini', raw: text }, { status: 502 })
  } catch (err) {
    console.error('[generate-flashcards-gemini] unexpected error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
  }
}
