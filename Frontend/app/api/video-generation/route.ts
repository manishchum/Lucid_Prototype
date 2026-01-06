import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import os from 'os';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import ffmpeg from 'fluent-ffmpeg';
import textToSpeech from "@google-cloud/text-to-speech";

// CONFIGURATION
export const runtime = 'nodejs';
export const maxDuration = 300; 

// SUPABASE SETUP
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'module-visuals';
const admin = createClient(supabaseUrl, serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

// FFMPEG SETUP
try {
  const req: any = eval('require');
  try {
    const ffmpegStatic = req('ffmpeg-static');
    if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
  } catch (e) {}
  try {
    const ffprobeStatic = req('ffprobe-static');
    if (ffprobeStatic?.path) ffmpeg.setFfprobePath(ffprobeStatic.path);
  } catch (e) {}
} catch (e) {}

// --- HELPER FUNCTIONS ---

function cleanTextForVideo(text: string) {
  return text.replace(/[#*`>-]/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function splitTextIntoChunks(text: string, maxLen = 600) {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLen, text.length);
    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastPunct = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'));
      if (lastPunct > maxLen * 0.6) end = start + lastPunct + 1;
      else {
        const lastSpace = slice.lastIndexOf(' ');
        if (lastSpace > maxLen * 0.6) end = start + lastSpace;
      }
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = end;
  }
  return chunks;
}

// --- CORE SERVICES ---

async function generateExplanationScript(title: string, content: string) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) throw new Error('GEMINI_API_KEY not configured');

  const prompt = `You are an expert educator. Create a conversational 60-90 second video narration script based on:
  Title: ${title}
  Content: ${content.substring(0, 2000)}
   
  Requirements:
  - Engaging, simple language.
  - No scene directions (e.g., "Cut to black"), just the spoken text.
  - Return ONLY the raw text.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );

  const data = await response.json();
  if (!response.ok) throw new Error(`Gemini Script API error: ${JSON.stringify(data)}`);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

async function generateTTSAudio(script: string, outputPath: string) {
  const ttsClient = new textToSpeech.TextToSpeechClient({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS, 
  });

  const [response] = await ttsClient.synthesizeSpeech({
    input: { text: script },
    voice: { languageCode: "en-US", name: "en-US-Neural2-J" },
    audioConfig: { audioEncoding: "MP3", speakingRate: 1.0 },
  });

  if (!response.audioContent) throw new Error("No audio content returned from TTS");
  await fsPromises.writeFile(outputPath, response.audioContent as Buffer);
  return outputPath;
}

async function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

// --- GOOGLE IMAGEN GENERATION ---

/**
 * Downloads a fallback image if generation fails
 */
async function downloadPlaceholder(text: string, outputPath: string) {
    const cleanText = encodeURIComponent(text.substring(0, 30));
    const url = `https://placehold.co/1280x720/5533FF/FFFFFF.png?text=${cleanText}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to download placeholder");
    const buffer = await res.arrayBuffer();
    await fsPromises.writeFile(outputPath, Buffer.from(buffer));
}

/**
 * Generates an image using Google's Imagen model via the Gemini API Key.
 */
