"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import AudioPlayer from "./AudioPlayer";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { createCacheKey, sharedDataClient } from "@/lib/data-client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Info, Lightbulb, BookOpen, Zap, Download } from "lucide-react";
import FlashcardCards from '@/components/FlashcardCards'
import MindmapViewer from '@/components/MindmapViewer'
import clsx from "clsx";
import { useAuth } from "@/contexts/auth-context";
import jsPDF from 'jspdf';
import VoiceInput from '@/components/VoiceInput';
import VoiceOutput from '@/components/VoiceOutput';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

const normalizeModulePayload = (raw: any, moduleId: string) => {
  const payload = raw?.data ?? raw;
  if (!payload) return null;

  const base = Array.isArray(payload) ? payload[0] : (payload?.module ?? payload);
  if (!base) return null;

  return {
    ...base,
    processed_module_id: base.processed_module_id ?? base.module_id ?? moduleId,
    original_module_id: base.original_module_id ?? base.module_id ?? base.id ?? moduleId,
  };
};

const fetchModuleData = async (employee: any, moduleId: string) => {
  return sharedDataClient.query(
    createCacheKey({
      namespace: "module",
      userId: employee.user_id,
      path: `/module/${moduleId}`,
    }),
    async () => {
      const headers = {
        "X-User-ID": employee.user_id,
      };

      const res = await fetch(`${API_BASE}/api/processed-modules/${moduleId}`, {
        headers,
      });

      if (res.ok) {
        return res.json();
      }

      // Fallback for cases where navigation passes original_module_id instead of processed_module_id.
      if (res.status === 404) {
        const originalRes = await fetch(`${API_BASE}/api/processed-modules/original-module/${moduleId}`, {
          headers,
        });

        if (originalRes.ok) {
          const originalPayload = await originalRes.json();
          const modules = originalPayload?.data || [];
          if (Array.isArray(modules) && modules.length > 0) {
            return { data: modules[0] };
          }
        }
      }

      throw new Error(`Failed to load module: ${res.status}`);
    },
    {
      ttlMs: 5 * 60 * 1000,
      swr: true,
    }
  );
};

