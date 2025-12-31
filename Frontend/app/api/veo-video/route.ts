import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Redirect to existing video generation endpoint that uses Gemini multimodal + FFmpeg
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const moduleId = body.processed_module_id || body.module_id;

    if (!moduleId) {
      return NextResponse.json({ error: 'Missing module ID' }, { status: 400 });
    }

    // Call the existing video generation endpoint that uses Gemini + FFmpeg
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const response = await fetch(`${baseUrl}/api/video-generation?processed_module_id=${moduleId}`, {
      method: 'GET',
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json({ error: data.error || 'Video generation failed' }, { status: response.status });
    }

    return NextResponse.json({ videoUrl: data.videoUrl });
  } catch (e: any) {
    console.error('[VEO-VIDEO API] Error:', e?.message);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
