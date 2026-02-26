import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

const credentials = process.env.GOOGLE_STT_JSON
  ? JSON.parse(Buffer.from(process.env.GOOGLE_STT_JSON, "base64").toString())
  : null;

async function getAccessToken() {
  if (!credentials) throw new Error("Credentials missing");

  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("Failed to obtain token");

  return token.token;
}

export async function POST(req: NextRequest) {
  try {
    if (!credentials)
      return NextResponse.json(
        { error: "STT credentials missing" },
        { status: 500 }
      );

    const formData = await req.formData();
    const audio = formData.get("audio") as File;

    if (!audio)
      return NextResponse.json({ error: "No audio provided" }, { status: 400 });

    const buffer = Buffer.from(await audio.arrayBuffer());
    const base64Audio = buffer.toString("base64");

    const token = await getAccessToken();

    const response = await fetch(
      "https://speech.googleapis.com/v1/speech:recognize",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          config: {
            encoding: "WEBM_OPUS",
            sampleRateHertz: 48000,
            languageCode: "en-US",
            enableAutomaticPunctuation: true,
          },
          audio: { content: base64Audio },
        }),
      }
    );

    const data = await response.json();

    const transcript =
      data.results?.[0]?.alternatives?.[0]?.transcript || "";

    if (!transcript)
      return NextResponse.json(
        { error: "No speech detected" },
        { status: 400 }
      );

    return NextResponse.json({ text: transcript.trim() });

  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "STT failed" },
      { status: 500 }
    );
  }
}