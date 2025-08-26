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
  if (body.moduleId) {
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
      .select('id, title, content')
      .eq('id', moduleId)
      .maybeSingle();
    if (moduleError || !moduleData) return NextResponse.json({ error: 'Module not found' }, { status: 404 });

    // Check if quiz already exists for this module and learning style
    const { data: assessment, error: fetchError } = await supabase
      .from('assessments')
      .select('id, questions')
      .eq('type', 'module')
      .eq('module_id', moduleId)
      .eq('learning_style', learningStyle)
      .maybeSingle();
    if (assessment) {
      // Always return existing quiz, regardless of questions content
      try {
        const quiz = Array.isArray(assessment.questions) ? assessment.questions : JSON.parse(assessment.questions);
        return NextResponse.json({ quiz });
      } catch (e) {
        // If parse fails, return raw questions
        return NextResponse.json({ quiz: assessment.questions });
      }
    }
    // Compose prompt for the user's learning style
  const prompt = `You are an expert instructional designer. Given the following training content summary, modules, and objectives, generate a 10-12 question quiz tailored for the ${learningStyle} learning style. Use a mix of question types (MCQ, open-ended, scenario, matching, etc.) that best fit this style.\n\nEach question object must follow this format:\n{\n  "question": string,\n  "type": string,\n  "options": array or object (if applicable),\n  "correctAnswer": string, array, or object (if applicable),\n  "explanation": string (optional)\n}\n\nReturn ONLY a valid JSON array of question objects, with no extra text, markdown, code blocks, or formatting. Do not include any explanations, headers, or comments outside the JSON array.\n\nSummary: ${moduleData.title}\nModules: ${JSON.stringify([moduleData.title])}\nObjectives: ${JSON.stringify([moduleData.content])}`;
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
        temperature: 0.3,
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
    // Save quiz for this learning style
    const { data: insertResult, error: insertError } = await supabase
      .from('assessments')
      .insert({
        type: 'module',
        module_id: moduleId,
        questions: JSON.stringify(quiz),
        learning_style: learningStyle
      });
    console.log('[gpt-mcq-quiz][DEBUG] Insert result:', insertResult, 'Insert error:', insertError);
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
