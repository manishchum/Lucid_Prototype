import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

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

// function areModulesEqual(modulesA: any[], modulesB: any[]) {
//   return JSON.stringify(normalizeModules(modulesA)) === JSON.stringify(normalizeModules(modulesB));
// }

// Helper to call Gemini for MCQ quiz generation
async function generateMCQQuiz(summary: string, modules: any[], objectives: any[]): Promise<any[]> {
  const prompt = `You are an expert instructional designer. Your task is to generate multiple-choice questions (MCQs) from the provided learning content using Bloom's Taxonomy.

Input: A learning asset (text, notes, or structured content).

Output: A set of 30 MCQs (Multiple Choice Questions) distributed across difficulty levels based on Bloom's Taxonomy.

Easy → Remember & Understand (default: 20%)
Average → Apply & Analyze (default: 50%)
Difficult → Evaluate & Create (default: 30%)

Bloom's Level Mapping:
Remember: Define, List, Identify, Recall, Name, Label, Recognize, State, Match, Repeat, Select
Understand: Explain, Summarize, Describe, Interpret, Restate, Paraphrase, Classify, Discuss, Illustrate, Compare (basic), Report
Apply: Solve, Demonstrate, Use, Implement, Apply, Execute, Practice, Show, Operate, Employ, Perform
Analyze: Differentiate, Compare, Contrast, Organize, Examine, Break down, Categorize, Investigate, Distinguish, Attribute, Diagram
Evaluate: Judge, Critique, Justify, Recommend, Assess, Evaluate, Defend, Support, Argue, Prioritize, Appraise, Rate, Validate
Create: Design, Generate, Propose, Develop, Formulate, Construct, Invent, Plan, Compose, Produce, Hypothesize, Integrate, Originate

Exhaustive Question-Type Bank (Stems/Patterns):
Remember: "What is…?", "Which of the following defines…?", "Identify…", "Who discovered…?", "When/Where did…?", "Match the term with…"
Understand: "Which best explains…?", "Summarize…", "What does this mean…?", "Which example illustrates…?", "Why does…happen?"
Apply: "Which principle would you use if…?", "What is the correct method to…?", "How would you solve…?", "Which tool/technique applies to…?", "Which step comes next…?"
Analyze: "Which factor contributes most to…?", "What pattern best explains…?", "Which cause-effect relationship is correct…?", "What evidence supports…?", "Which statement best differentiates between…?"
Evaluate: "Which option provides the best justification…?", "Which solution is most effective and why?", "Which argument is strongest?", "Which evidence best supports…?", "What decision is most appropriate…?"
Create: "What new approach could be developed…?", "Which design achieves…?", "How would you improve…?", "Which combination of ideas solves…?", "What hypothesis could you form…?"

Question Design Rules:
- Each question must explicitly map to its Bloom's level.
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
  // console.log("[gpt-mcq-quiz] Calling Gemini with prompt:", prompt.slice(0, 500));

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const content = response.text();
    
    // console.log('[gpt-mcq-quiz][DEBUG] Raw Gemini response:', JSON.stringify(content, null, 2));
    
    let quiz;
    try {
      // Clean the response to remove markdown code blocks and extract JSON
      let cleanedContent = content.trim();
      
      // Find JSON array bounds in the response
      const jsonStart = cleanedContent.indexOf('[');
      const jsonEnd = cleanedContent.lastIndexOf(']');
      
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleanedContent = cleanedContent.substring(jsonStart, jsonEnd + 1);
      } else {
        // Fallback: remove markdown code fences if present
        if (cleanedContent.startsWith('```json')) {
          cleanedContent = cleanedContent.replace(/^```json/, '').replace(/```$/, '').trim();
        } else if (cleanedContent.startsWith('```')) {
          cleanedContent = cleanedContent.replace(/^```/, '').replace(/```$/, '').trim();
        }
      }
      
      console.log('[gpt-mcq-quiz][DEBUG] Cleaned content for parsing:', cleanedContent.slice(0, 200) + '...');
      
      quiz = JSON.parse(cleanedContent);
      
      if (!Array.isArray(quiz) || quiz.length === 0) {
        console.warn('[gpt-mcq-quiz][WARN] Parsed quiz is empty or not an array:', quiz);
        quiz = [];
      }
    } catch (err) {
      console.error('[gpt-mcq-quiz][ERROR] Failed to parse Gemini response:', err);
      console.error('[gpt-mcq-quiz][ERROR] Content that failed to parse:', content);
      quiz = [];
    }
    return quiz;
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    throw error;
  }
}


