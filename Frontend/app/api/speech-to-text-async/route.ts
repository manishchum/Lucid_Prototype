import { NextRequest, NextResponse } from "next/server";
import os from 'os';
import fs from 'fs';

const base64Key = process.env.GOOGLE_STT_JSON;
let credentialsPath: string | undefined;
let serviceAccountCredentials: any = null;

if (base64Key) {
  try {
    const decoded = Buffer.from(base64Key, 'base64').toString('utf8');
    serviceAccountCredentials = JSON.parse(decoded);
    const tempPath = os.tmpdir() + `/google-credentials-${Date.now()}.json`;
    fs.writeFileSync(tempPath, decoded, { encoding: 'utf8' });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tempPath;
    credentialsPath = tempPath;
    console.log('[Async STT API] Decoded Google credentials from GOOGLE_STT_JSON');
  } catch (e) {
    console.error('[Async STT API] Failed to decode/write Google credentials:', e);
  }
} else {
  console.warn('[Async STT API] GOOGLE_STT_JSON not set.');
}

// Helper function to get OAuth2 access token
async function getAccessToken() {
  if (!serviceAccountCredentials) {
    throw new Error('Service account credentials not loaded');
  }

  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({
    credentials: serviceAccountCredentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  
  if (!accessToken.token) {
    throw new Error('Failed to get access token');
  }

  return accessToken.token;
}

/**
 * Transcribe a single audio chunk
 */
async function transcribeChunk(
  audioBase64: string,
  chunkIndex: number,
  accessToken: string
): Promise<{ text: string; chunkIndex: number }> {
  console.log(`[Async STT] Transcribing chunk ${chunkIndex}...`);

  const apiUrl = `https://speech.googleapis.com/v1/speech:recognize`;
  
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      config: {
        encoding: "LINEAR16",  // WAV format
        sampleRateHertz: 48000,
        languageCode: "en-US",
        enableAutomaticPunctuation: true,
        model: "default",
        useEnhanced: true,
      },
      audio: {
        content: audioBase64,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Async STT] Chunk ${chunkIndex} error:`, response.status, errorText);
    throw new Error(`Chunk ${chunkIndex} transcription failed: ${response.status}`);
  }

  const data = await response.json();
  const transcript = data.results?.[0]?.alternatives?.[0]?.transcript || '';
  
  console.log(`[Async STT] ✅ Chunk ${chunkIndex} transcribed:`, transcript.substring(0, 50) + '...');
  
  return {
    text: transcript,
    chunkIndex: chunkIndex
  };
}

/**
 * POST endpoint for asynchronous transcription
 * Accepts multiple audio chunks and processes them in parallel
 */
export async function POST(request: NextRequest) {
  try {
    if (!serviceAccountCredentials) {
      return NextResponse.json(
        { error: "Google Speech-to-Text credentials not configured" },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    
    // Check if this is a chunked request
    const isChunked = formData.has('chunkCount');
    
    if (!isChunked) {
      // Single audio file - process normally
      const audioFile = formData.get("audio") as File;
      if (!audioFile) {
        return NextResponse.json(
          { error: "No audio file provided" },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await audioFile.arrayBuffer());
      const base64Audio = buffer.toString("base64");
      const accessToken = await getAccessToken();

      console.log("[Async STT] Processing single audio file...");
      const result = await transcribeChunk(base64Audio, 0, accessToken);

      if (!result.text) {
        return NextResponse.json(
          { error: "No speech detected" },
          { status: 400 }
        );
      }

      return NextResponse.json({ text: result.text });
    }

    // Chunked request - process multiple chunks in parallel
    const chunkCount = parseInt(formData.get('chunkCount') as string);
    console.log(`[Async STT] 🎯 Processing ${chunkCount} chunks asynchronously...`);

    // Collect all chunks
    const chunks: Array<{ blob: Blob; index: number }> = [];
    for (let i = 0; i < chunkCount; i++) {
      const chunkBlob = formData.get(`chunk_${i}`) as File;
      if (chunkBlob) {
        chunks.push({ blob: chunkBlob, index: i });
      }
    }

    if (chunks.length === 0) {
      return NextResponse.json(
        { error: "No audio chunks provided" },
        { status: 400 }
      );
    }

    console.log(`[Async STT] Collected ${chunks.length} chunks`);

    // Get access token once for all requests
    const accessToken = await getAccessToken();

    // Process all chunks in parallel (bash-style async)
    console.log('[Async STT] 🚀 Starting parallel transcription...');
    const transcriptionPromises = chunks.map(async (chunk) => {
      const buffer = Buffer.from(await chunk.blob.arrayBuffer());
      const base64Audio = buffer.toString("base64");
      return transcribeChunk(base64Audio, chunk.index, accessToken);
    });

    // Wait for all transcriptions to complete
    const transcriptions = await Promise.all(transcriptionPromises);
    console.log('[Async STT] ✅ All chunks transcribed');

    // Sort by chunk index
    transcriptions.sort((a, b) => a.chunkIndex - b.chunkIndex);

    // Merge transcriptions with overlap handling
    const mergedText = mergeTranscriptions(transcriptions);

    if (!mergedText) {
      return NextResponse.json(
        { error: "No speech detected in audio" },
        { status: 400 }
      );
    }

    console.log('[Async STT] ✅ Final transcription length:', mergedText.length, 'characters');

    return NextResponse.json({ 
      text: mergedText,
      chunkCount: transcriptions.length,
      processingMethod: 'async-parallel'
    });

  } catch (err: any) {
    console.error("[Async STT] Error:", err);
    return NextResponse.json(
      { error: err.message || "Async transcription failed" },
      { status: 500 }
    );
  }
}

/**
 * Merge transcriptions from multiple chunks
 * Handles overlap by removing duplicate text at boundaries
 */
function mergeTranscriptions(
  transcriptions: Array<{ text: string; chunkIndex: number }>
): string {
  if (transcriptions.length === 0) return '';
  if (transcriptions.length === 1) return transcriptions[0].text;

  console.log('[Async STT] 🔗 Merging', transcriptions.length, 'transcriptions...');

  let merged = transcriptions[0].text;

  for (let i = 1; i < transcriptions.length; i++) {
    const current = transcriptions[i].text;
    
    // Try to find overlap between end of merged and beginning of current
    const overlap = findOverlap(merged, current);

    if (overlap.length > 0) {
      // Remove overlapping portion from beginning of current text
      const uniquePart = current.slice(overlap.length).trim();
      merged = merged + ' ' + uniquePart;
      console.log(`[Async STT] 🔗 Chunk ${i}: Found ${overlap.length} char overlap`);
    } else {
      // No overlap detected, just concatenate
      merged = merged + ' ' + current;
      console.log(`[Async STT] 🔗 Chunk ${i}: No overlap, concatenated`);
    }
  }

  return merged.trim();
}

/**
 * Find overlapping text between end of text1 and beginning of text2
 */
function findOverlap(text1: string, text2: string): string {
  const words1 = text1.trim().split(/\s+/);
  const words2 = text2.trim().split(/\s+/);
  
  // Try to find overlap of at least 2 words
  const minOverlapWords = 2;
  const maxOverlapWords = Math.min(8, words1.length, words2.length);

  for (let overlapLen = maxOverlapWords; overlapLen >= minOverlapWords; overlapLen--) {
    const end1 = words1.slice(-overlapLen).join(' ').toLowerCase();
    const start2 = words2.slice(0, overlapLen).join(' ').toLowerCase();
    
    if (end1 === start2) {
      return words2.slice(0, overlapLen).join(' ');
    }
  }

  return '';
}
