
// import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type, Chat, GenerateContentResponse } from "@google/genai";
// import { AssessmentReport, Message } from '../types';

// let nextStartTime = 0;
// let outputAudioContext: AudioContext | null = null;
// let inputAudioContext: AudioContext | null = null;
// let currentSession: { sessionPromise: Promise<Awaited<ReturnType<GoogleGenAI['live']['connect']>>>, close: () => void } | null = null;
// const sources = new Set<AudioBufferSourceNode>();

// // Helper functions for audio encoding/decoding
// function decode(base64: string) {
//   const binaryString = atob(base64);
//   const len = binaryString.length;
//   const bytes = new Uint8Array(len);
//   for (let i = 0; i < len; i++) {
//     bytes[i] = binaryString.charCodeAt(i);
//   }
//   return bytes;
// }

// async function decodeAudioData(
//   data: Uint8Array,
//   ctx: AudioContext,
//   sampleRate: number,
//   numChannels: number,
// ): Promise<AudioBuffer> {
//   const dataInt16 = new Int16Array(data.buffer);
//   const frameCount = dataInt16.length / numChannels;
//   const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

//   for (let channel = 0; channel < numChannels; channel++) {
//     const channelData = buffer.getChannelData(channel);
//     for (let i = 0; i < frameCount; i++) {
//       channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
//     }
//   }
//   return buffer;
// }

// function encode(bytes: Uint8Array) {
//   let binary = '';
//   const len = bytes.byteLength;
//   for (let i = 0; i < len; i++) {
//     binary += String.fromCharCode(bytes[i]);
//   }
//   return btoa(binary);
// }

// function createBlob(data: Float32Array): { data: string; mimeType: string } {
//   const l = data.length;
//   const int16 = new Int16Array(l);
//   for (let i = 0; i < l; i++) {
//     int16[i] = data[i] * 32768;
//   }
//   return {
//     data: encode(new Uint8Array(int16.buffer)),
//     mimeType: 'audio/pcm;rate=16000',
//   };
// }

// export const startLiveRolePlay = async (
//   onAvatarMessage: (message: string) => void,
//   onUserTranscription: (text: string) => void,
//   onAvatarTranscription: (text: string) => void,
//   onClose: (error?: Error) => void,
//   initialPrompt: string,
//   role: string
// ) => {
//   try {
//     const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

//     inputAudioContext = new window.AudioContext({ sampleRate: 16000 });
//     outputAudioContext = new window.AudioContext({ sampleRate: 24000 });
    
//     // Request microphone access
//     const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
//     const sessionPromise = ai.live.connect({
//       model: 'gemini-2.5-flash-native-audio-preview-12-2025',
//       callbacks: {
//         onopen: async (session) => {
//           console.debug('Live session opened.');
//           const source = inputAudioContext!.createMediaStreamSource(stream);
//           const scriptProcessor = inputAudioContext!.createScriptProcessor(4096, 1, 1);

//           scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
//             const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
//             const pcmBlob = createBlob(inputData);
//             // FIX: Use sessionPromise.then to ensure session is resolved before sending.
//             sessionPromise.then((resolvedSession) => {
//               resolvedSession.sendRealtimeInput({ media: pcmBlob });
//             });
//           };
//           source.connect(scriptProcessor);
//           scriptProcessor.connect(inputAudioContext!.destination);

//           // Send the initial prompt to kick off the conversation
//           session.sendRealtimeInput({ message: initialPrompt });
//         },
//         onmessage: async (message: LiveServerMessage) => {
//           if (message.serverContent?.outputTranscription) {
//             onAvatarTranscription(message.serverContent.outputTranscription.text);
//           }
//           if (message.serverContent?.inputTranscription) {
//             onUserTranscription(message.serverContent.inputTranscription.text);
//           }
          
//           const base64EncodedAudioString = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
//           if (base64EncodedAudioString && outputAudioContext) {
//             nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
//             const audioBuffer = await decodeAudioData(
//               decode(base64EncodedAudioString),
//               outputAudioContext,
//               24000,
//               1,
//             );
//             const source = outputAudioContext.createBufferSource();
//             source.buffer = audioBuffer;
//             source.connect(outputAudioContext.destination);
//             source.addEventListener('ended', () => {
//               sources.delete(source);
//             });

//             source.start(nextStartTime);
//             nextStartTime = nextStartTime + audioBuffer.duration;
//             sources.add(source);
//             onAvatarMessage(''); // Signal that avatar is speaking (or just finished)
//           }

//           const interrupted = message.serverContent?.interrupted;
//           if (interrupted) {
//             for (const source of sources.values()) {
//               source.stop();
//               sources.delete(source);
//             }
//             nextStartTime = 0;
//           }
//         },
//         onerror: (e: ErrorEvent) => {
//           console.error('Live session error:', e);
//           onClose(e.error);
//         },
//         onclose: (e: CloseEvent) => {
//           console.debug('Live session closed:', e);
//           if (!e.wasClean) {
//             onClose(new Error(`WebSocket closed unexpectedly with code ${e.code}: ${e.reason}`));
//           } else {
//             onClose();
//           }
//         },
//       },
//       config: {
//         responseModalities: [Modality.AUDIO],
//         speechConfig: {
//           voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }, // Zephyr for a clear voice
//         },
//         systemInstruction: `You are playing the role of a ${role}. Your goal is to react naturally to the user's input, stay in character, and push the conversation towards the core business challenge. Be concise and realistic.`,
//         inputAudioTranscription: {},
//         outputAudioTranscription: {},
//       },
//     });

