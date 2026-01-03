"use client";

import { useEffect, useMemo, useState } from "react";
import AudioPlayer from "./AudioPlayer";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import EmployeeNavigation from "@/components/employee-navigation";
import { ChevronLeft, Info, Lightbulb, BookOpen, Zap } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/contexts/auth-context";

export default function ModuleContentPage({ params }: { params: { module_id: string } }) {
  const { user, loading: authLoading, logout } = useAuth()
  const moduleId = params.module_id;
  const [module, setModule] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generatingContent, setGeneratingContent] = useState(false);
  const [employee, setEmployee] = useState<any>(null);
  const [learningStyle, setLearningStyle] = useState<string | null>(null);
  const [audioExpanded, setAudioExpanded] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [plainTranscript, setPlainTranscript] = useState("");
  const [hasVideo, setHasVideo] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const fetchModule = async () => {
      setLoading(true);
      if (!moduleId || moduleId === 'undefined' || moduleId === 'null') {
        console.error('[module] Invalid module id:', moduleId);
        setModule(null);
        setLoading(false);
        return;
      }
      let empObj = null;
      let style = null;
      try {
        const { data: userData } = await supabase.auth.getUser();
        const employeeEmail = userData?.user?.email || null;
        if (user?.email) {
          const { data: emp } = await supabase
            .from('users')
            .select('user_id')
            .eq('email', user?.email)
            .maybeSingle();
          if (emp?.user_id) {
            empObj = emp;
            setEmployee(emp);
            const { data: styleData } = await supabase
              .from('employee_learning_style')
              .select('learning_style')
              .eq('user_id', emp.user_id)
              .maybeSingle();
            if (styleData?.learning_style) {
              style = styleData.learning_style;
              setLearningStyle(style);
            }
          }
        }
      } catch (e) {
        console.error('[module] employee fetch error', e);
      }
      const selectCols = "processed_module_id, title, content, audio_url, original_module_id, learning_style, user_id";
      let data: any = null;
      const { data: directData, error: directError } = await supabase
        .from('processed_modules')
        .select(selectCols)
        .eq('processed_module_id', moduleId)
        .eq('user_id', empObj?.user_id || '')
        .maybeSingle();

      if (directError) {
        console.error('[module] Error fetching by processed_module_id:', directError);
      }

      if (directData) {
        data = directData;
      } else {
        const { data: origData, error: origError } = await supabase
          .from('processed_modules')
          .select(selectCols)
          .eq('original_module_id', moduleId)
          .eq('user_id', empObj?.user_id || '')
          .maybeSingle();

        if (origError) {
          console.error('[module] Error fetching by original_module_id:', origError);
        }

        if (origData) {
          data = origData;
        }
      }
      if (data) {
        if (!data.content || data.content.trim() === '') {
          setGeneratingContent(true);
          try {
            const genResponse = await fetch('/api/generate-module-content', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                moduleId: data.original_module_id
              }),
            });
            if (genResponse.ok) {
              await new Promise(resolve => setTimeout(resolve, 2000));
              const { data: refreshedData } = await supabase
                .from('processed_modules')
                .select(selectCols)
                .eq('processed_module_id', moduleId)
                .maybeSingle();
              if (refreshedData && refreshedData.content) {
                data = refreshedData;
              }
            }
          } catch (genError) {
            console.error('[module] Error triggering content generation:', genError);
          } finally {
            setGeneratingContent(false);
          }
        }

        setModule(data as any);
        setPlainTranscript(extractPlainText(data.content || ''));
        try {
          if (empObj?.user_id) {
            await fetch('/api/module-progress', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                user_id: empObj.user_id,
                processed_module_id: data.processed_module_id,
                module_id: data.original_module_id,
                started_at: new Date().toISOString(),
                audio_url: data.audio_url,
                viewOnly: true,
              }),
            });
          }
        } catch (e) {
          console.error('[module] progress log error', e);
        }
      } else {
        console.error('[module] No module data found for id:', moduleId);
        setModule(null);
      }
      setLoading(false);
    };
    if (moduleId) fetchModule();
  }, [moduleId]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading module content...</div>;
  }

  if (generatingContent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mx-auto mb-4"></div>
          <p className="text-lg font-semibold text-gray-700">Generating personalized content...</p>
          <p className="text-sm text-gray-500 mt-2">This may take a few moments</p>
        </div>
      </div>
    );
  }

  if (!module) {
    return <div className="min-h-screen flex items-center justify-center text-red-600">Module not found.</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
      <EmployeeNavigation customBackPath="/employee/training-plan" showForward={false} />

      <div className="transition-all duration-300 ease-in-out px-12 py-8" style={{ marginLeft: 'var(--sidebar-width, 0px)' }}>
        <div className="w-full mx-auto">
          <div>
            <main className="w-full">
              <div className="bg-white rounded-lg shadow-sm border p-12 w-full min-h-screen">
                <div className="mb-8">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2 hover:bg-gray-100"
                    onClick={() => router.back()}
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
                  employee={employee}
                  audioExpanded={audioExpanded}
                  setAudioExpanded={setAudioExpanded}
                  liveTranscript={liveTranscript}
                  plainTranscript={plainTranscript}
                  setLiveTranscript={setLiveTranscript}
                  onAudioGenerated={(url: string) => setModule((m: any) => ({ ...m, audio_url: url }))}
                  hasVideo={hasVideo}
                  setHasVideo={setHasVideo}
                  onVideoGenerated={(url: string) => {
                    setModule((m: any) => ({ ...m, video_url: url }));
                    setHasVideo(true);
                  }}
                />

                <ContentCards content={module.content || ''} />
              </div>
            </main>
          </div>
        </div>
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
    // Sanitize and format the content to ensure safe rendering
    const sanitizedContent = content
      .replace(/<script[^>]*?>.*?<\/script>/gi, "") // Remove any script tags
      .replace(/<style[^>]*?>.*?<\/style>/gi, "") // Remove any style tags
      .replace(/on\w+="[^"]*"/gi, "") // Remove inline event handlers
      .replace(/javascript:/gi, ""); // Remove javascript: URLs

    return sanitizedContent;
  }

  return (
    <div className="space-y-6 mb-8">
      <div className="flex flex-wrap gap-6 mb-4 border-b border-gray-200 pb-2">
        {tabGroups.map((group) => (
          <button
            key={group.key}
            onClick={() => setActiveTab(group.key)}
            className={clsx(
              'px-1 pb-2 text-sm font-semibold transition-all border-b-2',
              activeTab === group.key
                ? 'text-blue-700 border-blue-600'
                : 'text-gray-500 border-transparent hover:text-gray-800 hover:border-gray-300'
            )}
          >
            {group.label}
          </button>
        ))}
      </div>

      {activeGroup?.items.map((section, index) => (
        <div 
          key={index} 
          className={clsx(
            "rounded-xl border-2 shadow-md p-8 transition-all hover:shadow-lg",
            section.type === 'objectives' ? 'bg-gradient-to-br from-blue-50 to-blue-100 border-blue-300' :
            section.type === 'activity' ? 'bg-gradient-to-br from-green-50 to-green-100 border-green-300' :
            section.type === 'summary' ? 'bg-gradient-to-br from-purple-50 to-purple-100 border-purple-300' :
            section.type === 'discussion' ? 'bg-gradient-to-br from-orange-50 to-orange-100 border-orange-300' :
            'bg-white border-gray-300'
          )}
        >
          {section.title && (
            <div className="flex items-center gap-3 mb-6">
              {section.type === 'objectives' && <Lightbulb className="w-6 h-6 text-blue-600" />}
              {section.type === 'activity' && <Zap className="w-6 h-6 text-green-600" />}
              {section.type === 'summary' && <BookOpen className="w-6 h-6 text-purple-600" />}
              {section.type === 'discussion' && <Info className="w-6 h-6 text-orange-600" />}
              <h2 className={clsx(
                "font-bold",
                section.type === 'objectives' ? 'text-2xl text-blue-900' :
                section.type === 'section' ? 'text-2xl text-gray-900' :
                section.type === 'activity' ? 'text-xl text-green-900' :
                section.type === 'summary' ? 'text-xl text-purple-900' :
                section.type === 'discussion' ? 'text-xl text-orange-900' :
                'text-xl text-gray-900'
              )}>
                {section.title}
              </h2>
            </div>
          )}
          <div 
            className="prose prose-sm max-w-none text-gray-800 leading-relaxed" 
            dangerouslySetInnerHTML={{ __html: formatContent(section.content) }} 
          />
        </div>
      ))}
    </div>
  );
}

