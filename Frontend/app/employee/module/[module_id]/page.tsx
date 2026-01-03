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
      console.log('[module] Fetching module with id:', moduleId);
      // Validate incoming module id
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
            // Fetch learning style for employee
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
        console.log("User Data:", user);
        console.log(employeeEmail)
      } catch (e) {
        console.log('[module] employee fetch error', e);
      }
      // Fetch module info from processed_modules - try direct lookup first, then fallbacks
      const selectCols = "processed_module_id, title, content, audio_url, original_module_id, learning_style, user_id";
      
      let data: any = null;
      
      // First try: direct lookup by processed_module_id (this is what we pass from training plan)
      console.log('[module] Attempting direct fetch by processed_module_id:', moduleId);
      console.log(empObj);
      
      

        const { data: directData, error: directError } = await supabase
        .from('processed_modules')
        .select(selectCols)
        .eq('processed_module_id', moduleId)
        .eq('user_id',empObj?.user_id || '')
        .maybeSingle();

      if (directError) {
        console.error('[module] Error fetching by processed_module_id:', directError);
      }
      
      if (directData) {
        console.log('[module] Found module by processed_module_id:', directData.processed_module_id);
        data = directData;
      } else {
        // Fallback: try by original_module_id
        console.log('[module] No direct match, trying by original_module_id');
        const { data: origData, error: origError } = await supabase
          .from('processed_modules')
          .select(selectCols)
          .eq('original_module_id', moduleId)
          .eq('user_id',empObj?.user_id || '')
          .maybeSingle();
        
        if (origError) {
          console.error('[module] Error fetching by original_module_id:', origError);
        }
        
        if (origData) {
          console.log('[module] Found module by original_module_id:', origData.processed_module_id);
          data = origData;
        }
      }
      console.log('[module] Fetched module data:', data);
      if (data) {
        // Check if content is empty and trigger generation
        if (!data.content || data.content.trim() === '') {
          console.log('[module] Content is empty, triggering generation for:', data.processed_module_id);
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
              console.log('[module] Content generation triggered successfully');
              // Wait a moment then refetch the module to get updated content
              await new Promise(resolve => setTimeout(resolve, 2000));
              const { data: refreshedData } = await supabase
                .from('processed_modules')
                .select(selectCols)
                .eq('processed_module_id', moduleId)
                .maybeSingle();
              if (refreshedData && refreshedData.content) {
                data = refreshedData;
                console.log('[module] Content loaded after generation');
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
        // Log view to module_progress - only set started_at, NOT completed_at
        try {
          if (empObj?.user_id) {
            console.log('[module] Logging module view for employee:', empObj.user_id, 'module:', data.processed_module_id);
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
          console.log('[module] progress log error', e);
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
    console.log("Inside the !module block");
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
                {/* Back button */}
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

                {/* Title Section */}
                <div className="mb-10">
                  <h1 className="text-4xl font-bold text-gray-900 mb-2">{module.title}</h1>
                  <p className="text-lg text-gray-600">Professional learning content tailored for you</p>
                </div>

                {/* Content Transformer Section - Above Content */}
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

                {/* Main Content Cards */}
                <ContentCards content={module.content || ''} />
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

// Component to render content in separate cards
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

// Parse content into separate sections
function parseContentIntoSections(content: string) {
  const sections: Array<{ type: string; title: string; content: string }> = [];
  
  if (!content || content.trim() === '') {
    return sections;
  }
  
  // Clean up learning style codes from content first
  content = content.replace(/\s*\([CS|CR|AS|AR|cs|cr|as|ar|,\s]+\)/gi, '');
  content = content.replace(/\b(CS|CR|AS|AR)\b/g, '');
  
  // Split by major headings - more flexible patterns
  const lines = content.split('\n');
  let currentSection: { type: string; title: string; content: string } | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line) {
      if (currentSection) currentSection.content += '\n';
      continue;
    }
    
    // Check for Learning Objectives
    if (line.match(/^Learning Objectives?:/i)) {
      if (currentSection) sections.push(currentSection);
      currentSection = { type: 'objectives', title: 'Learning Objectives', content: '' };
      continue;
    }
    
    // Check for Section headings (Section 1:, Section 2:, etc.)
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
    
    // Check for Activity headings (Activity 1:, Activity 2:, etc.)
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
    
    // Check for Module Summary
    if (line.match(/^Module Summary:/i)) {
      if (currentSection) sections.push(currentSection);
      currentSection = { type: 'summary', title: 'Module Summary', content: '' };
      continue;
    }
    
    // Check for Discussion Prompts
    if (line.match(/^Discussion Prompts?:/i)) {
      if (currentSection) sections.push(currentSection);
      currentSection = { type: 'discussion', title: 'Discussion Prompts', content: '' };
      continue;
    }
    
    // Add content to current section
    if (currentSection) {
      currentSection.content += lines[i] + '\n';
    } else {
      // Content before first section - create intro section
      currentSection = { type: 'intro', title: '', content: lines[i] + '\n' };
    }
  }
  
  // Push the last section
  if (currentSection && currentSection.content.trim()) {
    sections.push(currentSection);
  }
  
  // If no sections were created, put all content in one section
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
  // Basic markdown/HTML stripping for a readable transcript source
  return content
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*>`_\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseChatFromTranscript(transcript: string): Array<{ speaker: string; text: string }> {
  // Parse the transcript to identify speakers and their messages
  // The transcript is generated from the podcast which alternates between Sarah and Mark
  const messages: Array<{ speaker: string; text: string }> = [];
  
  // Split by sentence boundaries and alternate speakers
  const sentences = transcript.match(/[^.!?]+[.!?]+/g) || [];
  let isSarah = false; // Start with Mark
  
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

  const handleTimeUpdate = (current: number, duration: number) => {
    if (!duration || !plainTranscript) return;
    const ratio = Math.min(current / duration, 1);
    const chars = Math.floor(plainTranscript.length * ratio);
    setLiveTranscript(plainTranscript.slice(0, chars));
    
    // Parse and update chat messages based on progress
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

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    // Add user message
    setChatMessages(prev => [...prev, { speaker: 'user', text: chatInput }]);
    setChatInput('');
    // TODO: Send to API and get response
  };

  return (
    <div className="mb-10 w-full">
      {/* Content Transformer Header */}
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

        {/* Options Grid */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {/* Audio Guide */}
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

          {/* Explainer Video */}
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

          {/* Mindmap */}
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

          {/* Infographic */}
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

        {/* Audio Content Area */}
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

                {/* Language Toggle */}
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

                {/* Live Transcript (collapsible) */}
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

        {/* Video Content Area */}
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

        {/* Placeholder for other options */}
        {selectedOption !== 'audio' && selectedOption !== 'video' && (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
            <div className="text-slate-600 text-sm">
              {selectedOption === 'infographic' && '📊 Infographic generation coming soon...'}
              {selectedOption === 'mindmap' && '🗺️ Mindmap generation coming soon...'}
            </div>
          </div>
        )}
      </div>

      {/* Chat Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
        <form onSubmit={handleSendChat} className="flex gap-3">
          <button type="button" className="p-3 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors text-slate-600">
            📎
          </button>
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ask for coaching, upload work, or chat..."
            className="flex-1 outline-none text-slate-700 placeholder-slate-400"
          />
          <button type="button" className="p-3 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors text-slate-600">
            🎤
          </button>
        </form>
      </div>
    </div>
  );
}

// Keep old AudioSection as alias for backward compatibility
function AudioSection(props: any) {
  return <ContentTransformer {...props} />;
}

// Helper to format content with beautiful card-based UI
function formatContent(content: string) {
  // If content is JSON, pretty print
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === "object") {
      return `<pre class="bg-gray-100 p-4 rounded-lg overflow-x-auto"><code>${JSON.stringify(parsed, null, 2)}</code></pre>`;
    }
  } catch {}

  // Lightweight markdown-like to HTML - enhanced for plain text
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

  // Wrap specific sections into callout cards (client-side safe)
  if (typeof window !== 'undefined') {
    const container = document.createElement('div');
    container.innerHTML = formatted;

    const wrapFollowingList = (labelRegex: RegExp, classes: string, title: string) => {
      const paragraphs = Array.from(container.querySelectorAll('p'));
      for (const p of paragraphs) {
        const text = p.textContent?.trim() || '';
        if (labelRegex.test(text)) {
          const next = p.nextElementSibling;
          if (next && (next.tagName === 'UL' || next.tagName === 'OL')) {
            const wrapper = document.createElement('div');
            wrapper.setAttribute('class', classes);
            const header = document.createElement('h3');
            header.setAttribute('class', 'text-lg font-bold mb-4');
            header.textContent = title;
            wrapper.appendChild(header);
            wrapper.appendChild(next);
            p.replaceWith(wrapper);
          }
        }
      }
    };

    const wrapFollowingParagraph = (labelRegex: RegExp, classes: string, title: string) => {
      const paragraphs = Array.from(container.querySelectorAll('p'));
      for (const p of paragraphs) {
        const text = p.textContent?.trim() || '';
        if (labelRegex.test(text)) {
          const next = p.nextElementSibling;
          if (next && next.tagName === 'P') {
            const wrapper = document.createElement('div');
            wrapper.setAttribute('class', classes);
            const header = document.createElement('h3');
            header.setAttribute('class', 'text-lg font-bold mb-4');
            header.textContent = title;
            const body = document.createElement('p');
            body.setAttribute('class', 'leading-relaxed');
            body.innerHTML = next.innerHTML;
            wrapper.appendChild(header);
            wrapper.appendChild(body);
            next.replaceWith(wrapper);
            p.remove();
          }
        }
      }
    };

    // Wrap Learning Objectives: find heading and following list in card
    const allParas = Array.from(container.querySelectorAll('p, ul, ol, li, div'));
    let i = 0;
    while (i < allParas.length) {
      const el = allParas[i];
      const text = el.textContent?.trim() || '';
      
      if (el.tagName === 'P' && text.match(/^Learning Objectives?:/i)) {
        // Found objectives heading; look for following list
        let nextIdx = i + 1;
        while (nextIdx < allParas.length) {
          const nextEl = allParas[nextIdx];
          // Skip divider lines
          if (nextEl.tagName === 'P' && nextEl.textContent?.trim().match(/^[_\-—–=]{3,}$/)) {
            nextIdx++;
            continue;
          }
          // Found the list
          if (nextEl.tagName === 'UL' || nextEl.tagName === 'OL') {
            const wrapper = document.createElement('div');
            wrapper.setAttribute('class', 'mb-6 rounded-lg border border-blue-200 bg-blue-50 p-6');
            const header = document.createElement('h3');
            header.setAttribute('class', 'text-lg font-bold mb-4 text-blue-900');
            header.textContent = 'Learning Objectives';
            wrapper.appendChild(header);
            wrapper.appendChild(nextEl);
            el.replaceWith(wrapper);
            break;
          }
          nextIdx++;
        }
        break;
      }
      i++;
    }

    // Wrap main sections into standalone cards: Module Title, Objectives, Section n:
    const isHeaderPara = (p: Element): { kind: 'module'|'objectives'|'section'|null; title: string } => {
      const text = p.textContent?.trim() || '';
      let m;
      if ((m = text.match(/^Module\s*Title:\s*(.+)$/i))) {
        return { kind: 'module', title: m[1] };
      }
      if ((m = text.match(/^Section\s*(\d+)\s*:\s*(.+)$/i))) {
        return { kind: 'section', title: `Section ${m[1]}: ${m[2]}` };
      }
      if ((m = text.match(/^Module\s*Summary\s*and\s*Next\s*Steps$/i))) {
        return { kind: 'section', title: 'Module Summary and Next Steps' };
      }
      return { kind: null, title: '' };
    };

    const paragraphs = Array.from(container.querySelectorAll('p'));
    for (const p of paragraphs) {
      const info = isHeaderPara(p);
      if (!info.kind) continue;

      // Create card wrapper per kind
      const wrapper = document.createElement('div');
      if (info.kind === 'objectives') {
        wrapper.setAttribute('class', 'mb-8 rounded-xl border border-blue-200 bg-blue-50 p-6 shadow-sm');
      } else {
        wrapper.setAttribute('class', 'mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm');
      }

      // Create card title
      const titleEl = document.createElement(info.kind === 'module' ? 'h1' : 'h2');
      titleEl.setAttribute('class', info.kind === 'module' ? 'text-3xl font-bold mb-4 text-gray-900' : 'text-2xl font-bold mb-4 text-gray-900');
      titleEl.textContent = info.kind === 'module' ? info.title : info.title;
      wrapper.appendChild(titleEl);

      // Move following siblings into the card until the next header paragraph
      let next: Element | null = p.nextElementSibling as Element | null;
      const isHeaderMatch = (el: Element | null) => {
        if (!el || el.tagName !== 'P') return false;
        const t = el.textContent?.trim() || '';
        return /^(Module\s*Title:|Objectives:?|Section\s*\d+\s*:)/i.test(t);
      };
      while (next && !isHeaderMatch(next)) {
        const move = next;
        next = next.nextElementSibling as Element | null;
        wrapper.appendChild(move);
      }

      // Replace the header paragraph with the card
      p.replaceWith(wrapper);
    }

    // Remove any lingering divider lines paragraphs (just underscores/dashes/etc)
    Array.from(container.querySelectorAll('p')).forEach(p => {
      const t = p.textContent?.trim() || '';
      if (/^[_\-—–=]{3,}$/.test(t)) {
        p.remove();
      }
    });

    // Bold sub-headings: make leading label before colon bold (e.g., "Definition:")
    Array.from(container.querySelectorAll('p')).forEach(p => {
      const text = p.textContent || '';
      const match = text.match(/^([A-Z][^:]{2,}):\s*(.*)$/);
      if (match) {
        const label = match[1] + ':';
        const rest = match[2] || '';
        p.innerHTML = `<strong class="font-semibold text-gray-900">${label}</strong> ${rest}`;
      }
    });

    formatted = container.innerHTML;
  }

  return formatted;
}

// Add GenerateAudioButton component
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

// Add GenerateVideoButton component
function GenerateVideoButton({ moduleId, onVideoGenerated }: { moduleId: string, onVideoGenerated: (url: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      // Use the new GPT-based video generation route. Previously we called `/api/video-generation` which
      // generated images/screenshots directly inside this page's flow. That approach is now deprecated here —
      // keep the old call commented below for reference.
      // const res = await fetch(`/api/video-generation?processed_module_id=${moduleId}`);

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
