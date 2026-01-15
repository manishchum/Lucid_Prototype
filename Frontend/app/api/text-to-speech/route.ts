import { NextRequest, NextResponse } from "next/server";
import os from 'os';
import fs from 'fs';

const base64Key = process.env.GOOGLE_STT_JSON;
let serviceAccountCredentials: any = null;

if (base64Key) {
  try {
    const decoded = Buffer.from(base64Key, 'base64').toString('utf8');
    serviceAccountCredentials = JSON.parse(decoded);
    console.log('[TTS API] Decoded Google credentials from GOOGLE_STT_JSON');
  } catch (e) {
    console.error('[TTS API] Failed to decode Google credentials:', e);
  }
} else {
  console.warn('[TTS API] GOOGLE_STT_JSON not set.');
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
        { error: "Google Text-to-Speech credentials not configured" },
        { status: 500 }
      );
    }

    const { text } = await request.json();

    if (!text) {
      return NextResponse.json(
        { error: "No text provided" },
        { status: 400 }
      );
    }

    console.log("[Text-to-Speech] Converting text to speech...");
    console.log("[Text-to-Speech] Text length:", text.length);

    // Get OAuth2 access token
    const accessToken = await getAccessToken();

    // Use Google Cloud Text-to-Speech REST API
    const apiUrl = `https://texttospeech.googleapis.com/v1/text:synthesize`;
    
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        input: {
          text: text
        },
        voice: {
          languageCode: "en-US",
          name: "en-US-Neural2-F", // Female neural voice
          ssmlGender: "FEMALE"
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: 1.0,
          pitch: 0.0,
          volumeGainDb: 0.0
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Text-to-Speech] API error response:", response.status, errorText);
      
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
    console.log("[Text-to-Speech] API response received");

    // Extract audio content from response
    const audioContent = data.audioContent;

    if (!audioContent) {
      return NextResponse.json(
        { error: "No audio generated" },
        { status: 400 }
      );
    }

    // Return the base64 encoded audio
    return NextResponse.json({ 
      audio: audioContent,
      contentType: "audio/mp3"
    });
  } catch (err: any) {
    console.error("Text-to-speech error:", err);
    return NextResponse.json(
      { error: err.message || "Text-to-speech failed" },
      { status: 500 }
    );
  }
}