function parseContentIntoSections(content: string) {
  const sections: Array<{ type: string; title: string; content: string }> = [];
  
  if (!content || content.trim() === '') {
    return sections;
  }
  
  content = content.replace(/\s*\([CS|CR|AS|AR|cs|cr|as|ar|,\s]+\)/gi, '');
  content = content.replace(/\b(CS|CR|AS|AR)\b/g, '');
  
  const lines = content.split('\n');
  let currentSection: { type: string; title: string; content: string } | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line) {
      if (currentSection) currentSection.content += '\n';
      continue;
    }
    
    if (line.match(/^Learning Objectives?:/i)) {
      if (currentSection) sections.push(currentSection);
      currentSection = { type: 'objectives', title: 'Learning Objectives', content: '' };
      continue;
    }
    
    const sectionMatch = line.match(/^Section\s+(\d+)\s*:\s*(.+)$/i);
    if (sectionMatch) {
      if (currentSection) sections.push(currentSection);
      currentSection = { 
        type: 'section', 
        title: line, 
        content: '' 
      };
      continue;
    }
    
    const activityMatch = line.match(/^Activity\s+(\d+)\s*:\s*(.+)$/i);
    if (activityMatch) {
      if (currentSection) sections.push(currentSection);
      currentSection = { 
        type: 'activity', 
        title: line, 
        content: '' 
      };
      continue;
    }
    
    if (line.match(/^Module Summary:/i)) {
      if (currentSection) sections.push(currentSection);
      currentSection = { type: 'summary', title: 'Module Summary', content: '' };
      continue;
    }
    
    if (line.match(/^Discussion Prompts?:/i)) {
      if (currentSection) sections.push(currentSection);
      currentSection = { type: 'discussion', title: 'Discussion Prompts', content: '' };
      continue;
    }
    
    if (currentSection) {
      currentSection.content += lines[i] + '\n';
    } else {
      currentSection = { type: 'intro', title: '', content: lines[i] + '\n' };
    }
  }
  
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

  let sectionCounter = 0;
  let currentKey = 'overview';
  ensureGroup(currentKey, 'Overview');

  sections.forEach((section) => {
    if (section.type === 'section') {
      sectionCounter += 1;
      currentKey = `section-${sectionCounter}`;
      const label = `Section ${sectionCounter}`;
      ensureGroup(currentKey, label).items.push(section);
      return;
    }

    if (section.type === 'summary') {
      ensureGroup('conclusion', 'Conclusion').items.push(section);
      return;
    }

    if (section.type === 'activity') {
      ensureGroup(currentKey, currentKey.startsWith('section-') ? currentKey.replace('section-', 'Section ') : 'Overview').items.push(section);
      return;
    }

    ensureGroup(currentKey, currentKey === 'overview' ? 'Overview' : currentKey.replace('section-', 'Section ')).items.push(section);
  });

  return groups;
}

