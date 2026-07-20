import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function POST(request: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      console.error('[assessment] GEMINI_API_KEY not configured');
      return NextResponse.json(
        { error: 'Gemini API key not configured' },
        { status: 500 }
      );
    }

    const { messages, scenarioTitle, scenarioRole, userRole } = await request.json();

    //console.log('[assessment] Received request:', {
    //   messagesCount: messages?.length,
    //   scenarioTitle,
    //   scenarioRole,
    //   userRole
    // });

    if (!messages || messages.length === 0) {
      console.error('[assessment] No messages provided');
      return NextResponse.json(
        { error: 'Conversation messages are required' },
        { status: 400 }
      );
    }

    // Check if conversation is too short or incomplete (ended abruptly)
    const userMessages = messages.filter((msg: any) => msg.sender === 'user');
    const aiMessages = messages.filter((msg: any) => msg.sender === 'avatar');
    
    //console.log('[assessment] Message breakdown:', {
    //   userMessages: userMessages.length,
    //   aiMessages: aiMessages.length,
    //   total: messages.length
    // });
    
    // If there are fewer than 3 exchanges or the conversation is very short, return zero score
    const minExchanges = 3;
    const minUserMessages = 2;
    
    if (userMessages.length < minUserMessages || messages.length < minExchanges * 2) {
      //console.log('⚠️ Conversation too short - returning zero score', {
      //   totalMessages: messages.length,
      //   userMessages: userMessages.length,
      //   aiMessages: aiMessages.length
      // });
      
      return NextResponse.json({
        overallScore: 0,
        summary: "The conversation was ended abruptly or was too short to provide a meaningful assessment. Please complete a full roleplay session with at least 3-4 exchanges to receive proper feedback.",
        parameters: [
          {
            name: "Communication Clarity",
            score: 0,
            feedback: "Insufficient conversation to evaluate communication skills."
          },
          
          {
            name: "Objection Handling",
            score: 0,
            feedback: "No sufficient interaction to evaluate objection handling."
          },
          {
            name: "Value Proposition",
            score: 0,
            feedback: "Conversation ended before value proposition could be assessed."
          },
          {
            name: "Active Listening",
            score: 0,
            feedback: "Insufficient dialogue to assess listening skills."
          },
          {
            name: "Confidence & Professionalism",
            score: 0,
            feedback: "Not enough interaction to evaluate confidence and professionalism."
          }
        ],
        recommendations: [
          "Complete a full roleplay session without ending it prematurely.",
          "Engage in at least 4-5 exchanges with the LT to demonstrate your skills.",
          "Practice maintaining the conversation until a natural conclusion is reached.",
          "Use the session duration effectively to showcase your abilities."
        ]
      });
    }

    // Build conversation transcript with clear role labels
    const learnerRole = userRole || 'Learner'; // This is the USER's role (Sales Manager)
    const aiRole = scenarioRole || 'AI Coach'; // This is the AI's role (ZSM/Customer)
    
    const transcript = messages
      .map((msg: any) => `${msg.sender === 'user' ? learnerRole : aiRole}: ${msg.text}`)
      .join('\n\n');

    // Create assessment prompt
    const assessmentPrompt = `You are an expert communication and sales coach analyzing a role-play conversation. 

Scenario: ${scenarioTitle}
Learner's Role: ${learnerRole} (the person being evaluated)
AI Coach's Role: ${aiRole} (the practice partner)

CRITICAL INSTRUCTION: You are evaluating the LEARNER (${learnerRole}), NOT the AI Coach. Analyze only the learner's performance in their messages.

Conversation Transcript:
${transcript}

Analyze the LEARNER's (${learnerRole}'s) performance in this role-play conversation and provide a detailed assessment. Since this is a video-based roleplay session, evaluate both verbal communication and non-verbal cues. Provide a comprehensive assessment in JSON format with the following structure:

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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
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
      console.error('[assessment] Invalid assessment structure:', assessment);
      throw new Error('Invalid assessment report structure');
    }

    //console.log('[assessment] Generated assessment:', {
    //   overallScore: assessment.overallScore,
    //   parametersCount: assessment.parameters.length
    // });

    return NextResponse.json(assessment);

  } catch (error: any) {
    console.error('[assessment] Error:', {
      message: error.message,
      status: error.status,
      name: error.name
    });
    return NextResponse.json(
      { error: error.message || 'Failed to generate assessment' },
      { status: 500 }
    );
  }
}
