// import { NextRequest, NextResponse } from "next/server";
// import { createClient } from "@supabase/supabase-js";
// import fs from "fs/promises";
// import path from "path";
// import os from "os";
// import { v4 as uuid } from "uuid";
// import puppeteer from "puppeteer";
// import ffmpeg from "fluent-ffmpeg";
// import textToSpeech from "@google-cloud/text-to-speech";

// /* ------------------------------------------------------------------ */
// /* NEXT CONFIG */
// /* ------------------------------------------------------------------ */
// export const runtime = "nodejs";
// export const dynamic = "force-dynamic";

// /* ------------------------------------------------------------------ */
// /* SUPABASE INIT */
// /* ------------------------------------------------------------------ */
// const supabase = createClient(
//   process.env.NEXT_PUBLIC_SUPABASE_URL!,
//   process.env.SUPABASE_SERVICE_ROLE_KEY!
// );

// const BUCKET = "module-visuals";

// /* ------------------------------------------------------------------ */
// /* GOOGLE CREDS INIT */
// /* ------------------------------------------------------------------ */
// const base64Key = process.env.GOOGLE_TTS_JSON;
// if (base64Key) {
//   try {
//     const decoded = Buffer.from(base64Key, "base64").toString("utf8");
//     const tempPath = os.tmpdir() + `/google-credentials-${Date.now()}.json`;

//     const fsSync = require("fs");
//     fsSync.writeFileSync(tempPath, decoded, { encoding: "utf8" });

//     process.env.GOOGLE_APPLICATION_CREDENTIALS = tempPath;
//     console.log("[VIDEO API] Google credentials loaded");
//   } catch (e) {
//     console.error("[VIDEO API] Failed to decode/write GOOGLE_TTS_JSON:", e);
//   }
// } else {
//   console.warn("[VIDEO API] GOOGLE_TTS_JSON not set.");
// }

// /* ------------------------------------------------------------------ */
// /* FFmpeg PATH RESOLUTION */
// /* ------------------------------------------------------------------ */
// try {
//   // eslint-disable-next-line no-eval
//   const req: any = eval("require");

//   try {
//     const ffmpegStatic = req("ffmpeg-static");
//     if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic as string);
//   } catch (e) {}

//   try {
//     const ffprobeStatic = req("ffprobe-static");
//     if (ffprobeStatic?.path) ffmpeg.setFfprobePath(ffprobeStatic.path);
//   } catch (e) {}
// } catch (e) {}

// /* ------------------------------------------------------------------ */
// /* HELPERS */
// /* ------------------------------------------------------------------ */
// async function ensureBucketExists() {
//   try {
//     const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
//     if (listErr) return { ok: false, error: `List buckets failed: ${listErr.message}` };

//     const exists = !!buckets?.find((b: any) => b.name === BUCKET);
//     if (exists) return { ok: true };

//     const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
//       public: true,
//       fileSizeLimit: "200MB",
//     });

//     if (createErr) return { ok: false, error: `Bucket create failed: ${createErr.message}` };
//     return { ok: true };
//   } catch (e: any) {
//     return { ok: false, error: e?.message || "Unknown error creating bucket" };
//   }
// }

// /* ------------------------------------------------------------------ */
// /* TYPES */
// /* ------------------------------------------------------------------ */
// type Scene = {
//   title: string;
//   spoken_script: string;
//   slide_bullets: string[];
//   visual_prompt: string;
// };

// /* ------------------------------------------------------------------ */
// /* 1. PLAN SCENES (OPENAI) */
// /* ------------------------------------------------------------------ */
// async function planScenes(content: string): Promise<Scene[]> {
//   const res = await fetch("https://api.openai.com/v1/chat/completions", {
//     method: "POST",
//     headers: {
//       Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
//       "Content-Type": "application/json",
//     },
//     body: JSON.stringify({
//       model: "gpt-4o",
//       temperature: 0.7,
//       messages: [
//         {
//           role: "system",
//           content:
//             "You are a master AI instructor specializing in NotebookLM-style deep dives. You synthesize complex information into engaging narratives.",
//         },
//         {
//           role: "user",
//           content: `
// Create a deep-dive, conversational instructor-led video script based on the modules provided.

// For each scene, provide:
// 1. title
// 2. spoken_script
// 3. slide_bullets (2-3 bullets)
// 4. visual_prompt (no text, no human faces)

// CRITICAL: Return JSON ONLY.
// [
//   {
//     "title": "...",
//     "spoken_script": "...",
//     "slide_bullets": ["...", "..."],
//     "visual_prompt": "..."
//   }
// ]

