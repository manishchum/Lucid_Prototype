import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import os from 'os';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer';
import ffmpeg from 'fluent-ffmpeg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl) console.warn('[gpt-video-gen] NEXT_PUBLIC_SUPABASE_URL not set');
if (!serviceKey) console.warn('[gpt-video-gen] SUPABASE_SERVICE_ROLE_KEY not set');

const admin = createClient(supabaseUrl, serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

const BUCKET = 'module-visuals';

// Try to set ffmpeg/ffprobe paths at runtime using optional packages to avoid bundler issues.
try {
  // eslint-disable-next-line no-eval
  const req: any = eval('require');
  try {
    const ffmpegStatic = req('ffmpeg-static');
    if (ffmpegStatic) {
      try { ffmpeg.setFfmpegPath(ffmpegStatic as string); console.log('[gpt-video-gen] set ffmpeg path to', ffmpegStatic); } catch (e) { console.warn('[gpt-video-gen] Could not set ffmpeg path', e); }
    }
  } catch (e) {
    // ffmpeg-static not installed — ok
  }

  try {
    const ffprobeStatic = req('ffprobe-static');
    if (ffprobeStatic && ffprobeStatic.path) {
      try { ffmpeg.setFfprobePath(ffprobeStatic.path); console.log('[gpt-video-gen] set ffprobe path to', ffprobeStatic.path); } catch (e) { console.warn('[gpt-video-gen] Could not set ffprobe path', e); }
    }
  } catch (e) {
    // ffprobe-static not installed — ok
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

function splitTextIntoChunks(text: string, maxLen = 700) {
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

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function captureScreenshots(title: string, chunks: string[], tmpDir: string, startIndex = 0) {
  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    const files: string[] = [];
    let index = startIndex;
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

      try {
        await page.setContent(html, { waitUntil: 'load', timeout: 0 });
      } catch (setErr: any) {
        console.warn('[gpt-video-gen] setContent warning for chunk', index, (setErr as any)?.message || setErr);
      }
      await new Promise((res) => setTimeout(res, 300));
      const fileName = path.join(tmpDir, `frame-${index.toString().padStart(3, '0')}.png`);
      await page.screenshot({ path: fileName, type: 'png', fullPage: false });
      files.push(fileName);
      index++;
    }
    return files;
  } finally {
    try { await browser.close(); } catch (e) { console.warn('[gpt-video-gen] Error closing browser', e); }
  }
}

async function generateImageWithGemini(prompt: string, style?: string) {
  // Requires: GEMINI_API_KEY and optional GEMINI_IMAGE_ENDPOINT
  const key = process.env.GEMINI_API_KEY;
  const endpoint = process.env.GEMINI_IMAGE_ENDPOINT; // optional override
  if (!key || !endpoint) throw new Error('Gemini image generation not configured (set GEMINI_API_KEY and GEMINI_IMAGE_ENDPOINT)');

  // Improve prompts by appending a style hint when provided to get more diverse images.
  const finalPrompt = style ? `${prompt}. Style: ${style}` : prompt;

  // Generic POST request; the exact payload/response shape may vary depending on your proxy/service.
  // We attempt to support common response shapes: base64 image in data[0].b64_json or an url in data[0].url
  const body = { prompt: finalPrompt, size: '1280x720' };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini generation failed: ${res.status} ${txt}`);
  }
  const json = await res.json();

  // Try to discover image data
  // 1) data[0].b64_json
  const d0 = Array.isArray(json?.data) ? json.data[0] : json?.output?.[0] || json;
  if (d0?.b64_json) return Buffer.from(d0.b64_json, 'base64');
  if (d0?.image_base64) return Buffer.from(d0.image_base64, 'base64');
  if (d0?.base64) return Buffer.from(d0.base64, 'base64');
  if (d0?.url) {
    // fetch image by URL
    const imgRes = await fetch(d0.url);
    if (!imgRes.ok) throw new Error('Failed to fetch image URL from Gemini response');
    return Buffer.from(await imgRes.arrayBuffer());
  }

  // Some proxies return a `images` array
  if (Array.isArray(json?.images) && json.images[0]) {
    const maybe = json.images[0];
    if (typeof maybe === 'string') return Buffer.from(maybe, 'base64');
  }

  throw new Error('Unknown Gemini image response shape');
}

async function createVideoFromImages(imagePaths: string[], outPath: string, durationPerImage = 4) {
  return new Promise<void>((resolve, reject) => {
    try {
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

async function downloadToFile(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsPromises.writeFile(dest, buf);
}

async function synthesizeAndStore(processedModuleId: string) {
  console.log('[gpt-video-gen] start for', processedModuleId);
  const { data: module, error: moduleError } = await admin
    .from('processed_modules')
    .select('processed_module_id, title, content, audio_url')
    .eq('processed_module_id', processedModuleId)
    .maybeSingle();
  if (moduleError || !module) return { error: moduleError?.message || 'Module not found', status: 404 } as const;

  const title = module.title || 'Module';
  const fullText = cleanTextForVideo(module.content || '');
  if (!fullText) return { error: 'Empty content', status: 400 } as const;

  const chunks = splitTextIntoChunks(fullText, 700);
  const tmpDir = path.join(os.tmpdir(), `gptvideo-${processedModuleId}-${Date.now()}`);
  await fsPromises.mkdir(tmpDir, { recursive: true });
  try {
    const images: string[] = [];

    // Try Gemini if configured, otherwise fallback to screenshots
    const useGemini = !!process.env.GEMINI_API_KEY && !!process.env.GEMINI_IMAGE_ENDPOINT;
    console.log('[gpt-video-gen] useGemini=', useGemini, 'GEMINI_API_KEY set=', !!process.env.GEMINI_API_KEY, 'GEMINI_IMAGE_ENDPOINT set=', !!process.env.GEMINI_IMAGE_ENDPOINT);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const imagePath = path.join(tmpDir, `frame-${i.toString().padStart(3, '0')}.png`);
      if (useGemini) {
        try {
          const prompt = `${title} — ${chunk}`;
          // Generate two complementary images per chunk to increase visual variety
          try {
            const buf1 = await generateImageWithGemini(prompt, 'photorealistic, cinematic lighting, high detail, 16:9');
            const img1 = path.join(tmpDir, `frame-${i.toString().padStart(3, '0')}-img-01.png`);
            try {
              await fsPromises.writeFile(img1, buf1);
              images.push(img1);
              console.log('[gpt-video-gen] wrote gemini img1', img1);
            } catch (wfErr) {
              console.warn('[gpt-video-gen] failed to write gemini img1 to disk', img1, wfErr);
            }
          } catch (e: any) {
            console.warn('[gpt-video-gen] Gemini image 1 failed for chunk', i, e?.message || e);
          }
          try {
            const buf2 = await generateImageWithGemini(prompt, 'illustrative, vector flat colors, simple composition, 16:9');
            const img2 = path.join(tmpDir, `frame-${i.toString().padStart(3, '0')}-img-02.png`);
            try {
              await fsPromises.writeFile(img2, buf2);
              images.push(img2);
              console.log('[gpt-video-gen] wrote gemini img2', img2);
            } catch (wfErr) {
              console.warn('[gpt-video-gen] failed to write gemini img2 to disk', img2, wfErr);
            }
          } catch (e: any) {
            console.warn('[gpt-video-gen] Gemini image 2 failed for chunk', i, e?.message || e);
          }
          // Also add a text screenshot frame for the chunk so content appears alongside images
          const snaps = await captureScreenshots(title, [chunk], tmpDir, images.length);
          if (snaps.length > 0) {
            images.push(snaps[0]);
            console.log('[gpt-video-gen] wrote screenshot for chunk', i, snaps[0]);
          } else {
            console.warn('[gpt-video-gen] no screenshot created for chunk', i);
          }
          continue;
        } catch (e: any) {
          console.warn('[gpt-video-gen] Gemini generation failed for chunk', i, e?.message || e);
          // fallthrough to screenshot fallback
        }
      }
      // Fallback: capture a text screenshot for the chunk
      const snaps = await captureScreenshots(title, [chunk], tmpDir, images.length);
      if (snaps.length > 0) {
        images.push(snaps[0]);
        console.log('[gpt-video-gen] wrote screenshot fallback for chunk', i, snaps[0]);
      } else {
        console.warn('[gpt-video-gen] no screenshot fallback for chunk', i);
      }
    }

    console.log('[gpt-video-gen] total images collected:', images.length);
    if (images.length === 0) {
      try {
        const dirFiles = await fsPromises.readdir(tmpDir);
        console.log('[gpt-video-gen] tmpDir contents:', tmpDir, dirFiles);
      } catch (e) {
        console.warn('[gpt-video-gen] could not list tmpDir contents', e);
      }
      return { error: 'No images generated', status: 500 } as const;
    }

    const outFile = path.join(tmpDir, `${uuidv4()}.mp4`);
    await createVideoFromImages(images, outFile, 4);

    let finalOut = outFile;
    // If audio available, download and merge
    if (module.audio_url) {
      try {
        const audioFile = path.join(tmpDir, 'audio.wav');
        await downloadToFile(module.audio_url, audioFile);
        const outWithAudio = path.join(tmpDir, `${uuidv4()}-with-audio.mp4`);
        await new Promise<void>((resolve, reject) => {
          ffmpeg()
            .input(outFile)
            .input(audioFile)
            .outputOptions(['-c:v copy', '-c:a aac', '-map 0:v:0', '-map 1:a:0', '-shortest'])
            .output(outWithAudio)
            .on('end', () => resolve())
            .on('error', (err: any) => reject(err))
            .run();
        });
        finalOut = outWithAudio;
      } catch (e: any) {
        console.warn('[gpt-video-gen] failed to attach audio:', e?.message || e);
      }
    }

    const ensured = await ensureBucketExists();
    if (!ensured.ok) return { error: `Bucket not found and could not be created: ${ensured.error}.`, status: 500 } as const;

    const fileName = `module-visuals/${processedModuleId}/${path.basename(finalOut)}`;
    const videoBuffer = fs.readFileSync(finalOut);
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(fileName, videoBuffer, { contentType: 'video/mp4', upsert: true });
    if (uploadError) return { error: `Video upload failed: ${uploadError.message}`, status: 500 } as const;

    const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(fileName);
    const videoUrl = publicUrlData?.publicUrl;

    const { error: updateErr } = await admin.from('processed_modules').update({ video_url: videoUrl, video_generated_at: new Date().toISOString() }).eq('processed_module_id', processedModuleId);
    if (updateErr) return { error: `DB update failed: ${updateErr.message}`, status: 500 } as const;

    return { videoUrl } as const;
  } catch (e: any) {
    console.error('[gpt-video-gen] error', e?.message || e, e?.stack || '');
    return { error: e?.message || 'Unexpected error', status: 500 } as const;
  } finally {
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
      const { data, error } = await admin.from('processed_modules').select('processed_module_id').is('video_url', null).limit(1).maybeSingle();
      if (error && error.code !== 'PGRST116') return NextResponse.json({ error: error.message }, { status: 500 });
      targetId = data?.processed_module_id || null;
      if (!targetId) {
        const { data: anyOne } = await admin.from('processed_modules').select('processed_module_id').limit(1).maybeSingle();
        targetId = anyOne?.processed_module_id || null;
      }
    }

    if (!targetId) return NextResponse.json({ error: 'No processed_modules found to generate video' }, { status: 404 });

    const result = await synthesizeAndStore(targetId);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ videoUrl: result.videoUrl, processed_module_id: targetId });
  } catch (err) {
    console.error('[gpt-video-gen][GET] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const module_id = body.processed_module_id || body.module_id;
    if (!module_id) return NextResponse.json({ error: 'Missing processed_module_id' }, { status: 400 });

    const result = await synthesizeAndStore(module_id);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ videoUrl: result.videoUrl, processed_module_id: module_id });
  } catch (err) {
    console.error('[gpt-video-gen][POST] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
