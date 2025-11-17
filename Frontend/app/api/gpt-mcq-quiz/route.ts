import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import crypto from 'crypto';

// Deep comparison helpers for modules
function normalizeModules(modules: any[]) {
  if (!Array.isArray(modules)) return [];
  // Only keep objects with a title property
  const validModules = modules.filter(m => m && typeof m === 'object' && typeof m.title === 'string');
  return validModules
    .map(m => ({
      ...m,
      topics: Array.isArray(m.topics) ? [...m.topics].sort() : [],
      objectives: Array.isArray(m.objectives) ? [...m.objectives].sort() : [],
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function areModulesEqual(modulesA: any[], modulesB: any[]) {
  return JSON.stringify(normalizeModules(modulesA)) === JSON.stringify(normalizeModules(modulesB));
}

// Helper to call OpenAI for MCQ quiz generation
async function generateMCQQuiz(summary: string, modules: any[], objectives: any[]): Promise<any[]> {
  const prompt = `You are an expert instructional designer. Your task is to generate multiple-choice questions (MCQs) from the provided learning content using Bloom’s Taxonomy.

Input: A learning asset (text, notes, or structured content).

Output: A set of 30 MCQs (Multiple Choice Questions) distributed across difficulty levels based on Bloom’s Taxonomy.

Easy → Remember & Understand (default: 20%)
Average → Apply & Analyze (default: 50%)
Difficult → Evaluate & Create (default: 30%)

Bloom’s Level Mapping:
Remember: Define, List, Identify, Recall, Name, Label, Recognize, State, Match, Repeat, Select
Understand: Explain, Summarize, Describe, Interpret, Restate, Paraphrase, Classify, Discuss, Illustrate, Compare (basic), Report
Apply: Solve, Demonstrate, Use, Implement, Apply, Execute, Practice, Show, Operate, Employ, Perform
Analyze: Differentiate, Compare, Contrast, Organize, Examine, Break down, Categorize, Investigate, Distinguish, Attribute, Diagram
Evaluate: Judge, Critique, Justify, Recommend, Assess, Evaluate, Defend, Support, Argue, Prioritize, Appraise, Rate, Validate
Create: Design, Generate, Propose, Develop, Formulate, Construct, Invent, Plan, Compose, Produce, Hypothesize, Integrate, Originate

Exhaustive Question-Type Bank (Stems/Patterns):
Remember: “What is…?”, “Which of the following defines…?”, “Identify…”, “Who discovered…?”, “When/Where did…?”, “Match the term with…”
Understand: “Which best explains…?”, “Summarize…”, “What does this mean…?”, “Which example illustrates…?”, “Why does…happen?”
Apply: “Which principle would you use if…?”, “What is the correct method to…?”, “How would you solve…?”, “Which tool/technique applies to…?”, “Which step comes next…?”
Analyze: “Which factor contributes most to…?”, “What pattern best explains…?”, “Which cause-effect relationship is correct…?”, “What evidence supports…?”, “Which statement best differentiates between…?”
Evaluate: “Which option provides the best justification…?”, “Which solution is most effective and why?”, “Which argument is strongest?”, “Which evidence best supports…?”, “What decision is most appropriate…?”
Create: “What new approach could be developed…?”, “Which design achieves…?”, “How would you improve…?”, “Which combination of ideas solves…?”, “What hypothesis could you form…?”

Question Design Rules:
- Each question must explicitly map to its Bloom’s level.
- Provide 4 answer choices (A–D).
- Clearly mark the correct answer.
- Avoid ambiguity; test one concept per question. Ensure every concept is tested.

Return ONLY a valid JSON array of 30 question objects, with no extra text, markdown, code blocks, or formatting. Each object must include:
{
  "question": string,
  "bloomLevel": string,
  "options": [string, string, string, string],
  "correctIndex": number,
  "explanation": string (optional)
}

Learning Content:
Summary: ${summary}
Modules: ${JSON.stringify(modules)}
Objectives: ${JSON.stringify(objectives)}
`;
  console.log("[gpt-mcq-quiz] Calling OpenAI with prompt:", prompt.slice(0, 500));

  // Call OpenAI API (replace with your actual API call)
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0.7,
      max_tokens: 8000,
    }),
  });
  const data = await response.json();
  console.log('[gpt-mcq-quiz][DEBUG] Raw OpenAI response:', JSON.stringify(data, null, 2));
  let quiz;
  try {
    quiz = JSON.parse(data.choices[0].message.content);
    if (!Array.isArray(quiz) || quiz.length === 0) {
      console.warn('[gpt-mcq-quiz][WARN] Parsed quiz is empty or not an array:', quiz);
    }
  } catch (err) {
    console.error('[gpt-mcq-quiz][ERROR] Failed to parse GPT response:', err, data.choices?.[0]?.message?.content);
    quiz = [];
  }
  return quiz;
}


