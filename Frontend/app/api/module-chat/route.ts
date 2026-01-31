import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from "@google/genai";
import { supabase } from '@/lib/supabase';
import { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// WebSocket server for real-time voice chat
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, request: IncomingMessage) => {
  console.log('New WebSocket connection for voice chat');

  // Handle incoming audio chunks
  ws.on('message', async (data: Buffer) => {
    try {
      // 1. Send audio chunk to streaming STT
      const transcript = await processSTT(data);

      // 2. Send transcript to LLM
      const llmResponse = await callLLM(transcript);

      // 3. Stream LLM response to TTS
      await streamTTS(ws, llmResponse);

    } catch (error) {
      console.error('Error processing audio:', error);
      ws.send(JSON.stringify({ error: 'Processing failed' }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
});

// Process STT (replace with actual streaming STT service like Google Speech-to-Text)
async function processSTT(audioChunk: Buffer): Promise<string> {
  // In real implementation:
  // - Use Google Cloud Speech-to-Text streaming API
  // - Handle audio longer than 1 minute with streaming
  // - Return partial transcripts for low latency
  console.log('Processing audio chunk of size:', audioChunk.length);
  return 'Hello, how can I help you with this training module?'; // Mock transcript
}

// Call LLM (using Gemini)
async function callLLM(transcript: string): Promise<string> {
  const prompt = `
You are a real-time voice assistant helping a user during a training session.

User said:
"${transcript}"

Respond naturally, concisely, and in plain text.
Do NOT use markdown, HTML, or special formatting.
`;

  const result = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
  });

  return result.text;
}

// Stream TTS (replace with actual streaming TTS service like ElevenLabs or Google TTS)
async function streamTTS(ws: any, text: string) {
  // Send the full text response first
  ws.send(JSON.stringify({ type: 'text', data: text }));
  
  // In real implementation:
  // - Use streaming TTS API that returns audio chunks
  // - Send chunks immediately to frontend for low latency
  const chunks = text.split(' '); // Simulate token-by-token streaming
  for (const chunk of chunks) {
    ws.send(JSON.stringify({ type: 'tts', data: chunk })); // Send audio data
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate streaming delay
  }
}

// Handle WebSocket upgrade
export async function GET(req: NextRequest) {
  if (req.headers.get('upgrade') === 'websocket') {
    // Upgrade HTTP request to WebSocket
    const res = new Response();
    (res as any).socket = (req as any).socket;
    wss.handleUpgrade(req as any, (req as any).socket, Buffer.alloc(0), (ws) => {
      wss.emit('connection', ws, req);
    });
    return res;
  }
  return NextResponse.json({ error: 'Not a WebSocket request' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    const { processed_module_id, user_message, chat_history } = await req.json();

    if (!processed_module_id || !user_message) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Fetch module content from database
    const { data: moduleData, error: moduleError } = await supabase
      .from('processed_modules')
      .select('title, content')
      .eq('processed_module_id', processed_module_id)
      .single();

    if (moduleError || !moduleData) {
      return NextResponse.json(
        { error: 'Module not found' },
        { status: 404 }
      );
    }

    // Build conversation history for context
    const historyContext = chat_history && chat_history.length > 0
      ? chat_history.map((msg: any) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n')
      : '';

    // Create prompt with module content as context
    const prompt = `You are a helpful learning assistant. You are helping a user understand a training module.

Module Title: ${moduleData.title}

Module Content:
${moduleData.content}

${historyContext ? `Previous conversation:\n${historyContext}\n` : ''}

User's question: ${user_message}

Please provide a helpful, concise response based on the module content. If the question is not related to the module, politely redirect the user to ask questions about the module content.
Provide response in plain text. DO NOT include any HTML or markdown formatting. DO NOT ADD BOLD UNDERLINES OR ITALICS.
`;

    // Call Gemini API
    const result = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
    });
    const assistantMessage = result.text;

    return NextResponse.json({
      success: true,
      message: assistantMessage,
    });
  } catch (error: any) {
    console.error('[module-chat] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process chat' },
      { status: 500 }
    );
  }
}
