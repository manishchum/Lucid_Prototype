"use client";

import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Video, VideoOff, Loader2, Phone, Camera, CameraOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import VoiceInput from '@/components/VoiceInput';
import { Scenario, Message } from '@/lib/roleplay/types';
import { createRolePlaySession, updateRolePlaySession } from '@/lib/roleplayDatabase';
import { useAuth } from '@/contexts/auth-context';
import { supabase } from '@/lib/supabase';
import { callGemini } from '@/lib/gemini-helper';

interface RolePlayConversationProps {
  scenario: Scenario;
  onEndSession: (messages: Message[], sessionId?: string) => void;
  moduleId?: string;
  voiceGender?: 'female' | 'male';
}

export default function RolePlayConversation({ scenario, onEndSession, moduleId, voiceGender = 'female' }: RolePlayConversationProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationActive, setConversationActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conversationActiveRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const userResponseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingRef = useRef(false); // Lock to prevent concurrent processing
  const containerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    conversationActiveRef.current = conversationActive;
  }, [conversationActive]);

  // Enter fullscreen when conversation starts
  useEffect(() => {
    const enterFullscreen = async () => {
      if (conversationActive && containerRef.current) {
        try {
          if (containerRef.current.requestFullscreen) {
            await containerRef.current.requestFullscreen();
          }
          console.log('✅ Entered fullscreen mode');
        } catch (error) {
          console.error('❌ Error entering fullscreen:', error);
        }
      }
    };

    enterFullscreen();
  }, [conversationActive]);

  // Prevent exiting fullscreen during conversation
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && conversationActive) {
        // Re-enter fullscreen if user tries to exit during conversation
        if (containerRef.current) {
          containerRef.current.requestFullscreen().catch(err => {
            console.error('Could not re-enter fullscreen:', err);
          });
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [conversationActive]);

  // Fetch employee ID from Supabase when user changes
  useEffect(() => {
    const fetchEmployeeId = async () => {
      if (user?.email) {
        try {
          const { data, error } = await supabase
            .from('users')
            .select('user_id')
            .eq('email', user.email)
            .single();

          if (error) {
            console.error('Error fetching employee ID:', error);
          } else if (data) {
            setEmployeeId(data.user_id);
            console.log('✅ Employee ID fetched:', data.user_id);
          }
        } catch (error) {
          console.error('Exception fetching employee ID:', error);
        }
      }
    };
    fetchEmployeeId();
  }, [user]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-save messages to database when they change
  useEffect(() => {
    if (sessionId && messages.length > 0 && conversationActive) {
      const saveMessages = async () => {
        try {
          console.log('💾 Auto-saving messages...', {
            sessionId,
            messageCount: messages.length
          });
          await updateRolePlaySession(sessionId, messages, false);
          console.log('✅ Messages auto-saved to database');
        } catch (error) {
          console.error('❌ Error auto-saving messages:', error);
          console.error('Error details:', JSON.stringify(error, null, 2));
        }
      };
      saveMessages();
    }
  }, [sessionId, messages, conversationActive]);

  // Cleanup video stream on unmount
  useEffect(() => {
    return () => {
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        console.log('✅ Video stream cleaned up on unmount');
      }
      if (userResponseTimeoutRef.current) {
        clearTimeout(userResponseTimeoutRef.current);
      }
    };
  }, [videoStream]);

  // Attach video stream to video element when stream changes
  useEffect(() => {
    if (videoRef.current && videoStream) {
      videoRef.current.srcObject = videoStream;
      console.log('✅ Video stream attached to video element');
    }
  }, [videoStream]);

  const sendMessage = async (text: string) => {
    console.log('sendMessage called with:', text);
    
    // Check if already processing
    if (isProcessingRef.current) {
      console.log('⚠️ Already processing a message, ignoring new request');
      return;
    }
    
    // Prevent sending message if AI is speaking or already loading
    if (!text.trim() || isLoading || isSpeaking) {
      console.log('Message rejected - empty, loading, or AI speaking');
      return;
    }

    // Set processing lock
    isProcessingRef.current = true;
    console.log('🔒 Processing lock acquired');

    // Add user message
    const userMessage: Message = {
      text: text.trim(),
      sender: 'user',
      timestamp: new Date().toISOString()
    };
    
    console.log('Adding user message:', userMessage);
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setIsListening(false); // Stop listening while processing

    try {
      console.log('Calling conversation API...');
      
      // Create updated conversation history that includes the new user message
      const updatedHistory = [...messages, userMessage];
      console.log('📜 Sending conversation history with', updatedHistory.length, 'messages');
      
      // Call API to get AI response
      const response = await fetch('/api/roleplay/conversation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text.trim(),
          conversationHistory: updatedHistory,
          scenarioTitle: scenario.title,
          scenarioRole: scenario.role,
          initialPrompt: scenario.initialPrompt,
          tone: scenario.tone || 'Neutral'
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('API error:', errorData);
        throw new Error(errorData.error || 'Failed to get response');
      }

      const data = await response.json();
      console.log('AI response received:', data);

      // Add AI response
      const aiMessage: Message = {
        text: data.response,
        sender: 'avatar',
        timestamp: data.timestamp
      };

      setMessages(prev => [...prev, aiMessage]);
      console.log('AI message added to chat');

      // If conversation is active, speak the AI response then listen again
      if (conversationActiveRef.current) {
        console.log('Speaking AI response...');
        await speakText(data.response);
      } else {
        console.log('⚠️ Conversation not active, skipping TTS');
        // Release lock if not speaking
        isProcessingRef.current = false;
        console.log('🔓 Processing lock released (no TTS)');
      }

    } catch (error: any) {
      console.error('Error sending message:', error);
      
      // Add error message
      const errorMessage: Message = {
        text: `Sorry, I encountered an error: ${error.message}. Please try again.`,
        sender: 'avatar',
        timestamp: new Date().toISOString()
      };
      
      setMessages(prev => [...prev, errorMessage]);
      
      // Release lock on error
      isProcessingRef.current = false;
      console.log('🔓 Processing lock released (error in sendMessage)');
    } finally {
      setIsLoading(false);
      // Release processing lock is handled in speakText's onended callback
      // or in error handlers above
    }
  };

  // Text-to-speech function
  const speakText = async (text: string): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        console.log('Starting TTS for text:', text);
        
        // Stop any currently playing audio first
        if (currentAudio) {
          console.log('Stopping previous audio...');
          currentAudio.pause();
          currentAudio.currentTime = 0;
          setCurrentAudio(null);
        }
        
        // Set speaking state immediately
        setIsSpeaking(true);
        setIsListening(false); // Ensure not listening while speaking

        // Call text-to-speech API
        const response = await fetch("/api/text-to-speech", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            text,
            voiceGender 
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ TTS API error:', response.status, errorText);
          throw new Error(`Failed to generate speech: ${response.status}`);
        }

        const data = await response.json();
        console.log('✅ TTS audio received, data keys:', Object.keys(data));
        
        if (!data.audio) {
          console.error('❌ No audio data in response:', data);
          throw new Error('No audio data received from TTS API');
        }
        
        // Convert base64 to audio blob
        console.log('🎵 Converting base64 to audio blob...');
        const audioBlob = await fetch(`data:audio/mp3;base64,${data.audio}`).then(r => r.blob());
        console.log('✅ Audio blob created, size:', audioBlob.size, 'bytes');
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Create and play audio
        console.log('🔊 Creating audio element...');
        const audioElement = new Audio(audioUrl);
        setCurrentAudio(audioElement);
        
        audioElement.onended = () => {
          console.log('✅ Audio playback completed');
          setIsSpeaking(false);
          setCurrentAudio(null);
          URL.revokeObjectURL(audioUrl);
          
          // Release processing lock AFTER audio completes
          isProcessingRef.current = false;
          console.log('🔓 Processing lock released');
          
          // After AI finishes speaking, start listening for user response
          // Use ref to avoid stale closure
          if (conversationActiveRef.current) {
            console.log('✅ Activating microphone for user response');
            // Small delay to ensure clean transition
            setTimeout(() => {
              setIsListening(true);
              
              // Set 5-second timeout - if user doesn't speak, AI continues
              userResponseTimeoutRef.current = setTimeout(() => {
                // Only proceed if not already processing AND conversation is still active
                if (!isProcessingRef.current && conversationActiveRef.current) {
                  console.log('⏱️ 5-second timeout - User did not speak, prompting...');
                  setIsListening(false);
                  
                  // Instead of continuing, prompt the user or wait a bit more
                  // Let's just re-enable listening after a short pause
                  setTimeout(() => {
                    if (conversationActiveRef.current && !isProcessingRef.current) {
                      console.log('🎤 Re-enabling microphone after pause');
                      setIsListening(true);
                    }
                  }, 1000);
                } else {
                  console.log('⚠️ 5-second timeout fired but processing or conversation ended, ignoring');
                }
              }, 5000);
            }, 300); // 300ms delay for smooth transition
          } else {
            console.warn('❌ Conversation not active - not activating microphone');
          }
          resolve();
        };

        audioElement.onerror = (e) => {
          console.error('❌ Audio playback error:', e);
          console.error('Audio element error:', audioElement.error);
          setIsSpeaking(false);
          setCurrentAudio(null);
          URL.revokeObjectURL(audioUrl);
          
          // Release lock on error too
          isProcessingRef.current = false;
          console.log('🔓 Processing lock released (error)');
          
          reject(new Error("Failed to play audio"));
        };

        console.log('▶️ Starting audio playback...');
        try {
          await audioElement.play();
          console.log('✅ Audio play() called successfully');
        } catch (playError) {
          console.error('❌ Error calling play():', playError);
          throw playError;
        }
      } catch (error: any) {
        console.error("Text-to-speech error:", error);
        setIsSpeaking(false);
        
        // Release lock on error
        isProcessingRef.current = false;
        console.log('🔓 Processing lock released (TTS error)');
        
        reject(error);
      }
    });
  };

  // Upload video to Supabase storage
  const uploadVideoToStorage = async (videoBlob: Blob, sessionId: string) => {
    try {
      console.log('📤 Uploading video to storage...');
      
      const fileName = `roleplay-sessions/${sessionId}/${Date.now()}.webm`;
      
      const { data, error } = await supabase.storage
        .from('roleplay-videos')
        .upload(fileName, videoBlob, {
          contentType: 'video/webm',
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error('❌ Error uploading video:', error);
        return;
      }

      console.log('✅ Video uploaded successfully:', data);

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('roleplay-videos')
        .getPublicUrl(fileName);

      const publicUrl = urlData.publicUrl;
      console.log('📹 Video public URL:', publicUrl);

      // Update session with video URL
      const { error: updateError } = await supabase
        .from('roleplay_sessions')
        .update({ video_url: publicUrl })
        .eq('id', sessionId);

      if (updateError) {
        console.error('❌ Error updating session with video URL:', updateError);
        return;
      }

      setVideoUrl(publicUrl);
      console.log('✅ Session updated with video URL');
      
    } catch (error) {
      console.error('❌ Error in uploadVideoToStorage:', error);
    }
  };

  // Start conversation
  const startConversation = async () => {
    console.log('Starting conversation...');
    console.log('🔍 User auth state:', { 
      hasUser: !!user, 
      userId: user?.uid,
      employeeId: employeeId,
      userEmail: user?.email 
    });
    
    // Start video stream
    try {
      console.log('🎥 Requesting video access...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 },
          height: { ideal: 480 }
        }, 
        audio: true // Include audio for recording
      });
      console.log('🎥 Video stream obtained:', stream);
      console.log('🎥 Video tracks:', stream.getVideoTracks());
      setVideoStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        console.log('🎥 Video stream assigned to video element');
        // Force play
        videoRef.current.play().catch(err => console.error('❌ Video play error:', err));
      }

      // Start recording the video with asynchronous blob accumulation
      try {
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'video/webm;codecs=vp9',
        });
        
        mediaRecorderRef.current = mediaRecorder;
        recordedChunksRef.current = [];

        // Asynchronous chunk collection - mimics bash async behavior
        // Data is accumulated progressively as it becomes available
        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
            const totalSize = recordedChunksRef.current.reduce((acc, chunk) => acc + chunk.size, 0);
            console.log(`📹 Video chunk ${recordedChunksRef.current.length} recorded: ${event.data.size} bytes (total: ${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
          }
        };

        mediaRecorder.onstop = async () => {
          console.log('📹 Recording stopped, total chunks:', recordedChunksRef.current.length);
          const videoBlob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
          console.log('📹 Final video blob size:', videoBlob.size, 'bytes', `(${(videoBlob.size / 1024 / 1024).toFixed(2)} MB)`);
          
          // Upload video to storage
          if (sessionId) {
            await uploadVideoToStorage(videoBlob, sessionId);
          }
        };

        // Start with 1-second timeslices for continuous asynchronous data collection
        // This allows recordings longer than 1 minute without memory issues
        mediaRecorder.start(1000); // 1000ms timeslice = bash-style async chunks
        setIsRecording(true);
        console.log('🔴 Video recording started with async 1s timeslices (supports long recordings)');
      } catch (recError) {
        console.error('❌ Error starting video recording:', recError);
      }

      console.log('✅ Video stream started successfully');
    } catch (error) {
      console.error('❌ Error starting video:', error);
      alert('Could not access camera. Please check your permissions.');
      // Continue even if video fails
    }
    
    // Create database session
    if (employeeId) {
      try {
        console.log('Creating session with data:', {
          employeeId: employeeId,
          scenarioId: scenario.scenario_id,
          moduleId
        });
        

        console.log('📤 Sending request to createRolePlaySession...');
        console.log('Scenario Variables',scenario);
        console.log("scenario details:", {
          id: await scenario.scenario_id,
          title: scenario.title,
          role: scenario.role,
          difficulty: scenario.difficulty
        });
        const { data, error } = await createRolePlaySession(
          employeeId,
          scenario.scenario_id,
          scenario.title,
          scenario.role,
          scenario.difficulty,
          moduleId
        );
        
        if (error) {
          console.error('❌ Error creating session:', error);
          console.error('Error details:', JSON.stringify(error, null, 2));
        } else {
          setSessionId(data.id);
          console.log('✅ Session created with ID:', data.id);
        }
      } catch (error) {
        console.error('❌ Exception creating session:', error);
      }
    } else {
      console.warn('⚠️ No employeeId available, cannot create session. Waiting for user data...');
    }
    
    setConversationActive(true);
    
    // Add initial AI message
    const initialMessage: Message = {
      text: scenario.initialPrompt,
      sender: 'avatar',
      timestamp: new Date().toISOString()
    };
    setMessages([initialMessage]);
    console.log('Initial message added:', initialMessage);

    // Speak the initial message then start listening
    console.log('Speaking initial message...');
    try {
      await speakText(scenario.initialPrompt);
    } catch (error) {
      console.error('❌ Error speaking initial message:', error);
      // Still start listening even if TTS fails
      setIsSpeaking(false);
      setIsListening(true);
    }
  };

  // Stop conversation
  const stopConversation = () => {
    setConversationActive(false);
    setIsListening(false);
    setIsSpeaking(false);
    
    // Reset processing lock
    isProcessingRef.current = false;
    console.log('🔓 Processing lock reset on stop');
    
    // Clear any pending timeout
    if (userResponseTimeoutRef.current) {
      clearTimeout(userResponseTimeoutRef.current);
      userResponseTimeoutRef.current = null;
    }
    
    // Stop any playing audio
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }
    
    // Stop video recording
    if (mediaRecorderRef.current && isRecording) {
      console.log('🛑 Stopping video recording...');
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
    
    // Stop video stream
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
      setVideoStream(null);
      console.log('✅ Video stream stopped');
    }

    // Exit fullscreen
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(err => {
        console.error('Could not exit fullscreen:', err);
      });
    }
  };

  const handleVoiceTranscription = (text: string) => {
    console.log('Voice transcription received:', text);
    
    // Ignore transcription if AI is currently speaking or loading
    if (isSpeaking || isLoading) {
      console.log('⚠️ Ignoring transcription - AI is speaking or loading');
      return;
    }
    
    // Check if already processing
    if (isProcessingRef.current) {
      console.log('⚠️ Already processing, ignoring transcription');
      return;
    }
    
    // Check for exit phrases - be more specific to avoid false positives
    // Only trigger if the user clearly wants to end the conversation
    const exitPhrases = [
      'goodbye', 
      'good bye',
      'bye bye', 
      'quit', 
      'exit', 
      'i quit', 
      'i want to quit', 
      'end conversation', 
      'end session',
      'end the conversation',
      'end the session',
      'stop the conversation',
      'stop the session',
      'i want to stop',
      'i want to end',
      "let's end",
      "let's stop"
    ];
    
    const lowerText = text.toLowerCase().trim();
    
    // Check if the text is exactly an exit phrase or starts/ends with one
    const shouldExit = exitPhrases.some(phrase => {
      // Exact match
      if (lowerText === phrase) return true;
      // Starts with phrase followed by punctuation or space
      if (lowerText.startsWith(phrase + ' ') || lowerText.startsWith(phrase + ',') || lowerText.startsWith(phrase + '.')) return true;
      // Ends with phrase preceded by space or punctuation
      if (lowerText.endsWith(' ' + phrase) || lowerText.endsWith(',' + phrase) || lowerText.endsWith('.' + phrase)) return true;
      // Only match "bye" if it's a standalone word (not part of "goodbye" which is already in the list)
      if (phrase === 'bye' && /\bbye\b/.test(lowerText) && !lowerText.includes('goodbye')) return true;
      return false;
    });
    
    // Add "bye" as a special case - only if standalone
    const hasBye = /^bye$|^bye[,.\s]|[,.\s]bye$|[,.\s]bye[,.\s]/.test(lowerText);
    
    if (shouldExit || hasBye) {
      console.log('👋 User requested to end session');
      
      // Acquire processing lock to prevent overlapping
      isProcessingRef.current = true;
      console.log('🔒 Processing lock acquired (goodbye)');
      
      // Clear the 5-second timeout
      if (userResponseTimeoutRef.current) {
        clearTimeout(userResponseTimeoutRef.current);
        userResponseTimeoutRef.current = null;
      }
      
      setIsListening(false);
      setConversationActive(false); // Stop conversation immediately
      
      // Add user's goodbye message
      const userMessage: Message = {
        text: text.trim(),
        sender: 'user',
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, userMessage]);
      
      // Add AI's goodbye message
      const goodbyeMessage: Message = {
        text: "Thank you for practicing with me today! You did great. I hope this session was helpful for you. Goodbye!",
        sender: 'avatar',
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, goodbyeMessage]);
      
      // Speak goodbye message then end session
      setIsSpeaking(true);
      speakText(goodbyeMessage.text).then(() => {
        console.log('✅ Goodbye message spoken, ending session...');
        setTimeout(() => {
          handleEndSession();
        }, 1000); // Wait 1 second after goodbye message
      }).catch((error) => {
        console.error('Error speaking goodbye:', error);
        setIsSpeaking(false);
        // End session even if TTS fails
        setTimeout(() => {
          handleEndSession();
        }, 1000);
      });
      
      return;
    }
    
    // Clear the 5-second timeout since user spoke
    if (userResponseTimeoutRef.current) {
      clearTimeout(userResponseTimeoutRef.current);
      userResponseTimeoutRef.current = null;
      console.log('✅ User response timeout cleared');
    }
    
    setIsListening(false);
    if (text && text.trim()) {
      sendMessage(text);
    } else {
      console.warn('Empty transcription received');
      // Only re-enable listening if not speaking or loading
      if (!isSpeaking && !isLoading) {
        setIsListening(true);
      }
    }
  };

  const handleEndSession = async () => {
    stopConversation();
    
    // Save final session state to database
    if (sessionId && messages.length > 0) {
      try {
        await updateRolePlaySession(sessionId, messages, true);
        console.log('Session marked as completed in database');
      } catch (error) {
        console.error('Error completing session:', error);
      }
    }
    
    if (messages.length > 0) {
      onEndSession(messages, sessionId || undefined);
    }
  };

  const toggleCamera = () => {
    if (videoStream) {
      const videoTrack = videoStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
      }
    }
  };

  const toggleMic = () => {
    if (videoStream) {
      const audioTrack = videoStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  };

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 bg-gray-900 flex flex-col z-50"
    >
      {/* Top Control Bar */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-white font-medium">{scenario.title}</span>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Camera Toggle */}
          <button
            onClick={toggleCamera}
            className={`p-2 rounded-lg transition-all ${
              isCameraOn
                ? 'bg-gray-700 hover:bg-gray-600 text-white'
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
            title={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
          >
            {isCameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>

          {/* Mic Toggle */}
          <button
            onClick={toggleMic}
            className={`p-2 rounded-lg transition-all ${
              isMicOn
                ? 'bg-gray-700 hover:bg-gray-600 text-white'
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
            title={isMicOn ? 'Mute' : 'Unmute'}
          >
            {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>

          {/* End Meeting Button */}
          <Button
            onClick={handleEndSession}
            className="bg-red-500 hover:bg-red-600 text-white flex items-center gap-2"
          >
            <Phone className="w-4 h-4" />
            End Meeting
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex">
        {/* Left Side - L Avatar */}
        <div className="w-1/2 bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600 flex items-center justify-center p-8 relative overflow-hidden">
          <div className="relative z-10 text-center">
            {/* Large Avatar with animated background effects BEHIND it */}
            <div className="relative mx-auto w-64 h-64 mb-6">
              {/* Animated background effects - positioned absolutely behind the circle */}
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-white/10 rounded-full ${isSpeaking ? 'animate-ping' : 'opacity-0'}`}></div>
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-white/5 rounded-full ${isSpeaking ? 'animate-pulse' : 'opacity-0'}`}></div>
              
              {/* Avatar Circle - positioned on top with z-index */}
              <div className={`relative z-10 w-64 h-64 rounded-full bg-white flex items-center justify-center shadow-2xl transition-all duration-300 ${isSpeaking ? 'scale-110 ring-8 ring-white/30' : 'scale-100'}`}>
                <span className="text-8xl font-bold text-purple-600">L</span>
              </div>
            </div>

            {/* L Name and Status */}
            <div className="text-white">
              <h2 className="text-4xl font-bold mb-2">{scenario.role}</h2>
              <div className="flex items-center justify-center gap-3 mb-3">
                {isSpeaking ? (
                  <>
                    <div className="flex gap-1">
                      <div className="w-2 h-6 bg-white rounded-full animate-pulse" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-8 bg-white rounded-full animate-pulse" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-6 bg-white rounded-full animate-pulse" style={{ animationDelay: '300ms' }}></div>
                    </div>
                    <span className="text-xl font-medium">Speaking...</span>
                  </>
                ) : isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-xl font-medium">Thinking...</span>
                  </>
                ) : isListening ? (
                  <>
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="text-xl font-medium">Listening...</span>
                  </>
                ) : conversationActive ? (
                  <span className="text-xl font-medium">Ready to talk</span>
                ) : (
                  <span className="text-xl font-medium">Waiting to start</span>
                )}
              </div>
              <p className="text-purple-100 opacity-90 text-lg">
                {scenario.difficulty} Difficulty • {scenario.tone || 'Neutral'} Tone
              </p>
            </div>
          </div>
        </div>

        {/* Right Side - User Video */}
        <div className="w-1/2 bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-600 flex items-center justify-center p-8 relative overflow-hidden">
          {/* Animated background */}
          <div className="absolute inset-0">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-white/10 rounded-full"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-white/5 rounded-full"></div>
          </div>

          <div className="relative z-10 w-full max-w-2xl">
            {/* Video Container */}
            <div className="relative rounded-3xl overflow-hidden shadow-2xl border-4 border-white/30 bg-black aspect-video">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover transform scale-x-[-1]"
                onLoadedMetadata={() => {
                  console.log('✅ Video metadata loaded');
                  if (videoRef.current) {
                    videoRef.current.play().catch(err => console.error('Video play error:', err));
                  }
                }}
              />
              {!videoStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                  <Camera className="w-16 h-16 mb-4 opacity-50" />
                  <p className="text-lg">Camera not started</p>
                </div>
              )}
              {!isCameraOn && videoStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-white">
                  <CameraOff className="w-16 h-16 mb-4" />
                  <p className="text-lg">Camera is off</p>
                </div>
              )}
            </div>

            {/* Name Label */}
            <div className="absolute bottom-8 right-8 bg-blue-900/80 backdrop-blur-sm px-6 py-3 rounded-full">
              <p className="text-white font-medium text-lg">You</p>
            </div>
          </div>
        </div>
      </div>

      {/* Voice Input - Hidden but functional */}
      {conversationActive && isListening && !isSpeaking && !isLoading && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50">
          <VoiceInput
            key={`voice-input-${sessionId}-${isListening}`}
            onTranscription={handleVoiceTranscription}
            disabled={isLoading || isSpeaking}
            autoStart={true}
          />
        </div>
      )}

      {/* Start Conversation Overlay - Before session starts */}
      {!conversationActive && messages.length === 0 && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-40">
          <div className="bg-white rounded-3xl p-12 shadow-2xl max-w-lg text-center">
            <div className="bg-gradient-to-br from-purple-100 to-blue-100 rounded-full p-8 mb-6 inline-block">
              <Mic className="w-16 h-16 text-purple-600" />
            </div>
            <h3 className="text-3xl font-bold text-slate-900 mb-3">Ready to Start?</h3>
            <p className="text-slate-600 mb-8 text-lg">
              Click the button below to begin your role-play conversation. 
              The L will speak first, then it's your turn!
            </p>
            <Button 
              onClick={startConversation}
              size="lg"
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-lg px-8 py-6"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-6 h-6 mr-3 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Mic className="w-6 h-6 mr-3" />
                  Start Conversation
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
