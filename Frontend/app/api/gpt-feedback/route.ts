import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Helper to call GPT for feedback
async function generateFeedback({ score, maxScore, answers, feedback, modules }: any): Promise<string> {
  const prompt = `You are an experienced HR learning coach. Your task is to generate a personalized feedback report for an employee based on their performance in the baseline assessment.\n\nInput:\nEmployee’s assessment results.\nTotal questions attempted and overall percentage score.\n\nOverview:\n- Start with a warm, encouraging introduction (e.g., “Great effort on your baseline assessment! This gives us a clear starting point for your learning journey.”).\n- Summarize total performance (overall percentage, number correct).\n- Highlight strengths at a glance: List topics for which answers were correct, and pick 3–5 content areas with strong performance.\n  Example: “Your strongest areas were: Excellent recall of Variables & Data Types (85% correct), Strong comprehension of Loops & Control Flow (75% correct)”\n\nUse the following example feedback styles as templates. For each Bloom’s category, highlight areas as strengths where answers are correct and highlight areas as developmental where answers are wrong.\n\nRemember (Recall facts/definitions)\nExample: “You did very well on remembering factual details (85% correct). For example, you quickly identified definitions and key terms. This shows strong memory recall. To stay sharp, try quick 5-minute flashcard practice weekly.”\n\nUnderstand (Comprehension/Interpretation)\nExample: “Your comprehension is strong (75%). For instance, you were able to summarize main ideas but sometimes missed nuances in interpretation. Practicing by explaining concepts in your own words or teaching a colleague can strengthen this skill.”\n\nApply (Practical usage of concepts)\nExample: “Application questions were moderately accurate (60%). For example, you could apply formulas to straightforward problems but found multi-step scenarios harder. Practicing with real-world exercises or simulations will help bridge this gap.”\n\nAnalyze (Breaking down/Examining relationships)\nExample: “Analysis is still developing (55%). You spotted simple differences between concepts but struggled with cause-effect reasoning. Case study breakdowns or comparing two processes side by side will help sharpen this skill.”\n\nEvaluate (Judgment/Decision-making)\nExample: “Evaluation questions were challenging (45%). For instance, when asked to justify the best option, you often selected plausible but less supported choices. To improve, try role-play scenarios where you must defend your reasoning with evidence.”\n\nCreate (Innovation/Designing new solutions)\nExample: “Creative thinking is an area for growth (35%). For example, when asked to propose new solutions, responses leaned toward safe, familiar answers. To improve, practice brainstorming alternative approaches or designing small projects that test new ideas.”\n\nShape:\n- Use a friendly, supportive, growth-oriented tone.\n- Replace “weak” with “developing area” or “next opportunity.”\n- Celebrate effort and progress: “This is a solid foundation…”\n\nAssessment Data:\nScore: ${score} / ${maxScore}\nModule Info: ${JSON.stringify(modules)}\nAnswers: ${JSON.stringify(answers)}\nFeedback per question: ${JSON.stringify(feedback)}\n`;

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
      max_tokens: 600,
    }),
  });
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function POST(request: NextRequest) {
  console.log('[API] Received request');
  let body;
  try {
    body = await request.json();
    console.log('[API] Request body:', JSON.stringify(body));
  } catch (err) {
    console.error('[API] Error parsing request body:', err);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Lightweight feedback for quiz page (no DB insert, just feedback)
  if (body.quiz && body.userAnswers && (!body.user_id || !body.assessment_id)) {
    try {
      console.log('[API] Lightweight feedback mode');
  const questions = (body.quiz as any[]).map((q: any, i: number) => ({
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        userAnswer: body.userAnswers[i],
      }));  
      const prompt = `You are an expert learning coach. For the following quiz, compare the user's answers to the correct answers. For each wrong answer, explain why it is wrong and give a brief tip for improvement. Be concise and supportive.\n\n${JSON.stringify(questions, null, 2)}`;
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
          max_tokens: 800,
        }),
      });
      const data = await response.json();
      let feedback = '';
      try {
        feedback = data.choices[0].message.content;
      } catch {
        feedback = 'No feedback available.';
      }
      console.log('[API] Lightweight feedback generated');
      return NextResponse.json({ feedback });
    } catch (err) {
      console.error('[API] Error in lightweight feedback:', err);
      return NextResponse.json({ error: 'Failed to generate feedback' }, { status: 500 });
    }
  }

  // Original assessment feedback logic
  let { score, maxScore, answers, feedback, modules, user_id, employee_name, assessment_id, quiz, userAnswers } = body;
  // Ensure answers is set to userAnswers if not provided
  if ((!answers || answers.length === 0) && Array.isArray(userAnswers) && userAnswers.length > 0) {
    answers = userAnswers;
  }
  console.log('[API] Assessment Submission');
  console.log('[API] Employee ID:', user_id);
  console.log('[API] Employee Name:', employee_name);
  console.log('[API] Employee Score:', score, '/', maxScore);
  console.log('[API] Employee Feedback (per question):', Array.isArray(feedback) ? feedback.join('\n') : feedback);
  console.log('[API] Assessment ID:', assessment_id);
  console.log('[API] Modules:', JSON.stringify(modules));

  // If module quiz did not provide score, compute with GPT using quiz + userAnswers
  if ((score === undefined || score === null) && Array.isArray(quiz) && Array.isArray(userAnswers)) {
    try {
      const rubricPrompt = `You are an assessment grader. Given the following quiz questions and the user's submitted answers, grade each question as correct or incorrect and return a JSON object with:
{
  "perQuestion": [true|false, ...],
  "score": number, 
  "maxScore": number,
  "explanations": [string, ...] // brief explanation per question (especially for incorrect)
}

Rules:
- All questions are multiple choice (MCQ) or True-False. Match the user's answer to the correct answer for each question. If the answer matches, mark true; otherwise, mark false.
- maxScore = number of questions.
- Only return JSON. No extra text.
Questions: ${JSON.stringify(quiz)}
UserAnswers: ${JSON.stringify(userAnswers)}`;
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [{ role: 'system', content: rubricPrompt }],
          temperature: 0.0,
          max_tokens: 800,
        }),
      });
      const grading = await resp.json();
      let graded: any = null;
      try {
        graded = JSON.parse(grading.choices?.[0]?.message?.content || '{}');
      } catch {}
      if (graded && typeof graded.score === 'number' && typeof graded.maxScore === 'number') {
        score = graded.score;
        maxScore = graded.maxScore;
        // Hydrate feedback if not provided
        if (!Array.isArray(feedback)) {
          feedback = Array.isArray(graded.explanations) ? graded.explanations : [];
        }
        // Normalize answers to store
        if ((!answers || answers.length === 0) && Array.isArray(userAnswers) && userAnswers.length > 0) {
          answers = userAnswers;
        }
      }
    } catch (e) {
      // Fallback: basic scoring disabled; leave score undefined
    }
  }
  // Log resolved score after potential GPT grading
  console.log('[API] Resolved Score (post-grading):', score, '/', maxScore);
  console.log('[API] Answers:', JSON.stringify(answers));

  // 1. Generate feedback
  let aiFeedback = '';
  try {
    aiFeedback = await generateFeedback({ score, maxScore, answers, feedback, modules });
    console.log('[API] AI feedback generated');
  } catch (err) {
    console.error('[API] Error generating AI feedback:', err);
    aiFeedback = 'Error generating feedback.';
  }

  // Prepare data for insertion
  const assessmentRecord = {
    user_id,
    assessment_id,
    answers: answers, // jsonb
    score,
    max_score: maxScore,
    feedback: aiFeedback, // summary feedback
    question_feedback: feedback, // question-wise feedback as array
  };
  console.log('[API] AssessmentRecord Prepared:', JSON.stringify(assessmentRecord, null, 2));

  // 2. Store in employee_assessments if user_id and assessment_id are provided
  let insertResult = null;
  if (user_id && assessment_id) {
    try {
      // Determine assessment type (baseline or module)
      let assessmentType = null;
      console.log('[API] Fetching assessment type from assessments table...');
      const { data: assessmentMeta, error: assessmentMetaError } = await supabase
        .from('assessments')
        .select('type')
        .eq('assessment_id', assessment_id)
        .maybeSingle();
      if (assessmentMetaError) {
        console.error('[API] Error fetching assessment type:', assessmentMetaError);
      }
      assessmentType = assessmentMeta?.type || null;
      console.log('[API] Assessment type:', assessmentType);
      if (assessmentType === 'baseline') {
        // Always insert new row for baseline (allow multiple attempts)
        console.log('[API] Inserting baseline employee_assessment...');
        insertResult = await supabase.from('employee_assessments').insert(assessmentRecord);
        console.log('[API] Inserted baseline employee_assessment:', JSON.stringify(insertResult, null, 2));
      } else {
        // For module, upsert (one record per module per employee)
        console.log('[API] Checking for existing module employee_assessment...');
        const { data: existingAssessment, error: checkError } = await supabase
          .from('employee_assessments')
          .select('employee_assessment_id')
          .eq('assessment_id', assessment_id)
          .eq('user_id', user_id)
          .maybeSingle();
        if (checkError) {
          console.error('[API] Error checking existing module assessment:', checkError);
        }
        console.log('[API] Existing module employee_assessment:', existingAssessment);
        if (!existingAssessment) {
          console.log('[API] Inserting module employee_assessment...');
          insertResult = await supabase.from('employee_assessments').insert(assessmentRecord);
          console.log('[API] Inserted module employee_assessment:', JSON.stringify(insertResult, null, 2));
        } else {
          // Overwrite existing row
          console.log('[API] Updating module employee_assessment...');
          insertResult = await supabase.from('employee_assessments').update(assessmentRecord)
            .eq('assessment_id', assessment_id)
            .eq('user_id', user_id);
          console.log('[API] Updated module employee_assessment:', JSON.stringify(insertResult, null, 2));
        }
      }
    } catch (err) {
      console.error('[API] Supabase Insert/Update Error:', err);
    }
  } else {
    console.log('[API] Missing user_id or assessment_id, skipping DB insert.');
  }

  return NextResponse.json({ feedback: aiFeedback, score, maxScore, question_feedback: feedback, insertResult });
}
