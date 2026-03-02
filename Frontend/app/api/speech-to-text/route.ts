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
    console.log('[STT API] Decoded Google credentials from GOOGLE_STT_JSON and set GOOGLE_APPLICATION_CREDENTIALS');
  } catch (e) {
    console.error('[STT API] Failed to decode/write Google credentials:', e);
  }
} else {
  console.warn('[STT API] GOOGLE_STT_JSON not set.');
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

// Helper function to estimate audio duration
function estimateAudioDuration(audioSizeBytes: number, sampleRate: number = 48000): number {
  // More conservative estimate: WEBM OPUS compression varies
  // Real-world data: ~15KB/second average for speech
  const bytesPerSecond = 15000; 
  return audioSizeBytes / bytesPerSecond;
}

export async function POST(request: NextRequest) {
  try {
    if (!serviceAccountCredentials) {
      return NextResponse.json(
        { error: "Google Speech-to-Text credentials not configured" },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    // Convert audio to base64
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const base64Audio = buffer.toString("base64");

    const estimatedDuration = estimateAudioDuration(buffer.length);
    console.log("[Speech-to-Text] Sending request to Google Speech API...");
    console.log("[Speech-to-Text] Audio size:", buffer.length, "bytes");
    console.log("[Speech-to-Text] Estimated duration:", estimatedDuration.toFixed(1), "seconds");

    // Get OAuth2 access token
    const accessToken = await getAccessToken();

    // Use conservative threshold: if > 800KB or estimated > 55s, use long-running
    // Google's sync API has issues with anything close to 60s
    if (buffer.length > 800000 || estimatedDuration > 55) {
      console.log("[Speech-to-Text] Audio likely > 60s, using LongRunningRecognize...");
      return await handleLongAudioRecognition(buffer, base64Audio, accessToken);
    }


    console.log("Sending payload to the gemini");
    // console.log(base64Audio);
    console.log(audioFile);
    // Use sync API for audio under 60 seconds
    const apiUrl = `https://speech.googleapis.com/v1/speech:recognize`;
    console.log(apiUrl);
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        config: {
          encoding: "LINEAR16",  // WAV format for better transcription quality
          sampleRateHertz: 48000,
          languageCode: "en-US",
          enableAutomaticPunctuation: true,
          model: "default",
          useEnhanced: true,
        },
        audio: {
          content: base64Audio,
        },
      }),
    });


    console.log(response);
    console.log("Request sent, awaiting response...");

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Speech-to-Text] API error response:", response.status, errorText);
      
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }
      
      const errorMessage = errorData.error?.message || errorData.message || '';
      
      // If Google says "Sync input too long", automatically retry with LongRunningRecognize
      if (errorMessage.includes('Sync input too long') || errorMessage.includes('LongRunningRecognize')) {
        console.log('[Speech-to-Text] Sync API rejected - retrying with LongRunningRecognize...');
        return await handleLongAudioRecognition(buffer, base64Audio, accessToken);
      }
      
      throw new Error(errorMessage || `API returned ${response.status}`);
    }

    const data = await response.json();
    console.log("[Speech-to-Text] API response:", JSON.stringify(data, null, 2));

    // Extract transcript from response
    const transcript = data.results?.[0]?.alternatives?.[0]?.transcript;

    if (!transcript) {
      console.warn('[Speech-to-Text] No speech detected in audio');
      // Return 200 with empty text instead of 400 error
      // This allows the UI to handle silence gracefully
      return NextResponse.json({ 
        text: '',
        confidence: 0,
        warning: 'No speech detected in audio'
      });
    }

    return NextResponse.json({ text: transcript });
  } catch (err: any) {
    console.error("Speech-to-text error:", err);
    return NextResponse.json(
      { error: err.message || "Speech-to-text failed" },
      { status: 500 }
    );
  }
}

// Handle long audio recognition using LongRunningRecognize
async function handleLongAudioRecognition(
  buffer: Buffer,
  base64Audio: string,
  accessToken: string
): Promise<NextResponse> {
  try {
    console.log('[Speech-to-Text] Starting long-running recognition...');
    
    // Start long-running operation
    const longRunningUrl = `https://speech.googleapis.com/v1/speech:longrunningrecognize`;
    
    const startResponse = await fetch(longRunningUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        config: {
          encoding: 'WEBM_OPUS',
          sampleRateHertz: 48000,
          languageCode: 'en-US',
          enableAutomaticPunctuation: true,
        },
        audio: {
          content: base64Audio,
        },
      }),
    });

    if (!startResponse.ok) {
      const errorText = await startResponse.text();
      console.error('[Speech-to-Text] Long-running start error:', errorText);
      throw new Error(`Failed to start long-running recognition: ${startResponse.status}`);
    }

    const operationData = await startResponse.json();
    const operationName = operationData.name;
    console.log('[Speech-to-Text] Operation started:', operationName);

    // Poll for completion
    let attempts = 0;
    const maxAttempts = 60; // 60 attempts * 2 seconds = 2 minutes timeout
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      attempts++;

      const statusUrl = `https://speech.googleapis.com/v1/operations/${operationName}`;
      const statusResponse = await fetch(statusUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!statusResponse.ok) {
        console.error('[Speech-to-Text] Status check failed:', statusResponse.status);
        continue;
      }

      const statusData = await statusResponse.json();
      
      if (statusData.done) {
        console.log('[Speech-to-Text] Operation completed after', attempts, 'attempts');
        
        if (statusData.error) {
          throw new Error(statusData.error.message || 'Recognition failed');
        }

        const transcript = statusData.response?.results?.[0]?.alternatives?.[0]?.transcript;
        
        if (!transcript) {
          return NextResponse.json({
            text: '',
            confidence: 0,
            warning: 'No speech detected in audio',
          });
        }

        return NextResponse.json({ text: transcript });
      }
      
      console.log(`[Speech-to-Text] Still processing... (attempt ${attempts}/${maxAttempts})`);
    }

    // Timeout
    throw new Error('Recognition timed out after 2 minutes');
    
  } catch (error: any) {
    console.error('[Speech-to-Text] Long-running recognition error:', error);
    throw error;
  }
}
