'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit2, Trash2, Eye, Loader2 } from 'lucide-react';
import { CareerJourneyDB } from '@/lib/types/career-journey';
import { fetchWithAuth } from '@/lib/fetch-with-auth';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

interface SavedDraftsProps {
  userId: string;
  onEditDraft: (draft: CareerJourneyDB) => void;
  onNotification?: (message: string, type: 'success' | 'error' | 'info') => void;
  refreshTrigger?: number; // External trigger to refresh drafts
}

export default function SavedDrafts({
  userId,
  onEditDraft,
  onNotification,
  refreshTrigger,
}: SavedDraftsProps) {
  const [drafts, setDrafts] = useState<CareerJourneyDB[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Load drafts on mount and when refreshTrigger changes
  useEffect(() => {
    loadDrafts();
  }, [refreshTrigger, userId]);

  const loadDrafts = async () => {
    setLoading(true);
    try {
      const response = await fetchWithAuth(`${API_BASE}/api/career-journeys?status=draft`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': userId,
        },
      });
      const result = await response.json();

      if (!response.ok) {
        const errorMsg = result?.error || result?.message || response.statusText || 'Failed to load drafts';
        onNotification?.(errorMsg, 'error');
        setDrafts([]);
      } else {
        setDrafts(result.data || []);
      }
    } catch (error: any) {
      onNotification?.(error.message || 'Failed to load drafts', 'error');
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDraft = async (draftId: string) => {
    if (!confirm('Are you sure you want to delete this draft?')) {
      return;
    }

    setDeleting(draftId);

    try {
      const response = await fetchWithAuth(`${API_BASE}/api/career-journeys/${draftId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': userId,
        },
      });
      const result = await response.json();

      if (!response.ok) {
        const errorMsg = result?.error || result?.message || response.statusText || 'Failed to delete draft';
        onNotification?.(errorMsg, 'error');
      } else {
        setDrafts((prev) => prev.filter((d) => d.id !== draftId));
        onNotification?.('Draft deleted successfully', 'success');
      }
    } catch (error: any) {
      onNotification?.(error.message || 'Failed to delete draft', 'error');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
        <p className="text-slate-600">Loading drafts...</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-lg font-bold text-slate-900 mb-4">Saved Drafts</h3>

      {drafts.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-12 bg-slate-50 rounded-lg border border-slate-200"
        >
          <p className="text-slate-500">No Drafts Yet. Create Your First SprintVerse!</p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {drafts.map((draft) => (
              <motion.div
                key={draft.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="p-5 bg-white border border-slate-200 rounded-xl hover:border-blue-300 hover:shadow-lg transition-all cursor-pointer group"
                onClick={() => onEditDraft(draft)}
              >
                <div className="flex justify-between items-start mb-3">
                  <h4 className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors flex-1">
                    {draft.title}
                  </h4>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditDraft(draft);
                      }}
                      className="p-2 hover:bg-blue-100 text-blue-600 rounded-lg transition-colors"
                      title="Edit draft"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDraft(draft.id!);
                      }}
                      disabled={deleting === draft.id}
                      className="p-2 hover:bg-red-100 text-red-600 rounded-lg transition-colors disabled:opacity-50"
                      title="Delete draft"
                    >
                      {deleting === draft.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <p className="text-sm text-slate-600 mb-3 line-clamp-2">
                  {draft.description || 'No description'}
                </p>

                <div className="flex justify-between items-center text-xs text-slate-500">
                  <span>{draft.skills?.length || 0} skills</span>
                  <span>
                    by {draft.createdBy === 'you' ? 'You' : 'Admin'}
                  </span>
                </div>

                {draft.category && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <span className="inline-block text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                      {draft.category}
                    </span>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
