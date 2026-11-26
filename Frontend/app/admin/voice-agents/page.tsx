"use client";

import dynamic from 'next/dynamic';

const VoiceAgentsApp = dynamic(() => import('@/components/voice-agents/VoiceAgentsApp'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center h-[calc(100vh-4rem)] bg-slate-50/50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-medium text-slate-500">Loading Voice Agents Studio...</span>
      </div>
    </div>
  ),
});

export default function VoiceAgentsPage() {
  return <VoiceAgentsApp />;
}