// CONTENT:
// ${content}
//           `,
//         },
//       ],
//     }),
//   });

//   if (!res.ok) throw new Error("OpenAI scene planning failed");

//   const json = await res.json();
//   const rawText = json.choices?.[0]?.message?.content || "";
//   const jsonMatch = rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);

//   if (!jsonMatch) throw new Error("No JSON array found from OpenAI response");

//   return JSON.parse(jsonMatch[0]);
// }

// /* ------------------------------------------------------------------ */
// /* 2. IMAGEN */
// /* ------------------------------------------------------------------ */
// async function generateImagenImage(prompt: string, outFile: string) {
//   try {
//     const key = process.env.GEMINI_API_KEY;
//     console.log(`[IMAGEN] Generating with prompt: ${prompt}`);

//     const res = await fetch(
//       `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${key}`,
//       {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           instances: [{ prompt }],
//           parameters: { sampleCount: 1, aspectRatio: "16:9" },
//         }),
//       }
//     );

//     if (!res.ok) {
//       const err = await res.text();
//       console.warn("[IMAGEN] failed:", res.status, err);
//       return;
//     }

//     const data = await res.json();

//     const base64 =
//       data.predictions?.[0]?.bytesBase64Encoded ||
//       data.images?.[0]?.base64 ||
//       data.output?.[0]?.base64 ||
//       (typeof data.predictions?.[0] === "string" ? data.predictions[0] : null);

//     if (!base64) throw new Error("No valid image data found in Imagen response");

//     await fs.writeFile(outFile, Buffer.from(base64, "base64"));
//     console.log(`[IMAGEN] Success: ${outFile}`);
//   } catch (e) {
//     console.error("[IMAGEN] generation error:", e);
//   }
// }

// /* ------------------------------------------------------------------ */
// /* FALLBACK ASSETS */
// /* ------------------------------------------------------------------ */
// async function renderFallbackAssets(dir: string) {
//   const bgPath = path.join(dir, "fallback-bg.png");

//   const browser = await puppeteer.launch({
//     headless: true,
//     args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
//   });

//   try {
//     const page = await browser.newPage();

//     // Background
//     await page.setViewport({ width: 1280, height: 720 });
//     await page.setContent(
//       `<body style="margin:0; background: linear-gradient(135deg, #f8fafc, #e2e8f0); width:1280px; height:720px;"></body>`
//     );
//     await page.screenshot({ path: bgPath });

//     // Transparent avatar fallback
//     await page.setViewport({ width: 1, height: 1 });
//     await page.setContent(`<body style="margin:0; background: transparent;"></body>`);
//     const fallbackAvatar = path.join(dir, "fallback-av.png");
//     await page.screenshot({ path: fallbackAvatar, omitBackground: true });

//     return { bgPath, fallbackAvatar };
//   } finally {
//     await browser.close();
//   }
// }

// async function generateAvatarImage(dir: string): Promise<string> {
//   const avatarPath = path.join(dir, "avatar.png");
//   await generateImagenImage(
//     "A professional, high-definition 3D render of a friendly AI instructor avatar, chest-up shot, wearing modern casual professional attire, soft studio lighting, solid neutral background",
//     avatarPath
//   );
//   return avatarPath;
// }

// /* ------------------------------------------------------------------ */
// /* GOOGLE TTS */
// /* ------------------------------------------------------------------ */
// async function generateTTSAudio(script: string, outFile: string): Promise<number> {
//   const ttsClient = new textToSpeech.TextToSpeechClient({
//     keyFilename:
//       process.env.GOOGLE_APPLICATION_CREDENTIALS || "./secrets/google-credentials.json",
//   });

//   const [response] = await ttsClient.synthesizeSpeech({
//     input: { text: script },
//     voice: { languageCode: "en-US", name: "en-US-Neural2-J" },
//     audioConfig: { audioEncoding: "MP3", speakingRate: 1.0 },
//   });

//   if (!response.audioContent) throw new Error("TTS failed");

//   await fs.writeFile(outFile, response.audioContent as Buffer);

//   return new Promise<number>((resolve) => {
//     ffmpeg.ffprobe(outFile, (err: any, data: any) => {
//       resolve(Number(data?.format?.duration ?? 5));
//     });
//   });
// }

// /* ------------------------------------------------------------------ */
// /* SLIDE RENDER */
// /* ------------------------------------------------------------------ */
// async function renderSlide(scene: Scene, index: number, dir: string): Promise<string> {
//   const browser = await puppeteer.launch({
//     headless: true,
//     args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
//   });

