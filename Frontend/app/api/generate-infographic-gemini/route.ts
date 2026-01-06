import { NextRequest, NextResponse } from 'next/server'
import { callGemini } from '@/lib/gemini-helper'

// Ensure the parsed Gemini JSON conforms to the frontend expected shape
function normalizeInfographicShape(parsed: any): Array<{ heading: string; points: string[] }> | null {
  if (!parsed) return null
  // Accept common wrappers
  if (!Array.isArray(parsed)) {
    if (Array.isArray(parsed?.sections)) parsed = parsed.sections
    else if (Array.isArray(parsed?.steps)) parsed = parsed.steps
    else return null
  }

  const out: Array<{ heading: string; points: string[] }> = []

  const maxSections = 6
  const maxHeadingWords = 4
  const maxBullets = 3
  const maxBulletWords = 6

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue

    // Determine heading from common keys
    let heading = (item.heading || item.title || item.text || '') + ''
    heading = heading.trim()
    if (!heading) continue

    // Reduce heading to maxHeadingWords
    const headingWords = heading.split(/\s+/).slice(0, maxHeadingWords).join(' ')

    // Extract points from common keys
    let points: string[] = []
    if (Array.isArray(item.points)) points = item.points.map((p: any) => String(p))
    else if (Array.isArray(item.bullets)) points = item.bullets.map((p: any) => String(p))
    else if (typeof item.points === 'string') points = item.points.split(/\n|;|\.|\u2022|\u2023/).map((s: string) => s.trim()).filter(Boolean)
    else if (typeof item.bullets === 'string') points = item.bullets.split(/\n|;|\.|\u2022|\u2023/).map((s: string) => s.trim()).filter(Boolean)

    // Normalize each point: trim and limit words
    points = points.map(p => {
      const words = String(p).trim().split(/\s+/).slice(0, maxBulletWords)
      return words.join(' ').replace(/[\s]+/g, ' ').trim()
    }).filter(Boolean)

    // Enforce max bullets
    if (points.length > maxBullets) points = points.slice(0, maxBullets)

    // minimal acceptance: heading present (after trimming)
    if (!headingWords) continue

    out.push({ heading: headingWords, points })
    if (out.length >= maxSections) break
  }

  // If nothing acceptable, return null
  if (out.length === 0) return null

  // If fewer than 5 sections, log a warning but still return what we have
  if (out.length < 5) {
    console.warn('[generate-infographic-gemini] normalized result has fewer than 5 sections:', out.length)
  }

  return out
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const content = (body?.content || '').toString()

    console.log('[generate-infographic-gemini] received request, content length:', content.length)

    if (!content || content.trim().length === 0) {
      return NextResponse.json({ error: 'no_content_provided' }, { status: 400 })
    }

    if (!process.env.GEMINI_API_KEY) {
      console.warn('[generate-infographic-gemini] missing GEMINI_API_KEY')
      return NextResponse.json({ error: 'no_gemini_key' }, { status: 500 })
    }

  // Stronger prompt: enforce strict JSON shape and limits for headings and bullets.
  const prompt = `Convert ONLY the Study Text into a compact, academically accurate infographic JSON.

Rules (follow EXACTLY):
1) OUTPUT ONLY valid JSON between the markers BEGIN_JSON and END_JSON. Do NOT include any extra text, explanation, or markdown outside those markers.
2) Return an ARRAY with 5 or 6 objects (max 6). Do not return more than 6 objects; if there are more, include only the first 6.
3) Each object MUST have exactly these fields and NO OTHERS: { "heading": string, "points": string[] }
   - heading: 1 short title, MAX 4 words. Use concise, study-focused phrases (e.g., "Chart Choice").
   - points: an array of EXACTLY up to 3 bullets (preferably 3). Each bullet MUST be ultra-short: MAX 6 words. Keep bullets actionable and academically accurate.
4) Use ONLY the Study Text content provided below. Ignore any unrelated metadata, file names, Excel columns, or tables. Do not invent examples not supported by the Study Text.
5) Keep language formal, objective, and focused on study concepts. Bullets should begin with an action word when possible.
6) Example (STRICT shape):
BEGIN_JSON
[
  {"heading":"Define Scope","points":["State research question","Identify key variables","Set success criteria"]},
  {"heading":"Choose Chart","points":["Match chart to goal","Prefer line for trends","Check axes labels"]},
  ... up to 6 objects ...
]
END_JSON

Now produce the JSON array based ONLY on the Study Text below. Ensure headings are ≤4 words and each points array contains at most 3 bullets of ≤6 words each. Do not include subtitles, icons, colors, or any extra fields.

Study Text:
${content}`

  const resp = await callGemini(prompt, { maxOutputTokens: 800 })
    console.log('[generate-infographic-gemini] callGemini result ok:', !!resp?.ok, 'model:', resp?.model)

    if (!resp || !resp.ok) {
      return NextResponse.json({ error: 'gemini_call_failed', detail: resp?.text || resp?.status || null }, { status: 502 })
    }

    const text = resp.data?.text || ''
    console.log('[generate-infographic-gemini] raw text preview:', text.slice(0, 1000))

    // First, try to extract JSON between BEGIN_JSON and END_JSON markers
    const markerMatch = text.match(/BEGIN_JSON\s*([\s\S]*?)\s*END_JSON/im)
    if (markerMatch && markerMatch[1]) {
      try {
        const parsed = JSON.parse(markerMatch[1])
        // Normalize and validate shape before returning
        const normalized = normalizeInfographicShape(parsed)
        if (normalized) return NextResponse.json(normalized)
        console.warn('[generate-infographic-gemini] parsed JSON between markers but shape invalid')
      } catch (err) {
        console.warn('[generate-infographic-gemini] failed to parse JSON between markers', err)
        // fall through to other extraction attempts
      }
    }

    // Next, try a straight JSON.parse of the whole response
    try {
      const parsed = JSON.parse(text)
      const normalized = normalizeInfographicShape(parsed)
      if (normalized) return NextResponse.json(normalized)
      console.warn('[generate-infographic-gemini] parsed whole response as JSON but shape invalid')
    } catch (_) {}

    // Fallback: extract first JSON array in the text
    const arrayMatch = text.match(/\[([\s\S]*?)\]/m)
    if (arrayMatch && arrayMatch[0]) {
      try {
        const parsed = JSON.parse(arrayMatch[0])
        const normalized = normalizeInfographicShape(parsed)
        if (normalized) return NextResponse.json(normalized)
        console.warn('[generate-infographic-gemini] extracted array JSON parsed but shape invalid')
      } catch (err) {
        console.warn('[generate-infographic-gemini] failed to parse extracted array JSON', err)
      }
    }

    // If all parsing attempts fail, return raw for debugging
    return NextResponse.json({ error: 'invalid_json_from_gemini', raw: text }, { status: 502 })
  } catch (err) {
    console.error('[generate-infographic-gemini] unexpected error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
  }
}
