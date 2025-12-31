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
      const { error: createErr } = await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: '50MB', allowedMimeTypes: ['audio/mpeg', 'audio/wav'] });
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

    // Prepare full cleaned text and chunk it if necessary
    const fullText = cleanTextForTTS(module.content || '');
    if (!fullText) throw new Error('Empty content for ' + processedModuleId);

    const maxChars = 4300;
    function splitTextIntoChunks(text, maxLen) {
      const chunks = [];
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

    function createWavBuffer(pcmBuffer, sampleRate = 24000, numChannels = 1, bytesPerSample = 2) {
      const blockAlign = numChannels * bytesPerSample;
      const byteRate = sampleRate * blockAlign;
      const header = Buffer.alloc(44);
      header.write('RIFF', 0);
      header.writeUInt32LE(36 + pcmBuffer.length, 4);
      header.write('WAVE', 8);
      header.write('fmt ', 12);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
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
    const pcmParts = [];
    for (const chunk of chunks) {
      const requestTTS = {
        input: { text: chunk },
        voice: { languageCode: 'en-IN', voiceName: 'en-IN-Chirp3-HD-Algenib', ssmlGender: 'MALE' },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 },
      };
      const [response] = await client.synthesizeSpeech(requestTTS);
      const audioContent = response.audioContent;
      if (!audioContent) throw new Error('TTS returned no audio for ' + processedModuleId);
      const buf = Buffer.isBuffer(audioContent) ? audioContent : Buffer.from(audioContent, 'base64');
      pcmParts.push(buf);
    }

    await ensureBucketExists();

    const pcm = Buffer.concat(pcmParts);
    const wav = createWavBuffer(pcm, 24000, 1, 2);

    const fileName = `module-audio/${processedModuleId}/${uuidv4()}.wav`;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(fileName, wav, {
      contentType: 'audio/wav',
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
    // console.log('Querying processed_modules missing audio...');
    const { data: rows, error } = await admin
      .from('processed_modules')
      .select('processed_module_id')
      .is('audio_url', null)
      .limit(100);
    if (error) throw error;
    if (!rows || rows.length === 0) {
      // console.log('No modules found without audio.');
      return;
    }

    // console.log(`Found ${rows.length} modules without audio. Starting synthesis...`);
    for (const r of rows) {
      const id = r.processed_module_id;
      try {
        // console.log('Synthesizing:', id);
        const url = await synthesizeAndStore(id);
        // console.log('Generated audio URL:', url);
      } catch (e) {
        console.error('Failed for', id, e.message || e);
      }
    }

    // console.log('Done.');
  } finally {
    try { fs.unlinkSync(tempPath); } catch (e) {}
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