export default function ModuleContentPage({ params }: { params: { module_id: string } }) {
  const [lastUserInputWasVoice, setLastUserInputWasVoice] = useState(false);
  const { user, employeeData, loading: authLoading } = useAuth();
  const moduleId = params.module_id;
  const [module, setModule] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [audioExpanded, setAudioExpanded] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [userChatHistory, setUserChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string; isVoice?: boolean }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const router = useRouter();
  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || loading);
  const [voiceLoopActive, setVoiceLoopActive] = useState(false);
  const [autoStartMic, setAutoStartMic] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  const loadModule = async () => {
    if (!employeeData || !moduleId || moduleId === "undefined" || moduleId === "null") {
      setModule(null);
      return;
    }

    setLoading(true);
    try {
      const result = await fetchModuleData(employeeData, moduleId);
      const normalizedModule = normalizeModulePayload(result.data, moduleId);

      if (!normalizedModule) {
        console.error("[module] No module data found for id:", moduleId);
        setModule(null);
        return;
      }

      setModule(normalizedModule);
    } catch (error) {
      console.error("[module] Failed to load module:", error);
      setModule(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && employeeData && moduleId) {
      loadModule();
    }
  }, [employeeData, moduleId, authLoading]);

  const handleSendChat = async (e: FormEvent<HTMLFormElement>, overrideInput?: string) => {
    e.preventDefault();
    const inputToSend = overrideInput !== undefined ? overrideInput : chatInput;
    console.log('[ModuleChat] handleSendChat called. inputToSend:', inputToSend, 'chatLoading:', chatLoading, 'module:', module?.processed_module_id);
    if (!inputToSend.trim() || chatLoading || !module?.processed_module_id) {
      console.log('[ModuleChat] handleSendChat aborted: missing input, loading, or module');
      return;
    }

  const userMessage = inputToSend.trim();
  setChatInput('');

  // If overrideInput is present, it means voice input was used
  const isVoiceInput = !!overrideInput;
  setLastUserInputWasVoice(isVoiceInput);
  
  if (isVoiceInput) {
    setVoiceLoopActive(true);
  } else {
    setVoiceLoopActive(false);
  }

  const newUserMessage = { role: 'user' as const, content: userMessage, isVoice: isVoiceInput };
  setUserChatHistory((prev) => [...prev, newUserMessage]);
  setChatLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/module-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          processed_module_id: module.processed_module_id,
          user_message: userMessage,
          chat_history: userChatHistory,
        }),
      });

      const data = await response.json();

      if (response.ok && data.message) {
        setUserChatHistory((prev) => [...prev, { role: 'assistant', content: data.message }]);
      } else {
        setUserChatHistory((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: 'Sorry, I encountered an error. Please try again.',
          },
        ]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setUserChatHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleVoiceTranscription = (text: string) => {
  setChatInput(text);
  setLastUserInputWasVoice(true);
  
  // Check if user said "bye" or similar exit phrases
  const exitPhrases = ['bye', 'goodbye', 'stop', 'exit', 'quit'];
  const lowerText = text.toLowerCase().trim();
  const shouldExit = exitPhrases.some(phrase => lowerText === phrase || lowerText.endsWith(phrase));
  
  if (shouldExit) {
    setVoiceLoopActive(false);
    console.log('[ModuleChat] Voice loop stopped - exit phrase detected:', text);
    return; // Don't auto-send, let user decide
  }
  
  setVoiceLoopActive(true);
    console.log('[ModuleChat] handleVoiceTranscription called. text:', text, 'chatLoading:', chatLoading, 'module:', module?.processed_module_id);
    // Auto-send after transcription
    setTimeout(() => {
      if (text && text.trim() && !chatLoading && module?.processed_module_id) {
        console.log('[ModuleChat] Auto-sending after transcription:', text);
        // Create a synthetic event for form submission
        const fakeEvent = { preventDefault: () => {} } as FormEvent<HTMLFormElement>;
        handleSendChat(fakeEvent, text);
      } else {
        console.log('[ModuleChat] Auto-send conditions not met:', {text, chatLoading, module: module?.processed_module_id});
      }
    }, 100);
  };

  if (showLoadingProgress) {
    const label = "Loading module content";
    return <LoadingProgress label={label} progress={loadingProgress} />;
  }

  if (!module) {
    return <div className="min-h-screen flex items-center justify-center text-red-600">Module not found.</div>;
  }

  return (
    <div className="min-h-screen">
      <div className="px-12 py-8">
        <div className="w-full mx-auto">
          <div>
            <main className="w-full">
              <div className="bg-white rounded-lg shadow-sm border p-12 w-full min-h-screen">
                <div className="mb-8">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2 hover:bg-gray-100"
                    onClick={() => {
                      const targetModuleId = module?.original_module_id || moduleId;
                      router.push('/employee/training-plan?module_id=' + encodeURIComponent(String(targetModuleId)));
                    }}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </Button>
                </div>

                <div className="mb-10">
                  <h1 className="text-4xl font-bold text-gray-900 mb-2">{module.title}</h1>
                  <p className="text-lg text-gray-600">Professional learning content tailored for you</p>
                </div>

                <ContentTransformer
                  module={module}
                  employeeId={employeeData?.user_id || ""}
                  audioExpanded={audioExpanded}
                  setAudioExpanded={setAudioExpanded}
                  liveTranscript={liveTranscript}
                  setLiveTranscript={setLiveTranscript}
                  userChatHistory={userChatHistory}
                  chatLoading={chatLoading}
                  onModuleUpdate={(update: any) => {
                    setModule((prev: any) => {
                      const nextData = typeof update === "function" ? update(prev) : update;
                      const normalized = normalizeModulePayload({ data: nextData }, moduleId);
                      return normalized || nextData;
                    });
                  }}
                  onAudioGenerated={(url: string, data?: any) => {
                    setModule((prev: any) => {
                      if (!prev) return prev;
                      const isHinglish = data?.language === "hinglish";
                      return {
                        ...prev,
                        [isHinglish ? "audio_url_hinglish" : "audio_url"]: url,
                        [isHinglish ? "podcast_transcript_hinglish" : "podcast_transcript"]:
                          data?.transcript || prev[isHinglish ? "podcast_transcript_hinglish" : "podcast_transcript"],
                        [isHinglish ? "podcast_timeline_hinglish" : "podcast_timeline"]:
                          data?.timeline
                            ? JSON.stringify(data.timeline)
                            : prev[isHinglish ? "podcast_timeline_hinglish" : "podcast_timeline"],
                      };
                    });
                  }}
                  onVideoGenerated={(url: string) => {
                    setModule((prev: any) => (prev ? { ...prev, video_url: url } : prev));
                  }}
                />

                <ContentCards content={module.content || ''} />

                <div className="rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden mt-10">
                  <div className="p-6 h-96 overflow-y-auto bg-gray-50">
                    {userChatHistory.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center">
                        <div className="text-6xl mb-4">💬</div>
                        <h3 className="text-lg font-semibold text-gray-700 mb-2">Ask me anything about this module!</h3>
                        <p className="text-sm text-gray-500">I can help clarify concepts, provide examples, or answer questions.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {userChatHistory.map((msg, idx) => {
                          // Determine if TTS should be enabled for this bot reply
                          // TTS is enabled if this is the most recent assistant message 
                          // AND it follows a voice user message
                          let ttsEnabled = false;
                          if (msg.role === 'assistant' && idx === userChatHistory.length - 1) {
                            // Find the most recent user message before this assistant message
                            for (let i = idx - 1; i >= 0; i--) {
                              if (userChatHistory[i].role === 'user') {
                                ttsEnabled = userChatHistory[i].isVoice === true;
                                break;
                              }
                            }
                          }
                          
                          return (
                            <div
                              key={idx}
                              className={clsx(
                                'flex items-end gap-2',
                                msg.role === 'user' ? 'justify-end' : 'justify-start'
                              )}
                            >
                              {msg.role === 'assistant' && (
                                <VoiceOutput text={msg.content} disabled={chatLoading || !ttsEnabled} 
                                onTTSComplete={() => {
                                if (voiceLoopActive && idx === userChatHistory.length - 1) {
                                setTimeout(() => setAutoStartMic(true), 300);
                                setTimeout(() => setAutoStartMic(false), 2000);
                                }
                                }}
                                />
                              )}
                              <div
                                className={clsx(
                                  'rounded-lg px-4 py-3 max-w-3xl',
                                  msg.role === 'user'
                                    ? 'bg-blue-600 text-white rounded-br-none'
                                    : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'
                                )}
                              >
                                {msg.role === 'assistant' && (
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs font-semibold text-gray-600">Lucid Assistant</span>
                                  </div>
                                )}
                                <p className="whitespace-pre-wrap break-words leading-relaxed text-sm">
                                  {msg.content}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                        {chatLoading && (
                          <div className="flex justify-start">
                            <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 rounded-bl-none">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-200 bg-white p-6">
                    <form onSubmit={handleSendChat} className="flex gap-3">
                      {/* <button
                        type="button"
                        className="p-3 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors text-slate-600 disabled:opacity-50"
                      >
                        📎
                      </button> */}
                      <VoiceInput 
                        onTranscription={handleVoiceTranscription}
                        disabled={chatLoading}
                        autoStart={autoStartMic}
                        onManualStop={() => {
                          console.log('[ModuleChat] Voice loop stopped - manual stop by user');
                          setVoiceLoopActive(false);
                        }}
                      />
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Ask for coaching, upload work, or chat..."
                        className="flex-1 outline-none text-slate-700 placeholder-slate-400 bg-gray-50 rounded-lg px-4 py-3 border border-gray-200 focus:border-blue-500 focus:bg-white transition-all"
                        disabled={chatLoading}
                      />
                      <button
                        type="submit"
                        className="px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={chatLoading || !chatInput.trim() || !module?.processed_module_id}
                      >
                        {chatLoading ? 'Sending...' : 'Send'}
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

function useIllusionProgress(active: boolean) {
  const [progress, setProgress] = useState(14);
  const [show, setShow] = useState(active);

  useEffect(() => {
    if (!active) {
      setProgress(100);
      const timeout = setTimeout(() => setShow(false), 180);
      return () => clearTimeout(timeout);
    }

    setShow(true);
    setProgress(Math.min(28, 12 + Math.round(Math.random() * 10)));

    const id = setInterval(() => {
      setProgress((prev) => {
        const hold = prev > 72 ? Math.random() < 0.5 : Math.random() < 0.3;
        if (hold) return prev; // occasionally pause to feel more organic
        const increment = Math.max(1, Math.round(Math.random() * 8));
        return Math.min(prev + increment, 95);
      });
    }, 420 + Math.round(Math.random() * 260));

    return () => clearInterval(id);
  }, [active]);

  return { progress: Math.min(progress, 100), show };
}

function LoadingProgress({ label, progress }: { label: string; progress: number }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg border border-slate-100 p-6 space-y-4">
        <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
          <span>{label}</span>
          <span className="text-slate-900 text-base font-black">{progress}%</span>
        </div>
        <div className="relative h-3 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-400 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 font-medium">Loading learning assets. If it feels slow, we are just getting things right.</p>
      </div>
    </div>
  );
}

function ContentCards({ content }: { content: string }) {
  const sections = parseContentIntoSections(content);
  const tabGroups = useMemo(() => groupSectionsForTabs(sections), [sections]);
  const [activeTab, setActiveTab] = useState(tabGroups[0]?.key || '');

  useEffect(() => {
    if (tabGroups.length === 0) return;
    const hasActive = tabGroups.some((group) => group.key === activeTab);
    if (!hasActive) {
      setActiveTab(tabGroups[0].key);
    }
  }, [tabGroups, activeTab]);

  if (sections.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No content available yet.</p>
      </div>
    );
  }

  const activeGroup = tabGroups.find((group) => group.key === activeTab);

  function formatContent(content: string): string {
    const sanitizedContent = content
      .replace(/<script[^>]*?>.*?<\/script>/gi, "")
      .replace(/<style[^>]*?>.*?<\/style>/gi, "")
      .replace(/on\w+="[^"]*"/gi, "")
      .replace(/javascript:/gi, "");
    return sanitizedContent;
  }

  // Color palette for sections — cycling vibrant colors
  const sectionStyles: Record<string, { bg: string; border: string; titleColor: string; icon: string }> = {
    objectives: { bg: 'bg-gradient-to-br from-blue-50 via-blue-100 to-indigo-100', border: 'border-blue-400', titleColor: 'text-blue-800', icon: '🎯' },
    activity: { bg: 'bg-gradient-to-br from-emerald-50 via-green-100 to-teal-100', border: 'border-emerald-400', titleColor: 'text-emerald-800', icon: '⚡' },
    summary: { bg: 'bg-gradient-to-br from-violet-50 via-purple-100 to-fuchsia-100', border: 'border-purple-400', titleColor: 'text-purple-800', icon: '📝' },
    discussion: { bg: 'bg-gradient-to-br from-amber-50 via-orange-100 to-yellow-100', border: 'border-amber-400', titleColor: 'text-amber-800', icon: '💬' },
    example: { bg: 'bg-gradient-to-br from-cyan-50 via-sky-100 to-blue-100', border: 'border-cyan-400', titleColor: 'text-cyan-800', icon: '📖' },
    definition: { bg: 'bg-gradient-to-br from-indigo-50 via-blue-100 to-violet-100', border: 'border-indigo-400', titleColor: 'text-indigo-800', icon: '📚' },
    tip: { bg: 'bg-gradient-to-br from-lime-50 via-green-100 to-emerald-100', border: 'border-lime-500', titleColor: 'text-lime-800', icon: '💡' },
    warning: { bg: 'bg-gradient-to-br from-red-50 via-rose-100 to-pink-100', border: 'border-red-400', titleColor: 'text-red-800', icon: '⚠️' },
    intro: { bg: 'bg-gradient-to-br from-slate-50 via-gray-100 to-zinc-100', border: 'border-slate-300', titleColor: 'text-slate-800', icon: '📋' },
  };

  // Cycling colors for generic "section" types
  const sectionCycleColors = [
    { bg: 'bg-[#FFFFFF]/40', border: 'border-[#000000]', titleColor: 'text-[#000000]', icon: '🔷' },
    { bg: 'bg-[#FFFFFF]/30', border: 'border-[#000000]', titleColor: 'text-[#000000]', icon: '🔶' },
    { bg: 'bg-[#FFFFFF]/50', border: 'border-[#000000]', titleColor: 'text-[#000000]', icon: '🟣' },
    { bg: 'bg-[#FFFFFF]/35', border: 'border-[#000000]', titleColor: 'text-[#000000]', icon: '🟢' },
    { bg: 'bg-[#FFFFFF]/45', border: 'border-[#000000]', titleColor: 'text-[#000000]', icon: '🔴' },
    { bg: 'bg-[#FFFFFF]/25', border: 'border-[#000000]', titleColor: 'text-[#000000]', icon: '🟡' },
  ];

  let sectionColorIdx = 0;

  const getStyle = (type: string) => {
    if (sectionStyles[type]) return sectionStyles[type];
    const style = sectionCycleColors[sectionColorIdx % sectionCycleColors.length];
    sectionColorIdx++;
    return style;
  };

  return (
    <div className="space-y-6 mb-8">
      <div className="flex flex-wrap gap-6 mb-4 border-b border-gray-200 pb-2">
        {tabGroups.map((group) => (
          <button
            key={group.key}
            onClick={() => setActiveTab(group.key)}
            className={clsx(
              'px-3 pb-2 text-sm font-semibold transition-all border-b-2 rounded-t-md',
              activeTab === group.key
                ? 'text-blue-700 border-blue-600 bg-blue-50'
                : 'text-gray-500 border-transparent hover:text-gray-800 hover:border-gray-300 hover:bg-gray-50'
            )}
          >
            {group.label}
          </button>
        ))}
      </div>

      {activeGroup?.items.map((section, index) => {
        const style = getStyle(section.type);
        return (
          <div
            key={index}
            className={clsx(
              "rounded-2xl border-2 shadow-md p-8 transition-all hover:shadow-xl hover:scale-[1.005]",
              style.bg,
              style.border
            )}
          >
            {section.title && (
              <div className="flex items-center gap-3 mb-6">
                {/* <span className="text-2xl">{style.icon}</span> */}
                <h2 className={clsx("font-bold text-xl", style.titleColor)}>
                  {section.title}
                </h2>
              </div>
            )}
            <div
              className="prose prose-sm max-w-none text-gray-800 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: formatContent(section.content) }}
            />
          </div>
        );
      })}
    </div>
  );
}

function parseContentIntoSections(content: string) {
  const sections: Array<{ type: string; title: string; content: string }> = [];

  if (!content || content.trim() === '') {
    return sections;
  }

  // Check if content is HTML (contains HTML tags)
  const isHTML = /<[^>]+>/.test(content);

  if (isHTML) {
    console.log("This is returning html content");
    // Split HTML content into sections based on <section> tags
    return splitHTMLIntoSections(content);
  } else {
    // Parse markdown-style content (legacy fallback)
    return parseMarkdownContent(content);
  }
}

function splitHTMLIntoSections(content: string): Array<{ type: string; title: string; content: string }> {
  const sections: Array<{ type: string; title: string; content: string }> = [];

  // Check if content uses <section> tags
  const hasSectionTags = /<section[\s>]/i.test(content);

  if (hasSectionTags) {
    // Parse based on <section> tags
    const sectionRegex = /<section[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/section>/gi;
    let match;

    while ((match = sectionRegex.exec(content)) !== null) {
      const className = match[1].trim();
      const sectionHTML = match[2].trim();

      // Extract title from the first <h2> or <h3> inside the section
      const titleMatch = sectionHTML.match(/<h[2-3][^>]*>(.*?)<\/h[2-3]>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : '';

      // Remove the first heading from content since we display it as the card title
      const contentWithoutTitle = titleMatch
        ? sectionHTML.replace(titleMatch[0], '').trim()
        : sectionHTML;

      // Determine section type from class name
      let type = 'section';
      if (className.includes('learning-objectives')) {
        type = 'objectives';
      } else if (className.includes('module-section')) {
        // Extract section number if present (e.g., "Section 1: ...")
        const sectionNumMatch = title.match(/Section\s+(\d+)/i);
        type = sectionNumMatch ? `module-section-${sectionNumMatch[1]}` : 'module-section';
      } else if (className.includes('activity')) {
        type = 'activity';
      } else if (className.includes('module-summary')) {
        type = 'summary';
      } else if (className.includes('discussion')) {
        type = 'discussion';
      }

      const styledContent = styleHTMLContent(contentWithoutTitle);
      sections.push({ type, title, content: styledContent });
    }

    if (sections.length > 0) {
      return sections;
    }
  }

  // Fallback: split by <h2>/<h3> headings if no <section> tags found
  const headingRegex = /<(h[1-3])[^>]*>(.*?)<\/\1>/gi;
  const matches: Array<{ index: number; tag: string; title: string }> = [];

  let headingMatch;
  while ((headingMatch = headingRegex.exec(content)) !== null) {
    matches.push({
      index: headingMatch.index,
      tag: headingMatch[1],
      title: headingMatch[2].replace(/<[^>]*>/g, '').trim(),
    });
  }

  if (matches.length === 0) {
    const styledContent = styleHTMLContent(content);
    return [{ type: 'intro', title: '', content: styledContent }];
  }

  // Capture content before the first heading as intro
  const beforeFirst = content.substring(0, matches[0].index).trim();
  if (beforeFirst) {
    const styledIntro = styleHTMLContent(beforeFirst);
    const stripped = styledIntro.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (stripped.length > 0) {
      sections.push({ type: 'intro', title: '', content: styledIntro });
    }
  }

  const getSectionType = (title: string): string => {
    const lower = title.toLowerCase();
    if (lower.includes('learning objective')) return 'objectives';
    if (lower.match(/section\s+\d+/)) {
      const num = lower.match(/section\s+(\d+)/);
      return num ? `module-section-${num[1]}` : 'module-section';
    }
    if (lower.includes('activity') || lower.includes('exercise')) return 'activity';
    if (lower.includes('summary') || lower.includes('conclusion')) return 'summary';
    if (lower.includes('discussion')) return 'discussion';
    return 'section';
  };

  for (let i = 0; i < matches.length; i++) {
    const heading = matches[i];
    const endIdx = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const closingTag = `</${heading.tag}>`;
    const closingIdx = content.indexOf(closingTag, heading.index);
    const sectionStart = closingIdx >= 0 ? closingIdx + closingTag.length : content.indexOf('>', heading.index) + 1;
    const sectionContent = content.substring(sectionStart, endIdx).trim();

    if (sectionContent || heading.title) {
      const styledContent = styleHTMLContent(sectionContent);
      const sectionType = getSectionType(heading.title);
      sections.push({ type: sectionType, title: heading.title, content: styledContent });
    }
  }

  if (sections.length === 0) {
    const styledContent = styleHTMLContent(content);
    return [{ type: 'intro', title: '', content: styledContent }];
  }

  return sections;
}

function parseMarkdownContent(content: string) {
  const sections: Array<{ type: string; title: string; content: string }> = [];

  // Clean up learning style codes from content first
  content = content.replace(/\s*\([CS|CR|AS|AR|cs|cr|as|ar|,\s]+\)/gi, '');
  content = content.replace(/\b(CS|CR|AS|AR)\b/g, '');

  const lines = content.split('\n');
  let currentSection: { type: string; title: string; content: string } | null = null;
  let listBuffer: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushList = () => {
    if (listBuffer && currentSection) {
      const tag = listBuffer.type;
      if (tag === 'ul') {
        currentSection.content += `<ul>${listBuffer.items.map((item) => `<li><span style='font-size:1.1em;margin-right:0.5em;'>•</span>${item}</li>`).join('')}</ul>\n`;
      } else {
        const numEmojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
        currentSection.content += `<ol>${listBuffer.items.map((item, idx) => `<li><span style='font-size:1.1em;margin-right:0.5em;'>${numEmojis[idx] || (idx+1)+'.'}</span>${item}</li>`).join('')}</ol>\n`;
      }
      listBuffer = null;
    }
  };

  const startSection = (section: { type: string; title: string; content: string }) => {
    flushList();
    if (currentSection) sections.push(currentSection);
    currentSection = section;
  };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      if (currentSection) currentSection.content += '\n';
      continue;
    }

    if (line.match(/^Learning Objectives?:/i)) {
      startSection({ type: 'objectives', title: 'Learning Objectives', content: '' });
      continue;
    }

    const sectionMatch = line.match(/^Section\s+(\d+)\s*:\s*(.+)$/i);
    if (sectionMatch) {
      startSection({ 
        type: 'section', 
        title: line, 
        content: '' 
      });
      continue;
    }

    const activityMatch = line.match(/^Activity\s+(\d+)\s*:\s*(.+)$/i);
    if (activityMatch) {
      startSection({ 
        type: 'activity', 
        title: line, 
        content: '' 
      });
      continue;
    }

    if (line.match(/^Module Summary:/i)) {
      startSection({ type: 'summary', title: 'Module Summary', content: '' });
      continue;
    }

    if (line.match(/^Discussion Prompts?:/i)) {
      startSection({ type: 'discussion', title: 'Discussion Prompts', content: '' });
      continue;
    }
    
    const bulletMatch = line.match(/^[-\*•]\s+(.*)$/);
    const numberedMatch = line.match(/^(\d+)\.\s+(.*)$/);

    if (bulletMatch || numberedMatch) {
      const type = bulletMatch ? 'ul' : 'ol';
      const text = (bulletMatch ? bulletMatch[1] : numberedMatch?.[2] || '').trim();
      if (!currentSection) {
        currentSection = { type: 'intro', title: '', content: '' };
      }
      if (!listBuffer || listBuffer.type !== type) {
        flushList();
        listBuffer = { type, items: [] };
      }
      if (text) {
        listBuffer.items.push(text);
      }
      continue;
    }

    flushList();
    if (currentSection) {
      currentSection.content += lines[i] + '\n';
    } else {
      currentSection = { type: 'intro', title: '', content: lines[i] + '\n' };
    }
  }
  
  flushList();
  if (currentSection && currentSection.content.trim()) {
    sections.push(currentSection);
  }

  if (sections.length === 0 && content.trim()) {
    sections.push({ type: 'intro', title: '', content: content });
  }

  return sections;
}

type SectionBlock = { type: string; title: string; content: string };
type TabGroup = { key: string; label: string; items: SectionBlock[] };

function groupSectionsForTabs(sections: SectionBlock[]): TabGroup[] {
  const groups: TabGroup[] = [];

  const ensureGroup = (key: string, label: string) => {
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label, items: [] };
      groups.push(group);
    }
    return group;
  };

  let lastSectionKey = 'overview';

  sections.forEach((section) => {
    // Module sections get their own tab: "Section 1", "Section 2", etc.
    const moduleSectionMatch = section.type.match(/^module-section-(\d+)$/);
    if (moduleSectionMatch) {
      const num = moduleSectionMatch[1];
      const key = `section-${num}`;
      const label = `Section ${num}`;
      ensureGroup(key, label).items.push(section);
      lastSectionKey = key;
      return;
    }

    // Generic module-section without a number
    if (section.type === 'module-section') {
      const key = 'section-misc';
      ensureGroup(key, 'Section').items.push(section);
      lastSectionKey = key;
      return;
    }

    // Summary / conclusion goes to its own tab
    if (section.type === 'summary') {
      ensureGroup('conclusion', 'Module Summary').items.push(section);
      return;
    }

    // Activity gets appended to the last numbered section tab (or overview if none)
    if (section.type === 'activity') {
      ensureGroup(lastSectionKey, lastSectionKey === 'overview' ? 'Overview' : '').items.push(section);
      return;
    }

    // Everything else (objectives, intro, discussion, etc.) goes to Overview
    ensureGroup('overview', 'Overview').items.push(section);
  });

  // Remove any empty groups
  return groups.filter((g) => g.items.length > 0);
}

// function parseChatFromTranscript(transcript: string): Array<{ speaker: string; text: string }> {
//   const messages: Array<{ speaker: string; text: string }> = [];


//   // Split by sentence boundaries and alternate speakers
//   const sentences = transcript.match(/[^.!?]+[.!?]+/g) || [];
//   let isSarah = true; // Start with Sarah to match TTS API


//   for (const sentence of sentences) {
//     const trimmed = sentence.trim();
//     if (trimmed) {
//       messages.push({
//         speaker: isSarah ? 'sarah' : 'mark',
//         text: trimmed
//       });
//       isSarah = !isSarah;
//     }
//   }

//   return messages;
// }

function ContentTransformer({
  module,
  employeeId,
  audioExpanded,
  setAudioExpanded,
  liveTranscript,
  setLiveTranscript,
  userChatHistory,
  chatLoading,
  onModuleUpdate,
  onAudioGenerated,
  onVideoGenerated,
}: any) {
  // Check if audio exists for each language
  const hasEnglishAudio = !!(module.audio_url && module.podcast_transcript && module.podcast_timeline);
  const hasHinglishAudio = !!(module.audio_url_hinglish && module.podcast_transcript_hinglish && module.podcast_timeline_hinglish);
  const hasAudio = hasEnglishAudio || hasHinglishAudio;
  
  // Check if current language audio is available
  const hasCurrentLanguageAudio = (language: 'en' | 'hinglish') => {
    if (language === 'hinglish') {
      return hasHinglishAudio;
    }
    return hasEnglishAudio;
  };
  const [chatMessages, setChatMessages] = useState<Array<{ speaker: string; text: string }>>([]); 
  const [language, setLanguage] = useState<'en' | 'hinglish'>('en');
  const [selectedOption, setSelectedOption] = useState<'audio' | 'video' | 'chat' | 'flashcard' | 'flashcards' | 'mindmap' | 'roleplay' | 'infographic' | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [flashcardSections, setFlashcardSections] = useState<any[] | null>(null);
  const [flashcardLoading, setFlashcardLoading] = useState(false);
  const flashcardExportRef = useRef<(() => Promise<void>) | null>(null);
  const [mindmapData, setMindmapData] = useState<any | null>(null);
  const [mindmapLoading, setMindmapLoading] = useState(false);
  const mindmapDownloadRef = useRef<(() => void) | null>(null);
  const [infographicData, setInfographicData] = useState<any | null>(null);
  const [infographicLoading, setInfographicLoading] = useState(false);

  useEffect(() => {
    const parseMaybeJson = (value: any) => {
      if (!value) return null;
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      return value;
    };

    const flashcards = parseMaybeJson(module?.flashcard_data);
    setFlashcardSections(Array.isArray(flashcards) ? flashcards : null);
    setMindmapData(parseMaybeJson(module?.mindmap_data));
    setInfographicData(parseMaybeJson(module?.infographic_data));
    setFlashcardLoading(false);
    setMindmapLoading(false);
    setInfographicLoading(false);
  }, [module?.flashcard_data, module?.mindmap_data, module?.infographic_data]);

  // Roleplay-specific state
  const [roleplayPersona, setRoleplayPersona] = useState<string>('Coach');
  const [roleplayScenario, setRoleplayScenario] = useState<string>('');
  const [roleplayHistory, setRoleplayHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [roleplayInput, setRoleplayInput] = useState<string>('');
  const [roleplayLoading, setRoleplayLoading] = useState(false);
  const [roleplayPersist, setRoleplayPersist] = useState<boolean>(false);

  // Podcast timeline state
  const [podcastTimeline, setPodcastTimeline] = useState<Array<{ speaker: 'sarah' | 'mark' | 'pooja' | 'rahul'; text: string; startSec: number; endSec: number }>>([]);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(-1);
  const [transcriptStarted, setTranscriptStarted] = useState(false);

  // Helper to get display name for speaker
  const getSpeakerDisplayName = (speaker: string) => {
    const names: Record<string, string> = {
      'sarah': 'Sarah',
      'mark': 'Mark',
      'pooja': 'Pooja',
      'rahul': 'Rahul'
    };
    return names[speaker] || speaker;
  };

  // Hydrate timeline from module.podcast_timeline on component mount
  useEffect(() => {
    const timelineField = language === 'hinglish' ? 'podcast_timeline_hinglish' : 'podcast_timeline';
    const timelineData = language === 'hinglish' ? module?.podcast_timeline_hinglish : module?.podcast_timeline;
    
    if (!timelineData) {
      console.log(`[ContentTransformer] No ${timelineField} in module data`);
      return;
    }

    try {
      let timeline = timelineData;
      // If timeline is a string (JSON), parse it
      if (typeof timeline === 'string') {
        timeline = JSON.parse(timeline);
      }

      // Validate timeline data structure
      if (!Array.isArray(timeline)) {
        console.warn(`[ContentTransformer] Invalid ${timelineField} format: not an array`, { timeline });
        return;
      }

      // Validate each segment has required fields
      const isValid = timeline.every(
        (seg: any) =>
          typeof seg.speaker === 'string' &&
          typeof seg.text === 'string' &&
          typeof seg.startSec === 'number' &&
          typeof seg.endSec === 'number'
      );

      if (!isValid) {
        console.warn(`[ContentTransformer] ${timelineField} segments missing required fields`, { timeline });
        return;
      }

      setPodcastTimeline(timeline);
      // console.log(`[ContentTransformer] ${timelineField} loaded from module:`, {
      //   segmentCount: timeline.length,
      //   totalDuration: timeline.length > 0 ? timeline[timeline.length - 1].endSec : 0,
      // });
    } catch (error) {
      console.error(`[ContentTransformer] Failed to parse ${timelineField}:`, {
        error,
        raw: timelineData,
      });
    }
  }, [module?.podcast_timeline, module?.podcast_timeline_hinglish, language]);

  const handleTimeUpdate = (current: number, duration: number, playbackRate: number = 1.0) => {
    if (!duration || podcastTimeline.length === 0) return;

    if (!transcriptStarted && current > 0) {
      setTranscriptStarted(true);
    }

    // currentTime already represents position in audio file
    // Browser handles playback speed internally, no adjustment needed
    let active = -1;
    for (let i = 0; i < podcastTimeline.length; i++) {
      const seg = podcastTimeline[i];
      if (current >= seg.startSec && current < seg.endSec) {
        active = i;
        break;
      }
    }

    // If we're in a pause/silence gap, keep showing the last known segment
    if (active === -1 && activeSegmentIndex >= 0) {
      active = activeSegmentIndex;
    }

    // Clamp to final segment once we've reached the end
    if (active === -1 && current >= podcastTimeline[podcastTimeline.length - 1].endSec) {
      active = podcastTimeline.length - 1;
    }

    if (active !== activeSegmentIndex) {
      setActiveSegmentIndex(active);
      if (active >= 0 && active < podcastTimeline.length) {
        // console.log('[ContentTransformer] Active segment:', {
        //   index: active,
        //   speaker: podcastTimeline[active].speaker,
        //   currentTime: current,
        //   playbackRate,
        //   segmentRange: `${podcastTimeline[active].startSec.toFixed(2)}s - ${podcastTimeline[active].endSec.toFixed(2)}s`,
        // });
      }
    }
  };

  const handleResetTranscript = () => {
    setLiveTranscript('');
    setChatMessages([]);
  };

  // Roleplay send handler
  const handleSendRoleplay = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!roleplayInput.trim() || roleplayLoading) return;

    const userMessage = roleplayInput.trim();
    setRoleplayInput('');

    const newUserMessage = { role: 'user' as const, content: userMessage };
    setRoleplayHistory(prev => [...prev, newUserMessage]);
    setRoleplayLoading(true);

    try {
      const response = await fetch('/api/roleplay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          processed_module_id: module.processed_module_id,
          user_message: userMessage,
          persona: roleplayPersona,
          scenario: roleplayScenario,
          chat_history: roleplayHistory,
          persist: roleplayPersist,
        }),
      });

      const data = await response.json();
      if (response.ok && data.message) {
        setRoleplayHistory(prev => [...prev, { role: 'assistant', content: data.message }]);
      } else {
        setRoleplayHistory(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]);
      }
    } catch (err) {
      console.error('Roleplay error:', err);
      setRoleplayHistory(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]);
    } finally {
      setRoleplayLoading(false);
    }
  };

  return (
    <div className="mb-10 w-full">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-lg mb-6">
        <div className="flex items-start gap-4 mb-8">
          <div className="h-14 w-14 rounded-xl bg-white border-2 border-slate-300 text-slate-800 flex items-center justify-center text-2xl shadow-lg">
            ✨
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Lucid Studio</h2>
            <p className="text-slate-600 text-sm mt-1">Convert this Sprint into your preferred format.</p>
          </div>
        </div>

  <div className="grid grid-cols-5 gap-4 mb-6">
          <div
            onClick={() => {
              if (selectedOption === 'audio') {
                setAudioOpen((v) => !v);
              } else {
                setSelectedOption('audio');
                setAudioOpen(true);
              }
            }}
            className={clsx(
              'rounded-xl p-5 cursor-pointer transition-all border-2',
              selectedOption === 'audio'
                ? 'bg-slate-50 border-blue-500 shadow-lg'
                : 'bg-white border-slate-300 hover:border-slate-400'
            )}
          >
            <div className="text-3xl mb-3">🎧</div>
            <div className="font-bold text-slate-900 text-sm">Podcast</div>
            <div className="text-slate-500 text-xs mt-1">Listen on the go</div>
          </div>

          <div
            onClick={() => setSelectedOption('video')}
            className={clsx(
              'rounded-xl p-5 cursor-pointer transition-all border-2',
              selectedOption === 'video'
                ? 'bg-slate-50 border-red-500 shadow-lg'
                : 'bg-white border-slate-300 hover:border-slate-400'
            )}
          >
            <div className="text-3xl mb-3">🎬</div>
            <div className="font-bold text-slate-900 text-sm">Explainer Video</div>
            <div className="text-slate-500 text-xs mt-1">Video lesson</div>
          </div>

          {/* AI Chat (Voice assistant) button removed as requested */}

          <div
            onClick={async () => {
              setSelectedOption('mindmap');

              if (mindmapData || module.mindmap_data) return;

              setMindmapLoading(true);
              try {
                const studyText = module.content || '';
                const res = await fetch(`${API_BASE}/api/generate-mindmap`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ content: studyText, title: module.title }),
                });

                const data = await res.json();

                if (res.ok && data && data.nodes && data.edges) {
                  setMindmapData(data);

                  if (employeeId) {
                    await fetch(`${API_BASE}/api/processed-modules/${module.processed_module_id}/content-generation`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', 'X-User-ID': employeeId },
                      body: JSON.stringify({ mindmap_data: data }),
                    });

                    if (onModuleUpdate) {
                      onModuleUpdate((prev: any) => ({ ...prev, mindmap_data: data }));
                    }
                  }
                }
              } catch (e) {
                console.error('Error generating mindmap', e);
                setMindmapData(null);
              } finally {
                setMindmapLoading(false);
              }
            }}
            className={clsx(
              'rounded-xl p-5 cursor-pointer transition-all border-2',
              selectedOption === 'mindmap'
                ? 'bg-slate-50 border-yellow-500 shadow-lg'
                : 'bg-white border-slate-300 hover:border-slate-400'
            )}
          >
            <div className="text-3xl mb-3">🗺️</div>
            <div className="font-bold text-slate-900 text-sm">Mindmap</div>
            <div className="text-slate-500 text-xs mt-1">Structured concepts</div>
          </div>

          {/* Flash cards */}
          <div
            onClick={async () => {
              setSelectedOption('flashcard');

              if (flashcardSections && flashcardSections.length > 0) return;

              try {
                setFlashcardLoading(true);

                const studyText = module.content || '';
                const res = await fetch(`${API_BASE}/api/generate-flashcards-gemini`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ content: studyText }),
                });

                const raw = await res.clone().text();
                let data: any = null;
                try {
                  data = await res.json();
                } catch {
                  data = JSON.parse(raw);
                }

                if (res.ok && Array.isArray(data)) {
                  setFlashcardSections(data);

                  if (employeeId) {
                    await fetch(`${API_BASE}/api/processed-modules/${module.processed_module_id}/content-generation`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', 'X-User-ID': employeeId },
                      body: JSON.stringify({ flashcard_data: data }),
                    });

                    if (onModuleUpdate) {
                      onModuleUpdate((prev: any) => ({ ...prev, flashcard_data: data }));
                    }
                  }
                } else {
                  setFlashcardSections([{ heading: 'Generation failed', points: [data?.error || 'Check console'] }]);
                }
              } catch (e) {
                console.error('Error generating flashcards', e);
              } finally {
                setFlashcardLoading(false);
              }
            }}
            className={clsx(
              'rounded-xl p-5 cursor-pointer transition-all border-2',
              selectedOption === 'flashcard'
                ? 'bg-slate-50 border-green-500 shadow-lg'
                : 'bg-white border-slate-300 hover:border-slate-400'
            )}
          >
            <div className="text-3xl mb-3">🃏</div>
            <div className="font-bold text-slate-900 text-sm">Flash cards</div>
            <div className="text-slate-500 text-xs mt-1">Quick revision</div>
          </div>

          {/* Infographic button */}
          <div
            onClick={async () => {
              setSelectedOption('infographic');

              if (infographicData) return;

              try {
                setInfographicLoading(true);
                const contentText = module.content || '';

                const res = await fetch(`${API_BASE}/api/generate-infographic`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    content: contentText,
                    title: module.title,
                    processed_module_id: module.processed_module_id,
                  }),
                });

                let data: any = null;
                try {
                  data = await res.json();
                } catch {
                  console.error('Failed to parse JSON');
                }

                if (res.ok && data && !data.error) {
                  setInfographicData(data);

                  if (employeeId) {
                    await fetch(`${API_BASE}/api/processed-modules/${module.processed_module_id}/content-generation`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', 'X-User-ID': employeeId },
                      body: JSON.stringify({ infographic_data: data }),
                    });

                    if (onModuleUpdate) {
                      onModuleUpdate((prev: any) => ({ ...prev, infographic_data: data }));
                    }
                  }
                } else {
                  alert(`Failed to generate visual guide: ${data?.error || 'Unknown error'}`);
                }
              } catch (e: any) {
                console.error('[infographic] Error:', e);
                alert(`Error generating visual guide: ${e.message || 'Unknown error'}`);
              } finally {
                setInfographicLoading(false);
              }
            }}
            className={clsx(
              'rounded-xl p-5 cursor-pointer transition-all border-2',
              selectedOption === 'infographic'
                ? 'bg-slate-50 border-purple-500 shadow-lg'
                : 'bg-white border-slate-300 hover:border-slate-400'
            )}
          >
            <div className="text-3xl mb-3">📊</div>
            <div className="font-bold text-slate-900 text-sm">Visual Guide</div>
            <div className="text-slate-500 text-xs mt-1">Structured overview</div>
          </div>

          {/* Flashcards button removed - keep only Flash cards button */}
          {/*<div
            onClick={() => setSelectedOption('roleplay')}
            className={clsx(
              'rounded-xl p-5 cursor-pointer transition-all border-2',
              selectedOption === 'roleplay'
                ? 'bg-slate-50 border-green-500 shadow-lg'
                : 'bg-white border-slate-300 hover:border-slate-400'
            )}
          >
            <div className="text-3xl mb-3">🎭</div>
            <div className="font-bold text-slate-900 text-sm">Role-playing Exercise</div>
            <div className="text-slate-500 text-xs mt-1">Role Play</div>
          </div> */}

        </div>

        {selectedOption === 'audio' && audioOpen && (
          <div className="space-y-3 flex flex-col">
             <div className="flex items-center gap-3">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'en' | 'hinglish')}
                className="px-3 py-1 rounded border text-sm bg-white"
              >
                <option value="en">English</option>
                <option value="hinglish">हिंदी</option>
              </select>
            </div>

            {hasCurrentLanguageAudio(language) && (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <AudioPlayer
                    employeeId={employeeId}
                    processedModuleId={module.processed_module_id}
                    moduleId={module.original_module_id}
                    audioUrl={language === 'hinglish' ? (module.audio_url_hinglish || module.audio_url) : module.audio_url}
                    onTimeUpdate={(current, duration, playbackRate) => handleTimeUpdate(current, duration, playbackRate)}
                    onPlayExtra={handleResetTranscript}
                    className="w-full"
                  />
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setTranscriptOpen((v) => !v)}
                    className="flex items-center justify-between w-full text-xs font-semibold text-slate-600"
                  >
                    <span>Live transcript</span>
                    <span
                      className={clsx(
                        'transition-transform',
                        transcriptOpen ? 'rotate-180' : 'rotate-0'
                      )}
                      aria-hidden
                    >
                      ▾
                    </span>
                  </button>

                  {transcriptOpen && (
                    <div className="mt-3 h-96 overflow-y-auto space-y-3 flex flex-col px-3">
                      {transcriptStarted && activeSegmentIndex >= 0 && podcastTimeline.length > 0 ? (
                        (() => {
                          const segments = [];
                          // Show previous segment if available
                          if (activeSegmentIndex > 0) {
                            const prev = podcastTimeline[activeSegmentIndex - 1];
                            segments.push(
                              <div key={`prev-${activeSegmentIndex - 1}`} className="opacity-50 transition-all duration-300 ease-out">
                                <div className="flex justify-start">
                                  <div className="rounded-lg px-4 py-2 bg-gray-100 text-gray-600 rounded-bl-none max-w-2xl">
                                    <div className="font-semibold text-xs mb-2 opacity-75">
                                      {getSpeakerDisplayName(prev.speaker)}
                                    </div>
                                    <p className="whitespace-normal break-words leading-relaxed text-sm">{prev.text}</p>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          // Show current segment
                          const curr = podcastTimeline[activeSegmentIndex];
                          const isHost = curr.speaker === 'sarah' || curr.speaker === 'pooja';
                          segments.push(
                            <div key={`curr-${activeSegmentIndex}`}>
                              <div className={clsx('flex', isHost ? 'justify-start' : 'justify-end')}>
                                <div className={clsx(
                                  'rounded-lg px-4 py-2 max-w-2xl font-semibold ring-2 ring-blue-500 transition-all duration-300 ease-out',
                                  isHost
                                    ? 'bg-blue-100 text-blue-900 rounded-bl-none'
                                    : 'bg-green-100 text-green-900 rounded-br-none'
                                )}>
                                  <div className="font-semibold text-xs mb-2 opacity-75">
                                    {getSpeakerDisplayName(curr.speaker)} (now)
                                  </div>
                                  <p className="whitespace-normal break-words leading-relaxed text-base">{curr.text}</p>
                                </div>
                              </div>
                            </div>
                          );
                          // Show next segment if available
                          if (activeSegmentIndex < podcastTimeline.length - 1) {
                            const next = podcastTimeline[activeSegmentIndex + 1];
                            const isNextHost = next.speaker === 'sarah' || next.speaker === 'pooja';
                            segments.push(
                              <div key={`next-${activeSegmentIndex + 1}`} className="opacity-50 transition-all duration-300 ease-out">
                                <div className={clsx('flex', isNextHost ? 'justify-start' : 'justify-end')}>
                                  <div className="rounded-lg px-4 py-2 bg-gray-100 text-gray-600 rounded-br-none max-w-2xl">
                                    <div className="font-semibold text-xs mb-2 opacity-75">
                                      {getSpeakerDisplayName(next.speaker)}
                                    </div>
                                    <p className="whitespace-normal break-words leading-relaxed text-sm">{next.text}</p>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return segments;
                        })()
                      ) : (
                        <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                          Press play to see the conversation unfold
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {!hasCurrentLanguageAudio(language) && (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 space-y-4">
                <div>Audio for this language is not available yet.</div>
                <GenerateAudioButton
                  moduleId={module.processed_module_id}
                  language={language}
                  onAudioGenerated={(url, data) => {
                    if (onAudioGenerated) onAudioGenerated(url, data);
                    if (data?.timeline && Array.isArray(data.timeline)) {
                      setPodcastTimeline(data.timeline);
                    }
                  }}
                />
              </div>
            )}
          </div>
        )}

        {selectedOption === 'video' && (
          <div className="space-y-3 flex flex-col">
            {module.video_url && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <video controls className="w-full rounded-lg">
                  <source src={module.video_url} type="video/mp4" />
                  Your browser does not support video playback.
                </video>
              </div>
            )}

            {!module.video_url && (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 space-y-4">
                <div>Video is not available yet.</div>
                <GenerateVideoButton
                  moduleId={module.processed_module_id}
                  onVideoGenerated={(url) => {
                    if (onVideoGenerated) onVideoGenerated(url);
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Placeholder / generated output for other options */}
        {selectedOption !== 'audio' && selectedOption !== 'video' && (
          <div className="text-slate-600 text-sm text-left">

                  {selectedOption === 'flashcard' && (
                    <div>
                      {flashcardLoading && (
                        <div className="rounded-xl border border-slate-200 bg-white p-12 text-left flex flex-col items-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mx-auto mb-3"></div>
                          <div>Loading flashcards...</div>
                        </div>
                      )}

                      {!flashcardLoading && (
                        <div>
                          {/* Download button outside the white box, aligned right */}
                          {flashcardSections && flashcardSections.length > 0 && (
                            <div className="mb-2 flex justify-end">
                              <button
                                onClick={() => flashcardExportRef.current?.()}
                                className="bg-white px-2 py-1 rounded shadow border flex items-center justify-center"
                                title="Download flashcards image"
                              >
                                <Download size={16} />
                              </button>
                            </div>
                          )}
                          <div className="rounded-xl border border-slate-200 bg-white p-6 text-left">
                            <FlashcardCards
                              sections={flashcardSections}
                              onExportReady={(fn) => { flashcardExportRef.current = fn; }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 'flashcard' (singular) is used to show generated sections inline */}

              {selectedOption === 'mindmap' && (
                <div>
                  {mindmapLoading && (
                    <div className="rounded-xl border border-slate-200 bg-white p-12 text-left flex flex-col items-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mx-auto mb-3"></div>
                      <div>Loading mindmap...</div>
                    </div>
                  )}

                  {!mindmapLoading && mindmapData && (
                    <div>
                      {/* Download button outside the white box, aligned right */}
                      <div className="mb-2 flex justify-end">
                        <button
                          onClick={() => mindmapDownloadRef.current?.()}
                          className="bg-white px-2 py-1 rounded shadow border flex items-center justify-center"
                          title="Download mindmap image"
                        >
                          <Download size={16} />
                        </button>
                      </div>
                      <div className="w-full h-[45vh] rounded-xl border border-slate-200 overflow-hidden">
                        <MindmapViewer
                          data={mindmapData}
                          source={module.content || ''}
                          onDownloadReady={(fn) => { mindmapDownloadRef.current = fn; }}
                        />
                      </div>
                    </div>
                  )}

                  {!mindmapLoading && !mindmapData && (
                    <div className="rounded-xl border border-slate-200 bg-white p-12 text-left text-sm text-gray-500">Mindmap is not available for this module yet.</div>
                  )}

                  {/* Debug preview removed */}
                </div>
              )}

              {selectedOption === 'infographic' && (
                <div>
                  {infographicLoading && (
                    <div className="rounded-xl border border-slate-200 bg-white p-12 text-left flex flex-col items-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mx-auto mb-3"></div>
                      <div>Loading visual guide...</div>
                    </div>
                  )}

                  {!infographicLoading && infographicData && (
                    <div>
                      {/* Download button outside the white box, aligned right */}
                      <div className="mb-2 flex justify-end">
                        <button
                          onClick={() => {
                            try {
                              const pdf = new jsPDF();
                              const pageWidth = pdf.internal.pageSize.getWidth();
                              const pageHeight = pdf.internal.pageSize.getHeight();
                              const margin = 20;
                              let yPosition = margin;

                              // Title
                              pdf.setFontSize(18);
                              pdf.setFont('helvetica', 'bold');
                              const titleLines = pdf.splitTextToSize(infographicData.title, pageWidth - 2 * margin);
                              pdf.text(titleLines, pageWidth / 2, yPosition, { align: 'center' });
                              yPosition += titleLines.length * 10 + 10;

                              // Helper function to check if new page is needed
                              const checkPageBreak = (requiredSpace: number) => {
                                if (yPosition + requiredSpace > pageHeight - margin) {
                                  pdf.addPage();
                                  yPosition = margin;
                                  return true;
                                }
                                return false;
                              };

                              // Main sections
                              if (infographicData.sections) {
                                infographicData.sections.forEach((section: any) => {
                                  checkPageBreak(40);
                                  
                                  // Section title
                                  pdf.setFontSize(14);
                                  pdf.setFont('helvetica', 'bold');
                                  pdf.text(section.title, margin, yPosition);
                                  yPosition += 10;

                                  // Section points
                                  if (section.points) {
                                    pdf.setFontSize(10);
                                    section.points.forEach((point: any) => {
                                      checkPageBreak(20);
                                      pdf.setFont('helvetica', 'bold');
                                      const pointTitle = pdf.splitTextToSize(`• ${point.title}`, pageWidth - 2 * margin - 10);
                                      pdf.text(pointTitle, margin + 5, yPosition);
                                      yPosition += pointTitle.length * 5 + 2;
                                      
                                      pdf.setFont('helvetica', 'normal');
                                      const pointText = pdf.splitTextToSize(point.text, pageWidth - 2 * margin - 10);
                                      pdf.text(pointText, margin + 5, yPosition);
                                      yPosition += pointText.length * 5 + 5;
                                    });
                                  }

                                  // Sub-sections
                                  if (section.subSections) {
                                    section.subSections.forEach((sub: any) => {
                                      checkPageBreak(30);
                                      
                                      pdf.setFontSize(12);
                                      pdf.setFont('helvetica', 'bold');
                                      pdf.text(sub.title, margin + 10, yPosition);
                                      yPosition += 8;

                                      if (sub.points) {
                                        pdf.setFontSize(9);
                                        sub.points.forEach((subPoint: any) => {
                                          checkPageBreak(15);
                                          pdf.setFont('helvetica', 'bold');
                                          const subTitle = pdf.splitTextToSize(`  - ${subPoint.title}`, pageWidth - 2 * margin - 15);
                                          pdf.text(subTitle, margin + 15, yPosition);
                                          yPosition += subTitle.length * 4 + 2;
                                          
                                          pdf.setFont('helvetica', 'normal');
                                          const subText = pdf.splitTextToSize(subPoint.text, pageWidth - 2 * margin - 15);
                                          pdf.text(subText, margin + 15, yPosition);
                                          yPosition += subText.length * 4 + 4;
                                        });
                                      }
                                    });
                                  }

                                  yPosition += 10;
                                });
                              }

                              // Critical flags
                              if (infographicData.criticalFlags && infographicData.criticalFlags.flags) {
                                checkPageBreak(40);
                                
                                pdf.setFontSize(14);
                                pdf.setFont('helvetica', 'bold');
                                pdf.setTextColor(220, 38, 38); // Red color
                                pdf.text(infographicData.criticalFlags.title || 'Critical Red Flags', margin, yPosition);
                                pdf.setTextColor(0, 0, 0); // Reset to black
                                yPosition += 10;

                                pdf.setFontSize(10);
                                infographicData.criticalFlags.flags.forEach((flag: any) => {
                                  checkPageBreak(25);
                                  
                                  pdf.setFont('helvetica', 'bold');
                                  const flagTitle = pdf.splitTextToSize(`⚠ ${flag.title}`, pageWidth - 2 * margin - 5);
                                  pdf.text(flagTitle, margin + 5, yPosition);
                                  yPosition += flagTitle.length * 5 + 2;

                                  if (flag.value) {
                                    pdf.setFont('helvetica', 'bold');
                                    pdf.text(flag.value, margin + 5, yPosition);
                                    yPosition += 7;
                                  }

                                  pdf.setFont('helvetica', 'normal');
                                  const flagText = pdf.splitTextToSize(flag.text, pageWidth - 2 * margin - 5);
                                  pdf.text(flagText, margin + 5, yPosition);
                                  yPosition += flagText.length * 5 + 8;
                                });
                              }

                              // Save the PDF
                              const fileName = `${infographicData.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_visual_guide.pdf`;
                              pdf.save(fileName);
                            } catch (error) {
                              console.error('Error generating PDF:', error);
                              alert('Failed to generate PDF. Please try again.');
                            }
                          }}
                          className="bg-white px-2 py-1 rounded shadow border flex items-center justify-center"
                          title="Download visual guide PDF"
                        >
                          <Download size={16} />
                        </button>
                      </div>

                      <div className="w-full rounded-xl border border-slate-200 bg-white p-4">
                        {/* Header with title */}
                        <div className="mb-4 text-center">
                          <h3 className="text-2xl font-bold">{infographicData.title}</h3>
                        </div>
                      
                      {/* Main sections */}
                      {infographicData.sections && infographicData.sections.map((section: any, sIdx: number) => (
                        <div key={sIdx} className="mb-8 pb-8">
                          <div className="flex items-center gap-3 mb-4">
                            <div className="text-3xl">{section.icon === 'umbrella' ? '☂️' : '📋'}</div>
                            <h4 className="text-xl font-bold text-gray-900">{section.title}</h4>
                          </div>
                          
                          {section.points && section.points.map((point: any, pIdx: number) => (
                            <div key={pIdx} className="ml-12 mb-3">
                              <div className="font-semibold text-gray-800">{point.title}</div>
                              <div className="text-gray-600 text-sm">{point.text}</div>
                            </div>
                          ))}
                          
                          {/* Sub-sections */}
                          {section.subSections && (
                            <div className="grid grid-cols-3 gap-4 mt-6 ml-12">
                              {section.subSections.map((sub: any, subIdx: number) => (
                                <div 
                                  key={subIdx} 
                                  className={clsx(
                                    'rounded-xl p-5',
                                    sub.color === 'blue' ? 'bg-blue-50' :
                                    sub.color === 'green' ? 'bg-green-50' :
                                    'bg-yellow-50'
                                  )}
                                >
                                  <div className="text-2xl mb-2">
                                    {sub.icon === 'person' ? '👤' : sub.icon === 'property' ? '🏠' : '⏰'}
                                  </div>
                                  <h5 className="font-bold text-gray-900 mb-3">{sub.title}</h5>
                                  {sub.points && sub.points.map((p: any, pIdx: number) => (
                                    <div key={pIdx} className="mb-2">
                                      <div className="font-semibold text-sm">{p.title}:</div>
                                      <div className="text-xs text-gray-700">{p.text}</div>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      
                      {/* Critical Flags */}
                      {infographicData.criticalFlags && (
                        <div className="mt-8 pt-8">
                          <h4 className="text-xl font-bold text-red-600 mb-6">{infographicData.criticalFlags.title}</h4>
                          <div className="grid grid-cols-3 gap-4">
                            {infographicData.criticalFlags.flags && infographicData.criticalFlags.flags.map((flag: any, fIdx: number) => (
                              <div key={fIdx} className="bg-red-50 border-2 border-red-300 rounded-xl p-5">
                                <div className="text-3xl mb-2">
                                  {flag.icon === 'mismatch' ? '💰' : flag.icon === 'gauge' ? '📊' : '📄'}
                                </div>
                                <h5 className="font-bold text-gray-900 mb-2">{flag.title}</h5>
                                {flag.value && (
                                  <div className="text-2xl font-bold text-red-600 mb-2">{flag.value}</div>
                                )}
                                <p className="text-sm text-gray-700">{flag.text}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      </div>
                    </div>
                  )}

                  {!infographicLoading && !infographicData && (
                    <div className="rounded-xl border border-slate-200 bg-white p-12 text-left text-sm text-gray-500">Visual guide is not available for this module yet.</div>
                  )}
                </div>
              )}

              {selectedOption === 'chat' && (
                <div className="rounded-xl border border-slate-200 bg-white p-12 text-left">
                  <div className="rounded-xl border p-4 mb-4 max-h-96 overflow-auto bg-white">
                    {userChatHistory.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-64 text-center">
                        <div className="text-6xl mb-4">💬</div>
                        <h3 className="text-lg font-semibold text-gray-700 mb-2">AI Voice Assistant</h3>
                        <p className="text-sm text-gray-500">Click the voice button below to start a conversation</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {userChatHistory.map((msg: { role: 'user' | 'assistant'; content: string }, idx: number) => (
                          <div
                            key={idx}
                            className={clsx(
                              'flex items-end gap-2',
                              msg.role === 'user' ? 'justify-end' : 'justify-start'
                            )}
                          >
                            {msg.role === 'assistant' && (
                              <VoiceOutput text={msg.content} disabled={chatLoading} />
                            )}
                            <div
                              className={clsx(
                                'rounded-lg px-4 py-3 max-w-3xl',
                                msg.role === 'user'
                                  ? 'bg-blue-600 text-white rounded-br-none'
                                  : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'
                              )}
                            >
                              {msg.role === 'assistant' && (
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-xs font-semibold text-gray-600">Lucid Assistant</span>
                                </div>
                              )}
                              <p className="whitespace-pre-wrap break-words leading-relaxed text-sm">
                                {msg.content}
                              </p>
                            </div>
                          </div>
                        ))}
                        {chatLoading && (
                          <div className="flex justify-start">
                            <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 rounded-bl-none">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedOption === 'roleplay' && (
                <div>
                  <div className="mb-4 grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Persona</label>
                      <input
                        value={roleplayPersona}
                        onChange={(e) => setRoleplayPersona(e.target.value)}
                        className="w-full rounded border px-3 py-2 text-sm"
                        placeholder="e.g., Supportive manager"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Scenario</label>
                      <input
                        value={roleplayScenario}
                        onChange={(e) => setRoleplayScenario(e.target.value)}
                        className="w-full rounded border px-3 py-2 text-sm"
                        placeholder="Short scenario (what's the goal)"
                      />
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={roleplayPersist} onChange={(e) => setRoleplayPersist(e.target.checked)} />
                      <span>Save transcript</span>
                    </label>
                  </div>

                  <div className="rounded-xl border p-4 mb-4 max-h-64 overflow-auto bg-white">
                    {roleplayHistory.length === 0 ? (
                      <div className="text-sm text-gray-500">Start the roleplay by sending a message.</div>
                    ) : (
                      roleplayHistory.map((msg, idx) => (
                        <div key={idx} className={clsx('mb-3', msg.role === 'user' ? 'text-right' : 'text-left')}>
                          <div className={clsx('inline-block px-4 py-2 rounded-lg', msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800')}>
                            {msg.content}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <form onSubmit={handleSendRoleplay} className="flex gap-3">
                    <input
                      value={roleplayInput}
                      onChange={(e) => setRoleplayInput(e.target.value)}
                      placeholder="Speak in character..."
                      className="flex-1 outline-none text-slate-700 placeholder-slate-400 bg-gray-50 rounded-lg px-4 py-3 border border-gray-200 focus:border-blue-500 focus:bg-white transition-all"
                      disabled={roleplayLoading}
                    />
                    <button
                      type="submit"
                      className="px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={roleplayLoading || !roleplayInput.trim()}
                    >
                      {roleplayLoading ? 'Sending...' : 'Send'}
                    </button>
                  </form>
                </div>
              )}
            </div>
        )}
      </div>
    </div>
  );
}
// Keep old AudioSection as alias for backward compatibility
function AudioSection(props: any) {
  return <ContentTransformer {...props} />;
}

// Debug preview removed

// Helper to format content with beautiful card-based UI
function formatContent(content: string) {
  // If content is JSON, pretty print
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === "object") {
      return `<pre class="bg-gray-100 p-4 rounded-lg overflow-x-auto"><code>${JSON.stringify(parsed, null, 2)}</code></pre>`;
    }
  } catch { }

  // Check if content is already HTML
  if (/<[^>]+>/.test(content)) {
    // It's HTML content - style it appropriately
    return styleHTMLContent(content);
  }

  console.log("This is not a html content")

  // Legacy markdown-to-HTML conversion for backward compatibility
  return styleMarkdownContent(content);
}

function styleHTMLContent(content: string): string {

  console.log("Style the html content is called")
  // Create a temporary container to work with HTML
  if (typeof window === 'undefined') {
    console.log("Inside this if")
    // Server-side fallback
    return sanitizeHTML(content);
  }

  try {
    const container = document.createElement('div');
    container.innerHTML = sanitizeHTML(content);

    // Style tables with Tailwind classes
    const tables = container.querySelectorAll('table');
    tables.forEach((table) => {
      table.className = 'w-full  border-2 border-gray-300 rounded-lg overflow-hidden shadow-sm mb-6';
      table.setAttribute('style', 'border-collapse: collapse; border: 2px solid rgb(0, 0, 0);');
      
      // Style table headers
      const headers = table.querySelectorAll('thead th, thead td');
      headers.forEach((header) => {
        header.className = 'bg-blue-50 border border-gray-300 px-4 py-3 text-left font-semibold text-gray-900 text-sm';
        (header as HTMLElement).style.cssText = 'border: 1px solid rgb(0, 0, 0); padding: 12px 16px; background-color: #eff6ff; font-weight: 600;';
      });

      // Style table rows
      const rows = table.querySelectorAll('tr');
      rows.forEach((row) => {
        (row as HTMLElement).style.cssText = 'border-bottom: 2px solidrgb(21, 22, 22);';
      });

      // Style table body
      const cells = table.querySelectorAll('tbody td, tbody th');
      cells.forEach((cell, idx) => {
        const isEvenRow = Math.floor(idx / (table.querySelectorAll('tbody tr')[0]?.children.length || 1)) % 2;
        cell.className = `border border-gray-300 px-4 py-3 text-gray-800 text-sm ${isEvenRow ? 'bg-white' : 'bg-gray-50'}`;
        (cell as HTMLElement).style.cssText = `border: 1px solidrgb(11, 12, 12); padding: 12px 16px; ${isEvenRow ? 'background-color: #ffffff;' : 'background-color: #f9fafb;'}`;
      });



      console.log("THis is the edited table")
      console.log(table.querySelectorAll)
    });

    // Style headings
    container.querySelectorAll('h1').forEach((h) => {
      h.className = 'text-3xl font-bold mt-8 mb-4 text-gray-900';
    });
    container.querySelectorAll('h2').forEach((h) => {
      h.className = 'text-2xl font-bold mt-8 mb-4 text-gray-900 pb-2 border-b border-gray-200';
    });
    container.querySelectorAll('h3').forEach((h) => {
      h.className = 'text-xl font-semibold mt-6 mb-3 text-gray-800';
    });
    container.querySelectorAll('h4').forEach((h) => {
      h.className = 'text-lg font-semibold mt-5 mb-2 text-gray-700';
    });

    // Style paragraphs
    container.querySelectorAll('p').forEach((p) => {
      if (!p.className) {
        p.className = 'mb-4 text-gray-700 leading-relaxed';
      }
    });

    // Style lists
    container.querySelectorAll('ul').forEach((ul) => {
      ul.className = 'list-disc list-inside mb-4 space-y-2 text-gray-700 ml-4';
    });
    container.querySelectorAll('ol').forEach((ol) => {
      ol.className = 'list-decimal list-inside mb-4 space-y-2 text-gray-700 ml-4';
    });
    container.querySelectorAll('li').forEach((li) => {
      if (!li.className) {
        li.className = 'mb-2';
      }
    });

    // Style blockquotes and callouts
    container.querySelectorAll('blockquote').forEach((bq) => {
      if (bq.className.includes('key-takeaway')) {
        bq.className = 'border-l-4 border-blue-500 bg-blue-50 p-4 rounded-r-lg mb-6 italic text-gray-800';
      } else {
        bq.className = 'border-l-4 border-gray-400 bg-gray-50 p-4 rounded-r-lg mb-6 text-gray-700';
      }
    });

    // Style callout divs
    container.querySelectorAll('div').forEach((div) => {
      if (div.className.includes('callout')) {
        let bgColor = 'bg-blue-50';
        let borderColor = 'border-blue-300';
        let titleColor = 'text-blue-900';

        if (div.className.includes('warning')) {
          bgColor = 'bg-yellow-50';
          borderColor = 'border-yellow-300';
          titleColor = 'text-yellow-900';
        } else if (div.className.includes('tip')) {
          bgColor = 'bg-green-50';
          borderColor = 'border-green-300';
          titleColor = 'text-green-900';
        } else if (div.className.includes('definition')) {
          bgColor = 'bg-purple-50';
          borderColor = 'border-purple-300';
          titleColor = 'text-purple-900';
        }

        div.className = `${bgColor} border-l-4 ${borderColor} p-4 rounded-r-lg mb-4`;
        
        // Style strong tags inside callouts as titles
        const strong = div.querySelector('strong');
        if (strong) {
          strong.className = `${titleColor} font-bold`;
        }
      }
    });

    // Style strong and em tags
    container.querySelectorAll('strong').forEach((s) => {
      if (!s.className) {
        s.className = 'font-semibold text-gray-900';
      }
    });
    container.querySelectorAll('em').forEach((e) => {
      if (!e.className) {
        e.className = 'italic text-gray-700';
      }
    });

    // Style code blocks and inline code
    container.querySelectorAll('code').forEach((code) => {
      if (code.parentElement?.tagName === 'PRE') {
        code.className = 'text-sm font-mono';
      } else {
        code.className = 'bg-gray-100 px-2 py-1 rounded text-sm font-mono text-red-700';
      }
    });
    container.querySelectorAll('pre').forEach((pre) => {
      pre.className = 'bg-gray-100 p-4 rounded-lg my-4 overflow-x-auto border border-gray-300';
    });

    // Style images with alt text as diagrams
    container.querySelectorAll('img').forEach((img) => {
      img.className = 'max-w-full h-auto rounded-lg border border-gray-300 my-4 shadow-sm';
      if (!img.alt) {
        img.alt = 'Content diagram';
      }
    });

    return container.innerHTML;
  } catch (error) {
    console.error('Error styling HTML content:', error);
    return sanitizeHTML(content);
  }
}

function styleMarkdownContent(content: string): string {
  // Remove visual divider lines made of underscores/dashes before formatting
  let formatted = content
    .replace(/^\s*[_\-—–=]{3,}\s*$/gm, '')
    .replace(/^### (.*$)/gm, '<h3 class="text-xl font-semibold mt-6 mb-3 text-gray-800">$1</h3>')
    .replace(/^## (.*$)/gm, '<h2 class="text-2xl font-bold mt-8 mb-4 text-gray-900">$1</h2>')
    .replace(/^# (.*$)/gm, '<h1 class="text-3xl font-bold mt-8 mb-6 text-gray-900">$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    .replace(/__(.*?)__/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em class="italic text-gray-700">$1</em>')
    .replace(/_(.*?)_/g, '<em class="italic text-gray-700">$1</em>')
    .replace(/```([\s\S]*?)```/g, '<pre class="bg-gray-100 p-4 rounded-lg my-4 overflow-x-auto"><code class="text-sm">$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-2 py-1 rounded text-sm font-mono">$1</code>')
    // Enhanced bullet point handling - support both • and - and *
    .replace(/^[•\-\*] (.*$)/gm, '<li class="ml-6 mb-2 list-disc">$1</li>')
    .replace(/^\d+\.\s+(.*$)/gm, '<li class="ml-6 mb-2 list-decimal">$1</li>')
    .replace(/\n\n+/g, '</p><p class="mb-4 text-gray-700 leading-relaxed">')
    .replace(/\n/g, '<br/>');

  formatted = '<p class="mb-4 text-gray-700 leading-relaxed">' + formatted + '</p>';

  // Group list items into proper ul/ol tags
  formatted = formatted
    .replace(/<p class="mb-4 text-gray-700 leading-relaxed">(<li class="ml-6 mb-2 list-disc[^>]*>.*?(?:<\/li>(?:\s*<br\/>\s*<li|<\/li>))*<\/li>)/g, '<ul class="mb-4 space-y-2 list-disc ml-6">$1</ul>')
    .replace(/<p class="mb-4 text-gray-700 leading-relaxed">(<li class="ml-6 mb-2 list-decimal[^>]*>.*?(?:<\/li>(?:\s*<br\/>\s*<li|<\/li>))*<\/li>)/g, '<ol class="mb-4 space-y-2 list-decimal ml-6">$1</ol>')
    .replace(/<br\/>\s*(<li class="ml-6 mb-2[^>]*>)/g, '$1')
    .replace(/(<\/li>)\s*<br\/>/g, '$1');

  // Clean up empty paragraphs
  formatted = formatted.replace(/<p class="mb-4 text-gray-700 leading-relaxed">\s*<\/p>/g, '');

  // Remove learning style codes (CS, CR, AS, AR) from content
  formatted = formatted.replace(/\s*\([CS|CR|AS|AR|cs|cr|as|ar|,\s]+\)/gi, '');
  formatted = formatted.replace(/\b(CS|CR|AS|AR)\b(?=\W|$)/g, '');


  console.log("This is getting called",formatted)
  return formatted;
}

function GenerateAudioButton({
  moduleId,
  onAudioGenerated,
  language = 'en',
}: {
  moduleId: string;
  onAudioGenerated: (url: string, data?: any) => void;
  language?: 'en' | 'hinglish';
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/tts?processed_module_id=${moduleId}&language=${language}`);
      const data = await res.json();
      if (res.ok && data.audioUrl) {
        onAudioGenerated(data.audioUrl, {
          transcript: data.podcastTranscript,
          timeline: data.podcastTimeline,
          language,
        });
      } else {
        setError(data.error || 'Failed to generate audio');
      }
    } catch (e: any) {
      setError(e?.message || 'Error generating audio');
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-start">
      <button
        className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700 disabled:opacity-50"
        onClick={handleGenerate}
        disabled={loading}
      >
        {loading ? 'Generating Audio...' : 'Generate Audio'}
      </button>
      {error && <div className="text-red-600 mt-2 text-sm">{error}</div>}
    </div>
  );
}

function GenerateVideoButton({
  moduleId,
  onVideoGenerated,
}: {
  moduleId: string;
  onVideoGenerated: (url: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/gpt-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processed_module_id: moduleId }),
      });
      const data = await res.json();
      if (res.ok && data.videoUrl) {
        onVideoGenerated(data.videoUrl);
      } else {
        setError(data.error || 'Failed to generate video');
      }
    } catch (e: any) {
      setError(e?.message || 'Error generating video');
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-start">
      <button
        className="bg-green-600 text-white px-4 py-2 rounded shadow hover:bg-green-700 disabled:opacity-50"
        onClick={handleGenerate}
        disabled={loading}
      >
        {loading ? 'Generating Video...' : 'Generate Video'}
      </button>
      {error && <div className="text-red-600 mt-2 text-sm">{error}</div>}
    </div>
  );
}

function sanitizeHTML(html: string): string {
  // Create a temporary container to parse and clean HTML
  if (typeof window === 'undefined') {
    return html;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove script and style tags
    doc.querySelectorAll('script, style').forEach(el => el.remove());

    // Remove dangerous attributes
    doc.querySelectorAll('*').forEach(el => {
      const dangerousAttrs = ['onclick', 'onload', 'onerror', 'onmouseover', 'onmouseout', 'javascript'];
      Array.from(el.attributes).forEach(attr => {
        if (dangerousAttrs.some(dangerous => attr.name.toLowerCase().includes(dangerous) || attr.value.includes('javascript:'))) {
          el.removeAttribute(attr.name);
        }
      });
    });

    return doc.body.innerHTML;
  } catch (error) {
    console.error('Error sanitizing HTML:', error);
    return html;
  }
}

// Helper: escape XML-sensitive characters for safe insertion into SVG
function escapeXml(unsafe: string) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Build a simple 16:9 flashcard SVG string from sections.
// sections: array of { heading: string, points: string[] }
function buildFlashcardSVG(sections: any[], title: string) {
  const w = 1920;
  const h = 1080;
  const marginX = 120;
  const startY = 160;
  const boxHeight = 220;
  const gapY = 28;
  const maxSections = 4;
  const items = Array.isArray(sections) ? sections.slice(0, maxSections) : [];

  const header = escapeXml(title || 'Flashcard');

  const colors = ['#E8F4FF', '#EFFCF0', '#FFF7E8', '#F6F0FF'];

  const rects = items.map((s: any, i: number) => {
    const y = startY + i * (boxHeight + gapY);
    const heading = escapeXml(String(s.heading || '').slice(0, 80));
    const points = Array.isArray(s.points) ? s.points : (typeof s.points === 'string' ? [s.points] : []);
    // Render up to 6 bullet points
    const bullets = (points || []).slice(0, 6).map((p: any, idx: number) => {
      const px = marginX + 32;
      const py = y + 80 + idx * 30;
      const txt = escapeXml(String(p || '').replace(/\s+/g, ' ').trim()).slice(0, 120);
      return `<text x="${px}" y="${py}" font-family="Inter, Arial, sans-serif" font-size="20" fill="#1f2937">• ${txt}</text>`;
    }).join('\n');

    const color = colors[i % colors.length];

    return `
      <g>
        <rect x="${marginX}" y="${y}" rx="18" ry="18" width="${w - marginX * 2}" height="${boxHeight}" fill="${color}" stroke="#D1D5DB" stroke-width="1" />
        <text x="${marginX + 28}" y="${y + 46}" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="700" fill="#0f172a">${heading}</text>
        ${bullets}
      </g>
    `;
  }).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <style>
      .title { font-family: Inter, Arial, sans-serif; font-size:48px; font-weight:800; fill:#0b3b66 }
    </style>
    <rect width="100%" height="100%" fill="#ffffff" />
    <g>
      <text x="${marginX}" y="88" class="title">${header}</text>
    </g>
    ${rects}
    <g>
      <text x="${marginX}" y="${h - 48}" font-family="Inter, Arial, sans-serif" font-size="14" fill="#6b7280">Boost Productivity • Generated by Lucid</text>
    </g>
  </svg>`;

  return svg;
}
