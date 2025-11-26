import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = (body?.query || '').toString().trim()
    const mode = body?.mode || null
    const userId = body?.user_id || null

    // helper: append a simple {question,answer} object into ask_doubt jsonb array
    const saveAskDoubt = async (uid: string | null, question: string, answer: string) => {
      if (!uid) return
      try {
        // Prefer calling an atomic RPC if available
        const { error } = await supabase.rpc('append_ask_doubt_qna', { p_user: uid, p_question: question, p_answer: answer })
        if (error) {
          // Fallback: read current array and upsert with appended element
          const { data: existing } = await supabase.from('chatbot_user_interactions').select('ask_doubt').eq('user_id', uid).single()
          let arr: any[] = []
          if (existing && Array.isArray(existing.ask_doubt)) arr = existing.ask_doubt
          arr.push({ question, answer })
          await supabase.from('chatbot_user_interactions').upsert([{ user_id: uid, ask_doubt: arr, updated_at: new Date().toISOString() }], { onConflict: 'user_id' })
        }
      } catch (e) {
        console.warn('[assistant] saveAskDoubt failed', e)
      }
    }

    // If caller sent a start action (e.g., user selected Ask Doubt), ensure a row exists
    if (body?.action === 'start' && userId) {
      try {
        await supabase.from('chatbot_user_interactions').upsert([{ user_id: userId, ask_doubt: [] }], { onConflict: 'user_id' })
      } catch (e) {
        console.warn('[assistant] failed to create initial user interaction row', e)
      }
      return NextResponse.json({ answer: 'Started doubt session.' })
    }

    // If caller is asking for a menu flow (non-doubt), handle without requiring a query
    if (mode && mode !== 'doubt' && !query) {
      // simple canned responses for menu flows
      if (mode === 'explore') {
        return NextResponse.json({ answer: 'What type of content would you like to explore? Options: Modules / Notes / Guides / Your generated content.' })
      }
      if (mode === 'report') {
        return NextResponse.json({ answer: 'Sure — please describe the issue you are experiencing (include page, steps, and expected behavior).' })
      }
      if (mode === 'navigate') {
        return NextResponse.json({ answer: 'Navigation help: How to access modules / Generate content / View saved content / Manage account. Which would you like?' })
      }
      if (mode === 'something_else') {
        return NextResponse.json({ answer: 'I can help with a variety of tasks — please tell me what you need.' })
      }
      // fallback
      return NextResponse.json({ answer: 'How can I help? Please type your question or pick a menu option.' })
    }

    // Tokenize the query to improve matching (remove short/common words)
    const normalized = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    const tokens = Array.from(new Set(normalized.split(/\s+/).filter(t => t.length >= 3 && !['the','and','for','with','you','how','what','when','where','is','are','in','on','of','a','an'].includes(t))))

    let matches: any[] = []

    try {
      if (tokens.length > 0) {
        // Build OR filter for title/content contains any token
        const conds = tokens.flatMap(t => [`title.ilike.%${t}%`, `content.ilike.%${t}%`])
        const orFilter = conds.join(',')
        const { data: keywordMatches, error: keywordErr } = await supabase
          .from('processed_modules')
          .select('processed_module_id, title, content, original_module_id, audio_duration')
          .or(orFilter)
          .limit(8)

        if (keywordErr) console.error('[assistant] supabase token search error', keywordErr)
        matches = keywordMatches || []
      }

      // Fallback: try whole-query ilike on title and content
      if (!matches || matches.length === 0) {
        const { data: titleMatches, error: titleErr } = await supabase
          .from('processed_modules')
          .select('processed_module_id, title, content, original_module_id, audio_duration')
          .ilike('title', `%${query}%`)
          .limit(6)
        if (titleErr) console.error('[assistant] supabase title search error', titleErr)
        matches = titleMatches || []
      }

      if (!matches || matches.length === 0) {
        const { data: contentMatches, error: contentErr } = await supabase
          .from('processed_modules')
          .select('processed_module_id, title, content, original_module_id, audio_duration')
          .ilike('content', `%${query}%`)
          .limit(6)
        if (contentErr) console.error('[assistant] supabase content search error', contentErr)
        matches = contentMatches || []
      }
    } catch (e) {
      console.error('[assistant] supabase search unexpected error', e)
    }

    // If still nothing, return a friendly message
    if (!matches || matches.length === 0) {
      return NextResponse.json({ answer: `I couldn't find matching module content for "${query}".` })
    }

    // If user asked about duration/length, try to answer from structured `audio_duration` first
    const qLower = query.toLowerCase()
    const asksDuration = qLower.includes('how long') || qLower.includes('duration') || qLower.includes('length') || qLower.includes('how long is')
    if (asksDuration) {
      // Group by original_module_id when available, else by title
      const byModule: Record<string, number[]> = {}
      for (const m of matches) {
        const key = m.original_module_id || m.title || m.processed_module_id
        if (!byModule[key]) byModule[key] = []
        if (typeof m.audio_duration === 'number' && !Number.isNaN(m.audio_duration)) byModule[key].push(m.audio_duration)
      }

      // If we have durations, compute sums and return a structured answer
      const results: string[] = []
      for (const key of Object.keys(byModule)) {
        const arr = byModule[key]
        if (arr.length === 0) continue
        const totalSec = arr.reduce((a, b) => a + b, 0)
        const mins = Math.floor(totalSec / 60)
        const secs = Math.round(totalSec % 60)
        // find a representative title for this key if possible
        const rep = matches.find((mm: any) => (mm.original_module_id || mm.title || mm.processed_module_id) === key)
        const label = rep?.title || key
        results.push(`${label}: ${mins}m ${secs}s`)
      }
      if (results.length > 0) {
        const answer = `Duration: ${results.join('; ')}`
        if (mode === 'doubt' && userId) await saveAskDoubt(userId, query, answer)
        return NextResponse.json({ answer, sources: matches.map((m: any) => ({ id: m.id, title: m.title })) })
      }
      // else fall through to LLM if no structured durations available
    }

    // --- Retrieval + Synthesis pipeline ---
    // Collect up to N relevant sections from matches and ask the LLM to synthesize
    const extractTopSections = (matches: any[], query: string, tokens: string[], maxSections = 3) => {
      const q = query.trim().toLowerCase()
      const normalize = (s: string) => s.replace(/[^a-z0-9 ]/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim()

      const parseSections = (text: string) => {
        const lines = text.replace(/\r\n/g, '\n').split('\n')
        const sections: Array<{ heading: string | null; body: string }> = []
        let currentHeading: string | null = null
        let buffer: string[] = []
        const isHeading = (line: string) => {
          if (!line) return false
          const t = line.trim()
          if (/^#{1,6}\s+/.test(t)) return true
          if (/^\*{2}.+\*{2}/.test(t)) return true
          if (/^[A-Za-z0-9 \-()]{1,80}:$/.test(t)) return true
          if (t.length > 0 && t.length < 80 && t === t.toUpperCase() && /[A-Z]/.test(t)) return true
          return false
        }
        for (const line of lines) {
          if (isHeading(line)) {
            if (buffer.length > 0 || currentHeading !== null) sections.push({ heading: currentHeading, body: buffer.join('\n').trim() })
            let h = line.trim().replace(/^#{1,6}\s+/, '').replace(/^\*{2}/, '').replace(/\*{2}$/, '').trim()
            currentHeading = h
            buffer = []
          } else {
            buffer.push(line)
          }
        }
        if (buffer.length > 0 || currentHeading !== null) sections.push({ heading: currentHeading, body: buffer.join('\n').trim() })
        return sections
      }

      const gathered: Array<{ title: string; text: string; score: number }> = []
      for (const m of matches) {
        const content = (m.content || '').toString()
        if (!content) continue
        const sections = parseSections(content)
        for (const sec of sections) {
          const body = (sec.body || '').trim()
          if (!body) continue
          let score = 0
          const hn = sec.heading ? normalize(sec.heading) : ''
          if (q && hn.includes(q)) score += 5
          for (const t of tokens) if (hn.includes(t)) score += 2
          if (body.toLowerCase().includes(q)) score += 3
          for (const t of tokens) if (body.toLowerCase().includes(t)) score += 1
          if (score > 0) gathered.push({ title: m.title || '', text: body, score })
        }
        if (gathered.length >= maxSections) break
      }
      gathered.sort((a, b) => b.score - a.score)
      const unique: Array<{ title: string; text: string }> = []
      const seen = new Set<string>()
      for (const g of gathered) {
        const key = (g.title || '') + '||' + g.text.slice(0, 200)
        if (!seen.has(key)) {
          unique.push({ title: g.title, text: g.text })
          seen.add(key)
        }
        if (unique.length >= maxSections) break
      }
      return unique
    }

    const sections = extractTopSections(matches, query, tokens, 3)

    // Helper: normalize and remove markdown-like markers, convert lists to '- '
    const cleanFormatting = (s: string) => {
      if (!s) return s
      let out = s.replace(/^\s*#{1,6}\s*/gm, '').replace(/```/g, '').trim()
      out = out.replace(/###\s*\d+\.?/g, '')
      out = out.replace(/(\*\*|__)(.*?)\1/g, '$2')
      out = out.replace(/(\*|_)(.*?)\1/g, '$2')
      out = out.replace(/^\s*\d+[\.)]\s+/gm, '- ')
      out = out.replace(/^\s*[\*\u2022]\s+/gm, '- ')
      out = out.replace(/\*\*/g, '')
      out = out.replace(/[ \t]+/g, ' ')
      out = out.replace(/\n{3,}/g, '\n\n')
      out = out.split('\n').map(l => l.trim()).join('\n')
      out = out.replace(/([^\n])\s+(-\s+)/g, '\n$2')
      // remove any leftover bracketed citations like [4:14] or (4)
      out = out.replace(/\[[^\]]*?\d+[^\]]*?\]/g, '')
      out = out.replace(/\([^\)]*?\d+[^\)]*?\)/g, '')
      return out.trim()
    }

    // Build sourceParts either from top sections or from truncated matches (for grounding)
    // Small sanitizer to remove citation artifacts like  or [4:14†source]
    const removeCitationArtifacts = (t: string) => {
      if (!t) return t
      let out = t
      // patterns like 【...source...】
      out = out.replace(/【[^】]*?source[^】]*】/gi, '')
      // patterns like [..source..]
      out = out.replace(/\[[^\]]*?source[^\]]*?\]/gi, '')
      // dagger source marker
      out = out.replace(/†source/gi, '')
      // any remaining bracketed numeric citations like [4:14] or [4]
      out = out.replace(/\[\s*\d+(?:[:,]\d+)?\s*\]/g, '')
      out = out.replace(/\(\s*\d+(?:[:,]\d+)?\s*\)/g, '')
      // collapse multiple spaces/newlines
      out = out.replace(/\n{3,}/g, '\n\n')
      out = out.replace(/[ \t]{2,}/g, ' ')
      return out.trim()
    }

    const truncate = (s: string, max = 1500) => (s && s.length > max ? s.slice(0, max) + '\n...[truncated]' : s)
    let sourceParts = ''
    if (sections && sections.length > 0) {
      // Use only the cleaned section text for grounding; do not include source headings or titles
      sourceParts = sections.map((s) => {
        const cleanText = removeCitationArtifacts(s.text)
        return `${cleanText}`
      }).join('\n\n---\n\n')
    } else {
      const contextParts = matches.map((m: any) => {
        const cleanText = removeCitationArtifacts(truncate(m.content || ''))
        return `${cleanText}`
      })
      sourceParts = contextParts.join('\n---\n')
    }

    // Synthesis prompt: ask model to paraphrase and synthesize (no citations)
    const synthSystem = `You are a helpful, conversational assistant. Use the provided content as grounding but DO NOT copy lines verbatim unless explicitly asked for quotes. Synthesize a single polished, human-sounding answer that is clear, intuitive, and step-by-step when helpful. You may use general knowledge to fill small gaps but avoid inventing specific factual claims. Do not include source IDs or citations. Output plain text only.`
    const synthUser = `User question: ${query}\n\nContext (for grounding only):\n${sourceParts}\n\nInstructions: Provide a polished, paraphrased answer that resonates with the provided content. Use '- ' for bullets and ensure each bullet is on its own line. Do not output citations or raw database fields.`

    // helper to detect long verbatim overlaps between sources and output
    const hasLongOverlap = (src: string, out: string, windowWords = 8) => {
      if (!src || !out) return false
      const sWords = src.split(/\s+/).filter(Boolean)
      for (let i = 0; i + windowWords <= sWords.length; i++) {
        const seq = sWords.slice(i, i + windowWords).join(' ')
        if (seq.length > 20 && out.includes(seq)) return true
      }
      return false
    }

    try {
      const synthResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: synthSystem },
            { role: 'user', content: synthUser },
          ],
          temperature: 0.45,
          max_tokens: 1100,
        }),
      })

      if (synthResp.ok) {
        const synthData = await synthResp.json()
        const synthText = synthData.choices?.[0]?.message?.content || ''
        if (synthText && typeof synthText === 'string' && synthText.trim().length > 0) {
          // if synthesis closely copied the sources, run a forced paraphrase pass
          const needsParaphrase = hasLongOverlap(sourceParts, synthText, 8)
          if (needsParaphrase) {
            try {
              const paraSystem = `You are a careful editor. Paraphrase the following text so that no sentence is copied verbatim from the original sources. Preserve meaning, change wording and structure, and format bullets with '- ' on separate lines. Do not include citations.`
              const paraUser = `Paraphrase this text:\n\n${synthText}`
              const paraResp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'gpt-4',
                  messages: [
                    { role: 'system', content: paraSystem },
                    { role: 'user', content: paraUser },
                  ],
                  temperature: 0.45,
                  max_tokens: 1000,
                }),
              })
              if (paraResp.ok) {
                const paraData = await paraResp.json()
                const paraText = paraData.choices?.[0]?.message?.content || ''
                if (paraText && typeof paraText === 'string' && paraText.trim().length > 0) {
                  const finalAnswer = cleanFormatting(paraText)
                  if (mode === 'doubt' && userId) await saveAskDoubt(userId, query, finalAnswer)
                  return NextResponse.json({ answer: finalAnswer })
                }
              }
            } catch (e) {
              console.warn('[assistant] paraphrase pass failed', e)
            }
          }

          // otherwise return cleaned synthesized text
          const finalAnswer = cleanFormatting(synthText)
          if (mode === 'doubt' && userId) await saveAskDoubt(userId, query, finalAnswer)
          return NextResponse.json({ answer: finalAnswer })
        }
      } else {
        const errTxt = await synthResp.text().catch(() => '')
        console.warn('[assistant] synth LLM error', synthResp.status, errTxt)
      }
    } catch (e) {
      console.error('[assistant] synth call failed', e)
    }

    // last-resort fallback: return cleaned sourceParts so the user still gets useful content
    const fallbackAnswer = cleanFormatting(sourceParts)
    if (mode === 'doubt' && userId) await saveAskDoubt(userId, query, fallbackAnswer)
    return NextResponse.json({ answer: fallbackAnswer })

    // --- end retrieval+synthesis pipeline ---

    

  } catch (err) {
    console.error('[assistant] unexpected error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
