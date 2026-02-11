
// import React, { useState, useEffect, useRef, useCallback } from 'react';
// import { Scenario, Message } from '../types';
// import { startLiveRolePlay, stopLiveRolePlay } from '../services/geminiService';
// import { AVATAR_PLACEHOLDER_IMAGE } from '../constants';
// import Button from './ui/Button';
// import LoadingSpinner from './ui/LoadingSpinner';

// interface RolePlayScreenProps {
//   scenario: Scenario;
//   onEndRolePlay: (history: Message[]) => void;
// }

// const RolePlayScreen: React.FC<RolePlayScreenProps> = ({ scenario, onEndRolePlay }) => {
//   const [messages, setMessages] = useState<Message[]>([]);
//   const [isRecording, setIsRecording] = useState(false);
//   const [isLoading, setIsLoading] = useState(false);
//   const [error, setError] = useState<string | null>(null);
//   const [avatarTyping, setAvatarTyping] = useState(false); // To show a typing indicator for avatar
//   const [currentUserTranscription, setCurrentUserTranscription] = useState('');
//   const [currentAvatarTranscription, setCurrentAvatarTranscription] = useState('');

//   const chatScrollRef = useRef<HTMLDivElement>(null);
//   const mediaStreamRef = useRef<MediaStream | null>(null); // To store the media stream for cleanup

//   const handleAvatarTranscription = useCallback((text: string) => {
//     setCurrentAvatarTranscription((prev) => {
//       // Append if it's new text, or replace if it's the start of a new turn
//       const isNewTurn = prev.endsWith('.') || prev.endsWith('!') || prev.endsWith('?');
//       if (isNewTurn || !prev) {
//         return text;
//       }
//       return prev + text;
//     });
//     setAvatarTyping(true); // Always show typing when new avatar transcription comes in
//   }, []);

//   const handleUserTranscription = useCallback((text: string) => {
//     setCurrentUserTranscription((prev) => prev + text);
//   }, []);

//   // FIX: Simplified onLiveSessionClose to only handle state and stream cleanup.
//   // Message finalization is now handled by handleStopRecording.
//   const onLiveSessionClose = useCallback((err?: Error) => {
//     setIsRecording(false);
//     setIsLoading(false);
//     if (err) {
//       setError(`Role-play ended due to an error: ${err.message}. Please try again.`);
//       console.error("Live session closed with error:", err);
//     } else {
//       console.log("Live session closed cleanly.");
//     }
//     if (mediaStreamRef.current) {
//         mediaStreamRef.current.getTracks().forEach(track => track.stop());
//         mediaStreamRef.current = null;
//     }
//     // Clear transcriptions on close, to ensure clean state for next session
//     setCurrentUserTranscription('');
//     setCurrentAvatarTranscription('');
//     setAvatarTyping(false);
//   }, []);


//   const handleStartRecording = useCallback(async () => {
//     setIsLoading(true);
//     setError(null);
//     setMessages([]); // Clear messages for a new session
//     setCurrentUserTranscription('');
//     setCurrentAvatarTranscription('');
//     setAvatarTyping(false);

//     try {
//       const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
//       mediaStreamRef.current = stream; // Store the stream for cleanup
      
//       await startLiveRolePlay(
//         (avatarText) => {
//           setAvatarTyping(false); // Stop typing when audio starts playing
//         },
//         handleUserTranscription,
//         handleAvatarTranscription,
//         onLiveSessionClose,
//         scenario.initialPrompt,
//         scenario.role
//       );
      
//       setIsRecording(true);
//       setIsLoading(false);

//       // Add initial prompt from avatar as the first message
//       setMessages((prev) => [
//         ...prev,
//         { text: scenario.initialPrompt, sender: 'avatar', timestamp: new Date().toLocaleTimeString() },
//       ]);

//     } catch (err) {
//       console.error("Failed to start role-play:", err);
//       setError("Failed to start role-play. Please ensure microphone access is granted and try again.");
//       setIsLoading(false);
//       setIsRecording(false);
//     }
//   }, [scenario, handleUserTranscription, handleAvatarTranscription, onLiveSessionClose]);

//   // FIX: Modified handleStopRecording to immediately finalize pending transcriptions.
//   const handleStopRecording = useCallback(() => {
//     // Finalize any pending transcriptions into messages immediately
//     setMessages((prev) => {
//       let updatedMessages = [...prev];
//       if (currentUserTranscription.trim()) {
//         updatedMessages.push({ text: currentUserTranscription.trim(), sender: 'user', timestamp: new Date().toLocaleTimeString() });
//       }
//       if (currentAvatarTranscription.trim()) {
//         updatedMessages.push({ text: currentAvatarTranscription.trim(), sender: 'avatar', timestamp: new Date().toLocaleTimeString() });
//       }
//       return updatedMessages;
//     });
//     // Clear current transcription states
//     setCurrentUserTranscription('');
//     setCurrentAvatarTranscription('');
//     setAvatarTyping(false);

//     // Stop the Gemini Live session. This will trigger onLiveSessionClose to handle state flags and stream cleanup.
//     stopLiveRolePlay();
//   }, [currentUserTranscription, currentAvatarTranscription]);

