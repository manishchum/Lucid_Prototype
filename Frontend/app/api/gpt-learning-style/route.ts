import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(request: NextRequest) {
  try {
    const { answers, user_id } = await request.json();

    if (!answers || !user_id) {
      return NextResponse.json({ error: 'Missing answers or user_id' }, { status: 400 });
    }

    // Create a text representation of the answers for Gemini analysis
    const answersText = answers.map((answer: any, index: number) => {
      if (typeof answer === 'object' && answer.question && answer.answer) {
        return `Question ${index + 1}: ${answer.question}\nAnswer: ${answer.answer}\n`;
      }
      return `Question ${index + 1}: ${JSON.stringify(answer)}\n`;
    }).join('\n');

    const prompt = `You are an expert educational psychologist specializing in learning style analysis. Based on the following responses to learning preference questions, determine the person's primary learning style.

Please analyze the responses and classify the learning style into one of these categories:
- Visual: Prefers charts, graphs, diagrams, maps, visual aids
- Auditory: Prefers listening, discussions, verbal explanations, music
- Kinesthetic: Prefers hands-on activities, movement, physical engagement
- Reading/Writing: Prefers text, lists, written materials, note-taking

Provide your analysis in the following JSON format only (no additional text or explanation):
{
  "learning_style": "Visual|Auditory|Kinesthetic|Reading/Writing",
  "confidence": 0.85,
  "analysis": "Brief explanation of why this learning style was chosen based on the responses",
  "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"]
}

Responses to analyze:
${answersText}`;

    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const content = response.text();

      console.log('[learning-style] Raw Gemini response:', content);

      let analysisResult;
      try {
        // Clean the response to extract JSON
        const cleanedContent = content.replace(/```json\n?|\n?```/g, '').trim();
        analysisResult = JSON.parse(cleanedContent);
      } catch (parseError) {
        console.log("--------------------------------")
        console.log("Error inside the gpt-learning-style")
        console.error('[learning-style] Failed to parse Gemini response:', parseError);
        // Fallback analysis
        analysisResult = {
          learning_style: "Visual",
          confidence: 0.7,
          analysis: "Unable to parse detailed analysis from AI response",
          recommendations: ["Use visual aids when learning", "Create mind maps and diagrams", "Organize information visually"]
        };
      }

      // Store the learning style analysis in the database
      const { error: upsertError } = await supabase
        .from('employee_learning_style')
        .upsert({
          user_id: user_id,
          learning_style: analysisResult.learning_style,
          gemini_analysis: JSON.stringify(analysisResult),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (upsertError) {
        console.error('[learning-style] Database upsert error:', upsertError);
        return NextResponse.json({ error: 'Failed to save learning style analysis' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        learning_style: analysisResult.learning_style,
        analysis: analysisResult,
        message: 'Learning style analysis completed successfully'
      });

    } catch (geminiError) {
      console.error('[learning-style] Gemini API error:', geminiError);
      return NextResponse.json({ error: 'Failed to analyze learning style with AI' }, { status: 500 });
    }

  } catch (error) {
    console.error('[learning-style] General error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
