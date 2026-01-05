import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import os from 'os';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer';
import ffmpeg from 'fluent-ffmpeg';
import textToSpeech from "@google-cloud/text-to-speech";

// Do not import ffmpeg-static at module scope (Next bundler may package binary incorrectly).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl) console.warn('[VIDEO API] NEXT_PUBLIC_SUPABASE_URL not set');
if (!serviceKey) console.warn('[VIDEO API] SUPABASE_SERVICE_ROLE_KEY not set');

const admin = createClient(supabaseUrl, serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

const BUCKET = 'module-visuals';

// Try to set ffmpeg/ffprobe paths at runtime using optional packages to avoid bundler issues.
try {
  // eslint-disable-next-line no-eval
  const req: any = eval('require');
  try {
    const ffmpegStatic = req('ffmpeg-static');
    if (ffmpegStatic) {
      try { ffmpeg.setFfmpegPath(ffmpegStatic as string);
         // console.log('[VIDEO API] set ffmpeg path to', ffmpegStatic); 
        } catch (e) { console.warn('[VIDEO API] Could not set ffmpeg path', e); }
    }
  } catch (e) {
    // ffmpeg-static not installed — ok, ffmpeg may be available in PATH
  }

  try {
    const ffprobeStatic = req('ffprobe-static');
    if (ffprobeStatic && ffprobeStatic.path) {
      try { ffmpeg.setFfprobePath(ffprobeStatic.path); 
        // console.log('[VIDEO API] set ffprobe path to', ffprobeStatic.path);
       } catch (e) { console.warn('[VIDEO API] Could not set ffprobe path', e); }
    }
  } catch (e) {
    // ffprobe-static not installed — ok, ffprobe may be available in PATH
  }
} catch (e) {
  // eval/require failed — environment may not allow dynamic requires
}

async function ensureBucketExists() {
  try {
    const { data: buckets, error: listErr } = await admin.storage.listBuckets();
    if (listErr) return { ok: false, error: `List buckets failed: ${listErr.message}` } as const;
    const exists = !!buckets?.find((b: any) => b.name === BUCKET);
    if (exists) return { ok: true } as const;

    const { error: createErr } = await admin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: '200MB',
      allowedMimeTypes: ['video/mp4', 'image/png', 'image/jpeg'],
    });
    if (createErr) return { ok: false, error: `Bucket create failed: ${createErr.message}` } as const;
    return { ok: true } as const;
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Unknown error creating bucket' } as const;
  }
}