//   // FIX: Removed the useEffect that finalized messages with timeouts to prevent race conditions.
//   // Message finalization is now handled explicitly by handleStopRecording.

//   useEffect(() => {
//     if (chatScrollRef.current) {
//       chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
//     }
//   }, [messages, currentUserTranscription, currentAvatarTranscription]);

//   useEffect(() => {
//     // Cleanup on component unmount
//     return () => {
//       if (isRecording) {
//         handleStopRecording(); // Ensure session is stopped if component unmounts while recording
//       }
//     };
//   }, [isRecording, handleStopRecording]);

//   const renderCurrentTranscript = (sender: 'user' | 'avatar', text: string) => {
//     if (!text.trim()) return null;
//     return (
//       <div className={`flex w-full ${sender === 'user' ? 'justify-end' : 'justify-start'}`}>
//         <div className={`p-3 rounded-lg max-w-[80%] text-sm italic text-gray-500 ${
//           sender === 'user' ? 'bg-indigo-50 mr-2' : 'bg-green-50 ml-2'
//         }`}>
//           {text}
//         </div>
//       </div>
//     );
//   };

//   return (
//     <div className="flex flex-col h-full items-center">
//       <h1 className="text-3xl md:text-4xl font-extrabold text-gray-800 mb-6 text-center leading-tight">
//         Role-Playing: <span className="text-indigo-600">{scenario.title}</span>
//       </h1>

//       {error && (
//         <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4 w-full text-center" role="alert">
//           <strong className="font-bold">Error!</strong>
//           <span className="block sm:inline ml-2">{error}</span>
//         </div>
//       )}

//       <div className="flex flex-col lg:flex-row w-full gap-6">
//         {/* Avatar and Info Column */}
//         <div className="lg:w-1/3 flex flex-col items-center p-4 bg-gray-50 rounded-lg shadow-inner">
//           <img
//             src={AVATAR_PLACEHOLDER_IMAGE}
//             alt="AI Avatar"
//             className="w-32 h-32 rounded-full border-4 border-indigo-300 mb-4 shadow-md"
//           />
//           <h2 className="text-2xl font-semibold text-gray-800 mb-2">{scenario.role}</h2>
//           <p className="text-gray-600 text-center text-sm mb-4">{scenario.description}</p>
//           <div className="flex items-center space-x-2 text-sm text-gray-700">
//             {isRecording ? (
//               <>
//                 <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
//                 <span>Recording...</span>
//               </>
//             ) : (
//               <>
//                 <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
//                 <span>Not Recording</span>
//               </>
//             )}
//           </div>
//           {avatarTyping && isRecording && (
//             <div className="mt-4 p-2 bg-indigo-100 text-indigo-800 rounded-full text-sm animate-pulse">
//               {scenario.role} is thinking...
//             </div>
//           )}
//         </div>

//         {/* Chat Window Column */}
//         <div className="lg:w-2/3 bg-white rounded-lg shadow-lg flex flex-col flex-grow min-h-[400px] max-h-[600px] md:min-h-[500px]">
//           <div ref={chatScrollRef} className="flex-1 p-4 overflow-y-auto space-y-4 bg-gray-50">
//             {messages.map((msg, index) => (
//               <div
//                 key={index}
//                 className={`flex w-full ${
//                   msg.sender === 'user' ? 'justify-end' : 'justify-start'
//                 }`}
//               >
//                 <div
//                   className={`relative p-3 rounded-lg max-w-[80%] shadow-md ${
//                     msg.sender === 'user'
//                       ? 'bg-gradient-to-tr from-blue-400 to-blue-600 text-white mr-2'
//                       : 'bg-gradient-to-tl from-purple-400 to-purple-600 text-white ml-2'
//                   }`}
//                 >
//                   <p className="text-sm md:text-base">{msg.text}</p>
//                   <span className="absolute bottom-1 right-2 text-xs text-white opacity-70">
//                     {msg.timestamp}
//                   </span>
//                 </div>
//               </div>
//             ))}
//             {renderCurrentTranscript('user', currentUserTranscription)}
//             {renderCurrentTranscript('avatar', currentAvatarTranscription)}
//           </div>

//           <div className="sticky bottom-0 bg-white p-4 border-t border-gray-200 flex justify-center gap-4">
//             {isLoading ? (
//               <LoadingSpinner message="Initializing Role-Play..." className="py-2" />
//             ) : isRecording ? (
//               <Button onClick={handleStopRecording} variant="danger" size="lg">
//                 <svg className="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"></path></svg>
//                 End Session
//               </Button>
//             ) : (
//               <Button onClick={handleStartRecording} size="lg">
//                 <svg className="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.065A8.902 8.02 0 0010 18c2.421 0 4.76-.683 6.625-1.928a1.23 1.23 0 00.41-1.065c-.08-.414-.486-.643-.9-.643H4.365c-.414 0-.82.229-.9.643z"></path></svg>
//                 Start Role-Play
//               </Button>
//             )}
//             {!isRecording && messages.length > 0 && !isLoading && (
//               <Button onClick={() => onEndRolePlay(messages)} variant="secondary" size="lg">
//                 <svg className="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clipRule="evenodd"></path></svg>
//                 View Assessment
//               </Button>
//             )}
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default RolePlayScreen;