async function generateGoogleImage(prompt: string, outputPath: string) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) throw new Error("GEMINI_API_KEY is not set");

  // Endpoint for Imagen 3 (or compatible image generation model)
  // Note: Model availability varies by region/account. 
  // If 'imagen-3.0-generate-001' fails, try 'image-generation-001'
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${geminiApiKey}`;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [
          {
            prompt: `educational illustration, clear, vector art style, ${prompt}`,
          }
        ],
        parameters: {
          aspectRatio: "16:9",
          sampleCount: 1
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Imagen Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Google returns image as Base64 string in `predictions[0].bytesBase64Encoded`
    const base64Image = data.predictions?.[0]?.bytesBase64Encoded;
    
    if (!base64Image) {
        throw new Error("No image data returned in response");
    }

    // Save Base64 to file
    await fsPromises.writeFile(outputPath, Buffer.from(base64Image, 'base64'));
    return;

  } catch (error) {
    console.warn(`Imagen Gen Failed (${error}). Using Fallback.`);
    await downloadPlaceholder(prompt, outputPath);
  }
}

async function generateVisuals(title: string, chunks: string[], tmpDir: string) {
  const files: string[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    const imagePrompt = `${title}: ${chunkText.substring(0, 120)}`; 
    const fileName = path.join(tmpDir, `image-${i}.png`);
    
    console.log(`Generating image ${i + 1}/${chunks.length}...`);
    
    try {
      await generateGoogleImage(imagePrompt, fileName);
      files.push(fileName);
    } catch (error) {
      console.error(`CRITICAL: Image ${i} totally failed. Skipping.`);
      if (files.length > 0) files.push(files[files.length - 1]);
    }
  }

  // Ensure at least one file exists
  if (files.length === 0) {
      const fallbackFile = path.join(tmpDir, 'fallback.png');
      await downloadPlaceholder("Error", fallbackFile);
      files.push(fallbackFile);
  }
  
  return files;
}

// --- VIDEO ASSEMBLY ---

async function createSyncedVideo(imagePaths: string[], audioPath: string, outPath: string) {
  const audioDuration = await getAudioDuration(audioPath);
  const durationPerImage = (audioDuration / imagePaths.length);

  const listFile = path.join(path.dirname(outPath), 'images.txt');
  
  const listContent = imagePaths.map(p => `file '${p.replace(/\\/g, '/')}'\nduration ${durationPerImage.toFixed(2)}`).join('\n');
  const finalContent = listContent + `\nfile '${imagePaths[imagePaths.length - 1].replace(/\\/g, '/')}'\n`;
  
  await fsPromises.writeFile(listFile, finalContent);

  return new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .input(audioPath)
      .outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-shortest',
        '-vf', 'scale=1280:720'
      ])
      .output(outPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

// --- MAIN CONTROLLER ---

async function synthesizeAndStore(processedModuleId: string) {
  const { data: module } = await admin
    .from('processed_modules')
    .select('title, content')
    .eq('processed_module_id', processedModuleId)
    .single();

  if (!module) return { error: 'Module not found', status: 404 };

  const tmpDir = path.join(os.tmpdir(), `video-${processedModuleId}-${Date.now()}`);
  await fsPromises.mkdir(tmpDir, { recursive: true });

  try {
    // 1. Script
    const script = await generateExplanationScript(module.title, cleanTextForVideo(module.content));
    
    // 2. Audio
    const audioPath = path.join(tmpDir, 'audio.mp3');
    await generateTTSAudio(script, audioPath);

    // 3. Visuals (Google Imagen)
    const chunks = splitTextIntoChunks(script, 400); 
    const images = await generateVisuals(module.title, chunks, tmpDir);

    // 4. Video
    const videoPath = path.join(tmpDir, 'final.mp4');
    await createSyncedVideo(images, audioPath, videoPath);

    // 5. Upload
    const fileName = `videos/${processedModuleId}/${uuidv4()}.mp4`;
    const videoBuffer = await fsPromises.readFile(videoPath);
    
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(fileName, videoBuffer, { contentType: 'video/mp4', upsert: true });

    if (uploadError) throw new Error(uploadError.message);

    const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(fileName);

    await admin.from('processed_modules')
      .update({ video_url: publicUrl, video_generated_at: new Date().toISOString() })
      .eq('processed_module_id', processedModuleId);

    return { videoUrl: publicUrl };

  } catch (e: any) {
    console.error('Synthesis Error:', e);
    return { error: e.message, status: 500 };
  } finally {
    try { await fsPromises.rm(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
}

// --- API ROUTES ---

export async function POST(request: NextRequest) {
  const body = await request.json();
  const result = await synthesizeAndStore(body.processed_module_id);
  
  if ('error' in result) {
    return NextResponse.json(result, { status: result.status as number });
  }
  return NextResponse.json(result);
}