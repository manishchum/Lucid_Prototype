// import { NextResponse } from "next/server";

// // Helper function to check if file type is video or audio
// function isVideoOrAudio(fileType: string): boolean {
//   return fileType.includes("video/") || fileType.includes("audio/");
// }

// // Helper function to transcribe audio/video using Whisper
// async function transcribeMedia(fileUrl: string): Promise<string> {
//   // console.log("🎵 DEBUG: Transcribing media using Whisper...");
  
//   try {
//     const whisperResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/whisper`, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify({
//         audioUrl: fileUrl
//       })
//     });

//     if (!whisperResponse.ok) {
//       throw new Error(`Whisper API failed: ${whisperResponse.status}`);
//     }

//     const whisperData = await whisperResponse.json();
//     // console.log("🎵 DEBUG: Whisper transcription completed");
//     return whisperData.transcription;
//   } catch (error) {
//     console.error("🎵 DEBUG: Whisper transcription failed:", error);
//     throw error;
//   }
// }

// export async function POST(req: Request) {
//   // console.log("🔍 DEBUG: /api/extract-and-analyze called");

//   try {
//     const { fileUrl, fileType, moduleId } = await req.json();
//     // console.log("🔍 DEBUG: Received parameters:");
//     // console.log("🔍 DEBUG: fileUrl:", fileUrl);
//     // console.log("🔍 DEBUG: fileType:", fileType);
//     // console.log("🔍 DEBUG: moduleId:", moduleId);

//     let extractedText: string;

//     // Check if the file is video or audio - if so, use Whisper for transcription
//     if (isVideoOrAudio(fileType)) {
//       // console.log("🎵 DEBUG: Detected video/audio file, routing to Whisper...");
//       extractedText = await transcribeMedia(fileUrl);
//     } else {
//       // For other file types (PDF, DOCX, etc.), use mock text for now
//       // TODO: Implement proper text extraction for documents
//       // console.log("📄 DEBUG: Non-media file, using mock extraction...");
//       extractedText = `Mock extracted text for ${fileType} file at ${fileUrl}. In a production environment, this would extract actual text content from documents like PDFs, Word files, PowerPoint presentations, etc.`;
//     }

//     // console.log("✅ DEBUG: Text extraction completed successfully");
//     return NextResponse.json({ extractedText });
//   } catch (err) {
//     console.error("🔍 DEBUG: API error:", err);
//     return NextResponse.json({ 
//       error: "Extraction failed", 
//       detail: err instanceof Error ? err.message : String(err) 
//     }, { status: 500 });
//   }
// }
