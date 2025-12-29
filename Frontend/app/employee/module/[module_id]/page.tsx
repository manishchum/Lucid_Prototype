"use client";

import { useEffect, useState } from "react";
import AudioPlayer from "./AudioPlayer";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import EmployeeNavigation from "@/components/employee-navigation";
import { ChevronLeft, Info, Lightbulb, BookOpen, Zap } from "lucide-react";
import clsx from "clsx";

export default function ModuleContentPage({ params }: { params: { module_id: string } }) {
  const moduleId = params.module_id;
  const [module, setModule] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState<any>(null);
  const [learningStyle, setLearningStyle] = useState<string | null>(null);
  const [audioExpanded, setAudioExpanded] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [plainTranscript, setPlainTranscript] = useState("");
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
        if (employeeEmail) {
          const { data: emp } = await supabase
            .from('users')
            .select('user_id')
            .eq('email', employeeEmail)
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
      } catch (e) {
        console.log('[module] employee fetch error', e);
      }
      // Fetch module info from processed_modules - try direct lookup first, then fallbacks
      const selectCols = "processed_module_id, title, content, audio_url, original_module_id, learning_style, user_id";
      
      let data: any = null;
      
      // First try: direct lookup by processed_module_id (this is what we pass from training plan)
      console.log('[module] Attempting direct fetch by processed_module_id:', moduleId);
      const { data: directData, error: directError } = await supabase
        .from('processed_modules')
        .select(selectCols)
        .eq('processed_module_id', moduleId)
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
        setModule(data as any);
        setPlainTranscript(extractPlainText(data.content || ''));
        // Log view to module_progress using processed_module_id and module_id, and started_at
        try {
          if (empObj?.user_id) {
            console.log('[module] Logging progress for employee:', empObj.user_id, 'module:', data.processed_module_id);
            await fetch('/api/module-progress', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                user_id: empObj.user_id,
                processed_module_id: data.processed_module_id,
                module_id: data.original_module_id,
                viewed_at: new Date().toISOString(),
                started_at: new Date().toISOString(),
                audio_url: data.audio_url,
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

                {/* Main Content Card */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 mb-8">
                  <div className="prose prose-sm max-w-none text-gray-800" dangerouslySetInnerHTML={{ __html: formatContent(module.content || '') }} />
                </div>

                {/* Audio section */}
                <AudioSection
                  module={module}
                  employee={employee}
                  audioExpanded={audioExpanded}
                  setAudioExpanded={setAudioExpanded}
                  liveTranscript={liveTranscript}
                  plainTranscript={plainTranscript}
                  setLiveTranscript={setLiveTranscript}
                  onAudioGenerated={(url: string) => setModule((m: any) => ({ ...m, audio_url: url }))}
                />
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

function extractPlainText(content: string) {
  // Basic markdown/HTML stripping for a readable transcript source
  return content
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*>`_\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function AudioSection({
  module,
  employee,
  audioExpanded,
  setAudioExpanded,
  liveTranscript,
  plainTranscript,
  setLiveTranscript,
  onAudioGenerated,
}: any) {
  const hasAudio = !!module.audio_url;

  const handleTimeUpdate = (current: number, duration: number) => {
    if (!duration || !plainTranscript) return;
    const ratio = Math.min(current / duration, 1);
    const chars = Math.floor(plainTranscript.length * ratio);
    setLiveTranscript(plainTranscript.slice(0, chars));
  };

  const handleResetTranscript = () => setLiveTranscript('');

  return (
    <div className="mt-6 w-full">
      <div
        className={clsx(
          "w-full rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 shadow-sm",
          "transition-all duration-300",
          audioExpanded ? "p-5" : "p-4"
        )}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-blue-600 text-white flex items-center justify-center text-lg font-semibold shadow-lg">
                🎧
              </div>
              <div>
                <div className="text-sm uppercase tracking-wide text-slate-500">Audio Preview</div>
                <div className="text-base font-semibold text-slate-900">Listen to this module</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasAudio && (
                <Button
                  variant="default"
                  className="rounded-full px-5 py-2 text-sm font-medium shadow-md"
                  onClick={() => setAudioExpanded((v: boolean) => !v)}
                >
                  {audioExpanded ? 'Hide Player' : 'Open Audio'}
                </Button>
              )}
            </div>
          </div>

          {!hasAudio && (
            <div className="mt-2">
              <GenerateAudioButton
                moduleId={module.processed_module_id}
                onAudioGenerated={onAudioGenerated}
              />
            </div>
          )}

          {hasAudio && audioExpanded && (
            <div className="mt-3 grid gap-3">
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
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-600 mb-2">Live transcript</div>
                <div className="min-h-[80px] whitespace-pre-wrap text-slate-800 text-sm leading-6">
                  {liveTranscript || 'Press play to see the transcript unfold in sync.'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
  
  const lines = content.split('\n');
  const htmlParts: string[] = [];
  // If content is JSON, pretty print
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === "object") {
      return `<pre class="bg-gray-100 p-4 rounded-lg overflow-x-auto"><code>${JSON.stringify(parsed, null, 2)}</code></pre>`;
    }
  } catch {}

  // Lightweight markdown-like to HTML (original behavior)
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
    .replace(/^[\*\-] (.*$)/gm, '<li class="ml-4 mb-2">$1</li>')
    .replace(/^\d+\. (.*$)/gm, '<li class="ml-4 mb-2">$1</li>')
    .replace(/\n\n+/g, '</p><p class="mb-4">')
    .replace(/\n/g, '<br/>');

  formatted = '<p class="mb-4">' + formatted + '</p>';
  formatted = formatted
    .replace(/<p class="mb-4">(<li class="ml-4 mb-2[^>]*>.*?(?:<\/li>(?:\s*<br\/>\s*<li|<\/li>))*<\/li>)/g, '<ul class="mb-4 space-y-1">$1</ul>')
    .replace(/<br\/>\s*(<li class="ml-4 mb-2[^>]*>)/g, '$1')
    .replace(/(<\/li>)\s*<br\/>/g, '$1');

  formatted = formatted.replace(/<p class="mb-4">\s*<\/p>/g, '');
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

      const res = await fetch(`/api/gpt-video-generation?processed_module_id=${moduleId}`);
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