//   try {
//     const page = await browser.newPage();
//     await page.setViewport({ width: 1280, height: 720 });

//     const html = `
//     <html>
//       <head>
//         <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Outfit:wght@600;800&display=swap" rel="stylesheet">
//         <style>
//           body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; background: transparent; width: 1280px; height: 720px; display: flex; align-items: center; overflow: hidden; }
//           .content { padding: 80px 120px; max-width: 800px; }
//           .glass-card { background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 32px; padding: 60px; color: white; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
//           h1 { font-family: 'Outfit', sans-serif; font-size: 48px; font-weight: 800; margin: 0 0 24px 0; background: linear-gradient(to right, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
//           ul { list-style: none; padding: 0; margin: 0; }
//           li { font-size: 24px; line-height: 1.4; margin-bottom: 16px; display: flex; align-items: flex-start; }
//           li::before { content: "→"; color: #38bdf8; font-weight: bold; width: 30px; flex-shrink: 0; }
//         </style>
//       </head>
//       <body>
//         <div class="content">
//           <div class="glass-card">
//             <h1>${scene.title}</h1>
//             <ul> ${scene.slide_bullets.map((b) => `<li>${b}</li>`).join("")} </ul>
//           </div>
//         </div>
//       </body>
//     </html>`;

//     await page.setContent(html);
//     const img = path.join(dir, `slide-${index}.png`);
//     await page.screenshot({ path: img, omitBackground: true });
//     return img;
//   } finally {
//     await browser.close();
//   }
// }

// /* ------------------------------------------------------------------ */
// /* COMPOSE SCENE */
// /* ------------------------------------------------------------------ */
// async function composeScene(
//   background: string,
//   overlay: string,
//   avatar: string,
//   audio: string,
//   out: string,
//   fallbacks: { bgPath: string; fallbackAvatar: string }
// ) {
//   console.log("[Compose] Scene args:", { bg: background, av: avatar });

//   return new Promise<void>(async (resolve, reject) => {
//     const proc = ffmpeg();

//     let bgExists = false;
//     try {
//       if (background) {
//         const s = await fs.stat(background);
//         if (s.size > 500) bgExists = true;
//       }
//     } catch (e) {}

//     proc.input(bgExists ? background : fallbacks.bgPath).inputOptions("-loop 1");

//     proc.input(overlay);

//     let avatarExists = false;
//     try {
//       if (avatar) {
//         const s = await fs.stat(avatar);
//         if (s.size > 500) avatarExists = true;
//       }
//     } catch (e) {}

//     proc.input(avatarExists ? avatar : fallbacks.fallbackAvatar).inputOptions("-loop 1");

//     proc.input(audio);

//     proc.complexFilter([
//       "[0:v]scale=1280:720[bgv]",
//       "[1:v]scale=1280:720[overv]",
//       "[bgv][overv]overlay=0:0[combined]",
//       avatarExists ? "[2:v]scale=350:350[av_scaled]" : "[2:v]scale=1:1[av_scaled]",
//       avatarExists ? "[av_scaled]pad=iw+10:ih+10:5:5:color='#38bdf8'[av]" : "[av_scaled]copy[av]",
//       "[combined][av]overlay=W-w-40:H-h-40[outv]",
//     ])
//       .outputOptions([
//         "-map [outv]",
//         "-map 3:a",
//         "-c:v libx264",
//         "-pix_fmt yuv420p",
//         "-shortest",
//       ])
//       .output(out)
//       .on("end", resolve)
//       .on("error", reject)
//       .run();
//   });
// }

// /* ------------------------------------------------------------------ */
// /* MAIN VIDEO PIPELINE */
// /* ------------------------------------------------------------------ */
// async function generateVideo(processedModuleId: string): Promise<string> {
//   console.log("Processed_Module_id:-", processedModuleId);
//   let { data: module } = await supabase
//     .from("processed_modules")
//     .select("content, title, processed_module_id, created_at, original_module_id")
//     .eq("processed_module_id", processedModuleId)
//     .maybeSingle?.() as any;

//   // If maybeSingle is not present in your supabase-js version, fallback:
//   if (!module) {
//     const res = await supabase
//       .from("processed_modules")
//       .select("content, title, processed_module_id, created_at, original_module_id")
//       .eq("processed_module_id", processedModuleId)
//       .single();
//     module = res.data;
//   }

