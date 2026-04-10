import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { randomUUID } from 'crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = 'module-visuals';

const supabaseService = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export async function POST(req: Request) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Storage service is not configured' }, { status: 500 });
    }

    const form = await req.formData();
    const file = form.get('file');
    const moduleId = String(form.get('moduleId') || '').trim();

    if (!moduleId) {
      return NextResponse.json({ error: 'moduleId is required' }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No video file provided' }, { status: 400 });
    }

    if (!file.type.startsWith('video/')) {
      return NextResponse.json({ error: 'Only video files are supported' }, { status: 400 });
    }

    const originalName = sanitizeFileName(file.name || 'video.mp4');
    const filePath = path.posix.join(moduleId, `${randomUUID()}_${originalName}`);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { data: storageData, error: storageError } = await supabaseService.storage
      .from(BUCKET)
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (storageError || !storageData) {
      return NextResponse.json(
        { error: storageError?.message || 'Failed to upload video' },
        { status: 500 }
      );
    }

    const { data: publicData } = supabaseService.storage.from(BUCKET).getPublicUrl(storageData.path);

    return NextResponse.json({
      bucket: BUCKET,
      path: storageData.path,
      url: publicData.publicUrl,
    });
  } catch (error) {
    console.error('Module media upload failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload media' },
      { status: 500 }
    );
  }
}