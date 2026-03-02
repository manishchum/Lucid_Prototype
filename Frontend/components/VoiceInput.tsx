'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, Square } from 'lucide-react';
import { splitAudioIntoChunks, mergeTranscriptions, convertToWav } from '@/lib/audio-chunker';

interface VoiceInputProps {
  onTranscription: (text: string) => void;
  disabled?: boolean;
  autoStart?: boolean; // New prop for auto-starting
  onManualStop?: () => void; // Callback when user manually stops recording
}

export default function VoiceInput({ onTranscription, disabled, autoStart = false, onManualStop }: VoiceInputProps) {
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
  const isProcessingRef = useRef<boolean>(false);
  const isStoppingRef = useRef<boolean>(false);

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

    // Use time-domain data and a reasonably sized FFT for RMS
    analyser.fftSize = 2048;
    microphone.connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.fftSize);
    let hasDetectedSpeech = false;
    let silenceTimer: number | null = null;

    // Tunable parameters
    const RMS_THRESHOLD = 0.02;      // Normalized RMS threshold (0..1). Adjust 0.01-0.03 to taste.
    const SILENCE_DURATION = 3000;   // 3 seconds required continuous silence to stop
    const MIN_SPEECH_MS = 300;       // require at least some speech before allowing stop

    const scheduleStop = () => {
      if (silenceTimer) return;
      silenceTimer = window.setTimeout(() => {
        silenceTimer = null;
        // Only stop if we actually recorded speech before and recording still active
        if (hasDetectedSpeech && isRecordingRef.current) {
          console.log(`🔇 ${SILENCE_DURATION / 1000}s of silence detected after speech, stopping recording...`);
          stopRecording();
        }
      }, SILENCE_DURATION);
    };

    const clearScheduledStop = () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    };

    const checkAudioLevel = () => {
      if (!isRecordingRef.current) {
        // stop loop and cleanup
        clearScheduledStop();
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        return;
      }

      analyser.getByteTimeDomainData(dataArray);

      // Compute normalized RMS (0..1)
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);

      // Update speech detection
      if (rms >= RMS_THRESHOLD) {
        // Heard speech
        if (!hasDetectedSpeech) {
          // ensure we don't stop on initial brief noise
          const totalSinceStart = Date.now() - recordingStartTimeRef.current;
          if (totalSinceStart >= MIN_SPEECH_MS) {
            hasDetectedSpeech = true;
          } else {
            hasDetectedSpeech = true; // allow short speech as "detected"
          }
          console.log('[VoiceInput] 🎤 Speech detected (RMS):', rms.toFixed(4));
        }
        clearScheduledStop();
      } else {
        // Below threshold -> start/maintain silence timer only if we've seen speech
        if (hasDetectedSpeech) {
          // schedule a stop after SILENCE_DURATION of continuous silence
          scheduleStop();
          // optional logging: show progress in seconds
          const silenceElapsed = silenceTimer ? Math.max(0, SILENCE_DURATION - (silenceTimer ? (silenceTimer as any) : 0)) : 0;
        }
      }

      animationFrameRef.current = requestAnimationFrame(checkAudioLevel);
    };

    checkAudioLevel();
  };

  // add near other refs at top of component
  // const isProcessingRef = useRef<boolean>(false);
  // const isStoppingRef = useRef<boolean>(false);

  // helper to wait until processing completes (simple poll)
  async function waitForProcessingToFinish(timeoutMs = 10000) {
    const start = Date.now();
    while (isProcessingRef.current) {
      if (Date.now() - start > timeoutMs) break;
      await new Promise(r => setTimeout(r, 50));
    }
  }

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

      // mediaRecorder.ondataavailable — only collect, do NOT transcribe here
      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          // debug only: console.debug('[VoiceInput] audio chunk captured', event.data.size);
        }
      };

      // mediaRecorder.onstop — assemble final blob, then transcribe and await completion
      mediaRecorder.onstop = async () => {
        // prevent duplicate onstop handling
        if (isStoppingRef.current) return;
        isStoppingRef.current = true;

        try {
          const finalBlob = new Blob(audioChunksRef.current, { type: audioMimeType || 'audio/webm' });
          audioChunksRef.current = []; // reset for next recording

          // mark processing state so we don't restart recording until done
          isProcessingRef.current = true;
          try {
            // transcribeAudio should be the existing function that posts to your API
            await transcribeAudio(finalBlob);
          } catch (err) {
            console.error('[VoiceInput] transcribe failed', err);
          } finally {
            isProcessingRef.current = false;
          }
        } finally {
          isStoppingRef.current = false;
        }
      };

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
      mediaRecorder.start(5000); // 1000ms timeslice = 1 second chunks (bash async style)
      setIsRecording(true);
      isRecordingRef.current = true; // Set ref for silence detection
      console.log('🎤 Recording started with 1s async timeslices for long-duration support');
      
      // Set maximum recording duration timeout
      // recordingTimerRef.current = setTimeout(() => {
      //   console.log('⏱️ Maximum recording duration reached, stopping...');
      //   stopRecording();
      // }, MAX_RECORDING_DURATION);
      
      // Start silence detection
      detectSilence(stream);
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not access microphone. Please check permissions.');
    }
  };

  // stopRecording — ensure we only call it once per silence event
  function stopRecording() {
    if (!isRecordingRef.current) return;
    // stop the recorder (this triggers onstop which will await transcription)
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    } catch (e) {
      console.warn('[VoiceInput] stopRecording error', e);
    }
    isRecordingRef.current = false;
    setIsRecording(false);
  }

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
        
        // Convert webm to WAV for better transcription quality
        console.log('[VoiceInput] 🔄 Converting webm to WAV...');
        const wavBlob = await convertToWav(audioBlob);
        
        const formData = new FormData();
        formData.append('audio', wavBlob, 'recording.wav');

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
            console.log('[VoiceInput] 🔄 Calling onTranscription with:', data.text);
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
  console.log('[VoiceInput] 🔄 Calling onTranscription with:', data.text);
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
      console.log('[VoiceInput] 🛑 User manually stopped recording');
      // Notify parent that user manually stopped
      if (onManualStop) {
        onManualStop();
      }
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