export async function POST(request: NextRequest) {
  const body = await request.json();
  console.log("[gpt-mcq-quiz] POST body:", body);
  
  // Derive learning style from provided user_id when available
  const reqUserId = body.userId || body.userId || null;
  let userLearningStyle: string | null = null;
  if (reqUserId) {
    try {
      const { data: lsRow, error: lsErr } = await supabase
        .from('employee_learning_style')
        .select('learning_style')
        .eq('user_id', reqUserId)
        .maybeSingle();
      if (lsErr) console.warn('[gpt-mcq-quiz] learning style lookup warning:', lsErr);
      userLearningStyle = lsRow?.learning_style ?? null;
      console.log('[gpt-mcq-quiz] Resolved user learning style for user:', reqUserId, userLearningStyle);
    } catch (e) {
      console.warn('[gpt-mcq-quiz] Error fetching learning style:', e);
    }
  }
  
  // Determine if this is a baseline or module assessment request
  // Check for explicit baseline flag or if this is part of baseline assessment flow
  const isBaselineRequest = body.isBaseline === true || body.assessmentType === 'baseline';
  
  // Per-module quiz branch: run when a single moduleId is provided for module assessments only
  // For baseline assessments, skip this branch even with single moduleId
  const explicitModuleId = body.moduleIds || body.moduleId || null;
  const singleFromArray = Array.isArray(body.moduleIds) && body.moduleIds.length === 1 ? String(body.moduleIds[0]) : null;
  const moduleId = explicitModuleId ? String(explicitModuleId) : singleFromArray;
  console.log("Module Idis ",moduleId)
  console.log(isBaselineRequest)
  if (moduleId && !isBaselineRequest) {
    console.log("Inside the if statement");
    // If a moduleId was provided explicitly or via single-element moduleIds
    // array, treat as a per-module quiz request.
    if (!moduleId || moduleId === 'undefined' || moduleId === 'null') {
      return NextResponse.json({ error: 'Invalid moduleId' }, { status: 400 });
    }
    // Prefer explicit learningStyle in body, otherwise use the user's stored learning style
    const learningStyle = body.learningStyle || userLearningStyle || null;
    if (!learningStyle) {
      return NextResponse.json({ error: 'Missing learningStyle; provide user_id or learningStyle in request.' }, { status: 400 });
    }
    console.log(`[gpt-mcq-quiz] Per-module quiz requested for moduleId: ${moduleId}, learningStyle: ${learningStyle}`);
    // Use processed_modules as the canonical source of content for per-module quizzes.
    // Try to find a processed_module by processed_module_id first (new-style), then by original_module_id (legacy).
    let processedModuleId: string | null = null;
    let existingProcessed: any = null;

    try {
      const { data: pmById, error: pmIdErr } = await supabase
        .from('processed_modules')
        .select('processed_module_id, title, content, original_module_id, learning_style')
        .eq('processed_module_id', moduleId)
      if (pmIdErr) console.warn('[gpt-mcq-quiz] lookup processed_modules by processed_module_id warning:', pmIdErr);
      if (pmById && pmById.processed_module_id) {
        existingProcessed = pmById;
        processedModuleId = pmById.processed_module_id;
        console.log("Inside the processed module id looking ")
      }
      console.log('[gpt-mcq-quiz] processed_module lookup by id result:', pmById);
    } catch (e) {
      console.warn('[gpt-mcq-quiz] Error querying processed_modules by id:', e);
    }

    if (!processedModuleId) {
      console.log("Inside the processed module id looking ")
      try {
        console.log(reqUserId)
        const { data: pmByOriginal, error: pmOrigErr } = await supabase
          .from('processed_modules')
          .select('processed_module_id, title, content, original_module_id, learning_style')
          .eq('original_module_id', moduleId)
          .eq('user_id',reqUserId)
        console.log(moduleId) 
        console.log(pmByOriginal)
        console.log("______________")
        if (pmOrigErr) console.warn('[gpt-mcq-quiz] lookup processed_modules by original_module_id warning:', pmOrigErr);
        if (pmByOriginal && pmByOriginal[0].processed_module_id) {
          console.log("Inside this")
          existingProcessed = pmByOriginal[0];
          processedModuleId = pmByOriginal[0].processed_module_id;
        }
        console.log("Data of the processed module by original id ",pmByOriginal)
      } catch (e) {
        console.warn('[gpt-mcq-quiz] Error querying processed_modules by original_module_id:', e);
      }
    }

    console.log("Processed module id is : ",processedModuleId)
    console.log(existingProcessed)
    
    // If no processed_module found, try to fetch the raw training_module and create a processed entry
    if (!processedModuleId) {
      console.log("[gpt-mcq-quiz] No processed module found, attempting fallback to raw training_module");
      try {
        const { data: trainingModule, error: tmError } = await supabase
          .from('training_modules')
          .select('module_id, title, gpt_summary')
          .eq('module_id', moduleId)
          .single();
        
        if (tmError || !trainingModule) {
          console.error('[gpt-mcq-quiz] Training module not found:', tmError);
          return NextResponse.json({ error: 'Module not found in training_modules or processed_modules.' }, { status: 404 });
        }
        
        
        // Create processed_module entry from raw training_module
        console.log('[gpt-mcq-quiz] Creating processed_module entry from raw training_module');
        const { data: newProcessed, error: insertErr } = await supabase
          .from('processed_modules')
          .insert({
            original_module_id: String(moduleId),
            title: trainingModule.title,
            content: trainingModule.gpt_summary || trainingModule.content,
            learning_style: learningStyle,
            user_id: reqUserId || null
          })
          .select('processed_module_id')
          .single();
        
        if (insertErr) {
          // If insert fails due to duplicate, try to fetch it again
          if ((insertErr as any).code === '23505') {
            console.log('[gpt-mcq-quiz] Duplicate processed_module, re-querying');
            const { data: requery } = await supabase
              .from('processed_modules')
              .select('processed_module_id, title, content')
              .eq('original_module_id', moduleId)
              .eq('learning_style', learningStyle)
              .maybeSingle();
            if (requery?.processed_module_id) {
              processedModuleId = requery.processed_module_id;
              existingProcessed = requery;
            }
          } else {
            console.error('[gpt-mcq-quiz] Failed to create processed_module:', insertErr);
            return NextResponse.json({ error: 'Failed to create processed module.' }, { status: 500 });
          }
        } else if (newProcessed?.processed_module_id) {
          processedModuleId = newProcessed.processed_module_id;
          existingProcessed = {
            title: trainingModule.title,
            content: trainingModule.gpt_summary || trainingModule.content
          };
          console.log('[gpt-mcq-quiz] Successfully created processed_module:', processedModuleId);
        }
      } catch (e) {
        console.error('[gpt-mcq-quiz] Error in fallback logic:', e);
        return NextResponse.json({ error: 'Failed to fetch or create module.' }, { status: 500 });
      }
    }

    if (!processedModuleId) {
      return NextResponse.json({ error: 'Processed module not found. Ensure a processed_modules entry exists for this module.' }, { status: 404 });
    }

    // Prepare module title/content for prompt from processed_modules
    const moduleTitle = existingProcessed?.title || '';
    const moduleContent = existingProcessed?.content || '';

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
    console.log("Error here")
    if (existing) {
      // Always return existing quiz, regardless of questions content
      try {
        const quiz = Array.isArray(existing.questions) ? existing.questions : JSON.parse(existing.questions);
        return NextResponse.json({ quiz, assessmentId: existing.assessment_id });
      } catch (e) {
        // If parse fails, return raw questions
        return NextResponse.json({ quiz: existing.questions, assessmentId: existing.assessment_id });
      }
    }

    console.log("Till now all good")
  // Compose prompt for per-module MCQ quiz (no mixed question types)
  const prompt = `You are an expert instructional designer. Your task is to generate multiple-choice questions (MCQs) from the provided learning content using Bloom's Taxonomy.

Input: A learning asset (text, notes, or structured content).

Output: A set of 10-13 MCQs (Multiple Choice Questions) distributed across difficulty levels based on Bloom's Taxonomy.

Easy → Remember & Understand (default: 20%)
Average → Apply & Analyze (default: 50%)
Difficult → Evaluate & Create (default: 30%)

Bloom's Level Mapping:
Remember: Define, List, Identify, Recall, Name, Label, Recognize, State, Match, Repeat, Select
Understand: Explain, Summarize, Describe, Interpret, Restate, Paraphrase, Classify, Discuss, Illustrate, Compare (basic), Report
Apply: Solve, Demonstrate, Use, Implement, Apply, Execute, Practice, Show, Operate, Employ, Perform
Analyze: Differentiate, Compare, Contrast, Organize, Examine, Break down, Categorize, Investigate, Distinguish, Attribute, Diagram
Evaluate: Judge, Critique, Justify, Recommend, Assess, Evaluate, Defend, Support, Argue, Prioritize, Appraise, Rate, Validate
Create: Design, Generate, Propose, Develop, Formulate, Construct, Invent, Plan, Compose, Produce, Hypothesize, Integrate, Originate

Exhaustive Question-Type Bank (Stems/Patterns):
Remember: "What is…?", "Which of the following defines…?", "Identify…", "Who discovered…?", "When/Where did…?", "Match the term with…"
Understand: "Which best explains…?", "Summarize…", "What does this mean…?", "Which example illustrates…?", "Why does…happen?"
Apply: "Which principle would you use if…?", "What is the correct method to…?", "How would you solve…?", "Which tool/technique applies to…?", "Which step comes next…?"
Analyze: "Which factor contributes most to…?", "What pattern best explains…?", "Which cause-effect relationship is correct…?", "What evidence supports…?", "Which statement best differentiates between…?"
Evaluate: "Which option provides the best justification…?", "Which solution is most effective and why?", "Which argument is strongest?", "Which evidence best supports…?", "What decision is most appropriate…?"
Create: "What new approach could be developed…?", "Which design achieves…?", "How would you improve…?", "Which combination of ideas solves…?", "What hypothesis could you form…?"

Question Design Rules:
- Each question must explicitly map to its Bloom's level.
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
    console.log(`[gpt-mcq-quiz] Calling Gemini for moduleId: ${moduleId} with learning style: ${learningStyle}`);
    
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const content = response.text();
      
      // console.log('[gpt-mcq-quiz][DEBUG] Raw Gemini response:', JSON.stringify(content, null, 2));
      
      let quiz = [];
      try {
        // Clean the response to remove markdown code blocks and extract JSON
        let cleanedContent = content.trim();
        
        // Find JSON array bounds in the response
        const jsonStart = cleanedContent.indexOf('[');
        const jsonEnd = cleanedContent.lastIndexOf(']');
        
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          cleanedContent = cleanedContent.substring(jsonStart, jsonEnd + 1);
        } else {
          // Fallback: remove markdown code fences if present
          if (cleanedContent.startsWith('```json')) {
            cleanedContent = cleanedContent.replace(/^```json/, '').replace(/```$/, '').trim();
          } else if (cleanedContent.startsWith('```')) {
            cleanedContent = cleanedContent.replace(/^```/, '').replace(/```$/, '').trim();
          }
        }
        
        console.log('[gpt-mcq-quiz][DEBUG] Cleaned content for parsing:', cleanedContent.slice(0, 200) + '...');
        
        quiz = JSON.parse(cleanedContent);
      } catch (e) {
        console.log('[gpt-mcq-quiz][DEBUG] Failed to parse Gemini response:', e, content);
        quiz = [];
      }
      
      console.log('[gpt-mcq-quiz][DEBUG] Generated quiz:', quiz);
      
      // Save quiz for this learning style, using a deterministic UUID to avoid race-condition duplicates
      const stableIdSeed = `module:${processedModuleId}|style:${learningStyle}`;
      const hash = crypto.createHash('sha1').update(stableIdSeed).digest('hex');
      const stableId = `${hash.substring(0,8)}-${hash.substring(8,12)}-${hash.substring(12,16)}-${hash.substring(16,20)}-${hash.substring(20,32)}`;
      const { data: insertResult, error: insertError } = await supabase
        .from('assessments')
        .insert({
          assessment_id: stableId,
          type: 'module',
          processed_module_id: processedModuleId,
          questions: JSON.stringify(quiz),
          learning_style: learningStyle
        });
        console.log("Inserting data inside the assessment table")
        console.log(insertResult)
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
    } catch (error) {
      console.error('Error generating quiz with Gemini:', error);
      return NextResponse.json({ error: 'Failed to generate quiz' }, { status: 500 });
    }
  }

  // Baseline (multi-module) quiz generation with modules_snapshot logic
  console.log('[gpt-mcq-quiz] Processing baseline assessment request');
  const { moduleIds, companyId,assessmentType,isBaseline,user_id } = body;
  console.log(moduleIds)
  console.log(companyId)
  if (!moduleIds  || moduleIds.length === 0) {
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
    console.log(data)
    console.log("------------------------")
    console.log(error)
  if (error || !data || data.length === 0) return NextResponse.json({ error: 'Modules not found' }, { status: 404 });
  // Map training module_id -> row for easy lookup
  const tmMap = new Map<string, any>();
  for (const r of data) tmMap.set(String(r.module_id), r);

  // 2. Ensure processed_modules exist for each training module (create missing entries)
  // Fetch existing processed_modules by original_module_id
  const { data: processedRows, error: processedError } = await supabase
    .from('processed_modules')
    .select('processed_module_id, original_module_id')
    .in('original_module_id', moduleIds)
    .eq("user_id",user_id || null);

  if (processedError) console.warn('[gpt-mcq-quiz] lookup processed_modules warning:', processedError);

  console.log("These is processed rows")
  console.log(processedRows);
  const processedMap = new Map<string, string>();
  if (Array.isArray(processedRows)) {
    for (const p of processedRows) {
      if (p && p.original_module_id && p.processed_module_id) processedMap.set(String(p.original_module_id), String(p.processed_module_id));
    }
  }

  // Insert missing processed_modules in bulk
  const missingModuleIds = moduleIds.filter((mId: any) => !processedMap.has(String(mId)));
  if (missingModuleIds.length > 0) {
    const inserts = missingModuleIds.map((mId: any) => {
      const tm = tmMap.get(String(mId)) || {};
      console.log('[gpt-mcq-quiz] Training module missing processed_module:', mId, tm);
      console.log('[gpt-mcq-quiz] Inserting missing processed_module for module_id:', mId);
      return {
        original_module_id: String(mId),
        title: tm.title || null,
        content: tm.gpt_summary || null,
        learning_style: userLearningStyle || null,
        user_id:user_id || null
      };
    });
    console.log(inserts);
    console.log("Adding values to the inserts")
    // Try upsert first (idempotent intent). If the DB lacks a unique constraint
    // on `original_module_id` Postgres returns 42P10. In that case, fall back to
    // a safer insert+requery flow so we don't return 500 to the caller.
    let insData: any = null;
    let insErr: any = null;
    const upsertRes = await supabase
      .from('processed_modules')
      .upsert(inserts, { onConflict: 'original_module_id' })
      .select('processed_module_id, original_module_id');
    insData = upsertRes.data; insErr = upsertRes.error;

    if (insErr) {
      // If the error indicates no matching unique constraint for ON CONFLICT,
      // fall back to a plain insert and then re-query existing rows.
      if (insErr.code === '42P10') {
        console.warn('[gpt-mcq-quiz] upsert failed (no unique constraint). Falling back to insert + re-query.', insErr.message);
        const insertRes = await supabase
          .from('processed_modules')
          .insert(inserts)
          .select('processed_module_id, original_module_id');
        if (!insertRes.error && Array.isArray(insertRes.data)) {
          insData = insertRes.data;
        } else {
          // If insert also failed (likely due to concurrent inserts), re-query the
          // processed_modules rows for our missingModuleIds to obtain ids.
          console.warn('[gpt-mcq-quiz] insert fallback failed; re-querying processed_modules for missing module ids.', insertRes.error);
          const { data: requeryRows, error: requeryErr } = await supabase
            .from('processed_modules')
            .select('processed_module_id, original_module_id')
            .in('original_module_id', missingModuleIds);
          if (!requeryErr) insData = requeryRows;
          else {
            console.error('[gpt-mcq-quiz] Re-query after failed insert also failed:', requeryErr);
            return NextResponse.json({ error: 'Failed to ensure processed_modules entries' }, { status: 500 });
          }
        }
      } else {
        console.error('[gpt-mcq-quiz] Failed to upsert processed_modules:', insErr);
        return NextResponse.json({ error: 'Failed to ensure processed_modules entries' }, { status: 500 });
      }
    }

    if (Array.isArray(insData)) {
      for (const p of insData) {
        if (p && p.original_module_id && p.processed_module_id) processedMap.set(String(p.original_module_id), String(p.processed_module_id));
      }
    }
  }

  // Build array of processed_module_ids corresponding to requested training moduleIds
  const processedIds = moduleIds.map((mId: any) => processedMap.get(String(mId))).filter(Boolean);

  // 3. Ensure no baseline already exists for any requested processed_module_id
  // Use `employee_assessments` so checks respect the per-user mapping. Fetch the
  // related `assessments` fields and filter client-side for type = 'baseline'
  // and processed_module_id in our requested list.
  const { data: existingEmployeeAssessments, error: existingBaselinesError } = await supabase
    .from('employee_assessments')
    .select('assessment_id, assessments(assessment_id, processed_module_id, company_id, type)');
  if (existingBaselinesError) {
    console.warn('[gpt-mcq-quiz] lookup employee_assessments warning:', existingBaselinesError);
  }

  const matched = Array.isArray(existingEmployeeAssessments)
    ? existingEmployeeAssessments.filter((r: any) => r.assessments && r.assessments.type === 'baseline' && processedIds.includes(String(r.assessments.processed_module_id)))
    : [];
  if (matched.length > 0) {
    // We found existing baseline templates. Map those template assessments to the
    // requesting user (or bulk-assign to ASSIGNED users) and return the stored
    // questions so the client can render immediately.
    const templateMap = new Map<string, string | null>(); // assessment_id -> processed_module_id
    for (const r of matched) {
      const rel = Array.isArray(r?.assessments) ? r.assessments[0] : r?.assessments;
      const aid = rel?.assessment_id;
      const pmid = rel?.processed_module_id;
      if (aid) templateMap.set(String(aid), pmid ? String(pmid) : null);
    }

    const templateIds = Array.from(templateMap.keys());
    console.log(templateIds)
    // Fetch full assessment rows to get questions and original_module_id if present
    const { data: assessmentsRows, error: assessmentsErr } = await supabase
      .from('assessments')
      .select('assessment_id, questions, processed_module_id')
      .in('assessment_id', templateIds);
    if (assessmentsErr) console.warn('[gpt-mcq-quiz] fetch assessments for existing templates warning:', assessmentsErr);

    // Prepare mapping to return to client, keyed by training module_id when possible
    const resultMap: any[] = [];
    for (const a of assessmentsRows || []) {
      let questions = a?.questions ?? null;
      try {
        if (typeof questions === 'string') questions = JSON.parse(questions);
      } catch (e) {
        // keep raw
      }
      const procId = a?.processed_module_id ?? templateMap.get(a.assessment_id) ?? null;
      const moduleId = Array.from(processedMap.entries()).find(([k, v]) => v === String(procId))?.[0] || a?.original_module_id || null;
      resultMap.push({ module_id: moduleId, processed_module_id: procId, assessment_id: a.assessment_id, questions });
    }

    // If a requesting user is present, upsert a per-user employee_assessments row
    if (reqUserId) {
      const rowsToUpsert = (assessmentsRows || []).map((a: any) => ({
        user_id: reqUserId,
        assessment_id: a.assessment_id,
        score: null,
        max_score: null,
        answers: null,
        feedback: null,
        question_feedback: null
      }));
      if (rowsToUpsert.length > 0) {
        const { error: upsertErr } = await supabase
          .from('employee_assessments')
          .upsert(rowsToUpsert, { onConflict: 'user_id,assessment_id' });
        if (upsertErr) console.warn('[gpt-mcq-quiz] upsert employee_assessments warning:', upsertErr);
      }
      // If there's only one mapped template, include a top-level `quiz` for
      // backward compatibility with clients expecting `{ quiz: [...] }`.
      if (resultMap.length === 1) {
        return NextResponse.json({ quizMapping: resultMap, quiz: resultMap[0].questions, source: 'db', assignedTo: reqUserId });
      }
      return NextResponse.json({ quizMapping: resultMap, source: 'db', assignedTo: reqUserId });
    }

    // No requesting user -> bulk assign to users with ASSIGNED plans for this company
    try {
      const { data: plans } = await supabase
        .from('learning_plan')
        .select('user_id')
        .eq('company_id', companyId)
        .eq('status', 'ASSIGNED');
      const users = Array.isArray(plans) ? plans.map((p: any) => p.user_id) : [];
      const bulkRows: any[] = [];
      for (const u of users) {
        for (const a of assessmentsRows || []) {
          bulkRows.push({ user_id: u, assessment_id: a.assessment_id, score: null, max_score: null, answers: null, feedback: null, question_feedback: null });
        }
      }
      if (bulkRows.length > 0) {
        const { error: bulkErr } = await supabase
          .from('employee_assessments')
          .upsert(bulkRows, { onConflict: 'user_id,assessment_id' });
        if (bulkErr) console.warn('[gpt-mcq-quiz] bulk upsert employee_assessments warning:', bulkErr);
      }
    } catch (e) {
      console.warn('[gpt-mcq-quiz] bulk-assign warning:', e);
    }

    if (resultMap.length === 1) {
      return NextResponse.json({ quizMapping: resultMap, quiz: resultMap[0].questions, source: 'db', assignedTo: 'bulk' });
    }
    return NextResponse.json({ quizMapping: resultMap, source: 'db', assignedTo: 'bulk' });
  }
  // 2. Prepare normalized snapshot
  const currentModules = data.flatMap((mod: any) => mod.ai_modules ? JSON.parse(mod.ai_modules) : []);
  const normalizedSnapshot = JSON.stringify(normalizeModules(currentModules));
  // 3. Check for existing assessment with snapshot
  const { data: existingAssessment, error: assessmentError } = await supabase
  .from('assessments')
  .select(`
    assessment_id,
    questions,
    company_id,
    modules_snapshot,
    processed_modules!inner (
      user_id
    )
  `)
  .eq('type', 'baseline')
  .eq('company_id', companyId)
  .eq('processed_modules.user_id', user_id)
  .eq('processed_modules.original_module_id', moduleIds)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
  if (assessmentError && (assessmentError as any).code !== 'PGRST116') {
    console.warn('[gpt-mcq-quiz] existing baseline lookup warning:', assessmentError);
  }

  console.log("It is stil returning existing assessment ")
  console.log(existingAssessment)
  console.log("Error in fetching existing assessment ",assessmentError)
  if (existingAssessment && existingAssessment.modules_snapshot) {
    if (existingAssessment.modules_snapshot === normalizedSnapshot) {
      // No change → return the existing quiz
      try {
        const quizData = typeof existingAssessment.questions === 'string'
          ? JSON.parse(existingAssessment.questions)
          : existingAssessment.questions;

        console.log('[gpt-mcq-quiz] Returning existing baseline assessment from DB.');
        return NextResponse.json({ quiz: quizData, source: 'db', assessmentId: existingAssessment.assessment_id });
      } catch {
        // If parse fails, treat as missing and regenerate below
      }
    }
  }
  // 4. Generate new quiz and update or insert assessment
  const combinedSummary = data.map((mod: any) => mod.gpt_summary).filter(Boolean).join('\n');
  const combinedObjectives = data.flatMap((mod: any) => mod.ai_objectives ? JSON.parse(mod.ai_objectives) : []);     
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

    
    console.log("Inside the if statement of existingAssessment")
    console.log(existingAssessment)
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
    console.log("Inside the else statement of existingAssessment")
    console.log(moduleIds)
    // Insert new assessment(s): create one baseline row per module_id so each
    // assessment record stores the module_id and enforces "one baseline per module"
    const rowsToInsert = moduleIds.map((mId: any) => ({
      type: 'baseline',
      questions: JSON.stringify(quiz),
      company_id: companyId,
      modules_snapshot: normalizedSnapshot,
      processed_module_id: processedMap.get(String(mId)),
      learning_style: userLearningStyle || null
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
