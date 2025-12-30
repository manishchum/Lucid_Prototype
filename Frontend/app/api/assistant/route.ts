import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'
import { callGemini as libCallGemini } from '../../../lib/gemini-helper'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = (body?.query || '').toString().trim()
    const mode = body?.mode || null
    const userId = body?.user_id || null
    // collector for model-level errors (populated when we try OpenAI models)
    let modelErrors: Array<{ model: string; error: string }> = []

    // Diagnostic: log whether provider keys exist (do not print actual keys)
    try {
      console.log('[assistant] env flags:', { hasGemini: Boolean(process.env.GEMINI_API_KEY), hasOpenAI: Boolean(process.env.OPENAI_API_KEY) })
    } catch (e) {
      // ignore logging errors
    }

    // helper: append a simple {question,answer} object into ask_doubt jsonb array
    const saveAskDoubt = async (uid: string | null, question: string, answer: string) => {
      if (!uid) return
      try {
        // Prefer calling an atomic RPC if available
        const { error: rpcError } = await supabase.rpc('append_ask_doubt_qna', { p_user: uid, p_question: question, p_answer: answer })
        if (rpcError) {
          console.warn('[assistant] append_ask_doubt_qna rpc error', { user: uid, rpcError })
          // Fallback: read current array and upsert with appended element
          const { data: existing, error: selectErr } = await supabase.from('chatbot_user_interactions').select('ask_doubt').eq('user_id', uid).single()
          if (selectErr) console.warn('[assistant] fallback select error', { user: uid, selectErr })
          let arr: any[] = []
          if (existing && Array.isArray(existing.ask_doubt)) arr = existing.ask_doubt
          arr.push({ question, answer })
          const { data: upsertData, error: upsertErr } = await supabase.from('chatbot_user_interactions').upsert([{ user_id: uid, ask_doubt: arr, updated_at: new Date().toISOString() }], { onConflict: 'user_id' })
          if (upsertErr) {
            console.warn('[assistant] fallback upsert error', { user: uid, upsertErr })
          } else {
            try { console.log('[assistant] fallback upsert ok', { user: uid, upsertRows: Array.isArray(upsertData) ? upsertData.length : null }) } catch(e) {}
          }
        }
      } catch (e) {
        console.warn('[assistant] saveAskDoubt failed', e)
      }
    }

    // helper: append a summary object into summarize jsonb array
    const saveSummarize = async (uid: string | null, item: any) => {
      if (!uid) return
      try {
        // Try to read existing summarize array
        const { data: existing, error: selectErr } = await supabase.from('chatbot_user_interactions').select('summarize').eq('user_id', uid).single()
        if (selectErr) {
          // no existing row or error - attempt upsert to create the row with summarize array
          const { error: upsertErr } = await supabase.from('chatbot_user_interactions').upsert([{ user_id: uid, summarize: [item], updated_at: new Date().toISOString() }], { onConflict: 'user_id' })
          if (upsertErr) console.warn('[assistant] saveSummarize initial upsert error', { user: uid, upsertErr })
          return
        }
        let arr: any[] = []
        if (existing && Array.isArray(existing.summarize)) arr = existing.summarize
        arr.push(item)
        const { data: upsertData, error: upsertErr } = await supabase.from('chatbot_user_interactions').upsert([{ user_id: uid, summarize: arr, updated_at: new Date().toISOString() }], { onConflict: 'user_id' })
        if (upsertErr) console.warn('[assistant] saveSummarize upsert error', { user: uid, upsertErr })
        else try { console.log('[assistant] saveSummarize ok', { user: uid, rows: Array.isArray(upsertData) ? upsertData.length : null }) } catch(e) {}
      } catch (e) {
        console.warn('[assistant] saveSummarize failed', e)
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
      // simple canned responses for menu flows (updated modes)
      if (mode === 'summarize') {
        return NextResponse.json({ answer: 'Summarize content: Tell me the module name, topic, or paste the text you want summarized.' })
      }
      if (mode === 'practice') {
        return NextResponse.json({ answer: 'Practice: I can generate MCQs, short answers, and scenario questions. Which topic or module would you like practice for?' })
      }
      // fallback
      return NextResponse.json({ answer: 'How can I help? Please type your question or pick a menu option.' })
    }

    // Quick greeting handler: if user just says "hi"/"hello", return a friendly reply immediately.
    // This ensures an intuitive response even when LLM calls fail due to quota/access.
    const greetingRegex = /^(hi|hello|hey|hiya|yo|hey there|good (morning|afternoon|evening))\b/i
    if (query && greetingRegex.test(query) && query.length < 40) {
      const friendly = `Hi — I'm Lucid Assistant 👋\nI can help you find modules, summarize content, or answer doubts about your learning material. Try asking: "Find modules about prompt engineering" or "Summarize the module on problem solving." What would you like to do?`
      return NextResponse.json({ answer: friendly, llm_model_used: null, llm_error: null })
    }

    // Tokenize the query to improve matching (remove short/common words)
    const normalized = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    const tokens = Array.from(new Set(normalized.split(/\s+/).filter(t => t.length >= 3 && !['the','and','for','with','you','how','what','when','where','is','are','in','on','of','a','an'].includes(t))))

    let matches: any[] = []

    // Prepare LLM diagnostics that may be referenced outside the synth try/catch
    let synthData: any = null
    let usedModel: string | null = null

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

    // If still nothing, allow the synthesis path to run without grounding so
    // the LLM can answer directly from the user's query (do NOT return here).
    if (!matches || matches.length === 0) {
      // keep `matches` as an empty array and proceed to the synthesis stage
      matches = []
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
        try { await saveChatMessage(userId, { role: 'assistant', text: answer, created_at: new Date().toISOString() }) } catch (e) {}
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
    let _pdfUsed = false

    // If a PDF was uploaded and the user selected summarize mode, prefer that
    // PDF content exclusively as the grounding source (avoid using module matches).
    if (mode === 'summarize' && body?.pdf_base64) {
      try {
        const b64: string = body.pdf_base64
        const buf = Buffer.from(b64, 'base64')
        const pdfModule = await import('pdf-parse')
        const pdfParse: any = (pdfModule && (pdfModule as any).default) || pdfModule
        const pdfRes = await pdfParse(buf)
        const extracted = (pdfRes && pdfRes.text) ? String(pdfRes.text) : ''
        sourceParts = cleanFormatting(removeCitationArtifacts(extracted || ''))
        _pdfUsed = true
        console.log('[assistant] using uploaded PDF as grounding, length:', sourceParts.length)
      } catch (e) {
        console.warn('[assistant] pdf extraction failed, falling back to normal grounding', e)
      }
    }
    // Allow callers to force ungrounded generation from Gemini (ignore matched content)
    const forceUngrounded = Boolean(body?.ungrounded || body?.force_gemini || body?.generate_only)

    // If the client specifically requested ungrounded generation but the
    // GEMINI_API_KEY is not available to the running server, return a clear
    // explanatory message so the frontend doesn't show the vague 'No response'.
    if (forceUngrounded && !process.env.GEMINI_API_KEY) {
      console.warn('[assistant] ungrounded requested but GEMINI_API_KEY missing')
      return NextResponse.json({ answer: 'Assistant unavailable: GEMINI_API_KEY is not set in the server environment. Restart the Next dev server in the shell where you set the key, then try again.' })
    }
    if (!_pdfUsed && sections && sections.length > 0) {
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

    // Synthesis prompt: ask model to paraphrase and synthesize (no citations).
    // Practice mode: generate questions in various forms (MCQ, short answer, long answer, scenario).
    if (mode === 'practice') {
      const detectPracticeType = (q: string) => {
        const s = (q || '').toLowerCase()
        const countMatch = s.match(/(\d+)\s*(mcq|questions|qns|qs|items|cases)?/)
        const count = countMatch ? parseInt(countMatch[1], 10) : null
        if (/\b(mcq|multiple choice|multiple-choice|multiplechoice)\b/.test(s)) return { type: 'mcq', count: count || 5 }
        if (/\b(short answer|short-answer|short)\b/.test(s)) return { type: 'short_answer', count: count || 8 }
        if (/\b(long answer|essay|detailed|long)\b/.test(s)) return { type: 'long_answer', count: count || 3 }
        if (/\b(scenario|case study|scenario-based|case)\b/.test(s)) return { type: 'scenario', count: count || 3 }
        // allow explicit param
        if (body?.practice_type) return { type: String(body.practice_type), count: count || 5 }
        // default: mixed set of practice items
        return { type: 'mixed', count: count || 8 }
      }

      const req = detectPracticeType(query || '')
      const maxTokensForPractice = 1200
      let practicePromptSystem = ''
      let practicePromptUser = ''

      if (req.type === 'mcq') {
        practicePromptSystem = `You are an expert assessment author. Generate clear multiple-choice questions (MCQs) grounded in the provided source. For each question include: question text, four options labeled A–D, the correct option letter, and a one-sentence explanation for the correct answer. Keep language simple and unambiguous.`
        practicePromptUser = `Generate ${req.count} MCQs for this topic. Source:\n${sourceParts}`
      } else if (req.type === 'short_answer') {
        practicePromptSystem = `You are an assessment writer. Generate short-answer questions that ask for concise factual responses (1–2 sentences). For each item provide the question and a 1–2 sentence answer.`
        practicePromptUser = `Generate ${req.count} short-answer questions from the source. Source:\n${sourceParts}`
      } else if (req.type === 'long_answer') {
        practicePromptSystem = `You are an assessment writer. Generate long-answer / essay-style questions that require explanation or synthesis. For each item provide the question and a short rubric (3–5 bullet points) describing what a full answer should include.`
        practicePromptUser = `Generate ${req.count} long-answer questions from the source. Source:\n${sourceParts}`
      } else if (req.type === 'scenario') {
        practicePromptSystem = `You are an educator. Create scenario-based prompts (case studies) grounded in the source. Each scenario should include a short narrative and 2–4 follow-up questions asking the learner to apply concepts. Provide brief model answers.`
        practicePromptUser = `Generate ${req.count} scenario-based practice items from the source. Source:\n${sourceParts}`
      } else {
        practicePromptSystem = `You are an assessment author. Produce a mixed set of practice items (MCQs, short answers, and one scenario). Label each item with its type.`
        practicePromptUser = `Generate ${req.count} varied practice items from the source. Source:\n${sourceParts}`
      }

      try {
        // call Gemini via helper
        const practiceResp = await (async () => {
          try {
            const r = await libCallGemini(practicePromptUser, { candidateModels: ['gemini-2.0-flash-lite'], maxOutputTokens: maxTokensForPractice, temperature: 0.25 })
            return r
          } catch (e) { return { data: null, ok: false, text: String(e) } }
        })()
        
        const savePracticeQues = async (uid: string | null, item: any) => {
          if (!uid) return
          try {
            // Try to read existing practise_ques array
            const { data: existing, error: selectErr } = await supabase.from('chatbot_user_interactions').select('practise_ques').eq('user_id', uid).single()
            if (selectErr) {
              // attempt upsert to create the row with practise_ques array
              const { error: upsertErr } = await supabase.from('chatbot_user_interactions').upsert([{ user_id: uid, practise_ques: [item], updated_at: new Date().toISOString() }], { onConflict: 'user_id' })
              if (upsertErr) console.warn('[assistant] savePracticeQues initial upsert error (practise_ques)', { user: uid, upsertErr })
              return
            }
            let arr: any[] = []
            if (existing && Array.isArray(existing.practise_ques)) arr = existing.practise_ques
            arr.push(item)
            const { data: upsertData, error: upsertErr } = await supabase.from('chatbot_user_interactions').upsert([{ user_id: uid, practise_ques: arr, updated_at: new Date().toISOString() }], { onConflict: 'user_id' })
            if (upsertErr) console.warn('[assistant] savePracticeQues upsert error (practise_ques)', { user: uid, upsertErr })
            else try { console.log('[assistant] savePracticeQues ok (practise_ques)', { user: uid, rows: Array.isArray(upsertData) ? upsertData.length : null }) } catch(e) {}
          } catch (e) {
            console.warn('[assistant] savePracticeQues failed', e)
          }
        }

        if (practiceResp && practiceResp.ok && practiceResp.data) {
          const practiceText = practiceResp.data.text || practiceResp.data.candidates?.[0]?.content || practiceResp.data.candidates?.[0]?.output || practiceResp.data.output?.[0]?.content || ''
          if (practiceText && practiceText.trim().length > 0) {
            // Save to database using same pattern as ask doubt and summarize
            if (userId) {
              await savePracticeQues(userId, { query: query, type: req.type, content: practiceText, created_at: new Date().toISOString() })
            }
            // Return the generated practice questions
            const finalAnswer = cleanFormatting(practiceText)
            return NextResponse.json({ answer: finalAnswer, llm_model_used: 'gemini-2.0-flash-lite' })
          }
        }
      } catch (e) {
        console.error('[assistant] practice generation failed', e)
        // fall through to normal synth if practice fails
      }
    }

    // If `forceUngrounded` is true, instruct the model to answer directly without using grounding context.
    let synthSystem = forceUngrounded
      ? `You are a helpful, conversational assistant. Answer the user's question directly and concisely. Do not rely on external context or try to search a corpus; instead, use general knowledge and reasoning to produce a clear, step-by-step response when helpful. Do not include citations. Output plain text only.`
      : `You are a helpful, conversational assistant. Use the provided content as grounding but DO NOT copy lines verbatim unless explicitly asked for quotes. Synthesize a single polished, human-sounding answer that is clear, intuitive, and step-by-step when helpful. You may use general knowledge to fill small gaps but avoid inventing specific factual claims. Do not include source IDs or citations. Output plain text only.`

    let synthUser = forceUngrounded
      ? `User question: ${query}\n\nInstructions: Provide a polished, direct answer to the question. Use '- ' for bullets and ensure each bullet is on its own line. Do not output citations or raw database fields.`
      : `User question: ${query}\n\nContext (for grounding only):\n${sourceParts}\n\nInstructions: Provide a polished, paraphrased answer that resonates with the provided content. Use '- ' for bullets and ensure each bullet is on its own line. Do not output citations or raw database fields.`

    // If the client requested summarize mode, choose a prompt based on user intent
    let summarizeIntent: string | null = null
    if (mode === 'summarize') {
      const detectSummarizeIntent = (q: string) => {
        if (!q) return 'complete_summary'
        const s = q.toLowerCase()
        if (/\b(topic|topics|outline|headings|sections|toc|table of contents)\b/.test(s)) return 'topics'
        if (/\b(key point|key points|keypoints|takeaway|takeaways|bullets|bullet points|highlights)\b/.test(s)) return 'key_points'
        if (/\b(action items|action-item|action items|next steps|todo|to do|tasks|actions)\b/.test(s)) return 'action_items'
        if (/\b(brief|short|concise|tldr|tl;dr|one-liner|one line|quick summary)\b/.test(s)) return 'short_summary'
        if (/\b(complete|detailed|detailed summary|full summary|comprehensive|in detail|long)\b/.test(s)) return 'complete_summary'
        // default to complete structured summary
        return 'complete_summary'
      }

      summarizeIntent = detectSummarizeIntent(query || body?.pdf_name || '')

      // Build prompt templates for each intent
      if (summarizeIntent === 'topics') {
        synthSystem = `You are an expert content analyst. Extract the main topical structure from the source text. Produce a concise list of topic headings or section titles that represent the major themes. For each topic, include a 1-2 sentence description (no more). Output plain Markdown list with headings.`
        synthUser = `Produce a topics-only outline for the following source. Source:\n${sourceParts}\n\nInstructions:\n- List 8–20 topic headings or section names in order of prominence.\n- For each topic, include a 1–2 sentence description summarizing what that topic covers (no examples, no procedures).\n- Keep output compact and use Markdown list format.`
      } else if (summarizeIntent === 'key_points') {
        synthSystem = `You are an expert summarizer. Extract the most important fact-level takeaways from the source. Produce concise bullet points that a learner can scan quickly. Do not invent facts; if missing, say 'Not found in source.' Output plain Markdown bullets.`
        synthUser = `Produce 6–15 concise key-point bullets from the source. Source:\n${sourceParts}\n\nInstructions:\n- Each bullet should be 1–2 lines and focus on facts or central ideas.\n- Prefer precise phrasing from the source when present.\n- Output as a Markdown list with '- '.`
      } else if (summarizeIntent === 'short_summary') {
        synthSystem = `You are a concise summarizer. Produce a short, high-value summary suitable for a quick review. Keep it to 3–6 sentences or 4–6 bullets. Output plain text or Markdown bullets.`
        synthUser = `Produce a short summary of the source (3–6 sentences or up to 6 bullets). Source:\n${sourceParts}\n\nInstructions:\n- Keep it brief and focused on the most important points.\n- Do not include procedural step lists or long examples.`
      } else if (summarizeIntent === 'action_items') {
        synthSystem = `You are a practical assistant that extracts actionable next steps from the source. Produce a prioritized checklist of actions someone should take to apply the content. Output plain Markdown checklist items ('- [ ] ...').`
        synthUser = `From the source, extract a set of actionable items or next steps (5–12). Source:\n${sourceParts}\n\nInstructions:\n- Each item should be a clear, executable action.\n- Prioritize items when possible and include brief rationale in parentheses.`
      } else {
        // complete_summary (default)
        synthSystem = `You are an expert subject-matter summarizer. Your goal is to produce a knowledge-dense, extractive summary targeted to someone who will *use* this material (a practitioner or learner). Prioritize facts and instructions that are present in the source. Do NOT hallucinate specifics. Structure the output with clear headings and sections: "Key facts", "Definitions", "Procedures / Steps", "Examples", "Actionable Takeaways". Under each heading, use short bullet points. When the source contains section headings or page numbers, include brief section references in parentheses. Keep the language precise and technical where appropriate. Output in Markdown. Do not include citations or raw DB fields.`
        synthUser = `Please produce a detailed, structured summary of the following source. Focus on extracting concrete knowledge, procedures, and actionable points rather than a high-level overview. Preserve terminology from the source where useful.\n\nSource:\n${sourceParts}\n\nInstructions:\n- Produce sections with these headings: Key facts; Definitions; Procedures / Steps; Examples; Actionable takeaways.\n- For each section, list 6–12 concise bullet points (or fewer if not available).\n- When a detail is ambiguous or not present, say "Not found in source." Do not invent facts.\n- If the source has section names, mention them briefly in parentheses after the bullet.\n- Keep the final summary between 200 and 1200 words, favoring clarity and actionable detail.\n\nOutput in Markdown only.`
      }
    }

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

     // helper: format module-like headings as bold Markdown (e.g. "Module 1: Intro" -> "**Module 1: Intro**")
    const formatModuleHeadings = (s: string) => {
      if (!s) return s
      try {
        // replace lines that start with 'Module' optionally numbered, or 'Module <n>:' patterns
        return s.replace(/^(\s*)(Module\s*\d+\s*:?.*)$/gmi, (m, p1, p2) => `${p1}**${p2.trim()}**`)
      } catch (e) {
        return s
      }
    }

    // Persist the user's message to chat history (non-blocking)
    try {
      try { await saveChatMessage(userId, { role: 'user', text: query, created_at: new Date().toISOString() }) } catch (e) { /* non-fatal */ }
      // OpenAI integration removed: assistant uses Gemini exclusively.

      // Adapter: delegate to shared gemini helper and normalize result to
      // the older local shape expected by this route.
      const callGemini = async (modelName: string, promptText: string, max_tokens = 512) => {
        try {
          const res = await libCallGemini(promptText, { candidateModels: [modelName], maxOutputTokens: max_tokens, temperature: 0.45 })
          if (res && res.ok) {
            return { data: res.data, error: null }
          }
          return { data: null, error: res && res.text ? res.text : 'gemini_error' }
        } catch (err) {
          return { data: null, error: err instanceof Error ? err.message : String(err) }
        }
      }

      // Use Gemini exclusively for synthesis; no OpenAI fallback configured.
      const messagesForSynth = [
        { role: 'system', content: synthSystem },
        { role: 'user', content: synthUser },
      ]

      // Use Gemini exclusively for the assistant when configured.
      const geminiModel = 'gemini-2.0-flash-lite'
      if (process.env.GEMINI_API_KEY) {
        const synthMaxTokens = mode === 'summarize' ? 2500 : 1500
        const gResp = await callGemini(geminiModel, synthUser, synthMaxTokens)
        try { console.log('[assistant] gemini raw response', { model: geminiModel, gRespPreview: JSON.stringify(gResp).slice(0,2000) }) } catch(e) {}
        if (gResp && gResp.data && !gResp.error) {
          // Prefer helper-normalized `.text` when present, else fall back to candidate shapes
          const cand = gResp.data.text || gResp.data.candidates?.[0]?.content || gResp.data.candidates?.[0]?.output || gResp.data.output?.[0]?.content || ''
          synthData = { choices: [{ message: { content: cand } }] }
          usedModel = `gemini:${geminiModel}`
          try {
            console.log('[assistant] gemini synth success', { model: usedModel, preview: (cand || '').slice(0, 400) })
          } catch (e) {
            // ignore logging errors
          }
        } else {
          const errText = (gResp && (gResp.error || gResp.text)) || 'unknown_gemini_error'
          modelErrors.push({ model: `gemini:${geminiModel}`, error: errText })
          console.error('[assistant] gemini failed for synth pass', errText, { gResp })
          try {
            console.log('[assistant] returning grounded fallback (gemini failed)', { fallbackPreview: cleanFormatting(sourceParts).slice(0, 400) })
          } catch (e) {}
          // Return grounded fallback so the user still receives content rather than attempting OpenAI
          const fallbackAnswer = cleanFormatting(sourceParts)
          // persist assistant reply
          try { await saveChatMessage(userId, { role: 'assistant', text: fallbackAnswer, llm_model_used: null, llm_error: modelErrors.length ? modelErrors : null, created_at: new Date().toISOString() }) } catch (e) {}
          if (mode === 'doubt' && userId) await saveAskDoubt(userId, query, fallbackAnswer)
          if (mode === 'summarize' && userId) await saveSummarize(userId, { title: body?.pdf_name || (query || null), summary: fallbackAnswer, source: body?.pdf_name ? 'pdf' : 'text', intent: summarizeIntent || 'complete_summary', created_at: new Date().toISOString() })
          return NextResponse.json({ answer: fallbackAnswer, llm_model_used: null, llm_error: modelErrors.length ? modelErrors : null })
        }
      } else {
        // Gemini is required for the assistant in this configuration
        console.warn('[assistant] GEMINI_API_KEY missing; assistant configured to use Gemini only')
        const fallbackAnswer = cleanFormatting(sourceParts)
        try { await saveChatMessage(userId, { role: 'assistant', text: fallbackAnswer, llm_model_used: null, llm_error: [{ model: 'gemini', error: 'no_gemini_key' }], created_at: new Date().toISOString() }) } catch (e) {}
        if (mode === 'doubt' && userId) await saveAskDoubt(userId, query, fallbackAnswer)
        if (mode === 'summarize' && userId) await saveSummarize(userId, { title: body?.pdf_name || (query || null), summary: fallbackAnswer, source: body?.pdf_name ? 'pdf' : 'text', created_at: new Date().toISOString() })
        return NextResponse.json({ answer: fallbackAnswer, llm_model_used: null, llm_error: [{ model: 'gemini', error: 'no_gemini_key' }] })
      }

      if (synthData) {
        const synthText = synthData.choices?.[0]?.message?.content || ''
        if (synthText && typeof synthText === 'string' && synthText.trim().length > 0) {
          const needsParaphrase = hasLongOverlap(sourceParts, synthText, 8)
          if (needsParaphrase) {
            try {
              const paraSystem = `You are a careful editor. Paraphrase the following text so that no sentence is copied verbatim from the original sources. Preserve meaning, change wording and structure, and format bullets with '- ' on separate lines. Do not include citations.`
              const paraUser = `Paraphrase this text:\n\n${synthText}`
              // Paraphrase using Gemini when available (assistant is Gemini-first)
              let paraRespData: any = null
              if (process.env.GEMINI_API_KEY) {
                try {
                  const pResp = await callGemini(geminiModel, paraUser, 1000)
                  if (pResp && pResp.data && !pResp.error) {
                    const cand = pResp.data.candidates?.[0]?.content || pResp.data.candidates?.[0]?.output || pResp.data.output?.[0]?.content || ''
                    paraRespData = { choices: [{ message: { content: cand } }] }
                    if (!usedModel) usedModel = `${geminiModel}`
                  } else {
                    modelErrors.push({ model: `${geminiModel}`, error: (pResp && pResp.error) || 'unknown_gemini_error' })
                  }
                } catch (err) {
                  modelErrors.push({ model: ` ${geminiModel}`, error: err instanceof Error ? err.message : String(err) })
                }
              } else {
                // No OpenAI fallback: paraphrase attempt will not call OpenAI.
              }
              if (paraRespData) {
                const paraText = paraRespData.choices?.[0]?.message?.content || ''
                  if (paraText && typeof paraText === 'string' && paraText.trim().length > 0) {
                  let finalAnswer = cleanFormatting(paraText)
                  finalAnswer = formatModuleHeadings(finalAnswer)
                  try {
                    console.log('[assistant] returning paraphrased answer from gemini', { preview: finalAnswer.slice(0,400), usedModel: usedModel })
                  } catch (e) {}
                  // persist assistant reply
                  try { await saveChatMessage(userId, { role: 'assistant', text: finalAnswer, llm_model_used: usedModel, intent: summarizeIntent || null, created_at: new Date().toISOString() }) } catch (e) {}
                  if (mode === 'doubt' && userId) await saveAskDoubt(userId, query, finalAnswer)
                  if (mode === 'summarize' && userId) await saveSummarize(userId, { title: body?.pdf_name || (query || null), summary: finalAnswer, source: body?.pdf_name ? 'pdf' : 'text', intent: summarizeIntent || 'complete_summary', created_at: new Date().toISOString() })
                  return NextResponse.json({ answer: finalAnswer, llm_model_used: usedModel, llm_error: modelErrors.length ? modelErrors : null })
                }
              }
            } catch (e) {
              console.warn('[assistant] paraphrase pass failed', e)
            }
          }

          let finalAnswer = cleanFormatting(synthText)
          finalAnswer = formatModuleHeadings(finalAnswer)
          try {
            console.log('[assistant] returning synth answer from gemini', { preview: finalAnswer.slice(0,400), usedModel: usedModel })
          } catch (e) {}
          // persist assistant reply
          try { await saveChatMessage(userId, { role: 'assistant', text: finalAnswer, llm_model_used: usedModel, intent: summarizeIntent || null, created_at: new Date().toISOString() }) } catch (e) {}
          if (mode === 'doubt' && userId) await saveAskDoubt(userId, query, finalAnswer)
          if (mode === 'summarize' && userId) await saveSummarize(userId, { title: body?.pdf_name || (query || null), summary: finalAnswer, source: body?.pdf_name ? 'pdf' : 'text', intent: summarizeIntent || 'complete_summary', created_at: new Date().toISOString() })
          return NextResponse.json({ answer: finalAnswer, llm_model_used: usedModel, llm_error: modelErrors.length ? modelErrors : null })
        }
      }
      // If we reach here, all model attempts failed or produced no text
      console.warn('[assistant] openai produced no valid text; falling back to sourceParts', modelErrors)
    } catch (e) {
      console.error('[assistant] synth call failed', e)
    }

    // last-resort fallback: return cleaned sourceParts so the user still gets useful content
    let fallbackAnswer = cleanFormatting(sourceParts)
    // Avoid returning an empty-string answer which the frontend displays as
    // the unhelpful literal 'No response'. Provide a helpful hint instead.
    if (!fallbackAnswer || fallbackAnswer.trim().length === 0) {
      fallbackAnswer = forceUngrounded
        ? 'No assistant response: ungrounded generation was requested but the assistant could not produce an answer. Ensure the GEMINI_API_KEY is set and restart the server.'
        : 'No matching content found for your query. Try rephrasing the question or enable ungrounded generation to get a direct answer.'
    }
    try {
      console.log('[assistant] returning final fallback from sourceParts', { preview: fallbackAnswer.slice(0,400), modelErrors: modelErrors })
    } catch (e) {}
    // format module headings for fallback answer as well
    fallbackAnswer = formatModuleHeadings(fallbackAnswer)
    // persist assistant fallback reply
    try { await saveChatMessage(userId, { role: 'assistant', text: fallbackAnswer, llm_model_used: null, llm_error: modelErrors.length ? modelErrors : null, intent: summarizeIntent || null, created_at: new Date().toISOString() }) } catch (e) {}
    if (mode === 'doubt' && userId) await saveAskDoubt(userId, query, fallbackAnswer)
    if (mode === 'summarize' && userId) await saveSummarize(userId, { title: body?.pdf_name || (query || null), summary: fallbackAnswer, source: body?.pdf_name ? 'pdf' : 'text', intent: summarizeIntent || 'complete_summary', created_at: new Date().toISOString() })
    return NextResponse.json({ answer: fallbackAnswer, llm_model_used: null, llm_error: modelErrors.length ? modelErrors : null })

    // --- end retrieval+synthesis pipeline ---

    

  } catch (err) {
    console.error('[assistant] unexpected error', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    const stack = err instanceof Error && err.stack ? err.stack : null
    // In development, return the stack to aid debugging; in production, hide details
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.json({ error: message, stack }, { status: 500 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
