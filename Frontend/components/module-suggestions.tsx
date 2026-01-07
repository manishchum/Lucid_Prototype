'use client'

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookOpen, Database, Sparkles, Plus, ExternalLink, TrendingUp, TrendingDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatContentType } from '@/lib/contentType';

interface DatasetSuggestion {
  source: string;
  data_points: string[];
  purpose: string;
}

interface SuggestedModule {
  module_id?: string;
  title: string;
  description: string;
  source: 'database' | 'ai-generated';
  content_type?: string;
  relevance_score?: number;
  target_kpi: string;
  kpi_type: 'lead' | 'lag';
  suggested_datasets?: DatasetSuggestion[];
}

interface ModuleSuggestionsProps {
  leadIndicators: string[];
  lagIndicators: string[];
  roleName: string;
}

export default function ModuleSuggestions({ leadIndicators, lagIndicators, roleName }: ModuleSuggestionsProps) {
  const [suggestedModules, setSuggestedModules] = useState<SuggestedModule[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (leadIndicators.length > 0 || lagIndicators.length > 0) {
      fetchModuleSuggestions();
    }
  }, [leadIndicators, lagIndicators]);

  const fetchModuleSuggestions = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/suggest-modules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadIndicators,
          lagIndicators,
          roleName,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch module suggestions');
      }

      const data = await response.json();
      setSuggestedModules(data.modules);
    } catch (error) {
      console.error('Error fetching module suggestions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Group modules by KPI
  const groupedModules = suggestedModules.reduce((acc, module) => {
    if (!acc[module.target_kpi]) {
      acc[module.target_kpi] = [];
    }
    acc[module.target_kpi].push(module);
    return acc;
  }, {} as Record<string, SuggestedModule[]>);

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          Suggested Training Modules by KPI
        </CardTitle>
        <p className="text-sm text-gray-600">
          AI-powered module recommendations categorized by each KPI indicator
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            <p className="ml-3 text-gray-600">Generating module suggestions...</p>
          </div>
        ) : suggestedModules.length > 0 ? (
          <div className="space-y-6">
            {/* Lead Indicators Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b-2 border-green-200">
                <TrendingUp className="w-5 h-5 text-green-600" />
                <h3 className="font-semibold text-lg text-gray-900">Lead Indicator Modules</h3>
              </div>
              {leadIndicators.map((kpi) => {
                const modules = groupedModules[kpi];
                if (!modules || modules.length === 0) return null;
                
                return (
                  <div key={kpi} className="space-y-3">
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 mt-2 flex-shrink-0"></div>
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900 mb-3">{kpi}</h4>
                        <div className="space-y-3 pl-4">
                          {modules.map((module, index) => (
                            <div
                              key={index}
                              className="p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow bg-white"
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <h5 className="font-semibold text-gray-900">{module.title}</h5>
                                    <Badge 
                                      variant={module.source === 'database' ? 'default' : 'secondary'}
                                      className={module.source === 'database' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}
                                    >
                                      {module.source === 'database' ? 'Existing' : 'Suggested'}
                                    </Badge>
                                  </div>
                                  <p className="text-sm text-gray-600 mb-3">{module.description}</p>
                                  
                                  {module.content_type && (
                                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                                      <BookOpen className="w-3.5 h-3.5" />
                                      <span className="">{formatContentType(module.content_type)}</span>
                                    </div>
                                  )}

                                  {/* Suggested Datasets */}
                                  {module.suggested_datasets && module.suggested_datasets.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-gray-100">
                                      <div className="flex items-center gap-1.5 mb-2">
                                        <Database className="w-4 h-4 text-orange-600" />
                                        <span className="text-xs font-semibold text-gray-700">Suggested Company Datasets</span>
                                      </div>
                                      <div className="space-y-2 ml-5">
                                        {module.suggested_datasets.map((dataset, idx) => (
                                          <div key={idx} className="bg-orange-50 border border-orange-200 rounded p-2">
                                            <div className="flex items-start gap-2">
                                              <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 flex-shrink-0"></div>
                                              <div className="flex-1">
                                                <p className="text-xs font-medium text-gray-900">{dataset.source}</p>
                                                <p className="text-xs text-gray-600 mt-0.5">
                                                  <span className="font-medium">Track: </span>
                                                  {dataset.data_points.join(', ')}
                                                </p>
                                                <p className="text-xs text-gray-500 mt-1 italic">{dataset.purpose}</p>
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                
                                {module.relevance_score && (
                                  <div className="ml-4 text-right">
                                    <div className="text-xl font-bold text-green-600">{module.relevance_score}%</div>
                                    <div className="text-xs text-gray-500">Match</div>
                                  </div>
                                )}
                              </div>

                              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                                {module.source === 'database' ? (
                                  <Button size="sm" variant="outline" className="gap-1">
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    View Module
                                  </Button>
                                ) : (
                                  <Button size="sm" variant="outline" className="gap-1">
                                    <Plus className="w-3.5 h-3.5" />
                                    Create Module
                                  </Button>
                                )}
                                <Button size="sm" className="bg-green-600 hover:bg-green-700">
                                  Assign to Role
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Lag Indicators Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b-2 border-blue-200">
                <TrendingDown className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-lg text-gray-900">Lag Indicator Modules</h3>
              </div>
              {lagIndicators.map((kpi) => {
                const modules = groupedModules[kpi];
                if (!modules || modules.length === 0) return null;
                
                return (
                  <div key={kpi} className="space-y-3">
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0"></div>
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900 mb-3">{kpi}</h4>
                        <div className="space-y-3 pl-4">
                          {modules.map((module, index) => (
                            <div
                              key={index}
                              className="p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow bg-white"
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <h5 className="font-semibold text-gray-900">{module.title}</h5>
                                    <Badge 
                                      variant={module.source === 'database' ? 'default' : 'secondary'}
                                      className={module.source === 'database' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}
                                    >
                                      {module.source === 'database' ? 'Existing' : 'Suggested'}
                                    </Badge>
                                  </div>
                                  <p className="text-sm text-gray-600 mb-3">{module.description}</p>
                                  
                                  {module.content_type && (
                                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                                      <BookOpen className="w-3.5 h-3.5" />
                                      <span className="">{formatContentType(module.content_type)}</span>
                                    </div>
                                  )}

                                  {/* Suggested Datasets */}
                                  {module.suggested_datasets && module.suggested_datasets.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-gray-100">
                                      <div className="flex items-center gap-1.5 mb-2">
                                        <Database className="w-4 h-4 text-orange-600" />
                                        <span className="text-xs font-semibold text-gray-700">Suggested Company Datasets</span>
                                      </div>
                                      <div className="space-y-2 ml-5">
                                        {module.suggested_datasets.map((dataset, idx) => (
                                          <div key={idx} className="bg-orange-50 border border-orange-200 rounded p-2">
                                            <div className="flex items-start gap-2">
                                              <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 flex-shrink-0"></div>
                                              <div className="flex-1">
                                                <p className="text-xs font-medium text-gray-900">{dataset.source}</p>
                                                <p className="text-xs text-gray-600 mt-0.5">
                                                  <span className="font-medium">Track: </span>
                                                  {dataset.data_points.join(', ')}
                                                </p>
                                                <p className="text-xs text-gray-500 mt-1 italic">{dataset.purpose}</p>
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                
                                {module.relevance_score && (
                                  <div className="ml-4 text-right">
                                    <div className="text-xl font-bold text-blue-600">{module.relevance_score}%</div>
                                    <div className="text-xs text-gray-500">Match</div>
                                  </div>
                                )}
                              </div>

                              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                                {module.source === 'database' ? (
                                  <Button size="sm" variant="outline" className="gap-1">
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    View Module
                                  </Button>
                                ) : (
                                  <Button size="sm" variant="outline" className="gap-1">
                                    <Plus className="w-3.5 h-3.5" />
                                    Create Module
                                  </Button>
                                )}
                                <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                                  Assign to Role
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">
            <BookOpen className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <p>No module suggestions available yet</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
