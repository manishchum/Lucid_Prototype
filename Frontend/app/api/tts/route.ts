import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';

// Using Google Cloud Text-to-Speech REST API with service account credentials
// Set GOOGLE_APPLICATION_CREDENTIALS to point to your service account JSON file
// Env:
// - GOOGLE_APPLICATION_CREDENTIALS: Path to google-tts.json service account file (required)
// - NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: used for storage + DB writes

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.warn('[TTS API] NEXT_PUBLIC_SUPABASE_URL is not set');
}
if (!serviceKey) {
  console.warn('[TTS API] SUPABASE_SERVICE_ROLE_KEY is not set. Storage/DB writes may fail due to RLS.');
}

const admin = createClient(supabaseUrl, serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

const BUCKET = 'module_audio';

function generateJWT(credentials: any): string {
  const crypto = require('crypto');
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64').replace(/[=+/]/g, m => ({ '=': '', '+': '-', '/': '_' }[m]!));
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/[=+/]/g, m => ({ '=': '', '+': '-', '/': '_' }[m]!));
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${headerB64}.${payloadB64}`)
    .sign(credentials.private_key, 'base64')
    .replace(/[=+/]/g, m => ({ '=': '', '+': '-', '/': '_' }[m]!));
  
  return `${headerB64}.${payloadB64}.${signature}`;
}

async function ensureBucketExists() {
  try {
    const { data: buckets, error: listErr } = await admin.storage.listBuckets();
    if (listErr) return { ok: false, error: `List buckets failed: ${listErr.message}` } as const;
    const exists = !!buckets?.find((b: any) => b.name === BUCKET);
    if (exists) return { ok: true } as const;

    const { error: createErr } = await admin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: '50MB',
      allowedMimeTypes: ['audio/mpeg', 'audio/wav'],
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
    .eq('processed_module_id', processedModuleId)
    .maybeSingle();
  if (moduleError || !module) {
    return { error: moduleError?.message || 'Module not found', status: 404 } as const;
  }

  // Prepare full cleaned text
  const fullText = cleanTextForTTS(module.content || '');
  if (!fullText) return { error: 'Empty content', status: 400 } as const;

  // Split into chunks for Cloud TTS
  const maxChars = 4300;

  function splitTextIntoChunks(text: string, maxLen: number) {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + maxLen, text.length);
      if (end < text.length) {
        const slice = text.slice(start, end);
        const lastPunct = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'));
        const lastSpace = slice.lastIndexOf(' ');
        if (lastPunct > Math.floor(maxLen * 0.6)) {
          end = start + lastPunct + 1;
        } else if (lastSpace > Math.floor(maxLen * 0.6)) {
          end = start + lastSpace;
        }
      }
      const chunk = text.slice(start, end).trim();
      if (chunk) chunks.push(chunk);
      start = end;
    }
    return chunks;
  }

  function createWavBuffer(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bytesPerSample = 2) {
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bytesPerSample * 8, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmBuffer.length, 40);
    return Buffer.concat([header, pcmBuffer]);
  }

  const chunks = splitTextIntoChunks(fullText, maxChars);
  const pcmBuffers: Buffer[] = [];
  
  // Get access token from service account
  let accessToken: string | null = null;
  try {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credPath) {
      return { error: 'GOOGLE_APPLICATION_CREDENTIALS not set', status: 500 } as const;
    }
    
    const fs = await import('fs');
    const credContent = fs.readFileSync(credPath, 'utf8');
    const credentials = JSON.parse(credContent);
    
    // Get OAuth2 access token using service account
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: generateJWT(credentials),
      }),
    });
    
    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.error('[TTS API] Failed to get access token:', errText);
      return { error: `Failed to get Google access token: ${errText}`, status: 500 } as const;
    }
    
    const tokenData = await tokenResp.json();
    accessToken = (tokenData as any).access_token;
    if (!accessToken) {
      return { error: 'No access token in response', status: 500 } as const;
    }
  } catch (err: any) {
    console.error('[TTS API] Error getting access token:', err);
    return { error: `Failed to initialize TTS: ${err?.message}`, status: 500 } as const;
  }
  
  for (const chunk of chunks) {
    const requestBody = {
      input: { text: chunk },
      voice: { 
        languageCode: 'en-US', 
        name: 'en-US-Neural2-J',
        ssmlGender: 'MALE'
      },
      audioConfig: { 
        audioEncoding: 'LINEAR16',
        sampleRateHertz: 24000
      },
    };
    
    try {
      // Use REST API with access token from service account
      const response = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize`,
        {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[TTS API] Google TTS REST API error:', response.status, errorText);
        return { 
          error: `Google TTS API failed: ${response.statusText}. ${errorText}`, 
          status: response.status 
        } as const;
      }

      const data = await response.json();
      const audioContent = (data as any).audioContent;
      
      if (!audioContent) {
        return { error: 'TTS returned no audio for a chunk', status: 500 } as const;
      }
      
      const buf = Buffer.from(audioContent, 'base64');
      pcmBuffers.push(buf);
    } catch (ttsErr: any) {
      const errMsg = ttsErr?.message || String(ttsErr);
      console.error('[TTS API] Google Cloud TTS error:', errMsg);
      return { 
        error: `Google Cloud TTS failed: ${errMsg}`, 
        status: 500 
      } as const;
    }
  }

  const pcm = Buffer.concat(pcmBuffers);
  const wavBuffer = createWavBuffer(pcm, 24000, 1, 2);

  // Ensure storage bucket exists
  const ensured = await ensureBucketExists();
  if (!ensured.ok) {
    return { error: `Bucket not found and could not be created: ${ensured.error}. Ensure SUPABASE_SERVICE_ROLE_KEY is set or create the bucket manually.`, status: 500 } as const;
  }

  // Upload to Supabase Storage (module_audio bucket) as WAV
  const fileName = `module-audio/${processedModuleId}/${uuidv4()}.wav`;
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(fileName, wavBuffer, {
      contentType: 'audio/wav',
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
      console.error('[TTS API][GET] Synthesis failed:', result.error);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ audioUrl: result.audioUrl, processed_module_id: targetId });
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error('[TTS API][GET] Error:', errMsg, err);
    return NextResponse.json({ error: `TTS request failed: ${errMsg}` }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const module_id = body.processed_module_id || body.module_id;
    if (!module_id) return NextResponse.json({ error: 'Missing processed_module_id' }, { status: 400 });

    const result = await synthesizeAndStore(module_id);
    if ('error' in result) {
      console.error('[TTS API][POST] Synthesis failed:', result.error);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ audioUrl: result.audioUrl, processed_module_id: module_id });
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error('[TTS API][POST] Error:', errMsg, err);
    return NextResponse.json({ error: `TTS request failed: ${errMsg}` }, { status: 500 });
  }
}
