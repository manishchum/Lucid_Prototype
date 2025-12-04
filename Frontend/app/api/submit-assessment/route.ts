import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('🧪 Assessment submission received:', body);

    const { user_id, assessment_id, answers, type } = body;

    if (!user_id || !assessment_id || !answers) {
      return NextResponse.json(
        { error: 'Missing required fields: user_id, assessment_id, and answers are required' },
        { status: 400 }
      );
    }

    // Fetch the assessment questions
    const { data: assessment, error: assessmentError } = await supabase
      .from('assessments')
      .select('questions, type, processed_module_id')
      .eq('assessment_id', assessment_id)
      .single();

    if (assessmentError || !assessment) {
      console.error('❌ Error fetching assessment:', assessmentError);
      return NextResponse.json({ error: 'Assessment not found' }, { status: 404 });
    }

    let questions;
    try {
      questions = typeof assessment.questions === 'string' 
        ? JSON.parse(assessment.questions) 
        : assessment.questions;
    } catch (parseError) {
      console.error('❌ Error parsing assessment questions:', parseError);
      return NextResponse.json({ error: 'Invalid assessment questions format' }, { status: 500 });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      console.error('❌ No valid questions found in assessment');
      return NextResponse.json({ error: 'No questions found in assessment' }, { status: 500 });
    }

    // Calculate score and generate feedback
    let score = 0;
    let maxScore = questions.length;
    const questionFeedback = [];
    const correctAnswers = [];
    const userAnswers = Array.isArray(answers) ? answers : [];

    console.log('🧪 Processing', questions.length, 'questions with', userAnswers.length, 'user answers');

    // Score each question
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      const userAnswer = userAnswers[i];
      const correctIndex = question.correctIndex;
      
      let isCorrect = false;
      let userAnswerText = '';
      let correctAnswerText = '';

      // Handle string-based answers (what frontend actually sends)
      if (typeof userAnswer === 'string') {
        userAnswerText = userAnswer.trim();
        correctAnswerText = question.options?.[correctIndex]?.trim() || '';
        isCorrect = userAnswerText === correctAnswerText;
        
        console.log('🔍 Question', i + 1, '- String comparison:');
        console.log('👤 User answer (string):', userAnswerText);
        console.log('✅ Correct answer (string):', correctAnswerText);
        console.log('🎯 Match:', isCorrect);
      }
      // Handle index-based answers (fallback for compatibility)
      else if (typeof userAnswer === 'number') {
        const userAnswerNum = userAnswer;
        const correctIndexNum = typeof correctIndex === 'number' ? correctIndex : -1;
        isCorrect = userAnswerNum === correctIndexNum && userAnswerNum !== -1;
        
        userAnswerText = question.options?.[userAnswerNum] || 'Invalid option';
        correctAnswerText = question.options?.[correctIndexNum] || 'Invalid option';
        
        console.log('🔍 Question', i + 1, '- Index comparison:');
        console.log('👤 User answer (index):', userAnswerNum, '→', userAnswerText);
        console.log('✅ Correct answer (index):', correctIndexNum, '→', correctAnswerText);
        console.log('🎯 Match:', isCorrect);
      }
      // Handle case where no answer was provided
      else {
        userAnswerText = 'No answer provided';
        correctAnswerText = question.options?.[correctIndex] || 'Invalid correct option';
        isCorrect = false;
        
        console.log('🔍 Question', i + 1, '- No answer provided');
        console.log('✅ Correct answer would be:', correctAnswerText);
      }

      console.log('📝 Question text:', question.question);
      console.log('📋 Available options:', question.options);
      console.log('---');

      if (isCorrect) {
        score++;
      }

      correctAnswers.push({
        questionIndex: i,
        question: question.question,
        userAnswer: userAnswerText, // Store the text for display
        correctAnswer: correctAnswerText, // Store the correct text for display
        userAnswerRaw: userAnswer, // Store original answer for debugging
        correctIndex: correctIndex, // Store original correct index for debugging
        isCorrect: isCorrect,
        explanation: question.explanation || null,
        bloomLevel: question.bloomLevel || null
      });

      // Generate question-level feedback
      if (isCorrect) {
        questionFeedback.push("Correct! Well done.");
      } else {
        const feedback = question.explanation || 
          `Incorrect. The correct answer is: "${correctAnswerText}". You answered: "${userAnswerText}".`;
        questionFeedback.push(feedback);
      }
    }

    const scorePercentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

    console.log('🧪 Quiz scored:', { 
      score, 
      maxScore, 
      percentage: scorePercentage,
      type: assessment.type 
    });

    // Generate AI feedback using Gemini
    let aiFeedback = null;
    try {
      if (process.env.GEMINI_API_KEY) {
        const feedbackPrompt = `
Generate personalized feedback for a quiz/assessment submission.

Assessment Type: ${assessment.type || 'quiz'}
Score: ${score}/${maxScore} (${scorePercentage}%)

User Performance:
${correctAnswers.map((answer, index) => `
Question ${index + 1}: ${answer.question}
User Answer: ${answer.userAnswer !== undefined ? (questions[index]?.options?.[answer.userAnswer] || 'No answer') : 'No answer'}
Correct Answer: ${questions[index]?.options?.[answer.correctAnswer] || 'N/A'}
Result: ${answer.isCorrect ? 'Correct' : 'Incorrect'}
Bloom's Level: ${answer.bloomLevel || 'N/A'}
${answer.explanation ? `Explanation: ${answer.explanation}` : ''}
`).join('\n')}

Please provide:
1. A brief congratulatory or encouraging opening
2. Overall performance summary
3. Strengths identified (areas where user performed well)
4. Areas for improvement (specific topics to focus on)
5. Actionable study recommendations
6. Encouraging closing remarks

Keep the feedback constructive, specific, and encouraging. Format it as a structured report with clear sections.
`;

        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        const result = await model.generateContent(feedbackPrompt);
        const response = await result.response;
        aiFeedback = response.text();

        console.log('🤖 AI feedback generated successfully');
      }
    } catch (feedbackError) {
      console.error('🤖 Error generating AI feedback:', feedbackError);
      // Continue without AI feedback - don't fail the whole process
    }

    // Save the assessment result
    const { data: savedResult, error: saveError } = await supabase
      .from('employee_assessments')
      .upsert({
        user_id: user_id,
        assessment_id: assessment_id,
        score: score,
        max_score: maxScore,
        answers: JSON.stringify(userAnswers),
        feedback: aiFeedback,
        question_feedback: JSON.stringify(questionFeedback),
        completed_at: new Date().toISOString()
      }
    )
      .select()
      .single();

    if (saveError) {
      console.error('❌ Error saving assessment result:', saveError);
      return NextResponse.json({ error: 'Failed to save assessment result' }, { status: 500 });
    }

    console.log('✅ Assessment result saved successfully');

    // If this is a module assessment, update module progress
    if (assessment.type === 'module' && assessment.processed_module_id) {
      try {
        console.log('📚 Updating module progress for processed_module_id:', assessment.processed_module_id);
        
        const moduleCompletionResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/complete-module`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: user_id,
            processed_module_id: assessment.processed_module_id,
            quiz_score: score,
            max_score: maxScore,
            quiz_feedback: aiFeedback
          })
        });

        if (!moduleCompletionResponse.ok) {
          const errorText = await moduleCompletionResponse.text();
          console.error('📚 Module completion failed:', errorText);
        } else {
          const completionResult = await moduleCompletionResponse.json();
          console.log('📚 Module completion updated:', completionResult.message);
        }
      } catch (moduleError) {
        console.error('📚 Error updating module completion:', moduleError);
        // Don't fail the assessment if module update fails
      }
    }

    // Return the complete result
    return NextResponse.json({
      success: true,
      score: score,
      maxScore: maxScore,
      percentage: scorePercentage,
      feedback: aiFeedback,
      questionFeedback: questionFeedback,
      correctAnswers: correctAnswers,
      assessment_id: assessment_id,
      type: assessment.type,
      employee_assessment_id: savedResult.employee_assessment_id,
      message: `Assessment completed! You scored ${score}/${maxScore} (${scorePercentage}%)`
    });

  } catch (error) {
    console.error('❌ Error in assessment submission:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process assessment submission',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}