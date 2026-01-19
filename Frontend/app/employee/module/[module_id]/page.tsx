"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import AudioPlayer from "./AudioPlayer";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import EmployeeNavigation from "@/components/employee-navigation";
import { ChevronLeft, Info, Lightbulb, BookOpen, Zap, Download } from "lucide-react";
import FlashcardCards from '@/components/FlashcardCards'
import MindmapViewer from '@/components/MindmapViewer'
import clsx from "clsx";
import { useAuth } from "@/contexts/auth-context";
import jsPDF from 'jspdf';
import VoiceInput from '@/components/VoiceInput';
import VoiceOutput from '@/components/VoiceOutput';

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
  const [userChatHistory, setUserChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
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
      const selectCols = "processed_module_id, title, content, audio_url, audio_url_hinglish, original_module_id, learning_style, podcast_timeline, podcast_timeline_hinglish, podcast_transcript, podcast_transcript_hinglish,video_url, mindmap_data, flashcard_data, infographic_data";
      let data: any = null;

      // First try: direct lookup by processed_module_id (this is what we pass from training plan)
      // console.log('[module] Attempting direct fetch by processed_module_id:', moduleId);
      // console.log(empObj);


      const { data: directData, error: directError } = await supabase
        .from('processed_modules')
        .select(selectCols)
        .eq('processed_module_id', moduleId)
        // .eq('user_id', empObj?.user_id || '')
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
          // .eq('user_id', empObj?.user_id || '')
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
            // const genResponse = await fetch('/api/generate-module-content', {
            //   method: 'POST',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify({
            //     moduleId: data.original_module_id
            //   }),
            // });
            // if (genResponse.ok) {
              await new Promise(resolve => setTimeout(resolve, 2000));
              const { data: refreshedData } = await supabase
                .from('processed_modules')
                .select(selectCols)
                .eq('processed_module_id', moduleId)
                .maybeSingle();
              if (refreshedData && refreshedData.content) {
                data = refreshedData;
              // }
            }
          } catch (genError) {
            console.error('[module] Error triggering content generation:', genError);
          } finally {
            setGeneratingContent(false);
          }
        }
        if(data.video_url){
          setHasVideo(true);
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
    if (!moduleId) return;
    if (authLoading) return;     // wait for auth
  if (!user) return;

    
  fetchModule();
  }, [moduleId,user,authLoading]);

  const handleSendChat = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading || !module?.processed_module_id) return;

    const userMessage = chatInput.trim();
    setChatInput('');

    const newUserMessage = { role: 'user' as const, content: userMessage };
    setUserChatHistory((prev) => [...prev, newUserMessage]);
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
  };

  // const handleSendChat = async (e: FormEvent<HTMLFormElement>) => {
  //   e.preventDefault();
  //   if (!chatInput.trim() || chatLoading || !module?.processed_module_id) return;

  //   const userMessage = chatInput.trim();
  //   setChatInput('');

  //   const newUserMessage = { role: 'user' as const, content: userMessage };
  //   setUserChatHistory((prev) => [...prev, newUserMessage]);
  //   setChatLoading(true);

  //   try {
  //     const response = await fetch('/api/module-chat', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({
  //         processed_module_id: module.processed_module_id,
  //         user_message: userMessage,
  //         chat_history: userChatHistory,
  //       }),
  //     });

  //     const data = await response.json();

  //     if (response.ok && data.message) {
  //       setUserChatHistory((prev) => [...prev, { role: 'assistant', content: data.message }]);
  //     } else {
  //       setUserChatHistory((prev) => [
  //         ...prev,
  //         {
  //           role: 'assistant',
  //           content: 'Sorry, I encountered an error. Please try again.',
  //         },
  //       ]);
  //     }
  //   } catch (error) {
  //     console.error('Chat error:', error);
  //     setUserChatHistory((prev) => [
  //       ...prev,
  //       {
  //         role: 'assistant',
  //         content: 'Sorry, I encountered an error. Please try again.',
  //       },
  //     ]);
  //   } finally {
  //     setChatLoading(false);
  //   }
  // };

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
    <div className="min-h-screen">
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
                  onAudioGenerated={(url: string, data?: { transcript?: string; timeline?: any; language?: 'en' | 'hinglish' }) => {
                    setModule((m: any) => {
                      const language = data?.language || 'en';
                      if (language === 'hinglish') {
                        return {
                          ...m,
                          audio_url_hinglish: url,
                          podcast_transcript_hinglish: data?.transcript || m.podcast_transcript_hinglish,
                          podcast_timeline_hinglish: data?.timeline ? JSON.stringify(data.timeline) : m.podcast_timeline_hinglish,
                        };
                      } else {
                        return {
                          ...m,
                          audio_url: url,
                          podcast_transcript: data?.transcript || m.podcast_transcript,
                          podcast_timeline: data?.timeline ? JSON.stringify(data.timeline) : m.podcast_timeline,
                        };
                      }
                    });
                  }}
                  hasVideo={hasVideo}
                  setHasVideo={setHasVideo}
                  onVideoGenerated={(url: string) => {
                    setModule((m: any) => ({ ...m, video_url: url }));
                    setHasVideo(true);
                  }}
                  onModuleUpdate={setModule}
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
                        {userChatHistory.map((msg, idx) => (
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
                      <VoiceInput 
                        onTranscription={handleVoiceTranscription}
                        disabled={chatLoading}
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
              {/* {section.type === 'objectives' && <Lightbulb className="w-6 h-6 text-blue-600" />} */}
              {/* {section.type === 'activity' && <Zap className="w-6 h-6 text-green-600" />}
              {section.type === 'summary' && <BookOpen className="w-6 h-6 text-purple-600" />}
              {section.type === 'discussion' && <Info className="w-6 h-6 text-orange-600" />} */}
              <h2 className={clsx(
                "font-bold",
                section.type === 'objectives' ? 'text-2xl text-blue-900' :
                  // section.type === 'section' ? 'text-2xl text-gray-900' :
                    section.type === 'activity' ? 'text-xl text-green-900' :
                      section.type === 'summary' ? 'text-xl text-purple-900' :
                        section.type === 'discussion' ? 'text-xl text-orange-900' :
                          ' text-gray-800'
              )}>
                {/* {section.title} */}
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

  // Check if content is HTML (contains HTML tags)
  const isHTML = /<[^>]+>/.test(content);

  if (isHTML) {
    // Parse HTML content
    return parseHTMLContent(content);
  } else {
    // Parse markdown-style content (legacy fallback)
    return parseMarkdownContent(content);
  }
}

function parseHTMLContent(content: string) {
  const sections: Array<{ type: string; title: string; content: string }> = [];

  // Create a temporary DOM parser
  if (typeof window === 'undefined') {
    // Server-side: return raw content as single section
    return [{ type: 'intro', title: '', content }];
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');

    // Extract sections from HTML structure
    const htmlSections = doc.querySelectorAll('section');
    
    if (htmlSections.length === 0) {
      // No semantic sections, parse by h2 headings
      return parseHTMLByHeadings(doc);
    }

    // Parse by semantic sections
    htmlSections.forEach((section) => {
      const classList = section.className;
      let type = 'section';
      
      if (classList.includes('learning-objectives')) {
        type = 'objectives';
      } else if (classList.includes('activity')) {
        type = 'activity';
      } else if (classList.includes('module-section')) {
        type = 'section';
      } else if (classList.includes('module-summary')) {
        type = 'summary';
      } else if (classList.includes('next-steps')) {
        type = 'conclusion';
      }

      // Extract title from h2 or h3
      const h2 = section.querySelector('h2');
      const h3 = section.querySelector('h3');
      const title = (h2?.textContent || h3?.textContent || '').trim();

      // Get inner HTML
      const sectionHTML = section.innerHTML;

      if (sectionHTML.trim()) {
        sections.push({
          type,
          title,
          content: sectionHTML
        });
      }
    });

    // If sections were extracted, return them
    if (sections.length > 0) {
      return sections;
    }

    // Fallback: parse by h2 headings
    return parseHTMLByHeadings(doc);
  } catch (error) {
    console.error('Error parsing HTML content:', error);
    // Fallback to raw content
    return [{ type: 'intro', title: '', content }];
  }
}

function parseHTMLByHeadings(doc: Document) {
  const sections: Array<{ type: string; title: string; content: string }> = [];
  const wrapper = document.createElement('div');
  wrapper.innerHTML = doc.body.innerHTML;

  let currentSection: { type: string; title: string; html: HTMLElement } | null = null;

  const children = Array.from(wrapper.children);

  for (const child of children) {
    if (child.tagName === 'H2') {
      // Start new section
      if (currentSection) {
        sections.push({
          type: getTypeFromHeading(currentSection.html),
          title: currentSection.html.querySelector('h2')?.textContent || '',
          content: currentSection.html.innerHTML
        });
      }

      currentSection = {
        type: 'section',
        title: child.textContent || '',
        html: document.createElement('div')
      };

      currentSection.html.appendChild(child.cloneNode(true));
    } else if (currentSection) {
      currentSection.html.appendChild(child.cloneNode(true));
    } else {
      // Content before first h2
      const div = document.createElement('div');
      div.appendChild(child.cloneNode(true));
      sections.push({
        type: 'intro',
        title: '',
        content: div.innerHTML
      });
    }
  }

  // Add last section
  if (currentSection) {
    sections.push({
      type: getTypeFromHeading(currentSection.html),
      title: currentSection.html.querySelector('h2')?.textContent || '',
      content: currentSection.html.innerHTML
    });
  }

  return sections;
}

function getTypeFromHeading(element: HTMLElement): string {
  const text = element.textContent?.toLowerCase() || '';
  if (text.includes('objective')) return 'objectives';
  if (text.includes('activity')) return 'activity';
  if (text.includes('summary')) return 'summary';
  if (text.includes('next steps')) return 'conclusion';
  return 'section';
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


  // Split by sentence boundaries and alternate speakers
  const sentences = transcript.match(/[^.!?]+[.!?]+/g) || [];
  let isSarah = true; // Start with Sarah to match TTS API


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
  onModuleUpdate,
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
  const [selectedOption, setSelectedOption] = useState<'audio' | 'flashcard' | 'flashcards' | 'mindmap' | 'video' | 'roleplay' | 'infographic'>('audio');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [flashcardSections, setFlashcardSections] = useState<any[] | null>(null);
  const [flashcardLoading, setFlashcardLoading] = useState(false);
  const [mindmapData, setMindmapData] = useState<any | null>(null);
  const [mindmapLoading, setMindmapLoading] = useState(false);
  const [infographicData, setInfographicData] = useState<any | null>(null);
  const [infographicLoading, setInfographicLoading] = useState(false);

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
            <h2 className="text-2xl font-bold text-slate-900">Content Transformer</h2>
            <p className="text-slate-600 text-sm mt-1">Convert this learning journey into your preferred format.</p>
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

          <div
            onClick={async () => {
              setSelectedOption('mindmap');
              setMindmapLoading(true);
              
              try {
                // Check if mindmap data already exists in the module
                if (module.mindmap_data) {
                  console.log('[mindmap] Using cached mindmap data');
                  let cachedData = module.mindmap_data;
                  if (typeof cachedData === 'string') {
                    cachedData = JSON.parse(cachedData);
                  }
                  setMindmapData(cachedData);
                  setMindmapLoading(false);
                  return;
                }

                // Generate new mindmap if not cached
                console.log('[mindmap] Generating new mindmap');
                setMindmapData(null);
                const studyText = plainTranscript || module.content || '';
                const res = await fetch('/api/generate-mindmap', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ content: studyText, title: module.title }),
                });
                let data: any = null;
                try {
                  data = await res.json();
                } catch (err) {
                  const raw = await res.clone().text();
                  console.error('[mindmap] parse error, raw:', raw.slice(0, 400));
                  data = null;
                }

                if (res.ok && data && data.nodes && data.edges) {
                  setMindmapData(data);
                  
                  // Save mindmap data to Supabase
                  try {
                    const { error: updateError } = await supabase
                      .from('processed_modules')
                      .update({ mindmap_data: data })
                      .eq('processed_module_id', module.processed_module_id);
                    
                    if (updateError) {
                      console.error('[mindmap] Failed to save mindmap to database:', updateError);
                    } else {
                      console.log('[mindmap] Mindmap saved to database successfully');
                      // Update local module state
                      if (onModuleUpdate) {
                        onModuleUpdate((prev: any) => ({ ...prev, mindmap_data: data }));
                      }
                    }
                  } catch (saveError) {
                    console.error('[mindmap] Error saving mindmap:', saveError);
                  }
                } else {
                  console.error('[mindmap] generation failed', data);
                  setMindmapData(null);
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
              // If already generated, just open the view
              if (flashcardSections && flashcardSections.length > 0) {
                setSelectedOption('flashcard');
                return;
              }

              try {
                setFlashcardLoading(true);
                setSelectedOption('flashcard');
                
                // Check if flashcard data already exists in the module (cache)
                if (module.flashcard_data) {
                  console.log('[flashcards] Using cached flashcard data');
                  let cachedData = module.flashcard_data;
                  if (typeof cachedData === 'string') {
                    cachedData = JSON.parse(cachedData);
                  }
                  if (Array.isArray(cachedData) && cachedData.length > 0) {
                    setFlashcardSections(cachedData);
                    setFlashcardLoading(false);
                    return;
                  }
                }

                // Generate new flashcards if not cached
                console.log('[flashcards] Generating new flashcards');
                const studyText = plainTranscript || module.content || '';
                console.log('[flashcards] starting fetch, studyText length:', (studyText || '').length);
                const res = await fetch('/api/generate-flashcards-gemini', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ content: studyText }),
                });

                // Read raw text for debugging first, then attempt to parse JSON
                const raw = await res.clone().text();
                console.log('[flashcards] fetch status:', res.status, 'raw preview:', raw.slice(0, 400));

                let data: any = null;
                try {
                  data = await res.json();
                } catch (parseErr) {
                  console.error('[flashcards] failed to parse JSON from response, parseErr:', parseErr);
                  // fallback: try to parse raw substring
                  try {
                    data = JSON.parse(raw);
                  } catch (e2) {
                    data = { raw };
                  }
                }

                console.log('[flashcards] parsed response:', data);

                if (res.ok) {
                  // Expecting an array of { heading, points }
                  if (Array.isArray(data)) {
                    setFlashcardSections(data);
                    
                    // Save flashcard data to Supabase
                    try {
                      const { error: updateError } = await supabase
                        .from('processed_modules')
                        .update({ flashcard_data: data })
                        .eq('processed_module_id', module.processed_module_id);
                      
                      if (updateError) {
                        console.error('[flashcards] Failed to save flashcards to database:', updateError);
                      } else {
                        console.log('[flashcards] Flashcards saved to database successfully');
                        // Update local module state
                        if (onModuleUpdate) {
                          onModuleUpdate((prev: any) => ({ ...prev, flashcard_data: data }));
                        }
                      }
                    } catch (saveError) {
                      console.error('[flashcards] Error saving flashcards:', saveError);
                    }
                  } else if (data && data.error) {
                    setFlashcardSections([{ heading: 'Flashcard generation failed', points: [data.error || data.detail || 'See console for details'] }]);
                  } else {
                    setFlashcardSections([{ heading: 'Flashcard: unexpected response', points: [JSON.stringify(data).slice(0, 300)] }]);
                  }
                } else {
                  // Surface error to the UI so the user sees feedback instead of a silent failure
                  setFlashcardSections([{ heading: 'Flashcard generation failed', points: [data?.error || data?.detail || 'See console for details'] }]);
                  console.error('Flashcard generation failed', data);
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
              // If already generated, just open the view
              if (infographicData) {
                setSelectedOption('infographic');
                return;
              }

              try {
                setInfographicLoading(true);
                setSelectedOption('infographic');
                
                console.log('[infographic] Starting generation...');
                console.log('[infographic] Module title:', module.title);
                console.log('[infographic] Content length:', (module.content || '').length);
                console.log('[infographic] Processed module ID:', module.processed_module_id);
                
                // Check if infographic data already exists in the module (cache)
                if (module.infographic_data) {
                  console.log('[infographic] Using cached infographic data');
                  let cachedData = module.infographic_data;
                  if (typeof cachedData === 'string') {
                    cachedData = JSON.parse(cachedData);
                  }
                  if (cachedData && (cachedData.title || cachedData.sections)) {
                    setInfographicData(cachedData);
                    setInfographicLoading(false);
                    return;
                  }
                }
                
                const contentText = module.content || '';
                
                if (!contentText) {
                  console.error('[infographic] No content available');
                  alert('No content available to generate visual guide');
                  setInfographicLoading(false);
                  return;
                }
                
                console.log('[infographic] Calling API...');
                const res = await fetch('/api/generate-infographic', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    content: contentText, 
                    title: module.title,
                    processed_module_id: module.processed_module_id 
                  }),
                });

                console.log('[infographic] API response status:', res.status);
                
                const raw = await res.clone().text();
                console.log('[infographic] Raw response preview:', raw.slice(0, 500));

                let data: any = null;
                try {
                  data = await res.json();
                  console.log('[infographic] Parsed data:', data);
                } catch (parseErr) {
                  console.error('[infographic] Failed to parse JSON:', parseErr);
                  console.error('[infographic] Raw response:', raw);
                  alert('Failed to parse server response. Check console for details.');
                  data = null;
                }

                if (res.ok && data && !data.error) {
                  console.log('[infographic] Successfully generated!');
                  setInfographicData(data);
                } else {
                  console.error('[infographic] Generation failed:', data);
                  alert(`Failed to generate visual guide: ${data?.error || 'Unknown error'}`);
                  setInfographicData(null);
                }
              } catch (e: any) {
                console.error('[infographic] Error:', e);
                alert(`Error generating visual guide: ${e.message || 'Unknown error'}`);
                setInfographicData(null);
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

              {!hasCurrentLanguageAudio(language) && (
                <GenerateAudioButton
                  moduleId={module.processed_module_id}
                  onAudioGenerated={(url, data) => {
                    onAudioGenerated(url, data);
                    if (data?.timeline && Array.isArray(data.timeline)) {
                      // console.log('[ContentTransformer] Timeline received from audio generation:', {
                      //   segmentCount: data.timeline.length,
                      //   totalDuration: data.timeline.length > 0 ? data.timeline[data.timeline.length - 1].endSec : 0,
                      // });
                      setPodcastTimeline(data.timeline);
                    } else if (!data?.timeline) {
                      // console.warn('[ContentTransformer] No timeline returned from audio generation');
                    }
                  }}
                  language={language}
                />
              )}
            </div>

            {hasCurrentLanguageAudio(language) && (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <AudioPlayer
                    employeeId={employee?.user_id}
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

        {/* Placeholder / generated output for other options */}
        {selectedOption !== 'audio' && selectedOption !== 'video' && (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-left">
            <div className="text-slate-600 text-sm text-left">
                  {selectedOption === 'flashcard' && (
                    <div>
                      {flashcardLoading && (
                        <div className="flex flex-col items-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mx-auto mb-3"></div>
                          <div>Generating flashcards...</div>
                        </div>
                      )}

                      {!flashcardLoading && (
                        <div>
                              <FlashcardCards sections={flashcardSections} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* 'flashcard' (singular) is used to show generated sections inline */}

              {selectedOption === 'mindmap' && (
                <div>
                  {mindmapLoading && (
                    <div className="flex flex-col items-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mx-auto mb-3"></div>
                      <div>Generating mindmap...</div>
                    </div>
                  )}

                  {!mindmapLoading && mindmapData && (
                    <div className="w-full h-[60vh] rounded-lg border p-2 bg-white overflow-auto">
                      <MindmapViewer data={mindmapData} source={module.content || ''} />
                    </div>
                  )}

                  {!mindmapLoading && !mindmapData && (
                    <div className="text-sm text-gray-500">Click the Mindmap tile to generate and view the mindmap.</div>
                  )}

                  {/* Debug preview removed */}
                </div>
              )}

              {selectedOption === 'infographic' && (
                <div>
                  {infographicLoading && (
                    <div className="flex flex-col items-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mx-auto mb-3"></div>
                      <div>Generating visual guide...</div>
                    </div>
                  )}

                  {!infographicLoading && infographicData && (
                    <div className="w-full rounded-lg border p-4 bg-white">
                      {/* Header with title and download button */}
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-2xl font-bold flex-1 text-center">{infographicData.title}</h3>
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
                  )}

                  {!infographicLoading && !infographicData && (
                    <div className="text-sm text-gray-500">Click the Visual Guide tile to generate the structured overview.</div>
                  )}
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

  // Legacy markdown-to-HTML conversion for backward compatibility
  return styleMarkdownContent(content);
}

function styleHTMLContent(content: string): string {
  // Create a temporary container to work with HTML
  if (typeof window === 'undefined') {
    // Server-side fallback
    return sanitizeHTML(content);
  }

  try {
    const container = document.createElement('div');
    container.innerHTML = sanitizeHTML(content);

    // Style tables with Tailwind classes
    const tables = container.querySelectorAll('table');
    tables.forEach((table) => {
      table.className = 'w-full border-collapse border border-gray-300 rounded-lg overflow-hidden shadow-sm mb-6';
      
      // Style table headers
      const headers = table.querySelectorAll('thead th, thead td');
      headers.forEach((header) => {
        header.className = 'bg-blue-50 border border-gray-300 px-4 py-3 text-left font-semibold text-gray-900 text-sm';
      });

      // Style table body
      const cells = table.querySelectorAll('tbody td, tbody th');
      cells.forEach((cell, idx) => {
        const isEvenRow = Math.floor(idx / (table.querySelectorAll('tbody tr')[0]?.children.length || 1)) % 2;
        cell.className = `border border-gray-300 px-4 py-3 text-gray-800 text-sm ${isEvenRow ? 'bg-white' : 'bg-gray-50'}`;
      });
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

  return formatted;
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

// Add GenerateAudioButton component


function GenerateAudioButton({ moduleId, onAudioGenerated, language = 'en' }: { moduleId: string, onAudioGenerated: (url: string, data?: { transcript?: string; timeline?: any; language?: 'en' | 'hinglish' }) => void, language?: 'en' | 'hinglish' }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      if (language === 'hinglish') {
        // Hinglish generation implementation
        const res = await fetch(`/api/tts?processed_module_id=${moduleId}&language=hinglish`);
        const data = await res.json();
        if (res.ok && data.audioUrl) {
          onAudioGenerated(data.audioUrl, {
            transcript: data.podcastTranscript,
            timeline: data.podcastTimeline,
            language: 'hinglish'
          });
        } else {
          setError(data.error || 'Failed to generate Hinglish audio');
        }
      } else {
        const res = await fetch(`/api/tts?processed_module_id=${moduleId}&language=en`);
        const data = await res.json();
        if (res.ok && data.audioUrl) {
          onAudioGenerated(data.audioUrl, {
            transcript: data.podcastTranscript,
            timeline: data.podcastTimeline,
            language: 'en'
          });
        } else {
          setError(data.error || 'Failed to generate audio');
        }
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