//     currentSession = {
//       sessionPromise: Promise.resolve(sessionPromise),
//       close: () => {
//         sessionPromise.then(session => session.close());
//         if (inputAudioContext) inputAudioContext.close();
//         if (outputAudioContext) outputAudioContext.close();
//         currentSession = null;
//       }
//     };

//     return sessionPromise;

//   } catch (error) {
//     console.error("Error starting live role-play:", error);
//     onClose(error as Error);
//     throw error;
//   }
// };

// export const stopLiveRolePlay = () => {
//   if (currentSession) {
//     currentSession.close();
//     currentSession = null;
//   }
//   for (const source of sources.values()) {
//     source.stop();
//     sources.delete(source);
//   }
//   nextStartTime = 0;
//   if (inputAudioContext && inputAudioContext.state !== 'closed') {
//     inputAudioContext.close();
//   }
//   if (outputAudioContext && outputAudioContext.state !== 'closed') {
//     outputAudioContext.close();
//   }
//   inputAudioContext = null;
//   outputAudioContext = null;
// };

// export const generateAssessmentReport = async (conversationHistory: Message[], scenarioTitle: string): Promise<AssessmentReport> => {
//   const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
//   const chat: Chat = ai.chats.create({
//     model: 'gemini-3-pro-preview', // Use a more capable model for assessment
//     config: {
//       temperature: 0.7,
//       maxOutputTokens: 1000,
//       responseMimeType: "application/json",
//       responseSchema: {
//         type: Type.OBJECT,
//         properties: {
//           overallScore: { type: Type.NUMBER, description: 'Overall score from 0-100' },
//           summary: { type: Type.STRING, description: 'A summary of the candidate\'s performance.' },
//           parameters: {
//             type: Type.ARRAY,
//             items: {
//               type: Type.OBJECT,
//               properties: {
//                 name: { type: Type.STRING, description: 'Name of the assessment parameter (e.g., Communication Clarity, Problem-Solving, Empathy, Negotiation Skills).' },
//                 score: { type: Type.NUMBER, description: 'Score for this parameter from 0-100.' },
//                 feedback: { type: Type.STRING, description: 'Specific feedback for this parameter.' },
//               },
//               required: ['name', 'score', 'feedback'],
//             },
//           },
//           recommendations: {
//             type: Type.ARRAY,
//             items: { type: Type.STRING },
//             description: 'Actionable recommendations for improvement.'
//           },
//         },
//         required: ['overallScore', 'summary', 'parameters', 'recommendations'],
//       },
//       systemInstruction: `You are an expert business coach providing a performance review for a candidate who just completed a role-play. Analyze the conversation transcript thoroughly. Provide a fair, constructive, and detailed assessment focusing on key business communication and problem-solving skills.
//       Rate the candidate on multiple parameters with a score from 0 to 100 and provide specific, actionable feedback. Conclude with an overall score and concrete recommendations for improvement. The response MUST be valid JSON according to the provided schema.`,
//     },
//   });

//   const formattedConversation = conversationHistory.map(msg => `${msg.sender}: ${msg.text}`).join('\n');
//   if (formattedConversation.trim().length === 0) {
//     throw new Error("Conversation history is empty, cannot generate assessment report.");
//   }

//   const prompt = `Assess the following role-play conversation for the scenario: "${scenarioTitle}".

// Conversation Transcript:
// \`\`\`
// ${formattedConversation}
// \`\`\`

// Evaluate the candidate based on:
// 1.  **Communication Clarity:** Was the candidate clear, concise, and easy to understand?
// 2.  **Problem-Solving:** How well did the candidate identify the core issue and propose solutions?
// 3.  **Empathy & Active Listening:** Did the candidate show understanding of the ${scenarioTitle.includes('Customer') ? 'customer\'s' : 'stakeholder\'s'} perspective?
// 4.  **Negotiation/Persuasion Skills:** If applicable, how effectively did the candidate advocate for their position or reach a compromise?
// 5.  **Professionalism:** Was the candidate's tone and language appropriate for a business setting?

// Provide scores (0-100) and detailed feedback for each, an overall score, a summary, and actionable recommendations. The output MUST be a JSON object conforming to the specified schema.`;

//   try {
//     const response: GenerateContentResponse = await chat.sendMessage({ message: prompt });
    
//     // FIX: Add check for response.text before trimming and parsing
//     if (!response.text) {
//       console.error("Gemini API response did not contain text content for assessment.");
//       throw new Error("Model did not return text content for the assessment report. This may indicate an API error or an inability to generate a valid response.");
//     }
    
//     const jsonStr = response.text.trim();
//     console.log("Raw JSON response:", jsonStr); // Debugging raw response
    
//     // Attempt to parse the JSON string
//     let assessment: AssessmentReport;
//     try {
//       assessment = JSON.parse(jsonStr);
//     } catch (parseError) {
//       console.error("Failed to parse JSON for assessment report:", parseError);
//       throw new Error(`Model returned invalid JSON for the assessment report. Raw response: "${jsonStr}"`);
//     }

//     return assessment;
//   } catch (error) {
//     console.error("Error generating assessment report:", error);
//     throw new Error(`Failed to generate assessment report: ${error instanceof Error ? error.message : String(error)}`);
//   }
// };
