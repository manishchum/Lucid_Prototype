'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, Square } from 'lucide-react';
import { splitAudioIntoChunks, mergeTranscriptions } from '@/lib/audio-chunker';

interface VoiceInputProps {
  onTranscription: (text: string) => void;
  disabled?: boolean;
  autoStart?: boolean; // New prop for auto-starting
}

export default function VoiceInput({ onTranscription, disabled, autoStart = false }: VoiceInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isRecordingRef = useRef<boolean>(false); // Ref for silence detection
  const animationFrameRef = useRef<number | null>(null); // Track animation frame for cleanup
  const hasAutoStartedRef = useRef<boolean>(false); // Prevent multiple auto-starts
  
  // Increased to 5 minutes for longer roleplay sessions
  // Using bash-style asynchronous recording with chunked data accumulation
  const MAX_RECORDING_DURATION = 300000; // 5 minutes (300 seconds)

  // Auto-start recording when autoStart becomes true (only once)
  useEffect(() => {
    if (autoStart && !isRecording && !isProcessing && !disabled && !hasAutoStartedRef.current) {
      console.log('🎤 Auto-starting recording...');
      hasAutoStartedRef.current = true;
      startRecording();
    }
  }, [autoStart]);

  // Update recording duration display
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    
    if (isRecording) {
      intervalId = setInterval(() => {
        const elapsed = Date.now() - recordingStartTimeRef.current;
        setRecordingDuration(elapsed);
      }, 100); // Update every 100ms for smooth display
    }
    
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(err => 
          console.warn('[VoiceInput] Cleanup: AudioContext already closed:', err)
        );
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const detectSilence = (stream: MediaStream) => {
    // Close existing audio context if it exists
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(err => 
        console.warn('[VoiceInput] Closing previous AudioContext:', err)
      );
    }
    
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);
    
    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;
    
    microphone.connect(analyser);
    
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let lastSoundTime = Date.now();
    const SILENCE_THRESHOLD = 25; // Volume level threshold (0-255) - require actual silence, not just quiet speech
    const SILENCE_DURATION = 3000; // 3 seconds - stop after 3 seconds of silence
    let hasDetectedSpeech = false; // Track if we've detected any speech at all
    let lastLoggedSecond = 0; // Track last logged second to avoid duplicate logs
    
    const checkAudioLevel = () => {
      if (!isRecordingRef.current) {
        console.log('[VoiceInput] 🛑 Not recording, stopping audio level check');
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        return;
      }
      
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      
      // Consider speech detected if volume is above a reasonable threshold
      if (average > 30) {
        if (!hasDetectedSpeech) {
          console.log('[VoiceInput] 🎤 Speech detected, starting silence detection');
          hasDetectedSpeech = true;
        }
        lastLoggedSecond = 0; // Reset logging when speech is detected
      }
      
      if (average > SILENCE_THRESHOLD) {
        // Sound detected, reset silence timer
        lastSoundTime = Date.now();
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }
      } else {
        // Silence detected
        const silenceDuration = Date.now() - lastSoundTime;
        const currentSecond = Math.floor(silenceDuration / 1000);
        
        // Only stop if we've detected speech before (prevents stopping on initial silence)
        // AND we've had enough silence duration (3 seconds)
        if (hasDetectedSpeech && silenceDuration >= SILENCE_DURATION) {
          console.log(`🔇 ${SILENCE_DURATION / 1000} seconds of silence detected after speech, stopping recording...`);
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }
          stopRecording();
          return; // Stop checking immediately
        }
        
        // Log silence progress every second (but only once per second)
        if (hasDetectedSpeech && currentSecond > 0 && currentSecond !== lastLoggedSecond) {
          console.log(`[VoiceInput] 🤫 Silence duration: ${currentSecond}s / ${SILENCE_DURATION / 1000}s`);
          lastLoggedSecond = currentSecond;
        }
      }
      
      animationFrameRef.current = requestAnimationFrame(checkAudioLevel);
    };
    
    checkAudioLevel();
  };

  const startRecording = async () => {
    // Prevent multiple recordings at once
    if (isRecording || isRecordingRef.current || mediaRecorderRef.current) {
      console.log('⚠️ Recording already in progress, ignoring start request');
      return;
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // Use webm format with opus codec for better compression on long recordings
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      recordingStartTimeRef.current = Date.now();
      setRecordingDuration(0);

      // Asynchronous data collection - chunks are accumulated as they become available
      // This mimics bash asynchronous behavior where data is written continuously
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          console.log(`📼 Audio chunk ${audioChunksRef.current.length} captured: ${event.data.size} bytes`);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log(`🎬 Recording stopped. Total chunks: ${audioChunksRef.current.length}`);
        
        // Calculate the recording duration from the start time
        // This is needed for transcribeAudio to determine if async API should be used
        const finalDuration = Date.now() - recordingStartTimeRef.current;
        console.log(`⏱️ Recording duration: ${finalDuration}ms (${(finalDuration / 1000).toFixed(1)}s)`);
        
        // Only proceed if we have audio data
        if (audioChunksRef.current.length === 0) {
          console.log('⚠️ No audio chunks captured, skipping transcription');
          cleanupRecording();
          return;
        }
        
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        console.log(`📦 Final audio blob size: ${audioBlob.size} bytes (${(audioBlob.size / 1024 / 1024).toFixed(2)} MB)`);
        
        // Transcribe first, then cleanup
        await transcribeAudio(audioBlob, finalDuration);
        
        // Cleanup after transcription
        cleanupRecording();
        
        setRecordingDuration(0);
      };

      const cleanupRecording = () => {
        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => {
            if (track.readyState === 'live') {
              track.stop();
            }
          });
          streamRef.current = null;
        }
        
        // Close audio context safely (if not already closed)
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(err => 
            console.warn('[VoiceInput] AudioContext already closed:', err)
          );
          audioContextRef.current = null;
        }
        
        // Clear the MediaRecorder reference
        mediaRecorderRef.current = null;
        
        console.log('[VoiceInput] 🧹 Cleanup completed');
      };

      // Start recording with 1-second timeslices for asynchronous chunk collection
      // This ensures data is available progressively, not all at once at the end
      mediaRecorder.start(1000); // 1000ms timeslice = 1 second chunks (bash async style)
      setIsRecording(true);
      isRecordingRef.current = true; // Set ref for silence detection
      console.log('🎤 Recording started with 1s async timeslices for long-duration support');
      
      // Set maximum recording duration timeout
      recordingTimerRef.current = setTimeout(() => {
        console.log('⏱️ Maximum recording duration reached, stopping...');
        stopRecording();
      }, MAX_RECORDING_DURATION);
      
      // Start silence detection
      detectSilence(stream);
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    console.log('[VoiceInput] 🛑 stopRecording called, isRecording:', isRecording);
    
    // Prevent multiple stop calls
    if (!isRecordingRef.current && !isRecording) {
      console.log('[VoiceInput] ⚠️ Already stopped or not recording');
      return;
    }
    
    // Set flags immediately to prevent re-entry
    setIsRecording(false);
    isRecordingRef.current = false;
    
    // Cancel animation frame first to stop silence detection loop
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      console.log('[VoiceInput] 🛑 Animation frame cancelled');
    }
    
    // Clear timers
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    
    // Close audio context (but don't stop the MediaRecorder yet - let it finish naturally)
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(err => 
        console.warn('[VoiceInput] Error closing AudioContext:', err)
      );
      console.log('[VoiceInput] 🎧 AudioContext closed');
    }
    
    // Stop MediaRecorder - this will trigger onstop handler
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      console.log('[VoiceInput] 🛑 Stopping MediaRecorder...');
      try {
        mediaRecorderRef.current.stop();
      } catch (error) {
        console.warn('[VoiceInput] Error stopping MediaRecorder:', error);
      }
      console.log('[VoiceInput] ✅ Recording stop initiated');
    } else {
      console.log('[VoiceInput] ⚠️ No active MediaRecorder to stop');
    }
  };

  const transcribeAudio = async (audioBlob: Blob, audioDurationMs: number) => {
    setIsProcessing(true);
    
    try {
      // Calculate audio duration to determine if chunking is needed
      const audioSizeKB = audioBlob.size / 1024;
      console.log('[VoiceInput] 🎯 Audio duration:', audioDurationMs, 'ms', `(${Math.floor(audioDurationMs / 1000)}s)`);
      console.log('[VoiceInput] 📦 Audio size:', audioSizeKB.toFixed(2), 'KB');

      // Check if audio is too small (likely no speech)
      if (audioSizeKB < 5) {
        console.log('[VoiceInput] ⚠️ Audio too small (< 5KB), likely no speech detected');
        return; // Silent return - don't send to API
      }

      // Use async chunked transcription if:
      // 1. Duration is over 55 seconds (safer threshold)
      // 2. OR file size is over 800KB (indicates longer audio)
      const useAsyncAPI = audioDurationMs > 55000 || audioSizeKB > 800;
      
      if (!useAsyncAPI) {
        console.log('[VoiceInput] Using standard transcription (< 55s)');
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');

        const response = await fetch('/api/speech-to-text', {
          method: 'POST',
          body: formData,
        });

        // Handle "No speech detected" as a normal case, not an error
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          
          // "No speech detected" is expected when user doesn't speak - handle gracefully
          if (response.status === 400 && errorData.error === 'No speech detected') {
            console.log('[VoiceInput] ℹ️ No speech detected in recording (user may not have spoken or spoke too quietly)');
            return; // Silent return - this is normal behavior
          }
          
          // Check if it's the "too long" error - fallback to async API
          if (errorData.error?.includes('Sync input too long') || errorData.error?.includes('LongRunningRecognize')) {
            console.log('[VoiceInput] ⚠️ Audio too long for sync API, falling back to async API...');
            // Fall through to async API handling below
          } else {
            // Other errors should be logged and handled
            console.error('[VoiceInput] Transcription API error:', errorData);
            throw new Error(errorData.error || 'Transcription failed');
          }
        } else {
          const data = await response.json();
          console.log('[VoiceInput] Transcription response:', data);
          
          if (data.text && data.text.trim()) {
            console.log('[VoiceInput] ✅ Transcription successful:', data.text);
            onTranscription(data.text);
          } else {
            console.log('[VoiceInput] ℹ️ Empty transcript received');
          }
          return;
        }
      }

      // For audio > 55 seconds or if sync API failed, use asynchronous chunked transcription
      console.log('[VoiceInput] 🔪 Using async chunked transcription (> 55s or sync API failed)');
      
      // Split audio into chunks
      const chunks = await splitAudioIntoChunks(audioBlob);
      console.log(`[VoiceInput] 📦 Split audio into ${chunks.length} chunks`);

      // Prepare form data with all chunks
      const formData = new FormData();
      formData.append('chunkCount', chunks.length.toString());
      
      for (let i = 0; i < chunks.length; i++) {
        formData.append(`chunk_${i}`, chunks[i].blob, `chunk_${i}.wav`);
      }

      console.log('[VoiceInput] 🚀 Sending chunks for async parallel transcription...');

      // Send to async transcription endpoint
      const response = await fetch('/api/speech-to-text-async', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        
        if (response.status === 400 && errorData.error === 'No speech detected in audio') {
          console.log('[VoiceInput] ℹ️ No speech detected in any chunk');
          return;
        }
        
        console.error('[VoiceInput] Async transcription API error:', errorData);
        throw new Error(errorData.error || 'Async transcription failed');
      }

      const data = await response.json();
      console.log('[VoiceInput] Async transcription response:', {
        textLength: data.text?.length,
        chunkCount: data.chunkCount,
        method: data.processingMethod
      });
      
      if (data.text && data.text.trim()) {
        console.log('[VoiceInput] ✅ Async transcription successful:', data.text.substring(0, 100) + '...');
        onTranscription(data.text);
      } else {
        console.log('[VoiceInput] ℹ️ Empty transcript received from async processing');
      }

      
    } catch (error: any) {
      console.error('[VoiceInput] ❌ Transcription error:', error);
      
      // Handle specific error cases
      if (error.message?.includes('Sync input too long')) {
        alert('Recording exceeded transcription limit. Using chunked processing...');
      } else if (error.message?.includes('No speech detected')) {
        // This shouldn't happen now since we handle it above, but keep as fallback
        console.log('[VoiceInput] ℹ️ No speech detected in recording');
      } else {
        alert(`Failed to transcribe audio: ${error.message}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Format duration as MM:SS
  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isProcessing}
        className={`p-2 rounded-full transition-all ${
          isRecording
            ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
            : isProcessing
            ? 'bg-gray-400 text-white cursor-not-allowed'
            : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={isRecording ? 'Stop recording' : isProcessing ? 'Processing...' : 'Start voice input'}
      >
        {isRecording ? (
          <Square className="w-5 h-5" />
        ) : (
          <Mic className="w-5 h-5" />
        )}
      </button>
      {isRecording && (
        <span className="text-sm font-mono text-red-600 animate-pulse">
          {formatDuration(recordingDuration)}
        </span>
      )}
    </div>
  );
}
