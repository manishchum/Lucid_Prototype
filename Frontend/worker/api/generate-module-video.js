/*
  Worker-side version of /api/gpt-video-generation.

  Usage (from other workers):
    const { generateModuleVideo } = require('./api/generate-module-video')
    await generateModuleVideo({ moduleId: '123' })

  Usage (standalone loop):
    node worker/api/generate-module-video.js --poll
*/

require('../env').loadWorkerEnv();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { v4: uuid } = require('uuid');
const puppeteer = require('puppeteer');
const ffmpeg = require('fluent-ffmpeg');
const fetch = require('node-fetch');
const textToSpeech = require('@google-cloud/text-to-speech');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!global.__videoWorkerPrinted) {
  console.log('[VIDEO WORKER] SUPABASE_URL loaded:', Boolean(SUPABASE_URL), 'len=', SUPABASE_URL.length);
  console.log('[VIDEO WORKER] SUPABASE_SERVICE_ROLE_KEY loaded:', Boolean(SUPABASE_SERVICE_KEY), 'len=', SUPABASE_SERVICE_KEY.length);
  console.log('[VIDEO WORKER] GEMINI_API_KEY loaded:', Boolean(process.env.GEMINI_API_KEY));
  console.log('[VIDEO WORKER] OPENAI_API_KEY loaded:', Boolean(process.env.OPENAI_API_KEY));
  global.__videoWorkerPrinted = true;
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const BUCKET = 'module-visuals';

// GOOGLE CREDS INIT (same idea as route.ts)
const base64Key = process.env.GOOGLE_TTS_JSON;
if (base64Key && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    const decoded = Buffer.from(base64Key, 'base64').toString('utf8');
    const tempPath = path.join(os.tmpdir(), `google-credentials-${Date.now()}.json`);
    require('fs').writeFileSync(tempPath, decoded, { encoding: 'utf8' });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tempPath;
    console.log('[VIDEO WORKER] Google credentials loaded from GOOGLE_TTS_JSON');
  } catch (e) {
    console.error('[VIDEO WORKER] Failed to decode/write GOOGLE_TTS_JSON:', e);
  }
}

// FFmpeg PATH RESOLUTION
try {
  // eslint-disable-next-line no-eval
  const req = eval('require');
  try {
    const ffmpegStatic = req('ffmpeg-static');
    if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
  } catch (e) {}

  try {
    const ffprobeStatic = req('ffprobe-static');
    if (ffprobeStatic?.path) ffmpeg.setFfprobePath(ffprobeStatic.path);
  } catch (e) {}
} catch (e) {}

