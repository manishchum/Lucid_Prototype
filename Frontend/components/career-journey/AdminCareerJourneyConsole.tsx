'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus } from 'lucide-react';
import CareerJourneyBuilder from './CareerJourneyBuilder';
import SavedDrafts from './SavedDrafts';
import { CareerJourneyDB } from '@/lib/types/career-journey';

interface AdminCareerJourneyConsoleProps {
  userId: string;
  onNotification?: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function AdminCareerJourneyConsole({
  userId,
  onNotification,
}: AdminCareerJourneyConsoleProps) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingDraft, setEditingDraft] = useState<CareerJourneyDB | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleOpenBuilder = () => {
    setEditingDraft(null);
    setShowBuilder(true);
  };

  const handleEditDraft = (draft: CareerJourneyDB) => {
    setEditingDraft(draft);
    setShowBuilder(true);
  };

  const handleBuilderClose = () => {
    setShowBuilder(false);
    setEditingDraft(null);
    // Trigger refresh of drafts list
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div className="space-y-6">
      {/* Header with Create Button */}
      <div className="flex justify-between items-center">
        <div className="space-y-6">
      {/* Header Card */}
      <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200 mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">SprintVerse</h1>
        <p className="text-slate-600">Create New SprintVerse</p>
      </div>
        </div>
        <button
          onClick={handleOpenBuilder}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors shadow-lg hover:shadow-xl"
        >
          <Plus className="w-5 h-5" />
          New SprintVerse
        </button>
      </div>

      {/* Saved Drafts Section */}
      <SavedDrafts
        userId={userId}
        onEditDraft={handleEditDraft}
        onNotification={onNotification}
        refreshTrigger={refreshTrigger}
      />

      {/* Career Journey Builder Modal */}
      <AnimatePresence>
        {showBuilder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <CareerJourneyBuilder
              onClose={handleBuilderClose}
              onNotification={onNotification}
              userId={userId}
              initialData={editingDraft}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
