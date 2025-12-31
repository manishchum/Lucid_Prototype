'use client'

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookOpen, Database } from 'lucide-react';

interface TrainingModule {
  module_id: string;
  title: string;
  description: string;
  content_type: string;
  gpt_summary: string;
}

interface ModuleSuggestionProps {
  indicator: string;
  type: 'lead' | 'lag';
  onModuleSelect?: (moduleId: string) => void;
}

export default function ModuleSuggestion({ indicator, type, onModuleSelect }: ModuleSuggestionProps) {
  const [suggestedModule, setSuggestedModule] = useState<TrainingModule | null>(null);
  const [requiredDataSignal, setRequiredDataSignal] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchModuleSuggestion();
  }, [indicator]);

  const fetchModuleSuggestion = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/suggest-module', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          indicator,
          type,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch module suggestion');
      }

      const data = await response.json();
      setSuggestedModule(data.module);
      setRequiredDataSignal(data.dataSignal);
    } catch (error) {
      console.error('Error fetching module suggestion:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
        <div className="h-3 bg-gray-200 rounded w-full"></div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Suggested Module */}
      {suggestedModule && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
            <span className="text-xs font-medium text-blue-600">Suggested Module</span>
          </div>
          <div className="ml-5">
            <button
              onClick={() => onModuleSelect?.(suggestedModule.module_id)}
              className="text-sm font-medium text-gray-800 hover:text-blue-600 transition-colors text-left"
            >
              {suggestedModule.title}
            </button>
            <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">
              {suggestedModule.description || suggestedModule.gpt_summary}
            </p>
          </div>
        </div>
      )}

      {/* Required Data Signal */}
      {requiredDataSignal && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-orange-600 flex-shrink-0" />
            <span className="text-xs font-medium text-orange-600">Required Data Signal</span>
          </div>
          <p className="text-xs text-gray-700 ml-5">{requiredDataSignal}</p>
        </div>
      )}
    </div>
  );
}
