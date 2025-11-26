import { NextRequest, NextResponse } from 'next/server';

// This is a placeholder for GPT-4.1 API integration
// In production, you would call OpenAI's API with a prompt to generate questions and evaluate answers

export async function POST(request: NextRequest) {
  const { modules, answers, user_id } = await request.json();

  if (!modules) {
    return NextResponse.json({ error: 'Modules are required' }, { status: 400 });
  }
  if (!user_id) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  }

  // Fetch company_id from users table
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: employee, error: employeeError } = await supabase
    .from('users')
    .select('company_id')
    .eq('user_id', user_id)
    .maybeSingle();
  if (employeeError || !employee?.company_id) {
    return NextResponse.json({ error: 'Could not find company for employee' }, { status: 400 });
  }
  const company_id = employee.company_id;

  // 1. Generate questions for each module (simulate with static questions for now) => baseline assessment in gpt-mcq-quiz
  const questions = modules.flatMap((mod: any, idx: number) => {
    return Array.from({ length: 2 }, (_, i) => ({
      id: `${mod.title}-${i+1}`,
      question: `Sample question ${i+1} for module: ${mod.title}`,
      module: mod.title,
    }));
  });

  // 2. Check if a baseline assessment already exists for this company
  const { data: existingAssessment, error: assessmentError } = await supabase
    .from('assessments')
    .select('assessment_id')
    .eq('type', 'baseline')
    .eq('company_id', company_id)
    .maybeSingle();

  let assessmentId = null;
  if (!existingAssessment) {
    // Insert new baseline assessment for this company
    const { data: newAssessment, error: newAssessmentError } = await supabase
      .from('assessments')
      .insert({ type: 'baseline', questions: JSON.stringify(questions), company_id })
      .select('assessment_id')
      .single();
    assessmentId = newAssessment?.assessment_id || null;
  } else {
    assessmentId = existingAssessment.assessment_id;
  }

  // 3. If answers are provided, evaluate (simulate scoring)
  if (answers) {
    // Simulate evaluation: score 1 if answer length > 10 chars, else 0
    let score = 0;
    let weakTopics: string[] = [];
    questions.forEach((q: any) => {
      const ans = answers[q.id] || '';
      if (ans.length > 10) score++;
      else weakTopics.push(q.module);
    });
    return NextResponse.json({ score, maxScore: questions.length, weakTopics, company_id, assessmentId });
  }

  // 4. Return questions for assessment
  return NextResponse.json({ questions, company_id, assessmentId });
}
