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

    const { message, conversationHistory, scenarioTitle, scenarioRole, initialPrompt, tone } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Define tone instructions
    const toneInstructions = {
      Friendly: 'Be warm, encouraging, and supportive in your responses. Show enthusiasm and positivity.',
      Neutral: 'Maintain a professional and balanced demeanor. Be business-like but not cold.',
      Aggressive: 'Be challenging, skeptical, and push back on ideas. Express doubts and raise tough objections.'
    };

    const toneInstruction = tone ? toneInstructions[tone as keyof typeof toneInstructions] : toneInstructions.Neutral;

    // Build the system prompt to keep AI in character
    const systemPrompt = `You are an expert role-play simulation engine.
You are roleplaying as a ${scenarioRole} in a "${scenarioTitle}" scenario.

CRITICAL RULES - YOU MUST FOLLOW THESE:
1. STAY IN CHARACTER as the ${scenarioRole} at all times
2. NEVER break character or acknowledge you are an AI
3. NEVER provide coaching, tips, or advice to the user
4. Respond naturally as the character would in this situation
5. Ask realistic questions, raise objections, express concerns
6. Keep responses conversational and concise (2-4 sentences)
7. Show realistic emotions and reactions based on what the user says
8. If the user's pitch is unclear, express confusion or ask for clarification
9. If the user handles objections well, gradually become more interested
10. Challenge the user with realistic business concerns

CHARACTER TONE: ${toneInstruction}

Your character background: ${initialPrompt}

Respond ONLY as the ${scenarioRole}. Do not provide meta-commentary or suggestions.`;

    // Build conversation context
    const messages = [
      {
        role: 'user',
        parts: [{ text: systemPrompt }]
      }
    ];

    // Add conversation history (which now includes the current message from the frontend)
    if (conversationHistory && conversationHistory.length > 0) {
      console.log('📜 Processing conversation history:', conversationHistory.length, 'messages');
      conversationHistory.forEach((msg: any) => {
        messages.push({
          role: msg.sender === 'user' ? 'user' : 'model',
          parts: [{ text: msg.text }]
        });
      });
    }

    console.log('📤 Sending to Gemini:', messages.length, 'messages total');

    // Call Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: messages,
          generationConfig: {
            temperature: 0.9,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 200,
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
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiResponse) {
      throw new Error('No response from Gemini API');
    }

    return NextResponse.json({ 
      response: aiResponse,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('Role-play conversation error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process conversation' },
      { status: 500 }
    );
  }
}
