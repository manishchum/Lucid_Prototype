import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    const formData = await request.formData();

    // Get audio file — look for "audio" key first, then any File in the form
    let audioFile = formData.get("audio") as File | null;

    if (!audioFile || !(audioFile instanceof File)) {
      for (const [, val] of formData.entries()) {
        if (val instanceof File) {
          audioFile = val;
          break;
        }
      }
    }

    if (!audioFile) {
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    console.log(
      `[STT] Received: name="${audioFile.name}", size=${(audioFile.size / 1024).toFixed(2)} KB, type="${audioFile.type}"`
    );

    if (audioFile.size < 1000) {
      return NextResponse.json(
        { error: "Audio file too small — likely no audio captured" },
        { status: 400 }
      );
    }

    // Read raw bytes and wrap as a proper File for the OpenAI SDK
    const arrayBuffer = await audioFile.arrayBuffer();
    const file = await toFile(Buffer.from(arrayBuffer), "audio.webm", {
      type: "audio/webm",
    });

    console.log(`[STT] Sending ${(arrayBuffer.byteLength / 1024).toFixed(2)} KB to gpt-4o-mini-transcribe...`);

    // Use OpenAI SDK — sends audio directly to transcription, no conversion
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
    });

    console.log("[STT] Transcription result:", transcription.text);

    if (!transcription.text || !transcription.text.trim()) {
      return NextResponse.json(
        { error: "No speech detected" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      text: transcription.text.trim(),
      processingMethod: "gpt-4o-mini-transcribe",
    });

  } catch (err: any) {
    console.error("[STT] Error:", err);
    return NextResponse.json(
      { error: err.message || "Transcription failed" },
      { status: 500 }
    );
  }
}