function extractPlainText(content: string) {
  return content
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*>`_\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseChatFromTranscript(transcript: string): Array<{ speaker: string; text: string }> {
  const messages: Array<{ speaker: string; text: string }> = [];
  const sentences = transcript.match(/[^.!?]+[.!?]+/g) || [];
  let isSarah = false;
  
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed) {
      messages.push({
        speaker: isSarah ? 'sarah' : 'mark',
        text: trimmed
      });
      isSarah = !isSarah;
    }
  }
  
  return messages;
}

function ContentTransformer({
  module,
  employee,
  audioExpanded,
  setAudioExpanded,
  liveTranscript,
  plainTranscript,
  setLiveTranscript,
  onAudioGenerated,
  hasVideo,
  setHasVideo,
  onVideoGenerated,
}: any) {
  const hasAudio = !!module.audio_url;
  const [chatMessages, setChatMessages] = useState<Array<{ speaker: string; text: string }>>([]); 
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [selectedOption, setSelectedOption] = useState<'audio' | 'infographic' | 'mindmap' | 'video'>('audio');
  const [chatInput, setChatInput] = useState('');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [userChatHistory, setUserChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatLoading, setChatLoading] = useState(false);

  const handleTimeUpdate = (current: number, duration: number) => {
    if (!duration || !plainTranscript) return;
    const ratio = Math.min(current / duration, 1);
    const chars = Math.floor(plainTranscript.length * ratio);
    setLiveTranscript(plainTranscript.slice(0, chars));
    
    const messages = parseChatFromTranscript(plainTranscript);
    const currentChars = Math.floor(plainTranscript.length * ratio);
    const displayedMessages: Array<{ speaker: string; text: string }> = [];
    let charCount = 0;
    
    for (const msg of messages) {
      charCount += msg.text.length;
      if (charCount <= currentChars) {
        displayedMessages.push(msg);
      } else {
        break;
      }
    }
    
    setChatMessages(displayedMessages);
  };

  const handleResetTranscript = () => {
    setLiveTranscript('');
    setChatMessages([]);
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;
    
    const userMessage = chatInput.trim();
    setChatInput('');
    
    const newUserMessage = { role: 'user' as const, content: userMessage };
    setUserChatHistory(prev => [...prev, newUserMessage]);
    setChatLoading(true);
    
    try {
      const response = await fetch('/api/module-chat', {
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
        setUserChatHistory(prev => [...prev, { role: 'assistant', content: data.message }]);
      } else {
        setUserChatHistory(prev => [...prev, { 
          role: 'assistant', 
          content: 'Sorry, I encountered an error. Please try again.' 
        }]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setUserChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: 'Sorry, I encountered an error. Please try again.' 
      }]);
    } finally {
      setChatLoading(false);
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
            <h2 className="text-2xl font-bold text-slate-900">AI Content Transformer</h2>
            <p className="text-slate-600 text-sm mt-1">Convert this learning journey into your preferred format.</p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
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
            <div className="font-bold text-slate-900 text-sm">Audio Guide</div>
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

          <div
            onClick={() => setSelectedOption('mindmap')}
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

          <div
            onClick={() => setSelectedOption('infographic')}
            className={clsx(
              'rounded-xl p-5 cursor-pointer transition-all border-2',
              selectedOption === 'infographic'
                ? 'bg-slate-50 border-green-500 shadow-lg'
                : 'bg-white border-slate-300 hover:border-slate-400'
            )}
          >
            <div className="text-3xl mb-3">🖼️</div>
            <div className="font-bold text-slate-900 text-sm">Infographic</div>
            <div className="text-slate-500 text-xs mt-1">Visual summary</div>
          </div>
        </div>

        {selectedOption === 'audio' && audioOpen && (
          <div className="space-y-3 flex flex-col">
            {!hasAudio && (
              <GenerateAudioButton
                moduleId={module.processed_module_id}
                onAudioGenerated={onAudioGenerated}
              />
            )}

            {hasAudio && (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <AudioPlayer
                    employeeId={employee?.user_id}
                    processedModuleId={module.processed_module_id}
                    moduleId={module.original_module_id}
                    audioUrl={module.audio_url}
                    onTimeUpdate={handleTimeUpdate}
                    onPlayExtra={handleResetTranscript}
                    className="w-full"
                  />
                </div>

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={async () => {
                      setLanguage('en');
                      const res = await fetch(`/api/tts?processed_module_id=${module.processed_module_id}&language=en`);
                      const data = await res.json();
                      if (res.ok && data.audioUrl) {
                        onAudioGenerated(data.audioUrl);
                      }
                    }}
                    className={clsx(
                      'px-3 py-1 rounded text-xs font-medium transition-all',
                      language === 'en'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                    )}
                  >
                    English
                  </button>
                  <button
                    onClick={async () => {
                      setLanguage('hi');
                      const res = await fetch(`/api/tts?processed_module_id=${module.processed_module_id}&language=hi`);
                      const data = await res.json();
                      if (res.ok && data.audioUrl) {
                        onAudioGenerated(data.audioUrl);
                      }
                    }}
                    className={clsx(
                      'px-3 py-1 rounded text-xs font-medium transition-all',
                      language === 'hi'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                    )}
                  >
                    हिंदी
                  </button>
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
                      {chatMessages.length > 0 ? (
                        chatMessages.map((msg, idx) => (
                          <div
                            key={idx}
                            className={clsx(
                              'flex',
                              msg.speaker === 'sarah' ? 'justify-start' : 'justify-end'
                            )}
                          >
                            <div
                              className={clsx(
                                'rounded-lg px-4 py-2',
                                msg.speaker === 'sarah'
                                  ? 'bg-blue-100 text-blue-900 rounded-bl-none max-w-2xl'
                                  : 'bg-green-100 text-green-900 rounded-br-none max-w-2xl'
                              )}
                            >
                              <div className="font-semibold text-xs mb-2 opacity-75">
                                {msg.speaker === 'sarah' ? 'Sarah' : 'Mark'}
                              </div>
                              <p className="whitespace-normal break-words leading-relaxed text-base">{msg.text}</p>
                            </div>
                          </div>
                        ))
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
          </div>
        )}

        {selectedOption === 'video' && (
          <div className="space-y-3 flex flex-col">
            {!hasVideo && (
              <GenerateVideoButton
                moduleId={module.processed_module_id}
                onVideoGenerated={onVideoGenerated}
              />
            )}

            {hasVideo && module.video_url && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <video controls className="w-full rounded-lg">
                  <source src={module.video_url} type="video/mp4" />
                  Your browser does not support video playback.
                </video>
              </div>
            )}
          </div>
        )}

        {selectedOption !== 'audio' && selectedOption !== 'video' && (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
            <div className="text-slate-600 text-sm">
              {selectedOption === 'infographic' && '📊 Infographic generation coming soon...'}
              {selectedOption === 'mindmap' && '🗺️ Mindmap generation coming soon...'}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
        <div className="p-6 h-96 overflow-y-auto bg-gray-50">
          {userChatHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-6xl mb-4">💬</div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">Ask me anything about this module!</h3>
              <p className="text-sm text-gray-500">I can help clarify concepts, provide examples, or answer questions.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {userChatHistory.map((msg, idx) => (
                <div
                  key={idx}
                  className={clsx(
                    'flex',
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
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
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
                          AI
                        </div>
                        <span className="text-xs font-semibold text-gray-600">Learning Assistant</span>
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

        <div className="border-t border-slate-200 bg-white p-6">
          <form onSubmit={handleSendChat} className="flex gap-3">
            <button 
              type="button" 
              className="p-3 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors text-slate-600 disabled:opacity-50"
              disabled={chatLoading}
            >
              📎
            </button>
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
              disabled={chatLoading || !chatInput.trim()}
            >
              {chatLoading ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function GenerateAudioButton({ moduleId, onAudioGenerated }: { moduleId: string, onAudioGenerated: (url: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tts?processed_module_id=${moduleId}`);
      const data = await res.json();
      if (res.ok && data.audioUrl) {
        onAudioGenerated(data.audioUrl);
      } else {
        setError(data.error || 'Failed to generate audio');
      }
    } catch (e: any) {
      setError(e?.message || 'Error generating audio');
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-center">
      <button
        className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700 disabled:opacity-50"
        onClick={handleGenerate}
        disabled={loading}
      >
        {loading ? 'Generating Audio...' : 'Generate Audio'}
      </button>
      {error && <div className="text-red-600 mt-2">{error}</div>}
    </div>
  );
}

function GenerateVideoButton({ moduleId, onVideoGenerated }: { moduleId: string, onVideoGenerated: (url: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/veo-video`, {
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
    <div className="flex flex-col items-center">
      <button
        className="bg-green-600 text-white px-4 py-2 rounded shadow hover:bg-green-700 disabled:opacity-50"
        onClick={handleGenerate}
        disabled={loading}
      >
        {loading ? 'Generating Video...' : 'Generate Video'}
      </button>
      {error && <div className="text-red-600 mt-2">{error}</div>}
    </div>
  );
}
