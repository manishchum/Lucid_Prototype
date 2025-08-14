import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
  const prompt = `You are an expert instructional designer. Given the following training content summary, modules, and objectives, generate a 10-12 question multiple-choice quiz. Each question should have 4 options, only one correct answer, and cover a range of topics. Return as JSON array with: {question, options, correctIndex, explanation (optional)}.

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
      model: 'gpt-4',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });
  const data = await response.json();
  let quiz;
  try {
    quiz = JSON.parse(data.choices[0].message.content);
  } catch {
    quiz = [];
  }
  return quiz;
}


export async function POST(request: NextRequest) {
  const body = await request.json();
  console.log("[gpt-mcq-quiz] POST body:", body);
  // Per-module quiz generation
  if (body.moduleId) {
    const moduleId = body.moduleId;
    console.log("[gpt-mcq-quiz] Per-module quiz requested for moduleId:", moduleId);
    // 1. Try to fetch existing quiz for this module
    const { data: assessment, error: fetchError } = await supabase
      .from('assessments')
      .select('id, questions')
      .eq('type', 'module')
      .eq('module_id', moduleId)
      .maybeSingle();
    console.log("[gpt-mcq-quiz] Assessment fetch result:", assessment, fetchError);
    if (assessment && assessment.questions) {
      try {
        console.log("[gpt-mcq-quiz] Returning existing quiz for moduleId:", moduleId);
        return NextResponse.json({ quiz: JSON.parse(assessment.questions) });
      } catch (e) {
        console.log("[gpt-mcq-quiz] Failed to parse existing quiz:", e);
        // If parse fails, treat as missing and regenerate below
      }
    }
    // 2. If not found, generate and insert quiz
    const { data: moduleData, error: moduleError } = await supabase
      .from('processed_modules')
      .select('id, title, content')
      .eq('id', moduleId)
      .maybeSingle();
    console.log("[gpt-mcq-quiz] Processed module fetch result:", moduleData, moduleError);
    if (moduleError || !moduleData) return NextResponse.json({ error: 'Module not found' }, { status: 404 });
    // 3. Feed content to GPT for quiz generation
    const summary = moduleData.title || '';
    const modules = [moduleData.title];
    const objectives = [moduleData.content];
    const quiz = await generateMCQQuiz(summary, modules, objectives);
    // 4. Double-check again before insert (race condition protection)
    const { data: existingQuiz } = await supabase
      .from('assessments')
      .select('id')
      .eq('type', 'module')
      .eq('module_id', moduleId)
      .maybeSingle();
    if (!existingQuiz) {
      const insertResult = await supabase
        .from('assessments')
        .insert({ type: 'module', module_id: moduleId, questions: JSON.stringify(quiz) });
      console.log("[gpt-mcq-quiz] Inserted quiz for moduleId:", moduleId, insertResult);
    } else {
      console.log("[gpt-mcq-quiz] Quiz already exists for moduleId, not inserting again.");
    }
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
  const currentModules = data.flatMap((mod) => mod.ai_modules ? JSON.parse(mod.ai_modules) : []);
  const normalizedSnapshot = JSON.stringify(normalizeModules(currentModules));
  // 3. Check for existing assessment with snapshot
  const { data: existingAssessment, error: assessmentError } = await supabase
    .from('assessments')
    .select('id, questions, company_id, modules_snapshot')
    .eq('type', 'baseline')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existingAssessment && existingAssessment.modules_snapshot) {
    if (existingAssessment.modules_snapshot === normalizedSnapshot) {
      // No change → return the existing quiz
      try {
        const quizData = typeof existingAssessment.questions === 'string'
          ? JSON.parse(existingAssessment.questions)
          : existingAssessment.questions;
        return NextResponse.json({ quiz: quizData, source: 'db' });
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
  if (existingAssessment && existingAssessment.id) {
    // Update the existing assessment
    await supabase
      .from('assessments')
      .update({
        questions: JSON.stringify(quiz),
        modules_snapshot: normalizedSnapshot,
        training_id: trainingId
      })
      .eq('id', existingAssessment.id)
      .eq('company_id', companyId);
  } else {
    // Insert new assessment
    await supabase
      .from('assessments')
      .insert([
        {
          type: 'baseline',
          questions: JSON.stringify(quiz),
          company_id: companyId,
          training_id: trainingId,
          modules_snapshot: normalizedSnapshot
        }
      ]);
  }
  return NextResponse.json({ quiz, source: 'generated' });
}
