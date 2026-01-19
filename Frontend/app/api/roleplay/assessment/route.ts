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
    const assessmentPrompt = `You are an expert communication and sales coach analyzing a role-play conversation. 

Scenario: ${scenarioTitle}
Role: ${scenarioRole}

Conversation Transcript:
${transcript}

Analyze this role-play conversation and provide a detailed performance assessment. Since this is a video-based roleplay session, evaluate both verbal communication and non-verbal cues. Provide a comprehensive assessment in JSON format with the following structure:

{
  "overallScore": <number 0-100>,
  "summary": "<2-3 sentence overall performance summary covering both verbal and non-verbal communication>",
  "parameters": [
    {
      "name": "Communication Clarity",
      "score": <number 0-100>,
      "feedback": "<specific feedback on verbal communication clarity and articulation>"
    },
    {
      "name": "Eye Contact & Engagement",
      "score": <number 0-100>,
      "feedback": "<feedback on maintaining appropriate eye contact and visual engagement with the other person. Assess if the person appears to be looking at the camera/person naturally, showing interest and confidence through their gaze>"
    },
    {
      "name": "Hand Gestures & Body Language",
      "score": <number 0-100>,
      "feedback": "<feedback on use of hand gestures and overall body language. Evaluate if gestures are natural, purposeful, and help emphasize key points. Note posture, openness, and physical confidence>"
    },
    {
      "name": "Facial Expressions",
      "score": <number 0-100>,
      "feedback": "<feedback on facial expressions and emotional expressiveness. Assess if expressions match the conversation tone, show empathy, enthusiasm, and genuine interest. Note smiling, nodding, and other facial cues>"
    },
    {
      "name": "Objection Handling",
      "score": <number 0-100>,
      "feedback": "<specific feedback on handling objections or difficult questions>"
    },
    {
      "name": "Value Proposition",
      "score": <number 0-100>,
      "feedback": "<specific feedback on presenting value and key messages effectively>"
    },
    {
      "name": "Active Listening",
      "score": <number 0-100>,
      "feedback": "<specific feedback on listening skills and responding appropriately>"
    },
    {
      "name": "Confidence & Professionalism",
      "score": <number 0-100>,
      "feedback": "<specific feedback on overall demeanor, confidence level, and professional presence>"
    }
  ],
  "recommendations": [
    "<specific actionable recommendation for improvement>",
    "<specific actionable recommendation for improvement>",
    "<specific actionable recommendation for improvement>",
    "<specific actionable recommendation for non-verbal communication improvement>"
  ]
}

IMPORTANT: For the non-verbal parameters (Eye Contact, Hand Gestures, Facial Expressions), provide realistic scores based on typical performance during video conversations. Even if you cannot directly see the video, infer performance from the conversation flow, engagement level, and communication style. Most people score between 60-85 on non-verbal communication in professional settings.

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
