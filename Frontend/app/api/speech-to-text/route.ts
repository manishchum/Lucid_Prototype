// import { NextRequest, NextResponse } from "next/server";
// import { GoogleAuth } from "google-auth-library";

// /* ======================================================
//    🔐 Load Service Account Credentials (Base64)
//    ====================================================== */

// const credentials = process.env.GOOGLE_STT_JSON
//   ? JSON.parse(
//       Buffer.from(process.env.GOOGLE_STT_JSON, "base64").toString("utf8")
//     )
//   : null;

// /* ======================================================
//    🔑 Get OAuth2 Access Token
//    ====================================================== */

// async function getAccessToken(): Promise<string> {
//   if (!credentials) {
//     throw new Error("Google STT credentials not configured");
//   }

//   const auth = new GoogleAuth({
//     credentials,
//     scopes: ["https://www.googleapis.com/auth/cloud-platform"],
//   });

//   const client = await auth.getClient();
//   const token = await client.getAccessToken();

//   if (!token.token) {
//     throw new Error("Failed to obtain Google access token");
//   }

//   return token.token;
// }

// /* ======================================================
//    🎙 Transcribe Single Chunk
//    ====================================================== */

// async function transcribeChunk(
//   base64Audio: string,
//   chunkIndex: number,
//   accessToken: string
// ): Promise<{ text: string; chunkIndex: number }> {
//   const response = await fetch(
//     "https://speech.googleapis.com/v1/speech:longrunningrecognize",
//     {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${accessToken}`,
//       },
//       body: JSON.stringify({
//         config: {
//           encoding: "WEBM_OPUS", // must match frontend
//           sampleRateHertz: 48000,
//           languageCode: "en-US",
//           enableAutomaticPunctuation: true,
//         },
//         audio: {
//           content: base64Audio,
//         },
//       }),
//     }
//   );

//   if (!response.ok) {
//     const errorText = await response.text();
//     throw new Error(
//       `Chunk ${chunkIndex} transcription failed (${response.status}): ${errorText}`
//     );
//   }

//   const data = await response.json();
//   const operationName = data.name;

//   if (!operationName) {
//     throw new Error(`Chunk ${chunkIndex} failed to start operation`);
//   }

//   // Poll until done
//   const operationUrl = `https://speech.googleapis.com/v1/operations/${operationName}`;

//   let attempts = 0;
//   const maxAttempts = 30; // ~30 seconds
//   const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

//   while (attempts < maxAttempts) {
//     await delay(1000);
//     attempts++;

//     const pollResponse = await fetch(operationUrl, {
//       headers: {
//         Authorization: `Bearer ${accessToken}`,
//       },
//     });

//     const pollData = await pollResponse.json();

//     if (pollData.done) {
//       if (pollData.error) {
//         throw new Error(
//           `Chunk ${chunkIndex} operation error: ${JSON.stringify(pollData.error)}`
//         );
//       }

//  const transcript =
//         pollData.response?.results
//           ?.map((r: any) => r.alternatives?.[0]?.transcript || "")
//           .join(" ") || "";

//       return {
//         text: transcript.trim(),
//         chunkIndex,
//       };
//     }
//   }

//   throw new Error(`Chunk ${chunkIndex} transcription timeout`);
// }

// /* ======================================================
//    🔗 Merge Chunk Transcriptions
//    ====================================================== */

// function mergeTranscriptions(
//   transcriptions: Array<{ text: string; chunkIndex: number }>
// ): string {
//   if (transcriptions.length === 0) return "";
//   if (transcriptions.length === 1) return transcriptions[0].text;

//   // Sort by chunk index
//   transcriptions.sort((a, b) => a.chunkIndex - b.chunkIndex);

//   let merged = transcriptions[0].text;

//   for (let i = 1; i < transcriptions.length; i++) {
//     const current = transcriptions[i].text;

//     const overlap = findOverlap(merged, current);

