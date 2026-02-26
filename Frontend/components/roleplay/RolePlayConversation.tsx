"use client";

import { useState, useRef, useEffect } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Loader2,
  Phone,
  Camera,
  CameraOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import VoiceInput from "@/components/VoiceInput";
import { Scenario, Message } from "@/lib/roleplay/types";

interface RolePlayConversationProps {
  scenario: Scenario;
  onEndSession: (messages: Message[]) => void;
  moduleId?: string;
  voiceGender?: "female" | "male";
}

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export default function RolePlayConversation({
  scenario,
  onEndSession,
  voiceGender = "female",
}: RolePlayConversationProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationActive, setConversationActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);

  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const isProcessingRef = useRef(false);
  const conversationActiveRef = useRef(false);

  useEffect(() => {
    conversationActiveRef.current = conversationActive;
  }, [conversationActive]);

  useEffect(() => {
    return () => stopAllMedia();
  }, []);

  const stopAllMedia = () => {
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      mediaRecorderRef.current = null;
    }

    if (videoStream) {
      videoStream.getTracks().forEach((t) => t.stop());
      setVideoStream(null);
    }
  };

  /* ================= START ================= */

  const startConversation = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setVideoStream(stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
    } catch {
      alert("Camera permission required");
    }

    setConversationActive(true);

    const initialMessage: Message = {
      text: scenario.initialPrompt,
      sender: "avatar",
      timestamp: new Date().toISOString(),
    };

    setMessages([initialMessage]);
    await speakText(initialMessage.text);
  };

  /* ================= STOP ================= */

  const stopConversation = () => {
    setConversationActive(false);
    setIsListening(false);
    setIsSpeaking(false);
    isProcessingRef.current = false;

    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }

    stopAllMedia();
  };

  /* ================= SEND MESSAGE ================= */

  const sendMessage = async (text: string) => {
    if (isProcessingRef.current || isLoading || isSpeaking) return;

    isProcessingRef.current = true;

    const userMessage: Message = {
      text,
      sender: "user",
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setIsListening(false);

    try {
      const response = await fetch(`${API_URL}/api/roleplay/conversation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationHistory: [...messages, userMessage],
          scenarioTitle: scenario.title,
          scenarioRole: scenario.role,
          initialPrompt: scenario.initialPrompt,
          tone: scenario.tone || "Neutral",
        }),
      });

      const data = await response.json();

      const aiMessage: Message = {
        text: data.response,
        sender: "avatar",
        timestamp: data.timestamp,
      };

      setMessages((prev) => [...prev, aiMessage]);

      if (conversationActiveRef.current) {
        await speakText(aiMessage.text);
      }
    } finally {
      setIsLoading(false);
      isProcessingRef.current = false;
    }
  };

  /* ================= VOICE TRANSCRIPTION ================= */

  const handleVoiceTranscription = (text: string) => {
    if (!text?.trim()) return;
    if (isSpeaking || isLoading || isProcessingRef.current) return;
    sendMessage(text.trim());
  };

  /* ================= TTS ================= */

  const speakText = async (text: string) => {
    setIsSpeaking(true);
    setIsListening(false);

    try {
      if (currentAudio) currentAudio.pause();

      const response = await fetch("/api/text-to-speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceGender }),
      });

      const data = await response.json();
      const blob = await fetch(
        `data:audio/mp3;base64,${data.audio}`
      ).then((r) => r.blob());

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      setCurrentAudio(audio);

      await audio.play();
      await new Promise((res) => (audio.onended = res));

      URL.revokeObjectURL(url);

      if (conversationActiveRef.current) {
        setTimeout(() => setIsListening(true), 800);
      }
    } catch {
    } finally {
      setIsSpeaking(false);
    }
  };

  /* ================= CAMERA ================= */

  const toggleCamera = () => {
    if (!videoStream) return;
    const track = videoStream.getVideoTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    setIsCameraOn(track.enabled);
  };

  /* ================= MIC ================= */

  const toggleMic = () => {
    if (!videoStream) return;
    const track = videoStream.getAudioTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    setIsMicOn(track.enabled);
  };

  /* ================= END SESSION ================= */

  const handleEndSession = () => {
    stopConversation();
    onEndSession(messages);
  };

  /* ================= UI (UNCHANGED) ================= */

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
            // key={`voice-input-${sessionId}-${isListening}`}
            key={`voice-input`}
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