// 'use client';

// import { useState, useRef, useEffect } from 'react';
// import { Mic, Square } from 'lucide-react';
// import { splitAudioIntoChunks } from '@/lib/audio-chunker';

// interface VoiceInputProps {
//   onTranscription: (text: string) => void;
//   disabled?: boolean;
//   autoStart?: boolean;
//   onManualStop?: () => void;
// }

// export default function VoiceInput({
//   onTranscription,
//   disabled,
//   autoStart = false,
//   onManualStop
// }: VoiceInputProps) {
//   const [isRecording, setIsRecording] = useState(false);
//   const [isProcessing, setIsProcessing] = useState(false);
//   const [recordingDuration, setRecordingDuration] = useState(0);

//   const mediaRecorderRef = useRef<MediaRecorder | null>(null);
//   const audioChunksRef = useRef<Blob[]>([]);
//   const audioContextRef = useRef<AudioContext | null>(null);
//   const analyserRef = useRef<AnalyserNode | null>(null);
//   const streamRef = useRef<MediaStream | null>(null);

//   const recordingStartTimeRef = useRef<number>(0);
//   const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
//   const animationFrameRef = useRef<number | null>(null);
//   const isRecordingRef = useRef<boolean>(false);
//   const hasAutoStartedRef = useRef<boolean>(false);

//   const MAX_RECORDING_DURATION = 300000; // 5 minutes

//   /* ---------------- AUTO START ---------------- */

//   useEffect(() => {
//     if (autoStart && !isRecording && !isProcessing && !disabled && !hasAutoStartedRef.current) {
//       hasAutoStartedRef.current = true;
//       startRecording();
//     }
//   }, [autoStart]);

//   /* ---------------- TIMER DISPLAY ---------------- */

//   useEffect(() => {
//     let id: NodeJS.Timeout | null = null;

//     if (isRecording) {
//       id = setInterval(() => {
//         setRecordingDuration(Date.now() - recordingStartTimeRef.current);
//       }, 100);
//     }

//     return () => {
//       if (id) clearInterval(id);
//     };
//   }, [isRecording]);

//   /* ---------------- CLEANUP ---------------- */

//   useEffect(() => {
//     return () => {
//       if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
//       if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
//       if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
//       if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
//     };
//   }, []);

//   /* =====================================================
//      🚀 FIXED SILENCE DETECTION (PRODUCTION GRADE)
//      ===================================================== */

//   const detectSilence = (stream: MediaStream) => {
//     if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
//       audioContextRef.current.close().catch(() => {});
//     }

//     const audioContext = new AudioContext();
//     const analyser = audioContext.createAnalyser();
//     const microphone = audioContext.createMediaStreamSource(stream);

//     analyser.fftSize = 2048;
//     microphone.connect(analyser);

//     audioContextRef.current = audioContext;
//     analyserRef.current = analyser;

//     const dataArray = new Uint8Array(analyser.fftSize);

//     let lastSoundTime = Date.now();
//     let hasDetectedSpeech = false;