function cleanTextForVideo(text: string) {
  return text
    .replace(/[#*`>-]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTextIntoChunks(text: string, maxLen = 800) {
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

async function captureScreenshots(title: string, chunks: string[], tmpDir: string) {
  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    const files: string[] = [];
    let index = 0;
    for (const chunk of chunks) {
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        body{margin:0;font-family:Arial,Helvetica,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;color:#fff}
        .card{width:1200px;height:675px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;padding:48px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}
        .title{font-size:44px;font-weight:700;margin-bottom:18px;text-shadow:0 2px 6px rgba(0,0,0,.6)}
        .text{font-size:26px;line-height:1.3;max-height:420px;overflow:hidden;text-shadow:0 1px 4px rgba(0,0,0,.6)}
      </style></head><body>
      <div class="card">
        <div class="title">${escapeHtml(title)}</div>
        <div class="text">${escapeHtml(chunk)}</div>
      </div>
      </body></html>`;

      // Use a disabled timeout to avoid failing when external resources are slow in dev.
      try {
        await page.setContent(html, { waitUntil: 'load', timeout: 0 });
      } catch (setErr: any) {
        console.warn(`[VIDEO API] setContent warning for chunk ${index}:`, (setErr as any)?.message || setErr);
      }
      // Small pause to let fonts/render settle
      await new Promise((res) => setTimeout(res, 300));
      const fileName = path.join(tmpDir, `frame-${index.toString().padStart(3, '0')}.png`);
      await page.screenshot({ path: fileName, type: 'png', fullPage: false });
      files.push(fileName);
      index++;
    }
    return files;
  } finally {
    try { await browser.close(); } catch (e) { console.warn('[VIDEO API] Error closing browser', e); }
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
}

async function createVideoFromImages(imagePaths: string[], outPath: string, durationPerImage = 4) {
  return new Promise<void>((resolve, reject) => {
    try {
      const proc = ffmpeg();
      imagePaths.forEach((img) => proc.addInput(img).inputOptions(['-loop 1']));
      // Set duration per image by using filter_complex concat
      const filterInputs = imagePaths.map((_, i) => `[${i}:v]`).join('');
      // Simpler: use image2pipe approach: build a slideshow by specifying -framerate and -pattern_type
      // We'll use fluent-ffmpeg built-in slideshow by using input list via concat demuxer

      // Create a temporary file list for ffmpeg concat demuxer
      const listFile = outPath + '.txt';
      const listContent = imagePaths.map((p) => `file '${p.replace(/\\/g, '/')}'\nduration ${durationPerImage}`).join('\n') + `\nfile '${imagePaths[imagePaths.length - 1].replace(/\\/g, '/')}'\n`;
      fs.writeFileSync(listFile, listContent);

      ffmpeg()
        .input(listFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-vsync vfr', '-pix_fmt yuv420p'])
        .videoCodec('libx264')
        .size('?x720')
        .output(outPath)
        .on('end', () => {
          try { fs.unlinkSync(listFile); } catch (e) {}
          resolve();
        })
        .on('error', (err: any) => {
          try { fs.unlinkSync(listFile); } catch (e) {}
          reject(err);
        })
        .run();
    } catch (err) {
      reject(err);
    }
  });
}

async function generateExplanationScript(title: string, content: string) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const prompt = `You are an expert educator creating an engaging video script. 

Based on this learning module:
Title: ${title}
Content: ${content.substring(0, 2000)}

Create a natural, conversational 60-90 second video narration script that:
- Explains the key concepts in an engaging way (don't just read the content)
- Uses simple language and real-world examples
- Has a clear beginning, middle, and end
- Sounds natural when spoken aloud
- Is informative and educational

Return ONLY the narration script text, no meta-commentary.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Gemini API error: ${data?.error?.message || 'Unknown error'}`);
  }

  const script = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return script.trim();
}

async function generateTTSAudio(script: string, outputPath: string) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  // Use Google Cloud TTS with the Gemini API key
  // const ttsUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${geminiApiKey}`;
  
  // const response = await fetch(ttsUrl, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({
  //     input: { text: script },
  //     voice: {
  //       languageCode: 'en-US',
  //       name: 'en-US-Neural2-J', // Professional male voice
  //       ssmlGender: 'MALE',
  //     },
  //     audioConfig: {
  //       audioEncoding: 'MP3',
  //       speakingRate: 0.95,
  //       pitch: 0,
  //     },
  //   }),
  // });


  const ttsClient = new textToSpeech.TextToSpeechClient({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || './secrets/google-credentials.json',
  });
async function generateTTSAudio(script: string, outputPath: string) {
  const [response] = await ttsClient.synthesizeSpeech({
    input: { text: script },
    voice: {
      languageCode: "en-US",
      name: "en-US-Neural2-J",
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: 0.95,
    },
  });

  if (!response.audioContent) {
    throw new Error("No audio content returned from TTS");
  }

  await fsPromises.writeFile(
    outputPath,
    response.audioContent as Buffer
  );
}
generateTTSAudio(script, outputPath);
  // const data = await response.json();
  // if (!response.ok) {
  //   throw new Error(`TTS API error: ${data?.error?.message || 'Unknown error'}`);
  // }

  // const audioContent = data.audioContent;
  // if (!audioContent) {
  //   throw new Error('No audio content returned from TTS');
  // }

  // // Write audio to file
  // await fsPromises.writeFile(outputPath, Buffer.from(audioContent, 'base64'));
  return outputPath;
}

async function synthesizeAndStore(processedModuleId: string) {
  // console.log('[VIDEO API] synthesizeAndStore start for', processedModuleId);
  // Fetch module content from processed_modules
  const { data: module, error: moduleError } = await admin
    .from('processed_modules')
    .select('processed_module_id, title, content, audio_url')
    .eq('processed_module_id', processedModuleId)
    .maybeSingle();
  if (moduleError || !module) {
    return { error: moduleError?.message || 'Module not found', status: 404 } as const;
  }

  const title = module.title || 'Module';
  const fullText = cleanTextForVideo(module.content || '');
  if (!fullText) return { error: 'Empty content', status: 400 } as const;

  // console.log('[VIDEO API] Generating explanation script...');
  const script = await generateExplanationScript(title, fullText);
  // console.log('[VIDEO API] Script generated:', script.substring(0, 100) + '...');

  const chunks = splitTextIntoChunks(script, 600);

  // console.log('[VIDEO API] chunk count:', chunks.length);

  const tmpDir = path.join(os.tmpdir(), `module-video-${processedModuleId}-${Date.now()}`);
  // console.log('[VIDEO API] tmpDir:', tmpDir);
  await fsPromises.mkdir(tmpDir, { recursive: true });
  try {
    // Generate TTS audio from script
    // console.log('[VIDEO API] Generating TTS audio...');
    const audioPath = path.join(tmpDir, 'narration.mp3');
    await generateTTSAudio(script, audioPath);
    // console.log('[VIDEO API] Audio generated');

    const images = await captureScreenshots(title, chunks, tmpDir);
    // console.log('[VIDEO API] captured images count:', images.length);

    const silentVideoPath = path.join(tmpDir, 'silent_video.mp4');
    await createVideoFromImages(images, silentVideoPath, 4);

    // Combine video with audio
    // console.log('[VIDEO API] Combining video with audio...');
    const outFile = path.join(tmpDir, `${uuidv4()}.mp4`);
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(silentVideoPath)
        .input(audioPath)
        .outputOptions([
          '-c:v copy',
          '-c:a aac',
          '-b:a 192k',
          '-shortest', // End video when audio ends
        ])
        .output(outFile)
        .on('end', () => resolve())
        .on('error', (err: any) => reject(err))
        .run();
    });
    // console.log('[VIDEO API] Video with audio created');

    // Ensure bucket exists
    const ensured = await ensureBucketExists();
    if (!ensured.ok) {
      return { error: `Bucket not found and could not be created: ${ensured.error}. Ensure SUPABASE_SERVICE_ROLE_KEY is set or create the bucket manually.`, status: 500 } as const;
    }

    // Upload to Supabase Storage
    const fileName = `module-visuals/${processedModuleId}/${path.basename(outFile)}`;
    const videoBuffer = fs.readFileSync(outFile);
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(fileName, videoBuffer, { contentType: 'video/mp4', upsert: true });
    if (uploadError) console.error('[VIDEO API] uploadError:', uploadError);
    if (uploadError) {
      return { error: `Video upload failed: ${uploadError.message}`, status: 500 } as const;
    }

    const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(fileName);
    const videoUrl = publicUrlData?.publicUrl;

    // Update processed_modules with video_url and generated_at
    const { error: updateErr } = await admin
      .from('processed_modules')
      .update({ video_url: videoUrl, video_generated_at: new Date().toISOString() })
      .eq('processed_module_id', processedModuleId);
    if (updateErr) console.error('[VIDEO API] DB update error:', updateErr);
    if (updateErr) {
      return { error: `DB update failed: ${updateErr.message}`, status: 500 } as const;
    }

    return { videoUrl } as const;
  } catch (e: any) {
    console.error('[VIDEO API] synthesizeAndStore unexpected error:', e?.message || e, e?.stack || '');
    return { error: e?.message || 'Unexpected error during video synthesis', status: 500 } as const;
  } finally {
    // cleanup tmp dir
    try {
      const files = await fsPromises.readdir(tmpDir);
      await Promise.all(files.map((f) => fsPromises.unlink(path.join(tmpDir, f))));
      await fsPromises.rmdir(tmpDir);
    } catch (e) {}
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const processed = url.searchParams.get('processed_module_id');
    const legacy = url.searchParams.get('module_id');
    const moduleId = processed || legacy;

    let targetId = moduleId;
    if (!targetId) {
      // Pick 1 module (prefer those without video yet), LIMIT 1
      const { data, error } = await admin
        .from('processed_modules')
        .select('processed_module_id')
        .is('video_url', null)
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
      return NextResponse.json({ error: 'No processed_modules found to generate video' }, { status: 404 });
    }

    const result = await synthesizeAndStore(targetId);
    if ('error' in result) {
      console.error('[VIDEO API][GET] synthesize error:', result.error);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ videoUrl: result.videoUrl, processed_module_id: targetId });
  } catch (err) {
    console.error('[VIDEO API][GET] Error:', err);
    const message = (err as any)?.message || 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const module_id = body.processed_module_id || body.module_id;
    if (!module_id) return NextResponse.json({ error: 'Missing processed_module_id' }, { status: 400 });

    const result = await synthesizeAndStore(module_id);
    if ('error' in result) {
      console.error('[VIDEO API][POST] synthesize error:', result.error);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ videoUrl: result.videoUrl, processed_module_id: module_id });
  } catch (err) {
    console.error('[VIDEO API][POST] Error:', err);
    const message = (err as any)?.message || 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
