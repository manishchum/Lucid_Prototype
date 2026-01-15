import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function POST(request: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'Gemini API key not configured' },
        { status: 500 }
      );
    }

    const { messages, scenarioTitle, scenarioRole } = await request.json();

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: 'Conversation messages are required' },
        { status: 400 }
      );
    }

    // Build conversation transcript
    const transcript = messages
      .map((msg: any) => `${msg.sender === 'user' ? 'User' : scenarioRole}: ${msg.text}`)
      .join('\n\n');

    // Create assessment prompt
    const assessmentPrompt = `You are an expert sales coach analyzing a role-play conversation. 

Scenario: ${scenarioTitle}
Role: ${scenarioRole}

Conversation Transcript:
${transcript}

Analyze this sales role-play conversation and provide a detailed performance assessment in JSON format with the following structure:

{
  "overallScore": <number 0-100>,
  "summary": "<2-3 sentence overall performance summary>",
  "parameters": [
    {
      "name": "Communication Clarity",
      "score": <number 0-100>,
      "feedback": "<specific feedback on communication>"
    },
    {
      "name": "Objection Handling",
      "score": <number 0-100>,
      "feedback": "<specific feedback on handling objections>"
    },
    {
      "name": "Value Proposition",
      "score": <number 0-100>,
      "feedback": "<specific feedback on presenting value>"
    },
    {
      "name": "Active Listening",
      "score": <number 0-100>,
      "feedback": "<specific feedback on listening skills>"
    },
    {
      "name": "Confidence & Professionalism",
      "score": <number 0-100>,
      "feedback": "<specific feedback on demeanor>"
    }
  ],
  "recommendations": [
    "<specific actionable recommendation>",
    "<specific actionable recommendation>",
    "<specific actionable recommendation>"
  ]
}

Provide ONLY the JSON object, no additional text.`;

    // Call Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: assessmentPrompt }]
            }
          ],
          generationConfig: {
            temperature: 0.4,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Gemini API error:', errorData);
      throw new Error(errorData.error?.message || 'Gemini API request failed');
    }

    const data = await response.json();
    
    // Extract the response text
    let assessmentText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!assessmentText) {
      throw new Error('No response from Gemini API');
    }

    // Clean up the response (remove markdown code blocks if present)
    assessmentText = assessmentText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    // Parse the JSON response
    let assessment;
    try {
      assessment = JSON.parse(assessmentText);
    } catch (parseError) {
      console.error('Failed to parse assessment JSON:', assessmentText);
      throw new Error('Failed to parse assessment report');
    }

    // Validate the assessment structure
    if (!assessment.overallScore || !assessment.summary || !assessment.parameters || !assessment.recommendations) {
      throw new Error('Invalid assessment report structure');
    }

    return NextResponse.json(assessment);

  } catch (error: any) {
    console.error('Assessment generation error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate assessment' },
      { status: 500 }
    );
  }
}
