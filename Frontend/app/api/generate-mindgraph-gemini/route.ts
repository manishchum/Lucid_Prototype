
// Normalize to array of { heading, points, icon_keyword? }











import { NextRequest, NextResponse } from 'next/server'
import { callGemini } from '@/lib/gemini-helper'

// Normalize to array of { heading, points, icon_keyword? }
function normalize(parsed: any) {
  if (!parsed) return null
  if (!Array.isArray(parsed)) {
    if (Array.isArray(parsed?.sections)) parsed = parsed.sections
    else if (Array.isArray(parsed?.nodes)) parsed = parsed.nodes
    else return null
  }
  const out: any[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const heading = String(item.heading || item.title || item.label || '').trim()
    if (!heading) continue
    let points: string[] = []
    if (Array.isArray(item.points)) points = item.points.map((p: any) => String(p).trim())
    else if (typeof item.points === 'string') points = item.points.split(/\n|;|\.|\u2022/).map((s: string) => s.trim()).filter(Boolean)
    out.push({ heading: heading.split(/\s+/).slice(0, 8).join(' '), points: points.slice(0,6), icon_keyword: String(item.icon_keyword || item.icon || '').trim() })
    if (out.length >= 6) break
  }
  return out.length ? out : null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const content = (body?.content || '').toString()

    if (!content || content.trim().length === 0) {
      return NextResponse.json({ error: 'no_content_provided' }, { status: 400 })
    }

    if (!process.env.GEMINI_API_KEY) {
      console.warn('[generate-mindgraph-gemini] missing GEMINI_API_KEY')
      if (process.env.NODE_ENV !== 'production') {
        console.log('[generate-mindgraph-gemini] returning dev fallback sample response')
        const sample = [
          { heading: 'Plan', points: ['Set objectives', 'Identify scope', 'Allocate time'], icon_keyword: 'target' },
          { heading: 'Research', points: ['Gather sources', 'Validate data', 'Summarize findings'], icon_keyword: 'search' },
          { heading: 'Design', points: ['Create outline', 'Pick visuals', 'Draft content'], icon_keyword: 'pencil' },
        ]
        return NextResponse.json(sample)
      }
      return NextResponse.json({ error: 'no_gemini_key' }, { status: 500 })
    }

    const prompt = `BEGIN_JSON\nYou are a Senior Instructional Designer. Convert this Study Text into infographic JSON.\nReturn an ARRAY with 3 to 6 objects. Each object must have ONLY these fields: { "heading": string, "points": string[], "icon_keyword": string }\nRules: - heading: MAX 4 words - points: EXACTLY 3 bullets, MAX 6 words each - icon_keyword: single noun for vector icon - Use only the study content given\nStudy Text:\n${content}\nEND_JSON`

    const resp = await callGemini(prompt, { maxOutputTokens: 800 })
    console.log('[generate-mindgraph-gemini] callGemini ok:', !!resp?.ok, 'model:', resp?.model)

    if (!resp || !resp.ok) {
      return NextResponse.json({ error: 'gemini_call_failed', detail: resp?.text || resp?.status || null }, { status: 502 })
    }

    const text = resp.data?.text || ''

    const markerMatch = text.match(/BEGIN_JSON\s*([\s\S]*?)\s*END_JSON/im)
    if (markerMatch && markerMatch[1]) {
      try {
        const parsed = JSON.parse(markerMatch[1])
        const normalized = normalize(parsed)
        if (normalized) return NextResponse.json(normalized)
      } catch (err) {
        console.warn('[generate-mindgraph-gemini] failed to parse JSON between markers', err)
      }
    }

    try {
      const parsed = JSON.parse(text)
      const normalized = normalize(parsed)
      if (normalized) return NextResponse.json(normalized)
    } catch (_) {}

    const arrayMatch = text.match(/\[([\s\S]*?)\]/m)
    if (arrayMatch && arrayMatch[0]) {
      try {
        const parsed = JSON.parse(arrayMatch[0])
        const normalized = normalize(parsed)
        if (normalized) return NextResponse.json(normalized)
      } catch (err) {
        console.warn('[generate-mindgraph-gemini] failed to parse extracted array', err)
      }
    }

    return NextResponse.json({ error: 'invalid_json_from_gemini', raw: text }, { status: 502 })
  } catch (err) {
    console.error('[generate-mindgraph-gemini] unexpected error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
  }
}

