import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    const realtimeModel = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";

    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expires_after: {
            anchor: "created_at",
            seconds: 600,
          },
          session: {
            type: "realtime",
            model: realtimeModel,
            output_modalities: ["audio"],
            audio: {
              input: {
                format: {
                  type: "audio/pcm",
                  rate: 24000,
                },
              },
              output: {
                format: {
                  type: "audio/pcm",
                  rate: 24000,
                },
                voice: "alloy",
              },
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("OpenAI token error:", error);
      return NextResponse.json(
        { error: "Failed to get Realtime client secret" },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      token: data.value,
      expires_at: data.expires_at,
    });
  } catch (error) {
    console.error("Realtime token error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}