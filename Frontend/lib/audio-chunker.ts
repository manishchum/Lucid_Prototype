/**
 * Audio Chunker Utility
 * 
 * Provides bash-style asynchronous audio chunking for processing long recordings.
 * Splits audio into overlapping chunks to ensure no speech is lost at boundaries.
 */

export interface AudioChunk {
  blob: Blob;
  startTime: number;
  endTime: number;
  chunkIndex: number;
}

export interface ChunkingOptions {
  chunkDurationMs?: number;  // Duration of each chunk in milliseconds
  overlapMs?: number;         // Overlap between chunks to prevent speech cutoff
  maxChunks?: number;         // Maximum number of chunks to create
}

/**
 * Calculate optimal chunk parameters based on audio duration
 */
export function calculateChunkParams(audioDurationMs: number): ChunkingOptions {
  // For audio <= 60 seconds, no chunking needed
  if (audioDurationMs <= 60000) {
    return {
      chunkDurationMs: audioDurationMs,
      overlapMs: 0,
      maxChunks: 1
    };
  }

  // For longer audio, use 50-second chunks with 5-second overlap
  // This ensures we stay under the 60-second API limit with buffer
  return {
    chunkDurationMs: 50000,  // 50 seconds
    overlapMs: 5000,         // 5 second overlap to catch speech at boundaries
    maxChunks: Math.ceil(audioDurationMs / 45000) // 45s effective duration per chunk
  };
}

/**
 * Split audio blob into time-based chunks using Web Audio API
 * This is asynchronous and non-blocking (bash-style async)
 */
export async function splitAudioIntoChunks(
  audioBlob: Blob,
  options?: ChunkingOptions
): Promise<AudioChunk[]> {
  console.log('🔪 Starting audio chunking...');
  console.log('📦 Original audio size:', audioBlob.size, 'bytes');

  // Decode audio to get duration
  const audioContext = new AudioContext();
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  const durationMs = audioBuffer.duration * 1000;
  console.log('⏱️ Audio duration:', durationMs, 'ms', `(${Math.floor(durationMs / 1000)}s)`);

  // Calculate optimal chunking parameters
  const params = options || calculateChunkParams(durationMs);
  console.log('⚙️ Chunk parameters:', params);

  // If no chunking needed, return original blob
  if (params.maxChunks === 1) {
    console.log('✅ Audio under 60s, no chunking needed');
    await audioContext.close();
    return [{
      blob: audioBlob,
      startTime: 0,
      endTime: durationMs,
      chunkIndex: 0
    }];
  }

  const chunks: AudioChunk[] = [];
  const chunkDurationSec = (params.chunkDurationMs || 50000) / 1000;
  const overlapSec = (params.overlapMs || 5000) / 1000;
  const effectiveChunkDuration = chunkDurationSec - overlapSec;

  let currentTime = 0;
  let chunkIndex = 0;

  // Create chunks asynchronously
  while (currentTime < audioBuffer.duration) {
    const startTime = Math.max(0, currentTime);
    const endTime = Math.min(audioBuffer.duration, currentTime + chunkDurationSec);
    
    console.log(`✂️ Creating chunk ${chunkIndex + 1}: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s`);

    // Extract chunk from audio buffer
    const chunkDuration = endTime - startTime;
    const chunkLength = Math.ceil(chunkDuration * audioBuffer.sampleRate);
    const chunkBuffer = audioContext.createBuffer(
      audioBuffer.numberOfChannels,
      chunkLength,
      audioBuffer.sampleRate
    );

    // Copy audio data for this chunk
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const chunkData = chunkBuffer.getChannelData(channel);
      const startSample = Math.floor(startTime * audioBuffer.sampleRate);
      
      for (let i = 0; i < chunkLength; i++) {
        chunkData[i] = sourceData[startSample + i] || 0;
      }
    }

    // Convert chunk buffer to blob
    const chunkBlob = await audioBufferToBlob(chunkBuffer, audioBlob.type);
    
    chunks.push({
      blob: chunkBlob,
      startTime: startTime * 1000,
      endTime: endTime * 1000,
      chunkIndex: chunkIndex
    });

    console.log(`📦 Chunk ${chunkIndex + 1} size:`, chunkBlob.size, 'bytes');

    currentTime += effectiveChunkDuration;
    chunkIndex++;

    // Safety limit
    if (chunkIndex >= (params.maxChunks || 10)) {
      console.warn('⚠️ Reached max chunks limit');
      break;
    }
  }

  await audioContext.close();
  console.log(`✅ Created ${chunks.length} chunks for async processing`);
  
  return chunks;
}

/**
 * Convert AudioBuffer to Blob (for chunk creation)
 */
async function audioBufferToBlob(audioBuffer: AudioBuffer, mimeType: string): Promise<Blob> {
  // Create offline context for rendering
  const offlineContext = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );

  // Create buffer source
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start();

  // Render audio
  const renderedBuffer = await offlineContext.startRendering();

  // Convert to WAV format (more compatible than WebM for chunking)
  const wavBlob = audioBufferToWav(renderedBuffer);
  
  return wavBlob;
}

/**
 * Convert AudioBuffer to WAV Blob
 * WAV is uncompressed and better for precise chunking
 */
function audioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numberOfChannels * bytesPerSample;

  const dataLength = audioBuffer.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, format, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write audio data
  const channels: Float32Array[] = [];
  for (let i = 0; i < numberOfChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Merge transcription results from multiple chunks
 * Handles overlap by removing duplicate text at boundaries
 */
export function mergeTranscriptions(
  transcriptions: Array<{ text: string; chunkIndex: number }>,
  chunks: AudioChunk[]
): string {
  if (transcriptions.length === 0) return '';
  if (transcriptions.length === 1) return transcriptions[0].text;

  console.log('🔗 Merging', transcriptions.length, 'transcriptions...');

  // Sort by chunk index
  transcriptions.sort((a, b) => a.chunkIndex - b.chunkIndex);

  let merged = transcriptions[0].text;

  for (let i = 1; i < transcriptions.length; i++) {
    const current = transcriptions[i].text;
    const overlap = findOverlap(merged, current);

    if (overlap.length > 0) {
      // Remove overlapping portion from beginning of current text
      const uniquePart = current.slice(overlap.length).trim();
      merged = merged + ' ' + uniquePart;
      console.log(`🔗 Chunk ${i}: Found ${overlap.length} char overlap, merged unique part`);
    } else {
      // No overlap detected, just concatenate
      merged = merged + ' ' + current;
      console.log(`🔗 Chunk ${i}: No overlap, concatenated`);
    }
  }

  console.log('✅ Merged transcription length:', merged.length, 'characters');
  return merged.trim();
}

/**
 * Find overlapping text between end of text1 and beginning of text2
 */
function findOverlap(text1: string, text2: string): string {
  const words1 = text1.split(' ');
  const words2 = text2.split(' ');
  
  // Try to find overlap of at least 3 words
  const minOverlapWords = 3;
  const maxOverlapWords = Math.min(10, words1.length, words2.length);

  for (let overlapLen = maxOverlapWords; overlapLen >= minOverlapWords; overlapLen--) {
    const end1 = words1.slice(-overlapLen).join(' ').toLowerCase();
    const start2 = words2.slice(0, overlapLen).join(' ').toLowerCase();
    
    if (end1 === start2) {
      return words2.slice(0, overlapLen).join(' ');
    }
  }

  return '';
}