//     if (overlap.length > 0) {
//       const uniquePart = current.slice(overlap.length).trim();
//       merged = `${merged} ${uniquePart}`;
//     } else {
//       merged = `${merged} ${current}`;
//     }
//   }

//   return merged.trim();
// }

// function normalize(text: string): string {
//   return text
//     .toLowerCase()
//     .replace(/[.,!?]/g, "")
//     .trim();
// }

// function findOverlap(text1: string, text2: string): string {
//   const words1 = normalize(text1).split(/\s+/);
//   const words2 = normalize(text2).split(/\s+/);

//   const minOverlapWords = 2;
//   const maxOverlapWords = Math.min(8, words1.length, words2.length);

//   for (let overlapLen = maxOverlapWords; overlapLen >= minOverlapWords; overlapLen--) {
//     const end1 = words1.slice(-overlapLen).join(" ");
//     const start2 = words2.slice(0, overlapLen).join(" ");

//     if (end1 === start2) {
//       return words2.slice(0, overlapLen).join(" ");
//     }
//   }

//   return "";
// }

// /* ======================================================
//    🚀 Main POST Handler
//    ====================================================== */

// export async function POST(request: NextRequest) {
//   try {
//     if (!credentials) {
//       return NextResponse.json(
//         { error: "Google Speech-to-Text credentials not configured" },
//         { status: 500 }
//       );
//     }

//     const formData = await request.formData();

//     const isChunked = formData.has("chunkCount");

//     const accessToken = await getAccessToken();

//     /* --------------------------------------------
//        🟢 SINGLE AUDIO FILE
//        -------------------------------------------- */

//     if (!isChunked) {
//       const audioFile = formData.get("audio") as File;

//       if (!audioFile) {
//         return NextResponse.json(
//           { error: "No audio file provided" },
//           { status: 400 }
//         );
//       }

//       const buffer = Buffer.from(await audioFile.arrayBuffer());
//       const base64Audio = buffer.toString("base64");

//       const result = await transcribeChunk(base64Audio, 0, accessToken);

//       if (!result.text) {
//         return NextResponse.json(
//           { error: "No speech detected" },
//           { status: 400 }
//         );
//       }

//       return NextResponse.json({
//         text: result.text,
//         processingMethod: "single",
//       });
//     }

//     /* --------------------------------------------
//        🟢 CHUNKED AUDIO (Parallel)
//        -------------------------------------------- */

//     const chunkCount = parseInt(formData.get("chunkCount") as string, 10);

//     if (!chunkCount || chunkCount <= 0) {
//       return NextResponse.json(
//         { error: "Invalid chunk count" },
//         { status: 400 }
//       );
//     }

//     const chunks: Array<{ blob: File; index: number }> = [];

//     for (let i = 0; i < chunkCount; i++) {
//       const chunkBlob = formData.get(`chunk_${i}`) as File;
//       if (chunkBlob) {
//         chunks.push({ blob: chunkBlob, index: i });
//       }
//     }

//     if (chunks.length === 0) {
//       return NextResponse.json(
//         { error: "No audio chunks provided" },
//         { status: 400 }
//       );
//     }

//     const transcriptionPromises = chunks.map(async (chunk) => {
//       const buffer = Buffer.from(await chunk.blob.arrayBuffer());
//       const base64Audio = buffer.toString("base64");

//       return transcribeChunk(base64Audio, chunk.index, accessToken);
//     });

//     const transcriptions = await Promise.all(transcriptionPromises);

//     const mergedText = mergeTranscriptions(transcriptions);

//     if (!mergedText) {
//       return NextResponse.json(
//         { error: "No speech detected in audio" },
//         { status: 400 }
//       );
//     }

//     return NextResponse.json({
//       text: mergedText,
//       chunkCount: transcriptions.length,
//       processingMethod: "async-parallel",
//     });

//   } catch (err: any) {
//     console.error("[Async STT] Error:", err);

//     return NextResponse.json(
//       { error: err.message || "Async transcription failed" },
//       { status: 500 }
//     );
//   }
// }