//     const SILENCE_DURATION = 10000; // ⭐ 10 seconds
//     const MIN_RECORDING_TIME = 3000;

//     const checkAudioLevel = () => {
//       if (!isRecordingRef.current) return;

//       analyser.getByteTimeDomainData(dataArray);

//       let sumSquares = 0;
//       for (let i = 0; i < dataArray.length; i++) {
//         const normalized = (dataArray[i] - 128) / 128;
//         sumSquares += normalized * normalized;
//       }

//       const rms = Math.sqrt(sumSquares / dataArray.length);
//       const isSpeaking = rms > 0.02;

//       if (isSpeaking) {
//         if (!hasDetectedSpeech) {
//           console.log('🎤 Speech detected');
//           hasDetectedSpeech = true;
//         }
//         lastSoundTime = Date.now();
//       } else {
//         const silenceTime = Date.now() - lastSoundTime;
//         const totalTime = Date.now() - recordingStartTimeRef.current;

//         if (hasDetectedSpeech && silenceTime > SILENCE_DURATION && totalTime > MIN_RECORDING_TIME) {
//           console.log('🔇 Silence detected — stopping recording');
//           stopRecording();
//           return;
//         }
//       }

//       animationFrameRef.current = requestAnimationFrame(checkAudioLevel);
//     };

//     checkAudioLevel();
//   };

//   /* ===================================================== */

//   const startRecording = async () => {
//     if (isRecording || mediaRecorderRef.current) return;

//     try {
//       const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
//       streamRef.current = stream;

//       const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

//       mediaRecorderRef.current = recorder;
//       audioChunksRef.current = [];
//       recordingStartTimeRef.current = Date.now();
//       setRecordingDuration(0);

//       recorder.ondataavailable = e => {
//         if (e.data.size > 0) {
//           audioChunksRef.current.push(e.data);
//         }
//       };

//       recorder.onstop = async () => {
//         const duration = Date.now() - recordingStartTimeRef.current;
//         const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

//         if (blob.size > 5000) {
//           await transcribeAudio(blob, duration);
//         }

//         cleanup();
//         setRecordingDuration(0);
//       };

//       const cleanup = () => {
//         if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
//         if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
//         mediaRecorderRef.current = null;
//       };

//       recorder.start(2000); // ⭐ 2 sec chunks (stable)
//       setIsRecording(true);
//       isRecordingRef.current = true;

//       recordingTimerRef.current = setTimeout(stopRecording, MAX_RECORDING_DURATION);

//       detectSilence(stream);
//     } catch {
//       alert('Microphone permission required');
//     }
//   };

//   const stopRecording = () => {
//     setIsRecording(false);
//     isRecordingRef.current = false;

//     if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
//     if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);

//     if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
//       mediaRecorderRef.current.stop();
//     }
//   };

//   /* ---------------- TRANSCRIPTION ---------------- */

//   const transcribeAudio = async (blob: Blob, duration: number) => {
//     setIsProcessing(true);

//     try {
//       const sizeKB = blob.size / 1024;
//       const useAsync = duration > 55000 || sizeKB > 800;

//       if (!useAsync) {
//         const fd = new FormData();
//         fd.append('audio', blob);

//         const res = await fetch('/api/speech-to-text', { method: 'POST', body: fd });
//         const data = await res.json();

//         if (data.text) onTranscription(data.text);
//         return;
//       }

//       const chunks = await splitAudioIntoChunks(blob);
//       const fd = new FormData();
//       fd.append('chunkCount', chunks.length.toString());

//       chunks.forEach((c, i) => fd.append(`chunk_${i}`, c.blob));

//       const res = await fetch('/api/speech-to-text-async', { method: 'POST', body: fd });
//       const data = await res.json();

//       if (data.text) onTranscription(data.text);
//     } finally {
//       setIsProcessing(false);
//     }
//   };

//   /* ---------------- UI ---------------- */

//   const formatDuration = (ms: number) => {
//     const s = Math.floor(ms / 1000);
//     return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
//   };

//   return (
//     <div className="flex items-center gap-2">
//       <button
//         onClick={() => (isRecording ? stopRecording() : startRecording())}
//         disabled={disabled || isProcessing}
//         className={`p-2 rounded-full ${
//           isRecording
//             ? 'bg-red-500 animate-pulse text-white'
//             : 'bg-gray-200 hover:bg-gray-300'
//         }`}
//       >
//         {isRecording ? <Square /> : <Mic />}
//       </button>

//       {isRecording && <span className="text-red-600 font-mono">{formatDuration(recordingDuration)}</span>}
//     </div>
//   );
// }