//   // fallback by original_module_id
//   if (!module) {
//     const { data: fallback } = await supabase
//       .from("processed_modules")
//       .select("content, title, processed_module_id, created_at, original_module_id")
//       .eq("original_module_id", processedModuleId)
//       .single();

//     module = fallback;
//   }

//   if (!module) throw new Error("Module not found");

//   const actualId = module.processed_module_id;

//   // Context
//   const { data: userModules } = await supabase
//     .from("processed_modules")
//     .select("title, content")
//     .eq("processed_module_id", actualId)
//     .order("created_at", { ascending: false })
//     .limit(3);

//   const context = userModules?.map((m: any) => `### ${m.title}\n${m.content}`).join("\n\n") || module.content;

//   const scenes = await planScenes(context);

//   const tmpDir = path.join(os.tmpdir(), `lucid-gen-${uuid()}`);
//   await fs.mkdir(tmpDir, { recursive: true });

//   console.log("[VIDEO] Preparing fallback assets...");
//   const fallbacks = await renderFallbackAssets(tmpDir);

//   console.log("[VIDEO] Generating AI instructor avatar...");
//   const avatar = await generateAvatarImage(tmpDir);

//   const sceneVideos: string[] = [];
//   let timeline = 0;

//   for (let i = 0; i < scenes.length; i++) {
//     const scene = scenes[i];
//     const bg = path.join(tmpDir, `bg-${i}.png`);
//     const audio = path.join(tmpDir, `audio-${i}.mp3`);
//     const slide = await renderSlide(scene, i, tmpDir);

//     console.log(`[VIDEO] Generating visual and audio for scene ${i + 1}/${scenes.length}`);
//     await generateImagenImage(scene.visual_prompt, bg);
//     const duration = await generateTTSAudio(scene.spoken_script, audio);

//     const out = path.join(tmpDir, `scene-${i}.mp4`);
//     await composeScene(bg, slide, avatar, audio, out, fallbacks);

//     sceneVideos.push(out);
//     timeline += duration;
//   }

//   const listFile = path.join(tmpDir, "scenes.txt");
//   await fs.writeFile(
//     listFile,
//     sceneVideos.map((v) => `file '${v.replace(/\\/g, "/")}'`).join("\n")
//   );

//   const finalVideo = path.join(tmpDir, "final.mp4");
//   await new Promise<void>((resolve, reject) => {
//     ffmpeg()
//       .input(listFile)
//       .inputOptions(["-f concat", "-safe 0"])
//       .outputOptions(["-c copy"])
//       .output(finalVideo)
//       .on("end", resolve)
//       .on("error", reject)
//       .run();
//   });

//   const buffer = await fs.readFile(finalVideo);

//   // Upload to Supabase
//   await ensureBucketExists();
//   const uploadPath = `${actualId}/${uuid()}_notebooklm_video.mp4`;

//   const { error: uploadErr } = await supabase.storage
//     .from(BUCKET)
//     .upload(uploadPath, buffer, { contentType: "video/mp4", upsert: true });

//   if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

//   const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(uploadPath);
//   const videoUrl = publicData?.publicUrl;

//   if (!videoUrl) throw new Error("Failed to get public video URL");

//   // Save URL in DB
//   console.log("[VIDEO] Saving video URL to database:", videoUrl);

//   await supabase
//     .from("processed_modules")
//     .update({
//       video_url: videoUrl,
//       video_generated_at: new Date().toISOString(),
//     })
//     .eq("processed_module_id", actualId);

//   // cleanup
//   try {
//     await fs.rm(tmpDir, { recursive: true, force: true });
//   } catch (e) {}

//   return videoUrl;
// }

// /* ------------------------------------------------------------------ */
// /* POST HANDLER (ONLY ENDPOINT YOU NEED) */
// /* ------------------------------------------------------------------ */
// export async function POST(req: NextRequest) {
//   console.log("[GPT-VIDEO] POST request received");
//   try {
//     const body = await req.json();

//     // ✅ supports BOTH keys
//     const moduleId = body.processed_module_id || body.module_id;
//     if (!moduleId) return NextResponse.json({ error: "Missing module ID" }, { status: 400 });

//     console.log("[GPT-VIDEO] Starting generation for:", moduleId);

//     const videoUrl = await generateVideo(moduleId);

//     return NextResponse.json({ videoUrl });
//   } catch (e: any) {
//     console.error("[GPT-VIDEO] Video generation failed:", e);
//     return NextResponse.json({ error: e?.message || "Generation failed" }, { status: 500 });
//   }
// }
