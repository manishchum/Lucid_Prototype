import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '@/lib/supabase';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

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

Please provide a helpful, concise response based on the module content. If the question is not related to the module, politely redirect the user to ask questions about the module content.`;

    // Call Gemini API
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const assistantMessage = response.text();

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
