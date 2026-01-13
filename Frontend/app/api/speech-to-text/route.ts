import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured" },
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

    // Convert audio → base64
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const base64Audio = buffer.toString("base64");

    console.log("[Gemini STT] Audio bytes:", buffer.length);

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash-001",
    });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "audio/webm",
          data: base64Audio,
        },
      },
      {
        text: "Transcribe this audio accurately into English text.",
      },
    ]);

    const transcript = result.response.text()?.trim();

    if (!transcript) {
      return NextResponse.json(
        { error: "No speech detected" },
        { status: 400 }
      );
    }

    return NextResponse.json({ text: transcript });
  } catch (err: any) {
    console.error("[Gemini STT Error]", err);
    return NextResponse.json(
      { error: err.message || "Speech-to-text failed" },
      { status: 500 }
    );
  }
}