async function ensureBucketExists() {
  try {
    const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
    if (listErr) return { ok: false, error: `List buckets failed: ${listErr.message}` };

    const exists = !!buckets?.find((b) => b.name === BUCKET);
    if (exists) return { ok: true };

    const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: '200MB',
    });

    if (createErr) return { ok: false, error: `Bucket create failed: ${createErr.message}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'Unknown error creating bucket' };
  }
}

async function planScenes(content) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content:
            'You are a master AI instructor specializing in NotebookLM-style deep dives. You synthesize complex information into engaging narratives.',
        },
        {
          role: 'user',
          content: `
Create a deep-dive, conversational instructor-led video script based on the modules provided.

For each scene, provide:
1. title
2. spoken_script
3. slide_bullets (2-3 bullets)
4. visual_prompt (no text, no human faces)

CRITICAL: Return JSON ONLY.
[
  {
    "title": "...",
    "spoken_script": "...",
    "slide_bullets": ["...", "..."],
    "visual_prompt": "..."
  }
]

CONTENT:
${content}
          `.trim(),
        },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`OpenAI scene planning failed: ${res.status} ${t}`);
  }

  const json = await res.json();
  const rawText = json.choices?.[0]?.message?.content || '';
  const jsonMatch = rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);

  if (!jsonMatch) throw new Error('No JSON array found from OpenAI response');
  return JSON.parse(jsonMatch[0]);
}

async function generateImagenImage(prompt, outFile) {
  try {
    const key = process.env.GEMINI_API_KEY;
    console.log(`[IMAGEN] Generating with prompt: ${prompt}`);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount: 1, aspectRatio: '16:9' },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.warn('[IMAGEN] failed:', res.status, err);
      return;
    }

    const data = await res.json();

    const base64 =
      data.predictions?.[0]?.bytesBase64Encoded ||
      data.images?.[0]?.base64 ||
      data.output?.[0]?.base64 ||
      (typeof data.predictions?.[0] === 'string' ? data.predictions[0] : null);

    if (!base64) throw new Error('No valid image data found in Imagen response');

    await fs.writeFile(outFile, Buffer.from(base64, 'base64'));
    console.log(`[IMAGEN] Success: ${outFile}`);
  } catch (e) {
    console.error('[IMAGEN] generation error:', e);
  }
}

async function renderFallbackAssets(dir) {
  const bgPath = path.join(dir, 'fallback-bg.png');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 720 });
    await page.setContent(
      `<body style="margin:0; background: linear-gradient(135deg, #f8fafc, #e2e8f0); width:1280px; height:720px;"></body>`
    );
    await page.screenshot({ path: bgPath });

    await page.setViewport({ width: 1, height: 1 });
    await page.setContent(`<body style="margin:0; background: transparent;"></body>`);
    const fallbackAvatar = path.join(dir, 'fallback-av.png');
    await page.screenshot({ path: fallbackAvatar, omitBackground: true });

    return { bgPath, fallbackAvatar };
  } finally {
    await browser.close();
  }
}

async function generateAvatarImage(dir) {
  const avatarPath = path.join(dir, 'avatar.png');
  await generateImagenImage(
    'A professional, high-definition 3D render of a friendly AI instructor avatar, chest-up shot, wearing modern casual professional attire, soft studio lighting, solid neutral background',
    avatarPath
  );
  return avatarPath;
}

async function generateTTSAudio(script, outFile) {
  const ttsClient = new textToSpeech.TextToSpeechClient({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || './secrets/google-credentials.json',
  });

  const [response] = await ttsClient.synthesizeSpeech({
    input: { text: script },
    voice: { languageCode: 'en-US', name: 'en-US-Neural2-J' },
    audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 },
  });

  if (!response.audioContent) throw new Error('TTS failed');

  await fs.writeFile(outFile, response.audioContent);

  return new Promise((resolve) => {
    ffmpeg.ffprobe(outFile, (err, data) => {
      resolve(Number(data?.format?.duration ?? 5));
    });
  });
}

async function renderSlide(scene, index, dir) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    const html = `
    <html>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Outfit:wght@600;800&display=swap" rel="stylesheet">
        <style>
          body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; background: transparent; width: 1280px; height: 720px; display: flex; align-items: center; overflow: hidden; }
          .content { padding: 80px 120px; max-width: 800px; }
          .glass-card { background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 32px; padding: 60px; color: white; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
          h1 { font-family: 'Outfit', sans-serif; font-size: 48px; font-weight: 800; margin: 0 0 24px 0; background: linear-gradient(to right, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          ul { list-style: none; padding: 0; margin: 0; }
          li { font-size: 24px; line-height: 1.4; margin-bottom: 16px; display: flex; align-items: flex-start; }
          li::before { content: "→"; color: #38bdf8; font-weight: bold; width: 30px; flex-shrink: 0; }
        </style>
      </head>
      <body>
        <div class="content">
          <div class="glass-card">
            <h1>${scene.title}</h1>
            <ul> ${scene.slide_bullets.map((b) => `<li>${b}</li>`).join('')} </ul>
          </div>
        </div>
      </body>
    </html>`;

    await page.setContent(html);
    const img = path.join(dir, `slide-${index}.png`);
    await page.screenshot({ path: img, omitBackground: true });
    return img;
  } finally {
    await browser.close();
  }
}

async function composeScene(background, overlay, avatar, audio, out, fallbacks) {
  console.log('[Compose] Scene args:', { bg: background, av: avatar });

  return new Promise(async (resolve, reject) => {
    const proc = ffmpeg();

    let bgExists = false;
    try {
      if (background) {
        const s = await fs.stat(background);
        if (s.size > 500) bgExists = true;
      }
    } catch (e) {}

    proc.input(bgExists ? background : fallbacks.bgPath).inputOptions('-loop 1');

    proc.input(overlay);

    let avatarExists = false;
    try {
      if (avatar) {
        const s = await fs.stat(avatar);
        if (s.size > 500) avatarExists = true;
      }
    } catch (e) {}

    proc.input(avatarExists ? avatar : fallbacks.fallbackAvatar).inputOptions('-loop 1');

    proc.input(audio);

    proc
      .complexFilter([
        '[0:v]scale=1280:720[bgv]',
        '[1:v]scale=1280:720[overv]',
        '[bgv][overv]overlay=0:0[combined]',
        avatarExists ? '[2:v]scale=350:350[av_scaled]' : '[2:v]scale=1:1[av_scaled]',
        avatarExists ? "[av_scaled]pad=iw+10:ih+10:5:5:color='#38bdf8'[av]" : '[av_scaled]copy[av]',
        '[combined][av]overlay=W-w-40:H-h-40[outv]',
      ])
      .outputOptions(['-map [outv]', '-map 3:a', '-c:v libx264', '-pix_fmt yuv420p', '-shortest'])
      .output(out)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

async function generateVideoForProcessedModule(processedModuleId) {
  console.log('[VIDEO WORKER] Generating video for processed_module_id:', processedModuleId);

  const { data: module, error } = await supabase
    .from('processed_modules')
    .select('processed_module_id, title, content, video_url, original_module_id')
    .eq('processed_module_id', processedModuleId)
    .maybeSingle();

  if (error) throw new Error(`Module fetch failed: ${error.message}`);
  if (!module) throw new Error('Module not found');
  if (module.video_url) {
    console.log('[VIDEO WORKER] Skipping; already has video_url:', module.video_url);
    return { ok: true, skipped: true, videoUrl: module.video_url };
  }

  const content = module.content || '';
  if (!content || content.trim().length < 50) {
    throw new Error('Module content is empty/too short; not generating video');
  }

  const scenes = await planScenes(content);

  const tmpDir = path.join(os.tmpdir(), `lucid-video-${uuid()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    console.log('[VIDEO] Preparing fallback assets...');
    const fallbacks = await renderFallbackAssets(tmpDir);

    console.log('[VIDEO] Generating AI instructor avatar...');
    const avatar = await generateAvatarImage(tmpDir);

    const sceneVideos = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const bg = path.join(tmpDir, `bg-${i}.png`);
      const audio = path.join(tmpDir, `audio-${i}.mp3`);
      const slide = await renderSlide(scene, i, tmpDir);

      console.log(`[VIDEO] Generating visual and audio for scene ${i + 1}/${scenes.length}`);
      await generateImagenImage(scene.visual_prompt, bg);
      await generateTTSAudio(scene.spoken_script, audio);

      const out = path.join(tmpDir, `scene-${i}.mp4`);
      await composeScene(bg, slide, avatar, audio, out, fallbacks);

      sceneVideos.push(out);
    }

    const listFile = path.join(tmpDir, 'scenes.txt');
    await fs.writeFile(
      listFile,
      sceneVideos.map((v) => `file '${v.replace(/\\/g, '/')}'`).join('\n')
    );

    const finalVideo = path.join(tmpDir, 'final.mp4');
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(listFile)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions(['-c copy'])
        .output(finalVideo)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const buffer = await fs.readFile(finalVideo);

    await ensureBucketExists();
    const uploadPath = `${module.processed_module_id}/${uuid()}_notebooklm_video.mp4`;

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(uploadPath, buffer, { contentType: 'video/mp4', upsert: true });

    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(uploadPath);
    const videoUrl = publicData?.publicUrl;

    if (!videoUrl) throw new Error('Failed to get public video URL');

    console.log('[VIDEO] Saving video URL to database:', videoUrl);

    const { error: updErr } = await supabase
      .from('processed_modules')
      .update({
        video_url: videoUrl,
        video_generated_at: new Date().toISOString(),
      })
      .eq('processed_module_id', module.processed_module_id);

    if (updErr) throw new Error(`DB update failed: ${updErr.message}`);

    return { ok: true, videoUrl };
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

async function generateModuleVideo({ moduleId = null, processedModuleId = null } = {}) {
  // If we got an original moduleId, generate videos for all processed_modules rows missing video_url.
  if (moduleId && !processedModuleId) {
    const { data: rows, error } = await supabase
      .from('processed_modules')
      .select('processed_module_id')
      .eq('original_module_id', moduleId)
      .is('video_url', null);

    if (error) throw new Error(`Processed module lookup failed: ${error.message}`);

    const ids = (rows || []).map((r) => r.processed_module_id).filter(Boolean);
    if (ids.length === 0) {
      return { ok: true, skipped: true, reason: 'No processed_modules missing video_url for this moduleId' };
    }

    for (const id of ids) {
      await generateVideoForProcessedModule(id);
    }

    return { ok: true, processedCount: ids.length };
  }

  if (processedModuleId) {
    return await generateVideoForProcessedModule(processedModuleId);
  }

  throw new Error('Missing moduleId or processedModuleId');
}

async function pollLoop() {
  console.log('[VIDEO WORKER] Polling for processed_modules missing video_url...');
  while (true) {
    try {
      const { data: row, error } = await supabase
        .from('processed_modules')
        .select('processed_module_id, content, video_url')
        .is('video_url', null)
        .not('content', 'is', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[VIDEO WORKER] poll error:', error);
      } else if (row?.processed_module_id && (row.content || '').trim().length >= 50) {
        await generateVideoForProcessedModule(row.processed_module_id);
      } else {
        console.log('[VIDEO WORKER] No eligible modules right now.');
      }
    } catch (e) {
      console.error('[VIDEO WORKER] loop error:', e);
    }

    await new Promise((r) => setTimeout(r, 10_000));
  }
}

module.exports = { generateModuleVideo, pollLoop };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--poll')) {
    pollLoop();
  } else {
    const idx = args.findIndex((a) => a === '--processed');
    const idx2 = args.findIndex((a) => a === '--module');
    const processedModuleId = idx >= 0 ? args[idx + 1] : null;
    const moduleId = idx2 >= 0 ? args[idx2 + 1] : null;

    generateModuleVideo({ moduleId, processedModuleId })
      .then((r) => {
        console.log('[VIDEO WORKER] done:', r);
        process.exit(0);
      })
      .catch((e) => {
        console.error('[VIDEO WORKER] failed:', e);
        process.exit(1);
      });
  }
}
