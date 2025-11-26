#!/usr/bin/env node
/**
 * Script to generate TTS audio for processed_modules missing audio_url.
 * Usage:
 *   cd Frontend
 *   node scripts/generate_missing_audio.js
 *
 * Required env vars (set in your shell or .env):
 *  - NEXT_PUBLIC_SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - GOOGLE_TTS_JSON (base64-encoded service account JSON)
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const textToSpeech = require('@google-cloud/text-to-speech');
const { v4: uuidv4 } = require('uuid');

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const base64Key = process.env.GOOGLE_TTS_JSON;

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  if (!base64Key) {
    console.error('Missing GOOGLE_TTS_JSON (base64). Set it to your service account JSON encoded in base64.');
    process.exit(1);
  }

  // Write Google credentials to temp file
  const decoded = Buffer.from(base64Key, 'base64').toString('utf8');
  const tempPath = path.join(os.tmpdir(), `google-tts-creds-${Date.now()}.json`);
  fs.writeFileSync(tempPath, decoded, { encoding: 'utf8' });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tempPath;

  const admin = createClient(supabaseUrl, serviceKey);
  const client = new textToSpeech.TextToSpeechClient();
  const BUCKET = 'module_audio';

  async function ensureBucketExists() {
    try {
      const { data: buckets, error: listErr } = await admin.storage.listBuckets();
      if (listErr) throw new Error(listErr.message);
      const exists = !!buckets?.find(b => b.name === BUCKET);
      if (exists) return;
      const { error: createErr } = await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: '50MB', allowedMimeTypes: ['audio/mpeg'] });
      if (createErr) throw new Error(createErr.message);
    } catch (e) {
      throw new Error('Failed to ensure bucket: ' + e.message);
    }
  }

  function cleanTextForTTS(text) {
    return (text || '')
      .replace(/[#*`>-]/g, '')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  async function synthesizeAndStore(processedModuleId) {
    const { data: module, error: moduleError } = await admin
      .from('processed_modules')
      .select('processed_module_id, title, content')
      .eq('processed_module_id', processedModuleId)
      .maybeSingle();
    if (moduleError || !module) {
      throw new Error(moduleError?.message || 'Module not found: ' + processedModuleId);
    }

    const maxChars = 4500;
    const text = cleanTextForTTS((module.content || '').slice(0, maxChars));
    if (!text) throw new Error('Empty content for ' + processedModuleId);

    const requestTTS = {
      input: { text },
      voice: { languageCode: 'en-IN', voiceName: 'en-IN-Chirp3-HD-Algenib', ssmlGender: 'MALE' },
      audioConfig: { audioEncoding: 'MP3' },
    };

    const [response] = await client.synthesizeSpeech(requestTTS);
    const audioContent = response.audioContent;
    if (!audioContent) throw new Error('TTS returned no audio for ' + processedModuleId);

    await ensureBucketExists();

    const fileName = `module-audio/${processedModuleId}/${uuidv4()}.mp3`;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(fileName, Buffer.from(audioContent), {
      contentType: 'audio/mpeg',
      upsert: true,
    });
    if (uploadError) throw new Error('Upload failed: ' + uploadError.message);

    const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(fileName);
    const audioUrl = publicUrlData?.publicUrl;

    const { error: updateErr } = await admin.from('processed_modules').update({ audio_url: audioUrl, audio_generated_at: new Date().toISOString() }).eq('processed_module_id', processedModuleId);
    if (updateErr) throw new Error('DB update failed: ' + updateErr.message);

    return audioUrl;
  }

  try {
    console.log('Querying processed_modules missing audio...');
    const { data: rows, error } = await admin
      .from('processed_modules')
      .select('processed_module_id')
      .is('audio_url', null)
      .limit(100);
    if (error) throw error;
    if (!rows || rows.length === 0) {
      console.log('No modules found without audio.');
      return;
    }

    console.log(`Found ${rows.length} modules without audio. Starting synthesis...`);
    for (const r of rows) {
      const id = r.processed_module_id;
      try {
        console.log('Synthesizing:', id);
        const url = await synthesizeAndStore(id);
        console.log('Generated audio URL:', url);
      } catch (e) {
        console.error('Failed for', id, e.message || e);
      }
    }

    console.log('Done.');
  } finally {
    try { fs.unlinkSync(tempPath); } catch (e) {}
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
