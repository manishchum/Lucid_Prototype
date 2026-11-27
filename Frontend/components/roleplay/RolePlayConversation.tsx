"use client";

import { useState, useRef, useEffect } from "react";
import {
  Mic, MicOff, Video, VideoOff,
  Loader2, Phone, Camera, CameraOff,
  Captions, CaptionsOff, ArrowLeftRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Scenario, Message } from "@/lib/roleplayApi";
// import { createRolePlaySession } from "@/lib/roleplayDatabase";
import { createRolePlaySessionAPI } from "@/lib/roleplayApi";
import { getFirebaseIdToken } from "@/lib/fetch-with-auth";

interface RolePlayConversationProps {
  scenario: Scenario;
  onEndSession: (messages: Message[], sessionId?: string) => void;
  onBack?: () => void;
  moduleId?: string;
  employeeId?: string;
  voiceGender?: "female" | "male";
  isGeneratingAssessment?: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

// ✅ Safe base64 encoding for large buffers (avoids stack overflow from spread operator)
function encodePcmToBase64(pcm16: Int16Array): string {
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function RolePlayConversation({
  scenario,
  onEndSession,
  onBack,
  moduleId,
  employeeId,
  voiceGender = "female",
  isGeneratingAssessment = false,
}: RolePlayConversationProps) {
  const [conversationActive, setConversationActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBotSpeaking, setIsBotSpeaking] = useState(false);
  const [limitPopup, setLimitPopup] = useState<{ open: boolean; message: string }>({ open: false, message: "" });
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isViewSwapped, setIsViewSwapped] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [showCaptions, setShowCaptions] = useState(true);
  const [currentCaption, setCurrentCaption] = useState<{
    speaker: string;
    text: string;
    isUser: boolean;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const audioInputRef = useRef<AudioContext | null>(null);
  const audioOutputRef = useRef<AudioContext | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const conversationTranscriptRef = useRef<Array<{ role: string; text: string }>>([]);
  const processorRef = useRef<ScriptProcessorNode | AudioWorkletNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const isBotSpeakingRef = useRef<boolean>(false);
  const sessionEndedRef = useRef<boolean>(false);
  const sessionEndedResolverRef = useRef<(() => void) | null>(null);
  const isStartingRef = useRef<boolean>(false);
  const isSessionActiveRef = useRef<boolean>(false);
  const activeAudioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const captionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const speechRecognitionRef = useRef<any>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (conversationActive) {
      interval = setInterval(() => {
        setCallSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setCallSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [conversationActive]);

  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const startSpeechRecognition = () => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        } catch {}
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          interimText += event.results[i][0].transcript;
        }
        if (interimText.trim()) {
          updateCaption("You", interimText.trim(), true, 3500);
        }
      };

      recognition.onerror = (e: any) => {
        if (e.error !== "no-speech" && e.error !== "aborted") {
          console.warn("[SpeechRecognition] Event error:", e.error);
        }
      };

      recognition.onend = () => {
        if (isSessionActiveRef.current && isMicOn) {
          try {
            recognition.start();
          } catch {}
        }
      };

      recognition.start();
      speechRecognitionRef.current = recognition;
    } catch (err) {
      console.warn("[SpeechRecognition] Init error:", err);
    }
  };

  const stopSpeechRecognition = () => {
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.onend = null;
        speechRecognitionRef.current.stop();
      } catch {}
      speechRecognitionRef.current = null;
    }
  };

  const updateCaption = (speaker: string, text: string, isUser: boolean, durationMs = 4500) => {
    if (captionTimeoutRef.current) {
      clearTimeout(captionTimeoutRef.current);
    }
    setCurrentCaption({ speaker, text, isUser });
    captionTimeoutRef.current = setTimeout(() => {
      setCurrentCaption(null);
    }, durationMs);
  };

  const setBotSpeaking = (val: boolean) => {
    isBotSpeakingRef.current = val;
    setIsBotSpeaking(val);
  };

  useEffect(() => {
    const handleNavigationEnd = () => {
      if (isSessionActiveRef.current) {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          try { wsRef.current.send(JSON.stringify({ type: "end_session" })); } catch {}
        }
        stopAllMedia();
      }
    };

    window.addEventListener("popstate", handleNavigationEnd);
    window.addEventListener("beforeunload", handleNavigationEnd);

    return () => {
      window.removeEventListener("popstate", handleNavigationEnd);
      window.removeEventListener("beforeunload", handleNavigationEnd);
      handleNavigationEnd();
    };
  }, []);

  const stopAllMedia = () => {
    isSessionActiveRef.current = false;
    isStartingRef.current = false;

    // 1. Immediately stop all playing and queued audio sources
    activeAudioSourcesRef.current.forEach((source) => {
      try {
        source.stop();
        source.disconnect();
      } catch { }
    });
    activeAudioSourcesRef.current.clear();

    // 2. Disconnect processor node
    if (processorRef.current) {
      try { (processorRef.current as any).disconnect(); } catch { }
      processorRef.current = null;
    }

    // 3. Stop MediaRecorder
    if (mediaRecorderRef.current?.state !== "inactive") {
      try { mediaRecorderRef.current?.stop(); } catch { }
    }
    mediaRecorderRef.current = null;

    // 4. Stop video/audio stream tracks
    setVideoStream((prev) => {
      if (prev) prev.getTracks().forEach(t => t.stop());
      return null;
    });

    // 5. Forcefully close WebSocket and unbind event handlers so late frames are ignored
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try { ws.close(); } catch { }
    }

    // 6. Close AudioContexts
    if (audioInputRef.current) {
      try { audioInputRef.current.close(); } catch { }
      audioInputRef.current = null;
    }

    if (audioOutputRef.current) {
      try { audioOutputRef.current.close(); } catch { }
      audioOutputRef.current = null;
    }

    if (captionTimeoutRef.current) {
      clearTimeout(captionTimeoutRef.current);
      captionTimeoutRef.current = null;
    }
    setCurrentCaption(null);
    stopSpeechRecognition();

    setBotSpeaking(false);
  };

  // ✅ Reset audio output context cleanly when bot is interrupted
  const resetAudioOutput = () => {
    activeAudioSourcesRef.current.forEach((source) => {
      try {
        source.stop();
        source.disconnect();
      } catch { }
    });
    activeAudioSourcesRef.current.clear();

    if (audioOutputRef.current) {
      try { audioOutputRef.current.close(); } catch { }
      audioOutputRef.current = null;
    }
    nextPlayTimeRef.current = 0;
  };

  const handleBotAudio = async (audioData: string) => {
    // 🛡️ If session is no longer active, reject late audio chunks immediately
    if (!isSessionActiveRef.current) return;

    try {
      setBotSpeaking(true);

      if (!audioOutputRef.current || audioOutputRef.current.state === "closed") {
        audioOutputRef.current = new (window.AudioContext ||
          (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      const ctx = audioOutputRef.current;

      // Resume context if suspended by browser autoplay policy
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      if (!isSessionActiveRef.current) return;

      // Anchor queue to real time on first chunk
      if (nextPlayTimeRef.current === 0) {
        nextPlayTimeRef.current = ctx.currentTime;
      }

      const binary = atob(audioData);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

      const buf = ctx.createBuffer(1, float32.length, 24000);
      buf.copyToChannel(float32, 0);

      const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);

      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(ctx.destination);

      activeAudioSourcesRef.current.add(source);

      source.onended = () => {
        activeAudioSourcesRef.current.delete(source);
        if (activeAudioSourcesRef.current.size === 0 || ctx.currentTime >= nextPlayTimeRef.current - 0.1) {
          setBotSpeaking(false);
          nextPlayTimeRef.current = 0;
        }
      };

      source.start(startTime);
      nextPlayTimeRef.current = startTime + buf.duration;

    } catch (err) {
      console.error("Audio playback error:", err);
      setBotSpeaking(false);
    }
  };

  const connectToRealtime = async (stream: MediaStream) => {
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const apiHost = API_URL?.replace(/^https?:\/\//, "").replace(/\/$/, "");

    // Grab the token and put it in the URL
    const token = await getFirebaseIdToken();
    const wsUrl = `${wsProtocol}//${apiHost}/api/roleplay/realtime?token=${token}`;

    // console.log("[RolePlay] Connecting to WebSocket:", wsUrl);

    const ws = new WebSocket(wsUrl);

    ws.onopen = async () => {
      // // console.log("[RolePlay] ✅ WebSocket connected");
      // console.log("[RolePlay] Starting roles:", {
      //   aiRole: scenario.role,
      //   learnerRole: scenario.userRole || "Learner",
      //   title: scenario.title,
      // });

      ws.send(JSON.stringify({
        scenarioTitle: scenario.title,
        scenarioRole: scenario.role,
        userRole: scenario.userRole || "Learner",
        initialPrompt: scenario.initialPrompt,
        aiPersonality: scenario.aiPersonality,
        aiObjectives: scenario.aiObjectives,
        learnerBrief: scenario.learnerBrief,
        tone: scenario.tone || "Neutral",
        employeeId,
        sessionId: sessionIdRef.current,
        voiceGender,
      }));

      const audioCtx = new (window.AudioContext ||
        (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioInputRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);

      // ✅ Shared PCM16 encoding with safe base64 (no spread on large arrays)
      const sendPcm16Audio = (audioData: Float32Array) => {
        if (isBotSpeakingRef.current) return;
        if (ws.readyState !== WebSocket.OPEN) return;

        const pcm16 = new Int16Array(audioData.length);
        let sumSq = 0;

        for (let i = 0; i < audioData.length; i++) {
          sumSq += audioData[i] * audioData[i];
          const s = Math.max(-1, Math.min(1, audioData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Noise gate: if RMS volume is very low, send pure silence to explicitly tell VAD to stop
        const rms = Math.sqrt(sumSq / audioData.length);
        if (rms < 0.005) {
          pcm16.fill(0);
        }

        const audioB64 = encodePcmToBase64(pcm16);
        ws.send(JSON.stringify({ type: "audio", audio: audioB64 }));
      };

      try {
        await audioCtx.audioWorklet.addModule("/audio-processor.js");
        const workletNode = new AudioWorkletNode(audioCtx, "audio-processor");
        processorRef.current = workletNode as any;

        workletNode.port.onmessage = (event) => {
          sendPcm16Audio(event.data.data as Float32Array);
        };

        source.connect(workletNode);
        workletNode.connect(audioCtx.destination);
        // console.log("[RolePlay] ✅ AudioWorklet initialized");

      } catch (err) {
        console.warn("[RolePlay] AudioWorklet failed, falling back to ScriptProcessorNode:", err);

        // ✅ 2048 buffer size — smooth streaming at 16000hz
        const processor = audioCtx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          sendPcm16Audio(e.inputBuffer.getChannelData(0));
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
        // console.log("[RolePlay] ✅ ScriptProcessorNode initialized (fallback)");
      }

      // Lock mic on startup to prevent VAD false positives during greeting
      setBotSpeaking(true);
      setTimeout(() => {
        if (isBotSpeakingRef.current) {
          setBotSpeaking(false);
        }
      }, 2000);
    };

    ws.onmessage = async (event) => {
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch {
        console.error("[RolePlay] Failed to parse WS message:", event.data);
        return;
      }

      switch (data.type) {
        case "audio":
          await handleBotAudio(data.audio);
          break;

        case "speech_started":
          // ✅ Reset output context fully — clears buffered/interrupted bot audio
          resetAudioOutput();
          setIsRecording(true);
          setBotSpeaking(false);
          break;

        case "user_transcription":
          if (data.text) {
            conversationTranscriptRef.current.push({ role: "user", text: data.text });
            updateCaption("You", data.text, true, 4000);
          }
          break;

        case "bot_transcription":
          if (data.text) {
            const transcript = conversationTranscriptRef.current;
            if (transcript.length > 0 && transcript[transcript.length - 1].role === "bot_chunk") {
              transcript.pop(); // Remove the ongoing chunk now that we have the final text
            }
            conversationTranscriptRef.current.push({ role: "bot", text: data.text });
            updateCaption(scenario.role || "Avatar", data.text, false, 4000);
          }
          break;

        case "transcript_chunk":
          if (data.text) {
            const transcript = conversationTranscriptRef.current;
            let currentText = data.text;
            if (transcript.length > 0 && transcript[transcript.length - 1].role === "bot_chunk") {
              const prev = transcript[transcript.length - 1].text || "";
              const next = data.text;
              let toAppend = next;
              // Guard against missing spaces between tokens / sentences
              if (prev && next && !/\s$/.test(prev) && !/^\s/.test(next)) {
                if (/[.,!?;:]$/.test(prev) || /^[a-zA-Z0-9]/.test(next)) {
                  toAppend = " " + next;
                }
              }
              transcript[transcript.length - 1].text = prev + toAppend;
              currentText = transcript[transcript.length - 1].text;
            } else {
              conversationTranscriptRef.current.push({ role: "bot_chunk", text: data.text });
            }
            updateCaption(scenario.role || "Avatar", currentText, false, 5000);
          }
          break;

        case "response.done":
          nextPlayTimeRef.current = 0;
          setIsRecording(false);
          if (captionTimeoutRef.current) clearTimeout(captionTimeoutRef.current);
          captionTimeoutRef.current = setTimeout(() => {
            setCurrentCaption(null);
          }, 3500);
          break;

        case "session_ended":
          if (data.transcript && Array.isArray(data.transcript) && data.transcript.length > 0) {
            const backendHasBot = data.transcript.some((t: any) => {
              const r = String(t.role || t.sender || "").toLowerCase();
              return ["avatar", "bot", "assistant", "ai", "model"].includes(r);
            });
            const localHasBot = conversationTranscriptRef.current.some((t: any) => {
              const r = String(t.role || t.sender || "").toLowerCase();
              return ["avatar", "bot", "assistant", "ai", "model", "bot_chunk"].includes(r);
            });

            if (backendHasBot || !localHasBot) {
              conversationTranscriptRef.current = data.transcript;
            } else {
              const merged = [...data.transcript];
              conversationTranscriptRef.current.forEach((localItem: any) => {
                const r = String(localItem.role || localItem.sender || "").toLowerCase();
                const isBot = ["avatar", "bot", "assistant", "ai", "model", "bot_chunk"].includes(r);
                if (isBot && !merged.some(m => m.text?.trim() === localItem.text?.trim())) {
                  merged.push(localItem);
                }
              });
              conversationTranscriptRef.current = merged;
            }
          }

          sessionEndedRef.current = true;
          sessionEndedResolverRef.current?.();
          sessionEndedResolverRef.current = null;
          break;

        case "error":
          console.error("[RolePlay] Backend error:", data.message);
          setLimitPopup({ open: true, message: data.message || "An error occurred." });
          break;

        default:
          break;
      }
    };

    ws.onerror = (err) => {
      console.error("[RolePlay] ❌ WebSocket error:", err);
      setLimitPopup({ open: true, message: "Connection error. Please try again." });
    };

    ws.onclose = (event) => {
      // console.log(`[RolePlay] 🔌 WebSocket closed — code: ${event.code}, reason: ${event.reason}, clean: ${event.wasClean}`);
      sessionEndedResolverRef.current?.();
      sessionEndedResolverRef.current = null;
    };

    wsRef.current = ws;
  };

  const startConversation = async () => {
    // 🛡️ Prevent double clicks and concurrent session initialization
    if (isStartingRef.current || isSessionActiveRef.current) {
      console.warn("[RolePlay] Session start request locked. Ignoring duplicate click.");
      return;
    }

    isStartingRef.current = true;
    setIsProcessing(true);

    // Stop any leftover media/connections first
    stopAllMedia();

    conversationTranscriptRef.current = [];

    if (employeeId) {
      try {
        const { data, error } = await createRolePlaySessionAPI(
          employeeId,
          scenario.scenario_id,
          scenario.title,
          scenario.role,
          scenario.difficulty,
          moduleId
        );
        if (data && !error) {
          sessionIdRef.current = data.id;
        } else {
          setLimitPopup({ open: true, message: error?.message || "Unable to start session." });
          isStartingRef.current = false;
          setIsProcessing(false);
          return;
        }
      } catch {
        setLimitPopup({ open: true, message: "Unable to start session. Please try again." });
        isStartingRef.current = false;
        setIsProcessing(false);
        return;
      }
    }

    let stream: MediaStream | null = null;
    let cameraAvailable = true;

    try {
      // 1. Try ideal widescreen video + audio without restrictive constraints
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (videoErr: any) {
        console.warn("[RolePlay] Ideal video constraints failed:", videoErr?.name, videoErr?.message);

        // 2. Fall back to basic video (any camera available)
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        } catch (basicVideoErr: any) {
          console.warn("[RolePlay] Video device unavailable or in use by another app, falling back to audio-only:", basicVideoErr?.name);
          cameraAvailable = false;

          // 3. Fall back to audio-only so the roleplay call is never blocked!
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
        }
      }

      setVideoStream(stream);
      setIsCameraOn(cameraAvailable && stream.getVideoTracks().length > 0);

      if (videoRef.current && stream.getVideoTracks().length > 0) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => { });
      }

      const videoRecorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      videoRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      videoRecorder.start();
      mediaRecorderRef.current = videoRecorder;

      isSessionActiveRef.current = true;
      connectToRealtime(stream);
      setConversationActive(true);
      startSpeechRecognition();

    } catch (err: any) {
      console.error("[RolePlay] Error starting conversation:", err);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        alert("Microphone permission was denied. Please allow microphone access in your browser settings.");
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        alert("No microphone was detected on your computer. Please check your audio input connection.");
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        alert("Your audio or video device is currently being used by another application (e.g. Zoom, Teams, Meet). Please close other apps and try again.");
      } else {
        alert("Failed to access media devices: " + (err.message || "Please check your device settings."));
      }
      stopAllMedia();
    } finally {
      isStartingRef.current = false;
      setIsProcessing(false);
    }
  };

  const handleEndSession = async () => {
    isSessionActiveRef.current = false;
    sessionEndedRef.current = false;
    stopSpeechRecognition();

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: "end_session" }));
      } catch { }

      await new Promise<void>((resolve) => {
        sessionEndedResolverRef.current = resolve;
        setTimeout(() => {
          if (sessionEndedResolverRef.current) {
            sessionEndedResolverRef.current = null;
            resolve();
          }
        }, 1500);
      });
    }

    // Forcefully stop and release all audio/video/WebSockets immediately
    stopAllMedia();
    setConversationActive(false);
    setIsRecording(false);
    setIsProcessing(false);
    setBotSpeaking(false);

    const rawTranscript = conversationTranscriptRef.current;

    // Filter and map all participants (user and AI avatar)
    const messages: Message[] = rawTranscript
      .filter((item: any) => {
        if (!item || !item.text || !item.text.trim()) return false;
        const role = String(item.role || item.sender || "").toLowerCase().trim();
        return ["user", "learner", "human", "avatar", "bot", "assistant", "ai", "model", "bot_chunk"].includes(role);
      })
      .map((item: any, idx) => {
        const role = String(item.role || item.sender || "").toLowerCase().trim();
        const isUser = ["user", "learner", "human"].includes(role);
        return {
          text: item.text.trim(),
          sender: (isUser ? "user" : "avatar") as "user" | "avatar",
          timestamp: item.timestamp || new Date(
            Date.now() - (rawTranscript.length - idx) * 1000
          ).toISOString(),
        };
      });

    // Remove consecutive identical duplicate messages
    const deduplicatedMessages: Message[] = [];
    for (const msg of messages) {
      if (
        deduplicatedMessages.length > 0 &&
        deduplicatedMessages[deduplicatedMessages.length - 1].sender === msg.sender &&
        deduplicatedMessages[deduplicatedMessages.length - 1].text === msg.text
      ) {
        continue;
      }
      deduplicatedMessages.push(msg);
    }

    // Safety fallback: ensure scenario's opening dialogue is present if no AI messages recorded
    if (!deduplicatedMessages.some(m => m.sender === "avatar") && scenario.initialPrompt?.trim()) {
      deduplicatedMessages.unshift({
        text: scenario.initialPrompt.trim(),
        sender: "avatar",
        timestamp: new Date(Date.now() - 60000).toISOString(),
      });
    }

    onEndSession(deduplicatedMessages, sessionIdRef.current || undefined);
  };

  const toggleCamera = () => {
    if (!videoStream) return;
    const track = videoStream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsCameraOn(track.enabled);
  };

  const toggleMic = () => {
    if (!videoStream) return;
    const track = videoStream.getAudioTracks()[0];
    if (!track) return;
    const newState = !track.enabled;
    track.enabled = newState;
    setIsMicOn(newState);
    if (newState) {
      startSpeechRecognition();
    } else {
      stopSpeechRecognition();
    }
  };

  return (
    <div ref={containerRef} className="fixed inset-0 bg-slate-950 flex flex-col z-50 overflow-hidden select-none">
      {/* Top-Right Floating Scenario & Call Timer Pill */}
      {conversationActive && (
        <div className="absolute top-5 right-5 z-30 flex items-center gap-2">
          <div className="bg-slate-900/80 backdrop-blur-md border border-white/15 px-3.5 py-1.5 rounded-full text-white text-xs sm:text-sm font-medium flex items-center gap-2.5 shadow-xl">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="font-mono text-xs sm:text-sm tracking-wide text-slate-200">
              {formatTime(callSeconds)}
            </span>
            <span className="w-1 h-3 bg-white/20 rounded-full" />
            <span className="text-slate-300 truncate max-w-[140px] sm:max-w-[220px]">
              {scenario.title}
            </span>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 1. USER CANVAS (Fullscreen Background or PiP Tile)       */}
      {/* ======================================================== */}
      <div
        onClick={isViewSwapped ? () => setIsViewSwapped(false) : undefined}
        className={
          isViewSwapped
            ? "absolute top-5 left-5 w-56 h-36 sm:w-64 sm:h-44 md:w-72 md:h-48 z-20 rounded-2xl overflow-hidden shadow-2xl border-2 border-cyan-400/50 bg-black cursor-pointer hover:border-cyan-300 transition-all duration-300 group"
            : "absolute inset-0 w-full h-full z-0 bg-slate-950 flex items-center justify-center overflow-hidden"
        }
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`w-full h-full transform scale-x-[-1] transition-all duration-300 ${
            isViewSwapped ? "object-cover" : "object-contain"
          }`}
          onLoadedMetadata={() => videoRef.current?.play().catch(() => { })}
        />

        {!videoStream && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-slate-900">
            <Camera className="w-10 h-10 sm:w-14 sm:h-14 mb-3 opacity-40 text-slate-400" />
            <p className="text-xs sm:text-sm text-slate-400 font-medium">Camera not started</p>
          </div>
        )}

        {!isCameraOn && videoStream && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-white">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center mb-2 shadow-inner">
              <CameraOff className="w-7 h-7 sm:w-8 sm:h-8 text-slate-400" />
            </div>
            <p className="text-xs sm:text-sm text-slate-400 font-medium">Camera is off</p>
          </div>
        )}

        {/* Badge Overlay */}
        <div className="absolute bottom-3 left-3 flex items-center gap-2">
          <span className="bg-slate-950/75 backdrop-blur-md border border-white/15 text-white text-xs font-semibold px-2.5 py-1 rounded-full shadow-md flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            You {isRecording && !isBotSpeaking && <span className="text-[10px] text-cyan-300 font-normal">(Speaking)</span>}
          </span>
        </div>

        {/* Swap Hover Hint when in PiP */}
        {isViewSwapped && (
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-sm rounded-full p-1 text-white border border-white/20">
            <ArrowLeftRight className="w-3.5 h-3.5" />
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* 2. AI AVATAR CANVAS (PiP Tile or Fullscreen Background)  */}
      {/* ======================================================== */}
      <div
        onClick={!isViewSwapped ? () => setIsViewSwapped(true) : undefined}
        className={
          isViewSwapped
            ? "absolute inset-0 w-full h-full z-0 bg-gradient-to-br from-slate-950 via-purple-950 to-indigo-950 flex flex-col items-center justify-center p-8 overflow-hidden select-none"
            : "absolute top-5 left-5 w-56 h-36 sm:w-64 sm:h-44 md:w-72 md:h-48 z-20 rounded-2xl overflow-hidden shadow-2xl border-2 border-purple-400/50 bg-gradient-to-br from-slate-900 via-indigo-950 to-purple-950 backdrop-blur-md cursor-pointer hover:border-purple-300 transition-all duration-300 group flex flex-col items-center justify-center p-3"
        }
      >
        {/* Concentric Pulsing Soundwave Rings */}
        <div className="relative flex items-center justify-center">
          {/* Outer ambient wave */}
          <div
            className={`absolute rounded-full transition-all duration-500 ${
              isViewSwapped
                ? "w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 bg-purple-500/10"
                : "w-24 h-24 sm:w-28 sm:h-28 bg-purple-500/10"
            } ${isBotSpeaking ? "animate-ping opacity-60" : "opacity-0"}`}
          />
          {/* Mid soundwave ring */}
          <div
            className={`absolute rounded-full transition-all duration-300 ${
              isViewSwapped
                ? "w-48 h-48 sm:w-60 sm:h-60 md:w-72 md:h-72 bg-purple-500/15"
                : "w-20 h-20 sm:w-24 sm:h-24 bg-purple-500/15"
            } ${isBotSpeaking ? "animate-pulse opacity-80" : "opacity-0"}`}
          />
          {/* Core Avatar Circle */}
          <div
            className={`relative z-10 rounded-full bg-white flex items-center justify-center shadow-2xl transition-all duration-300 ${
              isViewSwapped
                ? "w-32 h-32 sm:w-40 sm:h-40 md:w-48 md:h-48 ring-8 ring-purple-400/30"
                : "w-14 h-14 sm:w-16 sm:h-16 ring-4 ring-purple-400/30"
            } ${isBotSpeaking ? "scale-105" : "scale-100"}`}
          >
            <span
              className={`font-black text-purple-700 select-none ${
                isViewSwapped ? "text-5xl sm:text-6xl md:text-7xl" : "text-xl sm:text-2xl"
              }`}
            >
              {scenario.role ? scenario.role.charAt(0).toUpperCase() : "A"}
            </span>
          </div>
        </div>

        {/* Text info below Avatar */}
        <div className={`text-center transition-all ${isViewSwapped ? "mt-6" : "mt-2"}`}>
          <h3
            className={`font-bold text-white tracking-wide truncate ${
              isViewSwapped ? "text-xl sm:text-2xl md:text-3xl" : "text-xs sm:text-sm max-w-[180px]"
            }`}
          >
            {scenario.role}
          </h3>

          {/* Dynamic Sound Equalizer Waveform & Status */}
          <div className="flex items-center justify-center gap-2 mt-1">
            {isBotSpeaking ? (
              <div className="flex items-center gap-1">
                <span className="w-1 h-2.5 sm:h-4 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: "0ms" }} />
                <span className="w-1 h-4 sm:h-6 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
                <span className="w-1 h-3 sm:h-5 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
                <span className="w-1 h-1.5 sm:h-3 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: "450ms" }} />
                <span className="text-[10px] sm:text-xs text-purple-200 font-medium ml-1">Speaking...</span>
              </div>
            ) : isProcessing ? (
              <div className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin text-purple-300" />
                <span className="text-[10px] sm:text-xs text-purple-300 font-medium">Thinking...</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-[10px] sm:text-xs text-emerald-300 font-medium">Listening</span>
              </div>
            )}
          </div>

          {isViewSwapped && (
            <p className="text-purple-200/70 text-xs sm:text-sm mt-2">
              {scenario.difficulty} Difficulty • {scenario.tone || "Neutral"} Tone
            </p>
          )}
        </div>

        {/* Badges and Swap Hint */}
        {!isViewSwapped && (
          <>
            <div className="absolute top-2 left-2 flex items-center gap-1">
              <span className="bg-purple-950/80 border border-purple-400/40 text-purple-200 text-[10px] font-bold px-2 py-0.5 rounded-full">
                AI
              </span>
            </div>
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-sm rounded-full p-1 text-white border border-white/20">
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </div>
          </>
        )}
      </div>

      {/* ======================================================== */}
      {/* 3. LIVE FLOATING CLOSED CAPTIONS                         */}
      {/* ======================================================== */}
      {showCaptions && currentCaption && conversationActive && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 max-w-3xl w-[92%] sm:w-auto min-w-[280px] pointer-events-none transition-all duration-200 animate-in fade-in slide-in-from-bottom-2">
          <div className="bg-black/80 backdrop-blur-md border border-white/15 rounded-2xl px-6 py-3 shadow-2xl text-center">
            <p className="text-white text-sm sm:text-base md:text-lg font-medium leading-relaxed tracking-normal drop-shadow select-none break-words">
              {currentCaption.text}
              {!currentCaption.isUser && isBotSpeaking && (
                <span className="inline-block w-1.5 h-4 bg-purple-400 ml-1.5 rounded-sm animate-pulse align-middle" />
              )}
              {currentCaption.isUser && (
                <span className="inline-block w-1.5 h-4 bg-cyan-400 ml-1.5 rounded-sm animate-pulse align-middle" />
              )}
            </p>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. FLOATING CONTROL DOCK (Matching Mockup Pill)          */}
      {/* [Camera] [Mic] [CC] [End Call]                           */}
      {/* ======================================================== */}
      {conversationActive && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3.5 bg-slate-900/90 backdrop-blur-xl border border-white/20 px-5 py-2.5 rounded-full shadow-2xl">
          {/* Camera toggle */}
          <button
            type="button"
            onClick={toggleCamera}
            title={isCameraOn ? "Turn off camera" : "Turn on camera"}
            className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all ${
              isCameraOn
                ? "bg-slate-800 hover:bg-slate-700 text-white border border-white/10"
                : "bg-red-500 hover:bg-red-600 text-white shadow-md shadow-red-500/30"
            }`}
          >
            {isCameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>

          {/* Mic toggle */}
          <button
            type="button"
            onClick={toggleMic}
            title={isMicOn ? "Mute microphone" : "Unmute microphone"}
            className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all ${
              isMicOn
                ? "bg-slate-800 hover:bg-slate-700 text-white border border-white/10"
                : "bg-red-500 hover:bg-red-600 text-white shadow-md shadow-red-500/30"
            }`}
          >
            {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>

          {/* Closed Captions toggle */}
          <button
            type="button"
            onClick={() => setShowCaptions((prev) => !prev)}
            title={showCaptions ? "Hide Closed Captions (CC)" : "Show Closed Captions (CC)"}
            className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all font-bold text-xs ${
              showCaptions
                ? "bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-500/30 ring-1 ring-purple-400"
                : "bg-slate-800 hover:bg-slate-700 text-slate-400 border border-white/10"
            }`}
          >
            {showCaptions ? <Captions className="w-5 h-5" /> : <CaptionsOff className="w-5 h-5" />}
          </button>

          {/* End Call button */}
          <button
            type="button"
            onClick={handleEndSession}
            className="bg-red-500 hover:bg-red-600 text-white font-semibold text-sm sm:text-base px-6 py-2.5 sm:py-3 rounded-full flex items-center gap-2 shadow-lg shadow-red-500/30 transition-all active:scale-95"
          >
            <Phone className="w-4 h-4 fill-current rotate-[135deg]" />
            <span>End Call</span>
          </button>
        </div>
      )}

      {/* Start overlay */}
      {!conversationActive && !isGeneratingAssessment && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-12 shadow-2xl max-w-sm sm:max-w-lg w-full text-center">
            <div className="bg-gradient-to-br from-purple-100 to-blue-100 rounded-full p-4 sm:p-6 lg:p-8 mb-4 sm:mb-6 inline-block">
              <Mic className="w-8 sm:w-12 lg:w-16 h-8 sm:h-12 lg:h-16 text-purple-600" />
            </div>
            <h3 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 mb-2 sm:mb-3">Ready to Start?</h3>
            <p className="text-slate-600 mb-6 sm:mb-8 text-sm sm:text-base lg:text-lg">
              Click the button to begin your speech-to-speech role-play. The bot will speak first, then listen to you!
            </p>
            <Button
              onClick={startConversation}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-sm sm:text-base lg:text-lg px-6 sm:px-8 py-4 sm:py-3 lg:py-6 w-full sm:w-auto h-auto flex items-center justify-center gap-2 mx-auto"
              disabled={isProcessing || conversationActive}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 sm:w-5 lg:w-6 h-4 sm:h-5 lg:h-6 mr-0 animate-spin" />
                  <span className="hidden sm:inline">Starting...</span>
                </>
              ) : (
                <>
                  <Mic className="w-4 sm:w-5 lg:w-6 h-4 sm:h-5 lg:h-6 mr-0" />
                  <span className="hidden sm:inline">Start Conversation</span>
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {isGeneratingAssessment && !conversationActive && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-12 shadow-2xl max-w-sm sm:max-w-lg w-full text-center">
            <Loader2 className="w-16 h-16 animate-spin text-blue-600 mx-auto mb-4" />
            <h3 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 mb-2 sm:mb-3">Generating assessment...</h3>
            <p className="text-slate-600 mb-6 sm:mb-8 text-sm sm:text-base lg:text-lg">
              Please wait while we analyze your session and prepare the report.
            </p>
          </div>
        </div>
      )}

      {/* Error popup */}
      {limitPopup.open && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-2xl max-w-sm w-full text-center">
            <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-slate-900 mb-2 sm:mb-3">Error</h3>
            <p className="text-slate-600 mb-4 sm:mb-6 text-sm sm:text-base">{limitPopup.message}</p>
            <div className="flex items-center justify-center gap-2 sm:gap-3 flex-col sm:flex-row">
              <Button
                onClick={() => { setLimitPopup({ open: false, message: "" }); onBack?.(); }}
                variant="outline"
                className="px-4 sm:px-6 w-full sm:w-auto text-sm sm:text-base h-auto py-2 sm:py-2"
              >
                Back
              </Button>
              <Button
                onClick={() => setLimitPopup({ open: false, message: "" })}
                className="px-4 sm:px-6 bg-blue-600 hover:bg-blue-700 w-full sm:w-auto text-sm sm:text-base h-auto py-2 sm:py-2"
              >
                Retry
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
