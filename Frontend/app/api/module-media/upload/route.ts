import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { randomUUID } from 'crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

type ModuleMediaType = 'video' | 'image' | 'audio';

const BUCKET_BY_MEDIA_TYPE: Record<ModuleMediaType, string> = {
  video: 'module-visuals',
  image: 'module-assets',
  audio: 'module_audio',
};

const supabaseService = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function buildStoragePath(moduleId: string, mediaType: ModuleMediaType, originalName: string) {
  const mediaFolder = mediaType === 'image' ? 'images' : mediaType;
  return path.posix.join(moduleId, mediaFolder, `${randomUUID()}_${originalName}`);
}

function inferMediaType(file: File, requested: string): ModuleMediaType | null {
  if (requested === 'video' || requested === 'image' || requested === 'audio') {
    return requested;
  }

  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';

  const extension = sanitizeFileName(file.name || '').toLowerCase();
  if (/\.(mp4|mov|webm|m4v|avi)$/.test(extension)) return 'video';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(extension)) return 'image';
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(extension)) return 'audio';

  return null;
}

function isFileValidForMediaType(file: File, mediaType: ModuleMediaType): boolean {
  const name = sanitizeFileName(file.name || '').toLowerCase();
  if (mediaType === 'video') {
    return file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|avi)$/.test(name);
  }
  if (mediaType === 'image') {
    return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name);
  }
  return file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/.test(name);
}

export async function POST(req: Request) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Storage service is not configured' }, { status: 500 });
    }

    const contentType = req.headers.get('content-type') || '';

    // Lightweight signed-upload handshake so large file bytes bypass Vercel and go directly to Supabase.
    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => null);
      const action = String(body?.action || '').trim();

      if (action !== 'createSignedUploadUrl') {
        return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
      }

      const moduleId = String(body?.moduleId || '').trim();
      const requestedMediaType = String(body?.mediaType || '').trim().toLowerCase();
      const rawFileName = String(body?.fileName || '').trim();

      if (!moduleId) {
        return NextResponse.json({ error: 'moduleId is required' }, { status: 400 });
      }

      if (requestedMediaType !== 'video' && requestedMediaType !== 'image' && requestedMediaType !== 'audio') {
        return NextResponse.json({ error: 'mediaType must be video, image, or audio' }, { status: 400 });
      }

      const mediaType = requestedMediaType as ModuleMediaType;
      const bucket = BUCKET_BY_MEDIA_TYPE[mediaType];
      const defaultFileName = mediaType === 'video' ? 'video.mp4' : mediaType === 'image' ? 'image.png' : 'audio.mp3';
      const originalName = sanitizeFileName(rawFileName || defaultFileName);
      const filePath = buildStoragePath(moduleId, mediaType, originalName);

      const { data: signedData, error: signedError } = await supabaseService.storage
        .from(bucket)
        .createSignedUploadUrl(filePath);

      if (signedError || !signedData?.token || !signedData?.path) {
        return NextResponse.json(
          { error: signedError?.message || `Failed to create signed upload URL for ${mediaType}` },
          { status: 500 }
        );
      }

      return NextResponse.json({
        mediaType,
        bucket,
        path: signedData.path,
        token: signedData.token,
      });
    }

    const form = await req.formData();
    const file = form.get('file');
    const moduleId = String(form.get('moduleId') || '').trim();
    const requestedMediaType = String(form.get('mediaType') || '').trim().toLowerCase();

    if (!moduleId) {
      return NextResponse.json({ error: 'moduleId is required' }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No media file provided' }, { status: 400 });
    }

    const mediaType = inferMediaType(file, requestedMediaType);
    if (!mediaType) {
      return NextResponse.json({ error: 'Unsupported media type. Use video, image, or audio.' }, { status: 400 });
    }

    if (!isFileValidForMediaType(file, mediaType)) {
      return NextResponse.json({ error: `Only ${mediaType} files are supported` }, { status: 400 });
    }

    const bucket = BUCKET_BY_MEDIA_TYPE[mediaType];

    const defaultFileName = mediaType === 'video' ? 'video.mp4' : mediaType === 'image' ? 'image.png' : 'audio.mp3';
    const originalName = sanitizeFileName(file.name || defaultFileName);
    const filePath = buildStoragePath(moduleId, mediaType, originalName);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { data: storageData, error: storageError } = await supabaseService.storage
      .from(bucket)
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (storageError || !storageData) {
      return NextResponse.json(
        { error: storageError?.message || `Failed to upload ${mediaType}` },
        { status: 500 }
      );
    }

    const { data: publicData } = supabaseService.storage.from(bucket).getPublicUrl(storageData.path);

    return NextResponse.json({
      mediaType,
      bucket,
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