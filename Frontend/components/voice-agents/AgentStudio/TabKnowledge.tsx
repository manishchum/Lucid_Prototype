"use client";
import React, { useState } from 'react';
import { VoiceAgent, KnowledgeSource } from '@/types/voice-agents';
import { useApp } from '@/contexts/voice-agents-context';
import {
  FileText,
  Upload,
  Link2,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  Eye,
  X,
  FileCode,
  Globe,
  Search,
} from 'lucide-react';

interface TabKnowledgeProps {
  agent: VoiceAgent;
}

export const TabKnowledge: React.FC<TabKnowledgeProps> = ({ agent }) => {
  const { updateAgent, permissions, showToast } = useApp();

  const [activeModal, setActiveModal] = useState<'upload' | 'link' | 'manual' | null>(null);
  const [docTitle, setDocTitle] = useState('');
  const [webUrl, setWebUrl] = useState('');
  const [manualText, setManualText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewItem, setPreviewItem] = useState<KnowledgeSource | null>(null);

  const handleAddSource = (type: 'pdf' | 'docx' | 'url' | 'custom') => {
    if (!docTitle.trim() && type !== 'url') return;
    if (type === 'url' && !webUrl.trim()) return;

    setIsProcessing(true);

    const titleResolved =
      type === 'url'
        ? webUrl.replace(/^https?:\/\//, '').split('/')[0] + ' (Web Link)'
        : docTitle.trim();

    const newId = `kb-${Date.now()}`;
    const newSource: KnowledgeSource = {
      id: newId,
      title: titleResolved,
      type: type,
      size: type === 'url' ? 'Website' : '1.8 MB',
      sourceUrl: type === 'url' ? webUrl : undefined,
      dateAdded: 'Today',
      status: 'processing',
      contentSnippet: manualText.trim() || `Reference knowledge documentation from ${titleResolved}...`,
      charCount: manualText.length || 8500,
    };

    const updated = [...agent.knowledgeBase, newSource];
    updateAgent(agent.id, { knowledgeBase: updated, hasUnsavedChanges: true });

    setTimeout(() => {
      const readyList = updated.map((k) =>
        k.id === newId ? { ...k, status: 'ready' as const } : k
      );
      updateAgent(agent.id, { knowledgeBase: readyList });
      setIsProcessing(false);
      setActiveModal(null);
      setDocTitle('');
      setWebUrl('');
      setManualText('');
      showToast('Knowledge Added', `"${titleResolved}" is ready for your agent to reference.`);
    }, 1200);
  };

  const handleRemoveSource = (id: string) => {
    const updated = agent.knowledgeBase.filter((k) => k.id !== id);
    updateAgent(agent.id, { knowledgeBase: updated, hasUnsavedChanges: true });
    showToast('Removed Source', 'Document removed.');
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
          What should your agent know?
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Give your agent useful information so it can answer questions accurately during calls.
        </p>
      </div>

      {/* 3 Clear Options */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Option 1: Upload a document */}
        <div
          onClick={() => setActiveModal('upload')}
          className="p-5 bg-white rounded-xl border border-slate-200 hover:border-blue-400 hover:shadow-sm transition-all cursor-pointer flex flex-col justify-between group"
        >
          <div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
              <Upload className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
              1. Upload a Document
            </h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Upload PDF manuals, Word documents, or text files with guidelines.
            </p>
          </div>
          <span className="mt-4 text-xs font-semibold text-blue-600 flex items-center gap-1">
            <span>Upload file</span>
            <span>+</span>
          </span>
        </div>

        {/* Option 2: Add a website link */}
        <div
          onClick={() => setActiveModal('link')}
          className="p-5 bg-white rounded-xl border border-slate-200 hover:border-blue-400 hover:shadow-sm transition-all cursor-pointer flex flex-col justify-between group"
        >
          <div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
              <Globe className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
              2. Add a Website Link
            </h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Provide a web page URL such as company FAQs or knowledge base articles.
            </p>
          </div>
          <span className="mt-4 text-xs font-semibold text-blue-600 flex items-center gap-1">
            <span>Add link</span>
            <span>+</span>
          </span>
        </div>

        {/* Option 3: Add manually */}
        <div
          onClick={() => setActiveModal('manual')}
          className="p-5 bg-white rounded-xl border border-slate-200 hover:border-blue-400 hover:shadow-sm transition-all cursor-pointer flex flex-col justify-between group"
        >
          <div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
              <FileText className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
              3. Add Manually
            </h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Type or paste answers, key facts, or instructions directly.
            </p>
          </div>
          <span className="mt-4 text-xs font-semibold text-blue-600 flex items-center gap-1">
            <span>Type notes</span>
            <span>+</span>
          </span>
        </div>
      </div>

      {/* Uploaded Resources List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Knowledge Sources</h3>
          <span className="text-xs text-slate-400">
            {agent.knowledgeBase.length} source(s) available to this agent
          </span>
        </div>

        {agent.knowledgeBase.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            <p>No knowledge sources added yet.</p>
            <p className="text-slate-400 mt-0.5">
              Select one of the 3 options above to give your agent reference documents.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {agent.knowledgeBase.map((k) => (
              <div
                key={k.id}
                className="p-4 flex items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-lg bg-blue-50 text-blue-600 shrink-0">
                    {k.type === 'url' ? <Globe className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-slate-900 truncate">{k.title}</h4>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                      <span className="uppercase">{k.type}</span>
                      <span>·</span>
                      <span>{k.dateAdded}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
                      k.status === 'ready'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-amber-50 text-amber-700 animate-pulse'
                    }`}
                  >
                    {k.status === 'ready' ? (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Ready</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-3 h-3" />
                        <span>Processing...</span>
                      </>
                    )}
                  </span>

                  <button
                    onClick={() => setPreviewItem(k)}
                    className="p-1.5 text-slate-400 hover:text-blue-600 rounded-md"
                    title="Preview content"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>

                  {permissions.canManageKnowledgeBase && (
                    <button
                      onClick={() => handleRemoveSource(k.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md"
                      title="Remove source"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upload Document Modal */}
      {activeModal === 'upload' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Upload a Document</h3>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center bg-slate-50/50 hover:bg-slate-50 cursor-pointer">
                <Upload className="w-7 h-7 text-blue-600 mx-auto mb-2" />
                <p className="font-semibold text-slate-800">Choose a file from your computer</p>
                <p className="text-[11px] text-slate-400 mt-1">PDF, Word (DOCX) or plain text up to 10MB</p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Document Name *</label>
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="e.g. Employee Handbook 2026.pdf"
                  className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setActiveModal(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAddSource('pdf')}
                disabled={!docTitle.trim() || isProcessing}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm"
              >
                {isProcessing ? 'Adding...' : 'Add Document'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Website Link Modal */}
      {activeModal === 'link' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Add a Website Link</h3>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Web Page Address (URL) *</label>
                <input
                  type="url"
                  value={webUrl}
                  onChange={(e) => setWebUrl(e.target.value)}
                  placeholder="https://company.com/faq"
                  className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                The agent will periodically read this web page to answer caller questions.
              </p>
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setActiveModal(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAddSource('url')}
                disabled={!webUrl.trim() || isProcessing}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm"
              >
                {isProcessing ? 'Reading...' : 'Save Link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Information Modal */}
      {activeModal === 'manual' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Add Information Manually</h3>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="e.g. Return Policy Q&A"
                  className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Information / Facts *</label>
                <textarea
                  rows={4}
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder="Type or paste answers the agent should know..."
                  className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setActiveModal(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAddSource('custom')}
                disabled={!docTitle.trim() || !manualText.trim() || isProcessing}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm"
              >
                {isProcessing ? 'Saving...' : 'Save Information'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">{previewItem.title}</h3>
              <button onClick={() => setPreviewItem(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 max-h-64 overflow-y-auto text-xs text-slate-700 bg-slate-50 leading-relaxed font-sans">
              {previewItem.contentSnippet}
            </div>
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 text-right">
              <button
                onClick={() => setPreviewItem(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