export async function POST(request: NextRequest) {
  const body = await request.json();
  console.log("[gpt-mcq-quiz] POST body:", body);
  // Per-module quiz branch: only run this when a single moduleId is provided
  // and no moduleIds array is present (avoid accidental branch when both are sent).
  if (body.moduleId && !body.moduleIds) {
    const moduleId = String(body.moduleId);
    if (!moduleId || moduleId === 'undefined' || moduleId === 'null') {
      return NextResponse.json({ error: 'Invalid moduleId' }, { status: 400 });
    }
    const learningStyle = body.learningStyle || null;
    if (!learningStyle) {
      return NextResponse.json({ error: 'Missing learningStyle in request.' }, { status: 400 });
    }
    console.log(`[gpt-mcq-quiz] Per-module quiz requested for moduleId: ${moduleId}, learningStyle: ${learningStyle}`);
    // Ensure a processed_modules row exists for this training module (original_module_id)
    let processedModuleId: string | null = null;
    let tmRow: any = null;
    const { data: existingProcessed, error: existingProcessedErr } = await supabase
      .from('processed_modules')
      .select('processed_module_id, title, content, original_module_id')
      .eq('original_module_id', moduleId)
      .maybeSingle();
    if (existingProcessedErr) console.warn('[gpt-mcq-quiz] lookup processed_modules warning:', existingProcessedErr);
    if (existingProcessed && existingProcessed.processed_module_id) {
      processedModuleId = existingProcessed.processed_module_id;
    } else {
      // Create a processed_modules row from the training_modules data
      let tmRow: any = null;
      const { data: _tmRow, error: tmErr } = await supabase
        .from('training_modules')
        .select('module_id, title, gpt_summary')
        .eq('module_id', moduleId)
        .maybeSingle();
      tmRow = _tmRow;
      if (tmErr || !tmRow) return NextResponse.json({ error: 'Module not found' }, { status: 404 });
      const insertPayload: any = {
        original_module_id: String(moduleId),
        title: tmRow.title || null,
        content: tmRow.gpt_summary || null,
        learning_style: null
      };
      const { data: insData, error: insErr } = await supabase
        .from('processed_modules')
        .insert(insertPayload)
        .select('processed_module_id')
        .limit(1);
      if (insErr) {
        console.error('[gpt-mcq-quiz] Failed to create processed_modules row:', insErr);
        return NextResponse.json({ error: 'Failed to create processed module' }, { status: 500 });
      }
      processedModuleId = Array.isArray(insData) && insData[0] ? insData[0].processed_module_id : null;
      if (!processedModuleId) return NextResponse.json({ error: 'Failed to resolve processed module id' }, { status: 500 });
    }

    // Prepare module title/content for prompt
    const moduleTitle = (existingProcessed && existingProcessed.title) || (typeof tmRow !== 'undefined' && tmRow && tmRow.title) || '';
    const moduleContent = (existingProcessed && existingProcessed.content) || (typeof tmRow !== 'undefined' && tmRow && tmRow.gpt_summary) || '';

    // Check if quiz already exists for this processed module id and learning style (robust to duplicates)
    const { data: assessmentsList } = await supabase
      .from('assessments')
      .select('assessment_id, questions')
      .eq('type', 'module')
      .eq('processed_module_id', processedModuleId)
      .eq('learning_style', learningStyle)
      .order('assessment_id', { ascending: false })
      .limit(1);
    const existing = Array.isArray(assessmentsList) ? assessmentsList[0] : null;
    if (existing) {
      // Always return existing quiz, regardless of questions content
      try {
        const quiz = Array.isArray(existing.questions) ? existing.questions : JSON.parse(existing.questions);
        return NextResponse.json({ quiz });
      } catch (e) {
        // If parse fails, return raw questions
        return NextResponse.json({ quiz: existing.questions });
      }
    }
  // Compose prompt for per-module MCQ quiz (no mixed question types)
  const prompt = `You are an expert instructional designer. Your task is to generate multiple-choice questions (MCQs) from the provided learning content using Bloom’s Taxonomy.

Input: A learning asset (text, notes, or structured content).

Output: A set of 10-13 MCQs (Multiple Choice Questions) distributed across difficulty levels based on Bloom’s Taxonomy.

Easy → Remember & Understand (default: 20%)
Average → Apply & Analyze (default: 50%)
Difficult → Evaluate & Create (default: 30%)

Bloom’s Level Mapping:
Remember: Define, List, Identify, Recall, Name, Label, Recognize, State, Match, Repeat, Select
Understand: Explain, Summarize, Describe, Interpret, Restate, Paraphrase, Classify, Discuss, Illustrate, Compare (basic), Report
Apply: Solve, Demonstrate, Use, Implement, Apply, Execute, Practice, Show, Operate, Employ, Perform
Analyze: Differentiate, Compare, Contrast, Organize, Examine, Break down, Categorize, Investigate, Distinguish, Attribute, Diagram
Evaluate: Judge, Critique, Justify, Recommend, Assess, Evaluate, Defend, Support, Argue, Prioritize, Appraise, Rate, Validate
Create: Design, Generate, Propose, Develop, Formulate, Construct, Invent, Plan, Compose, Produce, Hypothesize, Integrate, Originate

Exhaustive Question-Type Bank (Stems/Patterns):
Remember: “What is…?”, “Which of the following defines…?”, “Identify…”, “Who discovered…?”, “When/Where did…?”, “Match the term with…”
Understand: “Which best explains…?”, “Summarize…”, “What does this mean…?”, “Which example illustrates…?”, “Why does…happen?”
Apply: “Which principle would you use if…?”, “What is the correct method to…?”, “How would you solve…?”, “Which tool/technique applies to…?”, “Which step comes next…?”
Analyze: “Which factor contributes most to…?”, “What pattern best explains…?”, “Which cause-effect relationship is correct…?”, “What evidence supports…?”, “Which statement best differentiates between…?”
Evaluate: “Which option provides the best justification…?”, “Which solution is most effective and why?”, “Which argument is strongest?”, “Which evidence best supports…?”, “What decision is most appropriate…?”
Create: “What new approach could be developed…?”, “Which design achieves…?”, “How would you improve…?”, “Which combination of ideas solves…?”, “What hypothesis could you form…?”

Question Design Rules:
- Each question must explicitly map to its Bloom’s level.
- Provide 4 answer choices (A–D).
- Clearly mark the correct answer.
- Avoid ambiguity; test one concept per question. Ensure every concept is tested.

Return ONLY a valid JSON array of 10-13 question objects, with no extra text, markdown, code blocks, or formatting. Each object must include:
{
  "question": string,
  "bloomLevel": string,
  "options": [string, string, string, string],
  "correctIndex": number,
  "explanation": string (optional)
}

Learning Content:
Summary: ${moduleTitle}
Modules: ${JSON.stringify([moduleTitle])}
Objectives: ${JSON.stringify([moduleContent])}`;
    console.log(`[gpt-mcq-quiz] Calling OpenAI for moduleId: ${moduleId} with learning style: ${learningStyle}`);
    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
        messages: [{ role: 'system', content: prompt }],
        temperature: 0.7,
        max_tokens: 20000,
      }),
    });
    const data = await response.json();
    console.log('[gpt-mcq-quiz][DEBUG] Raw GPT response:', JSON.stringify(data, null, 2));
    let quiz = [];
    if (data.choices && Array.isArray(data.choices) && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
      try {
        quiz = JSON.parse(data.choices[0].message.content);
      } catch (e) {
        console.log('[gpt-mcq-quiz][DEBUG] Failed to parse GPT response:', e, data.choices[0].message.content);
        quiz = [];
      }
    } else {
      console.log('[gpt-mcq-quiz][DEBUG] GPT response missing choices or content:', data);
    }
    console.log('[gpt-mcq-quiz][DEBUG] Generated quiz:', quiz);
    // Save quiz for this learning style, using a deterministic UUID to avoid race-condition duplicates
    const stableIdSeed = `module:${processedModuleId}|style:${learningStyle}`;
    const hash = crypto.createHash('sha1').update(stableIdSeed).digest('hex');
    const stableId = `${hash.substring(0,8)}-${hash.substring(8,12)}-${hash.substring(12,16)}-${hash.substring(16,20)}-${hash.substring(20,32)}`;
    const { data: insertResult, error: insertError } = await supabase
      .from('assessments')
      .insert({
        id: stableId,
        type: 'module',
        processed_module_id: processedModuleId,
        questions: JSON.stringify(quiz),
        learning_style: learningStyle
      });
    if (insertError) {
      // If another concurrent request inserted the same row, return that one
      if ((insertError as any).code === '23505' || (insertError as any).code === '409') {
        const { data: existingListAfter } = await supabase
          .from('assessments')
          .select('assessment_id, questions')
          .eq('type', 'module')
          .eq('processed_module_id', processedModuleId)
          .eq('learning_style', learningStyle)
          .order('assessment_id', { ascending: false })
          .limit(1);
        const existingAfter = Array.isArray(existingListAfter) ? existingListAfter[0] : null;
        if (existingAfter) {
          try {
            const quizExisting = Array.isArray(existingAfter.questions) ? existingAfter.questions : JSON.parse(existingAfter.questions);
            return NextResponse.json({ quiz: quizExisting });
          } catch {
            return NextResponse.json({ quiz: existingAfter.questions });
          }
        }
        // Fallback: still return the generated quiz
        return NextResponse.json({ quiz });
      }
      console.log('[gpt-mcq-quiz][DEBUG] Insert error (non-duplicate):', insertError);
      return NextResponse.json({ error: 'Failed to save assessment' }, { status: 500 });
    }
    console.log('[gpt-mcq-quiz][DEBUG] Insert result:', insertResult);
    return NextResponse.json({ quiz });
  }

  // Baseline (multi-module) quiz generation with modules_snapshot logic
  const { moduleIds, companyId, trainingId } = body;
  if (!moduleIds || !Array.isArray(moduleIds) || moduleIds.length === 0) {
    return NextResponse.json({ error: 'moduleIds (array) required' }, { status: 400 });
  }
  if (!companyId) {
    return NextResponse.json({ error: 'companyId required' }, { status: 400 });
  }
  // 1. Get all selected training modules' content for this company only
  const { data, error } = await supabase
    .from('training_modules')
    .select('module_id, title, gpt_summary, ai_modules, ai_objectives, company_id')
    .in('module_id', moduleIds)
    .eq('company_id', companyId);
  if (error || !data || data.length === 0) return NextResponse.json({ error: 'Modules not found' }, { status: 404 });
  // Map training module_id -> row for easy lookup
  const tmMap = new Map<string, any>();
  for (const r of data) tmMap.set(String(r.module_id), r);

  // 2. Ensure processed_modules exist for each training module (create missing entries)
  // Fetch existing processed_modules by original_module_id
  const { data: processedRows, error: processedError } = await supabase
    .from('processed_modules')
    .select('processed_module_id, original_module_id')
    .in('original_module_id', moduleIds);
  if (processedError) console.warn('[gpt-mcq-quiz] lookup processed_modules warning:', processedError);

  const processedMap = new Map<string, string>();
  if (Array.isArray(processedRows)) {
    for (const p of processedRows) {
      if (p && p.original_module_id && p.processed_module_id) processedMap.set(String(p.original_module_id), String(p.processed_module_id));
    }
  }

  // Insert missing processed_modules in bulk
  const missingModuleIds = moduleIds.filter((m: any) => !processedMap.has(String(m)));
  if (missingModuleIds.length > 0) {
    const inserts = missingModuleIds.map((mId: any) => {
      const tm = tmMap.get(String(mId)) || {};
      return {
        original_module_id: String(mId),
        title: tm.title || null,
        content: tm.gpt_summary || null,
        learning_style: null
      };
    });
    const { data: insData, error: insErr } = await supabase
      .from('processed_modules')
      .insert(inserts)
      .select('processed_module_id, original_module_id');
    if (insErr) {
      console.error('[gpt-mcq-quiz] Failed to insert processed_modules:', insErr);
      return NextResponse.json({ error: 'Failed to ensure processed_modules entries' }, { status: 500 });
    }
    if (Array.isArray(insData)) {
      for (const p of insData) {
        if (p && p.original_module_id && p.processed_module_id) processedMap.set(String(p.original_module_id), String(p.processed_module_id));
      }
    }
  }

  // Build array of processed_module_ids corresponding to requested training moduleIds
  const processedIds = moduleIds.map((m: any) => processedMap.get(String(m))).filter(Boolean);

  // 3. Ensure no baseline already exists for any requested processed_module_id
  const { data: existingBaselinesByModule, error: existingBaselinesError } = await supabase
    .from('assessments')
    .select('assessment_id, processed_module_id, company_id')
    .eq('type', 'baseline')
    .in('processed_module_id', processedIds);
  if (existingBaselinesError) {
    console.warn('[gpt-mcq-quiz] lookup baseline by processed_module_id warning:', existingBaselinesError);
  }
  if (existingBaselinesByModule && Array.isArray(existingBaselinesByModule) && existingBaselinesByModule.length > 0) {
    const conflicted = existingBaselinesByModule.map((r: any) => ({ processed_module_id: r.module_id, assessment_id: r.assessment_id }));
    // Map processed_module_id back to training module_id for user clarity
    const conflictsMapped = conflicted.map((c: any) => ({
      processed_module_id: c.processed_module_id,
      assessment_id: c.assessment_id,
      module_id: Array.from(processedMap.entries()).find(([k, v]) => v === c.processed_module_id)?.[0] || null
    }));
    return NextResponse.json({ error: 'Baseline assessment already exists for one or more moduleIds', conflicts: conflictsMapped }, { status: 409 });
  }
  // 2. Prepare normalized snapshot
  const currentModules = data.flatMap((mod) => mod.ai_modules ? JSON.parse(mod.ai_modules) : []);
  const normalizedSnapshot = JSON.stringify(normalizeModules(currentModules));
  // 3. Check for existing assessment with snapshot
  const { data: existingAssessment, error: assessmentError } = await supabase
    .from('assessments')
    .select('assessment_id, questions, company_id, modules_snapshot')
    .eq('type', 'baseline')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (assessmentError && (assessmentError as any).code !== 'PGRST116') {
    console.warn('[gpt-mcq-quiz] existing baseline lookup warning:', assessmentError);
  }

  if (existingAssessment && existingAssessment.modules_snapshot) {
    if (existingAssessment.modules_snapshot === normalizedSnapshot) {
      // No change → return the existing quiz
      try {
        const quizData = typeof existingAssessment.questions === 'string'
          ? JSON.parse(existingAssessment.questions)
          : existingAssessment.questions;
        return NextResponse.json({ quiz: quizData, source: 'db', assessmentId: existingAssessment.assessment_id });
      } catch {
        // If parse fails, treat as missing and regenerate below
      }
    }
  }
  // 4. Generate new quiz and update or insert assessment
  const combinedSummary = data.map((mod) => mod.gpt_summary).filter(Boolean).join('\n');
  const combinedObjectives = data.flatMap((mod) => mod.ai_objectives ? JSON.parse(mod.ai_objectives) : []);
  const quiz = await generateMCQQuiz(
    combinedSummary,
    currentModules,
    combinedObjectives
  );
  if (!Array.isArray(quiz) || quiz.length === 0) {
    console.error('[gpt-mcq-quiz][ERROR] Quiz array is empty or invalid. Not storing.');
    return NextResponse.json({ error: 'Quiz generation failed or returned empty array.', rawResponse: quiz }, { status: 500 });
  }
  if (existingAssessment && existingAssessment.assessment_id) {
    // Update the existing assessment
    const { error: updateError } = await supabase
      .from('assessments')
      .update({
        questions: JSON.stringify(quiz),
        modules_snapshot: normalizedSnapshot
      })
      .eq('assessment_id', existingAssessment.assessment_id)
      .eq('company_id', companyId);
    if (updateError) {
      console.error('[gpt-mcq-quiz] Failed to update baseline assessment:', updateError);
      return NextResponse.json({ error: 'Failed to save baseline assessment (update).' }, { status: 500 });
    }
    return NextResponse.json({ quiz, source: 'generated', assessmentId: existingAssessment.assessment_id });
  } else {
    // Insert new assessment(s): create one baseline row per module_id so each
    // assessment record stores the module_id and enforces "one baseline per module"
    const rowsToInsert = moduleIds.map((mId: any) => ({
      type: 'baseline',
      questions: JSON.stringify(quiz),
      company_id: companyId,
      modules_snapshot: normalizedSnapshot,
      processed_module_id: processedMap.get(String(mId))
    }));

    const { data: insertData, error: insertError } = await supabase
      .from('assessments')
      .insert(rowsToInsert)
      .select('assessment_id, processed_module_id');

    if (insertError) {
      console.error('[gpt-mcq-quiz] Failed to insert baseline assessment(s):', insertError);
      return NextResponse.json({ error: 'Failed to save baseline assessment (insert).' }, { status: 500 });
    }

    console.log('[gpt-mcq-quiz] Inserted baseline assessment rows:', insertData);
    return NextResponse.json({ quiz, source: 'generated', inserted: insertData });
  }
  
}
