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
    // Fetch module info  
    const { data: moduleData, error: moduleError } = await supabase
      .from('processed_modules')
      .select('processed_module_id, title, content')
      .eq('module_id', moduleId)
      .maybeSingle();
    if (moduleError || !moduleData) return NextResponse.json({ error: 'Module not found' }, { status: 404 });

    // Check if quiz already exists for this module and learning style (robust to duplicates)
    const { data: assessmentsList } = await supabase
      .from('assessments')
      .select('assessment_id, questions')
      .eq('type', 'module')
      .eq('module_id', moduleId)
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
  const prompt = `You are an expert instructional designer. Your task is to generate multiple-choice questions (MCQs) from the provided learning content using Bloom’s Taxonomy.\n\nInput: A learning asset (text, notes, or structured content).\n\nOutput: A set of 10-13 MCQs (Multiple Choice Questions) distributed across difficulty levels based on Bloom’s Taxonomy.\n\nEasy → Remember & Understand (default: 20%)\nAverage → Apply & Analyze (default: 50%)\nDifficult → Evaluate & Create (default: 30%)\n\nBloom’s Level Mapping:\nRemember: Define, List, Identify, Recall, Name, Label, Recognize, State, Match, Repeat, Select\nUnderstand: Explain, Summarize, Describe, Interpret, Restate, Paraphrase, Classify, Discuss, Illustrate, Compare (basic), Report\nApply: Solve, Demonstrate, Use, Implement, Apply, Execute, Practice, Show, Operate, Employ, Perform\nAnalyze: Differentiate, Compare, Contrast, Organize, Examine, Break down, Categorize, Investigate, Distinguish, Attribute, Diagram\nEvaluate: Judge, Critique, Justify, Recommend, Assess, Evaluate, Defend, Support, Argue, Prioritize, Appraise, Rate, Validate\nCreate: Design, Generate, Propose, Develop, Formulate, Construct, Invent, Plan, Compose, Produce, Hypothesize, Integrate, Originate\n\nExhaustive Question-Type Bank (Stems/Patterns):\nRemember: “What is…?”, “Which of the following defines…?”, “Identify…”, “Who discovered…?”, “When/Where did…?”, “Match the term with…”\nUnderstand: “Which best explains…?”, “Summarize…”, “What does this mean…?”, “Which example illustrates…?”, “Why does…happen?”\nApply: “Which principle would you use if…?”, “What is the correct method to…?”, “How would you solve…?”, “Which tool/technique applies to…?”, “Which step comes next…?”\nAnalyze: “Which factor contributes most to…?”, “What pattern best explains…?”, “Which cause-effect relationship is correct…?”, “What evidence supports…?”, “Which statement best differentiates between…?”\nEvaluate: “Which option provides the best justification…?”, “Which solution is most effective and why?”, “Which argument is strongest?”, “Which evidence best supports…?”, “What decision is most appropriate…?”\nCreate: “What new approach could be developed…?”, “Which design achieves…?”, “How would you improve…?”, “Which combination of ideas solves…?”, “What hypothesis could you form…?”\n\nQuestion Design Rules:\n- Each question must explicitly map to its Bloom’s level.\n- Provide 4 answer choices (A–D).\n- Clearly mark the correct answer.\n- Avoid ambiguity; test one concept per question. Ensure every concept is tested.\n\nReturn ONLY a valid JSON array of 10-13 question objects, with no extra text, markdown, code blocks, or formatting. Each object must include:\n{\n  "question": string,\n  "bloomLevel": string,\n  "options": [string, string, string, string],\n  "correctIndex": number,\n  "explanation": string (optional)\n}\n\nLearning Content:\nSummary: ${moduleData.title}\nModules: ${JSON.stringify([moduleData.title])}\nObjectives: ${JSON.stringify([moduleData.content])}`;
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
    const stableIdSeed = `module:${moduleId}|style:${learningStyle}`;
    const hash = crypto.createHash('sha1').update(stableIdSeed).digest('hex');
    const stableId = `${hash.substring(0,8)}-${hash.substring(8,12)}-${hash.substring(12,16)}-${hash.substring(16,20)}-${hash.substring(20,32)}`;
    const { data: insertResult, error: insertError } = await supabase
      .from('assessments')
      .insert({
        id: stableId,
        type: 'module',
        module_id: moduleId,
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
          .eq('module_id', moduleId)
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
  // 1. Get all selected modules' content for this company only
  const { data, error } = await supabase
    .from('training_modules')
    .select('id, gpt_summary, ai_modules, ai_objectives, company_id')
    .in('id', moduleIds)
    .eq('company_id', companyId);
  if (error || !data || data.length === 0) return NextResponse.json({ error: 'Modules not found' }, { status: 404 });
  // 2. Prepare normalized snapshot
  const currentModules = data.flatMap((mod: any) => mod.ai_modules ? JSON.parse(mod.ai_modules) : []);
  const normalizedSnapshot = JSON.stringify(normalizeModules(currentModules));
  // 3. Check for existing assessment with snapshot
  const { data: existingAssessment, error: assessmentError } = await supabase
    .from('assessments')
    .select('id, questions, company_id, modules_snapshot')
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
        return NextResponse.json({ quiz: quizData, source: 'db', assessmentId: existingAssessment.id });
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
  if (existingAssessment && existingAssessment.id) {
    // Update the existing assessment
    const { error: updateError } = await supabase
      .from('assessments')
      .update({
        questions: JSON.stringify(quiz),
        modules_snapshot: normalizedSnapshot
      })
      .eq('assessment_id', existingAssessment.id)
      .eq('company_id', companyId);
    if (updateError) {
      console.error('[gpt-mcq-quiz] Failed to update baseline assessment:', updateError);
      return NextResponse.json({ error: 'Failed to save baseline assessment (update).' }, { status: 500 });
    }
    return NextResponse.json({ quiz, source: 'generated', assessmentId: existingAssessment.id });
  } else {
    // Insert new assessment
    const { data: insertData, error: insertError } = await supabase
      .from('assessments')
      .insert([
        {
          type: 'baseline',
          questions: JSON.stringify(quiz),
          company_id: companyId,
          modules_snapshot: normalizedSnapshot
        }
      ])
      .select('id')
      .maybeSingle();
    if (insertError) {
      console.error('[gpt-mcq-quiz] Failed to insert baseline assessment:', insertError);
      return NextResponse.json({ error: 'Failed to save baseline assessment (insert).' }, { status: 500 });
    }
    console.log('[gpt-mcq-quiz] Inserted baseline assessment id:', insertData?.id);
    return NextResponse.json({ quiz, source: 'generated', assessmentId: insertData?.id });
  }
  
}
