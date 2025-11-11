import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Google TTS API imports
// You need to install @google-cloud/text-to-speech and set up credentials
import textToSpeech from '@google-cloud/text-to-speech';
import os from 'os';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Decode base64 Google service account key from GOOGLE_TTS_JSON and set GOOGLE_APPLICATION_CREDENTIALS
const base64Key = process.env.GOOGLE_TTS_JSON;
let credentialsPath: string | undefined;
if (base64Key) {
  try {
    const decoded = Buffer.from(base64Key, 'base64').toString('utf8');
    const tempPath = os.tmpdir() + `/google-credentials-${Date.now()}.json`;
    fs.writeFileSync(tempPath, decoded, { encoding: 'utf8' });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tempPath;
    credentialsPath = tempPath;
    console.log('[TTS API] Decoded Google credentials from GOOGLE_TTS_JSON and set GOOGLE_APPLICATION_CREDENTIALS');
  } catch (e) {
    console.error('[TTS API] Failed to decode/write Google credentials:', e);
  }
} else {
  console.warn('[TTS API] GOOGLE_TTS_JSON not set.');
}

if (!supabaseUrl) {
  console.warn('[TTS API] NEXT_PUBLIC_SUPABASE_URL is not set');
}
if (!serviceKey) {
  console.warn('[TTS API] SUPABASE_SERVICE_ROLE_KEY is not set. Storage/DB writes may fail due to RLS.');
}

const admin = createClient(supabaseUrl, serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const client = new textToSpeech.TextToSpeechClient();

const BUCKET = 'module_audio';

async function ensureBucketExists() {
  try {
    const { data: buckets, error: listErr } = await admin.storage.listBuckets();
    if (listErr) return { ok: false, error: `List buckets failed: ${listErr.message}` } as const;
    const exists = !!buckets?.find((b: any) => b.name === BUCKET);
    if (exists) return { ok: true } as const;

    const { error: createErr } = await admin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: '50MB',
      allowedMimeTypes: ['audio/mpeg'],
    });
    if (createErr) return { ok: false, error: `Bucket create failed: ${createErr.message}` } as const;
    return { ok: true } as const;
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Unknown error creating bucket' } as const;
  }
}

function cleanTextForTTS(text: string) {
  return text
    .replace(/[#*`>-]/g, '') // Remove markdown symbols
    .replace(/\n/g, ' ')    // Replace newlines with space
    .replace(/\s+/g, ' ')   // Collapse multiple spaces
    .replace(/<[^>]+>/g, '') // Remove HTML tags
    .trim();
}

async function synthesizeAndStore(processedModuleId: string) {
  // Fetch module content from processed_modules
  const { data: module, error: moduleError } = await admin
    .from('processed_modules')
    .select('processed_module_id, title, content')
    .eq('module_id', processedModuleId)
    .maybeSingle();
  if (moduleError || !module) {
    return { error: moduleError?.message || 'Module not found', status: 404 } as const;
  }

  // Truncate very long content to reduce cost and meet TTS limits
  const maxChars = 4500; // Google TTS limit is ~5000 for plain text
  const text = cleanTextForTTS((module.content || '').slice(0, maxChars));
  if (!text) return { error: 'Empty content', status: 400 } as const;

  // Prepare Google TTS request
  const requestTTS = {
    input: { text },
    voice: { languageCode: 'en-IN',voiceName: 'en-IN-Chirp3-HD-Algenib', ssmlGender: 'MALE' as const },
    audioConfig: { audioEncoding: 'MP3' as const },
  };
  // Synthesize speech
  const [response] = await client.synthesizeSpeech(requestTTS as any);
  const audioContent = response.audioContent as Uint8Array | undefined;
  if (!audioContent) {
    return { error: 'TTS failed', status: 500 } as const;
  }

  // Ensure storage bucket exists
  const ensured = await ensureBucketExists();
  if (!ensured.ok) {
    return { error: `Bucket not found and could not be created: ${ensured.error}. Ensure SUPABASE_SERVICE_ROLE_KEY is set or create the bucket manually.`, status: 500 } as const;
  }

  // Upload to Supabase Storage (module_audio bucket)
  const fileName = `module-audio/${processedModuleId}/${uuidv4()}.mp3`;
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(fileName, Buffer.from(audioContent as any), {
      contentType: 'audio/mpeg',
      upsert: true,
    });
  if (uploadError) {
    return { error: `Audio upload failed: ${uploadError.message}`, status: 500 } as const;
  }

  // Get public URL
  const { data: publicUrlData } = admin.storage
    .from(BUCKET)
    .getPublicUrl(fileName);
  const audioUrl = publicUrlData?.publicUrl;

  // Update processed_modules with audio_url and generated_at
  const { error: updateErr } = await admin
    .from('processed_modules')
    .update({ audio_url: audioUrl, audio_generated_at: new Date().toISOString() })
    .eq('processed_module_id', processedModuleId);
  if (updateErr) {
    return { error: `DB update failed: ${updateErr.message}`, status: 500 } as const;
  }

  return { audioUrl } as const;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const processed = url.searchParams.get('processed_module_id');
    const legacy = url.searchParams.get('module_id');
    const moduleId = processed || legacy;

    let targetId = moduleId;
    if (!targetId) {
      // Pick 1 module (prefer those without audio yet), LIMIT 1
      const { data, error } = await admin
        .from('processed_modules')
        .select('processed_module_id')
        .is('audio_url', null)
        .limit(1)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      targetId = data?.processed_module_id || null;
      if (!targetId) {
        // Fallback to any one (LIMIT 1)
        const { data: anyOne } = await admin
          .from('processed_modules')
          .select('processed_module_id')
          .limit(1)
          .maybeSingle();
        targetId = anyOne?.processed_module_id || null;
      }
    }

    if (!targetId) {
      return NextResponse.json({ error: 'No processed_modules found to synthesize' }, { status: 404 });
    }

    const result = await synthesizeAndStore(targetId);
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ audioUrl: result.audioUrl, processed_module_id: targetId });
  } catch (err) {
    console.error('[TTS API][GET] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const module_id = body.processed_module_id || body.module_id;
    if (!module_id) return NextResponse.json({ error: 'Missing processed_module_id' }, { status: 400 });

    const result = await synthesizeAndStore(module_id);
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ audioUrl: result.audioUrl, processed_module_id: module_id });
  } catch (err) {
    console.error('[TTS API][POST] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
