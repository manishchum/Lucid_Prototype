import { NextRequest, NextResponse } from 'next/server';
import { generateInfographicData } from '../infographic-generator/services/geminiService';

export async function POST(req: NextRequest) {
  try {
    const { content, title } = await req.json();

    if (!content || !title) {
      return NextResponse.json(
        { error: 'Content and title are required' },
        { status: 400 }
      );
    }

    console.log('[generate-infographic] Generating infographic for:', title);
    console.log('[generate-infographic] Content length:', content.length);

    // Call the infographic generator service
    const infographicData = await generateInfographicData(content);

    console.log('[generate-infographic] Successfully generated infographic');

    return NextResponse.json(infographicData);
  } catch (error: any) {
    console.error('[generate-infographic] Error:', error);
    console.error('[generate-infographic] Error message:', error?.message);
    console.error('[generate-infographic] Error stack:', error?.stack);
    return NextResponse.json(
      { error: error.message || 'Failed to generate infographic' },
      { status: 500 }
    );
  }
}
