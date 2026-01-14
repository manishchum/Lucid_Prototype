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

    console.log("[Speech-to-Text] Sending request to Google Speech API...");
    console.log("[Speech-to-Text] Audio size:", buffer.length, "bytes");

    // Get OAuth2 access token
    const accessToken = await getAccessToken();

    // Use Google Cloud Speech-to-Text REST API with OAuth2 authentication
    const apiUrl = `https://speech.googleapis.com/v1/speech:recognize`;
    
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        config: {
          encoding: "WEBM_OPUS",
          sampleRateHertz: 48000,
          languageCode: "en-US",
          enableAutomaticPunctuation: true,
        },
        audio: {
          content: base64Audio,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Speech-to-Text] API error response:", response.status, errorText);
      
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }
      
      throw new Error(
        errorData.error?.message || 
        errorData.message || 
        `API returned ${response.status}`
      );
    }

    const data = await response.json();
    console.log("[Speech-to-Text] API response:", JSON.stringify(data, null, 2));

    // Extract transcript from response
    const transcript = data.results?.[0]?.alternatives?.[0]?.transcript;

    if (!transcript) {
      return NextResponse.json(
        { error: "No speech detected" },
        { status: 400 }
      );
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
