'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, Square } from 'lucide-react';

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
  
  const MAX_RECORDING_DURATION = 55000; // 55 seconds (under Google's 60-second limit)

  // Auto-start recording when autoStart becomes true
  useEffect(() => {
    if (autoStart && !isRecording && !isProcessing && !disabled) {
      console.log('🎤 Auto-starting recording...');
      startRecording();
    }
  }, [autoStart, isRecording, isProcessing, disabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
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
    const SILENCE_THRESHOLD = 25; // Increased from 10 to 25 - require actual silence, not just quiet speech
    const SILENCE_DURATION = 3500; // Increased from 2000ms to 3500ms (3.5 seconds) - allow for natural pauses
    let hasDetectedSpeech = false; // Track if we've detected any speech at all
    
    const checkAudioLevel = () => {
      if (!isRecording) return;
      
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      
      // Consider speech detected if volume is above a reasonable threshold
      if (average > 30) {
        hasDetectedSpeech = true;
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
        
        // Only stop if we've detected speech before (prevents stopping on initial silence)
        // AND we've had enough silence duration
        if (hasDetectedSpeech && silenceDuration > SILENCE_DURATION && !silenceTimeoutRef.current) {
          console.log('🔇 Silence detected after speech, stopping recording...');
          stopRecording();
          return;
        }
      }
      
      requestAnimationFrame(checkAudioLevel);
    };
    
    checkAudioLevel();
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      recordingStartTimeRef.current = Date.now();
      setRecordingDuration(0);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await transcribeAudio(audioBlob);
        
        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        
        // Close audio context safely
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          try {
            await audioContextRef.current.close();
          } catch (error) {
            console.warn('[VoiceInput] AudioContext already closed:', error);
          }
          audioContextRef.current = null;
        }
        
        setRecordingDuration(0);
      };

      mediaRecorder.start();
      setIsRecording(true);
      
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
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }
      
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    
    try {
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
        
        // Other errors should be logged and handled
        console.error('[VoiceInput] Transcription API error:', errorData);
        throw new Error(errorData.error || 'Transcription failed');
      }

      const data = await response.json();
      console.log('[VoiceInput] Transcription response:', data);
      
      if (data.text && data.text.trim()) {
        console.log('[VoiceInput] ✅ Transcription successful:', data.text);
        onTranscription(data.text);
      } else {
        console.log('[VoiceInput] ℹ️ Empty transcript received');
      }
    } catch (error: any) {
      console.error('[VoiceInput] ❌ Transcription error:', error);
      
      // Handle specific error cases
      if (error.message?.includes('Sync input too long')) {
        alert('Recording too long. Please keep responses under 1 minute.');
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

  return (
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
  );
}
