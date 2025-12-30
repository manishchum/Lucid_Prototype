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

      // Ensure options array exists and correctIndex is valid
      const options = Array.isArray(question.options) ? question.options : [];
      const validCorrectIndex = typeof correctIndex === 'number' && correctIndex >= 0 && correctIndex < options.length;
      
      if (validCorrectIndex) {
        correctAnswerText = options[correctIndex].trim();
      } else {
        correctAnswerText = 'Invalid correct answer';
        console.warn(`⚠️ Question ${i + 1}: Invalid correctIndex`, correctIndex, 'for options', options);
      }

      // Handle string-based answers (what frontend actually sends)
      if (typeof userAnswer === 'string' && userAnswer.trim() !== '') {
        userAnswerText = userAnswer.trim();
        isCorrect = validCorrectIndex && userAnswerText === correctAnswerText;
      }
      // Handle index-based answers (fallback for compatibility)
      else if (typeof userAnswer === 'number' && userAnswer >= 0 && userAnswer < options.length) {
        userAnswerText = options[userAnswer].trim();
        isCorrect = validCorrectIndex && userAnswer === correctIndex;
      }
      // Handle case where no answer was provided
      else {
        userAnswerText = 'No answer provided';
        isCorrect = false;
      }

      // console.log('📝 Question', i + 1, ':', question.question);
      // console.log('📋 Options:', options);
      // console.log('✅ Correct answer:', correctAnswerText, `(index: ${correctIndex})`);
      // console.log('👤 User answer:', userAnswerText);
      // console.log('✓ Is correct:', isCorrect);
      // console.log('---');

      if (isCorrect) {
        score++;
      }

      correctAnswers.push({
        questionIndex: i,
        question: question.question,
        userAnswer: userAnswerText,
        correctAnswer: correctAnswerText,
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
        const feedbackPrompt = `You are an expert educational assessment analyst. Generate a structured quiz feedback report using EXACTLY this format:

## Quiz Feedback Report

**Assessment:** ${assessment.type || 'Module'} Quiz
**Score:** ${score}/${maxScore} (${scorePercentage}%)

User Performance Summary:
${correctAnswers.map((answer, index) => `
Question ${index + 1}: ${answer.question}
User Answer: ${answer.userAnswer}
Correct Answer: ${answer.correctAnswer}
Result: ${answer.isCorrect ? '✓ Correct' : '✗ Incorrect'}
Bloom's Level: ${answer.bloomLevel || 'N/A'}
${answer.explanation && !answer.isCorrect ? `Explanation: ${answer.explanation}` : ''}
`).join('\n')}

Please provide:
1. A brief congratulatory or encouraging opening
2. Overall performance summary
3. Strengths identified (areas where user performed well)
4. Areas for improvement (specific topics to focus on)
5. Actionable study recommendations
6. Encouraging closing remarks

Keep the feedback constructive, specific, and encouraging. Format it as a structured report with clear sections.

IMPORTANT: Use this EXACT format with these headings. Do not add extra sections or change the structure.`;

        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
        const result = await model.generateContent(feedbackPrompt);
        const response = await result.response;
        let rawFeedback = response.text();

        // Standardize the response format
        if (rawFeedback) {
          // Remove any markdown code blocks
          rawFeedback = rawFeedback.replace(/```[\s\S]*?```/g, '');
          // Ensure consistent header format
          rawFeedback = rawFeedback.replace(/^#+\s*/gm, '## ');
          // Clean up extra whitespace
          rawFeedback = rawFeedback.replace(/\n{3,}/g, '\n\n');
          aiFeedback = rawFeedback.trim();
        }
        console.log('🤖 AI feedback generated successfully');
      }
    } catch (feedbackError) {
      console.error('🤖 Error generating AI feedback:', feedbackError);
      // Provide fallback feedback
      aiFeedback = `## Quiz Feedback Report

**Assessment:** ${assessment.type || 'Module'} Quiz
**Score:** ${score}/${maxScore} (${scorePercentage}%)

### Overall Performance Summary
You scored ${scorePercentage}% on this assessment. ${scorePercentage >= 70 ? 'Well done!' : 'Keep studying to improve your understanding.'}

### Areas for Review
${correctAnswers.filter(a => !a.isCorrect).map(a => `* Question ${a.questionIndex + 1}: ${a.question}`).join('\n')}

### Next Steps
Review the questions you missed and study the related concepts to improve your understanding.`;
    }

    // Save the assessment result
    console.log('💾 Saving assessment result to database for user_id:', user_id, 'assessment_id:', assessment_id);
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
      })
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
