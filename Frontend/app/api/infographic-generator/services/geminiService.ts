
// import { GoogleGenerativeAI } from "@google/generative-ai";
// import { InfographicData } from '../types';

// const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY;

// console.log('[geminiService] API key configured:', !!apiKey);
// console.log('[geminiService] API key length:', apiKey?.length || 0);

// if (!apiKey) {
//   console.error('[geminiService] No API key found in environment variables');
//   throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY environment variable not set");
// }

// const genAI = new GoogleGenerativeAI(apiKey);

// export async function generateInfographicData(fileContent: string): Promise<InfographicData> {
//   const model = genAI.getGenerativeModel({ model: 'gemini-3-pro-preview' });
  
//   const systemPrompt = `You are an expert at creating professional infographics from educational content. 
// Your task is to analyze the provided content and structure it into a comprehensive visual infographic format.

// The infographic should have:
// 1. A main title that captures the essence of the content
// 2. Two primary sections with detailed points and sub-sections
// 3. A final section highlighting critical warnings or red flags

// Output ONLY valid JSON that follows this structure:
// {
//   "title": "Main title of infographic",
//   "sections": [
//     {
//       "title": "Section title",
//       "icon": "umbrella or clipboard",
//       "points": [
//         { "title": "Point title", "text": "Point description" }
//       ],
//       "subSections": [
//         {
//           "title": "Subsection title",
//           "icon": "person, property, or term",
//           "color": "blue, green, or yellow",
//           "points": [
//             { "title": "Detail title", "text": "Detail description" }
//           ]
//         }
//       ]
//     }
//   ],
//   "criticalFlags": {
//     "title": "Critical Red Flags or Key Warnings",
//     "flags": [
//       {
//         "title": "Flag title",
//         "icon": "mismatch, gauge, or legal",
//         "text": "Description of the warning",
//         "value": "Optional metric value like 65% or null"
//       }
//     ]
//   }
// }

// Keep all text concise and informative. Extract the most important information from the content.`;

//   const prompt = `${systemPrompt}\n\nDocument Content:\n---\n${fileContent}\n---`;

//   try {
//     console.log('[geminiService] Starting content generation...');
//     const result = await model.generateContent(prompt);
//     const response = await result.response;
//     const text = response.text();
    
//     console.log('[geminiService] Raw Gemini response length:', text.length);
//     console.log('[geminiService] Raw Gemini response preview:', text.slice(0, 1000));
    
//     // Extract JSON from response (handle markdown code blocks)
//     let jsonText = text.trim();
//     const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
//     if (jsonMatch) {
//       console.log('[geminiService] Found JSON in code block');
//       jsonText = jsonMatch[1].trim();
//     } else {
//       console.log('[geminiService] No code block found, extracting by braces');
//       // Try to find JSON object boundaries
//       const firstBrace = text.indexOf('{');
//       const lastBrace = text.lastIndexOf('}');
//       if (firstBrace !== -1 && lastBrace !== -1) {
//         jsonText = text.slice(firstBrace, lastBrace + 1);
//         console.log('[geminiService] Extracted JSON by braces, length:', jsonText.length);
//       }
//     }

//     console.log('[geminiService] JSON to parse preview:', jsonText.slice(0, 500));
//     const data = JSON.parse(jsonText);
//     console.log('[geminiService] Successfully parsed JSON');
//     return data as InfographicData;
//   } catch (error) {
//     console.error("[geminiService] Failed to parse Gemini response:", error);
//     console.error("[geminiService] Error details:", error instanceof Error ? error.message : String(error));
//     throw new Error("Could not parse the data from the AI model.");
//   }
// }
