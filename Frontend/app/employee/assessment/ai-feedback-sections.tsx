"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  ChevronDown, 
  ChevronRight, 
  TrendingUp, 
  Target, 
  BookOpen, 
  Lightbulb,
  Award,
  AlertCircle,
  CheckCircle2,
  MessageSquare
} from 'lucide-react';

interface AIFeedbackSectionsProps {
  feedback: string;
}

interface FeedbackSection {
  title: string;
  content: string;
  icon: React.ReactNode;
  type: 'success' | 'warning' | 'info' | 'neutral';
}

const AIFeedbackSections: React.FC<AIFeedbackSectionsProps> = ({ feedback }) => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['opening']));

  const toggleSection = (sectionKey: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionKey)) {
      newExpanded.delete(sectionKey);
    } else {
      newExpanded.add(sectionKey);
    }
    setExpandedSections(newExpanded);
  };

  const expandAllSections = () => {
    const allSections = parsedSections.map((_, index) => `section-${index}`);
    setExpandedSections(new Set(['opening', ...allSections]));
  };

  const collapseAllSections = () => {
    setExpandedSections(new Set());
  };

  // Clean up the feedback text
  const cleanText = (text: string): string => {
    return text
      .replace(/#{1,6}\s*/g, '') // Remove markdown headers
      .replace(/\*\*/g, '') // Remove bold markdown
      .replace(/\*/g, '') // Remove italic markdown
      .replace(/^\s*[-•]\s*/gm, '• ') // Normalize bullet points
      .replace(/\n\s*\n/g, '\n\n') // Normalize spacing
      .trim();
  };

  // Parse feedback into sections
  const parseFeedback = (feedbackText: string): FeedbackSection[] => {
    const sections: FeedbackSection[] = [];
    
    // Split by common section patterns
    const sectionPatterns = [
      { pattern: /(?:###?\s*)?1\.\s*Opening(?:\s+Remarks?)?/i, key: 'opening', icon: <MessageSquare className="h-5 w-5" />, type: 'info' as const },
      { pattern: /(?:###?\s*)?2\.\s*Overall\s+Performance\s+Summary/i, key: 'performance', icon: <TrendingUp className="h-5 w-5" />, type: 'neutral' as const },
      { pattern: /(?:###?\s*)?3\.\s*Strengths?\s+Identified/i, key: 'strengths', icon: <CheckCircle2 className="h-5 w-5" />, type: 'success' as const },
      { pattern: /(?:###?\s*)?4\.\s*Areas?\s+for\s+Improvement/i, key: 'improvement', icon: <AlertCircle className="h-5 w-5" />, type: 'warning' as const },
      { pattern: /(?:###?\s*)?5\.\s*Actionable\s+Study\s+Recommendations/i, key: 'recommendations', icon: <Lightbulb className="h-5 w-5" />, type: 'info' as const },
      { pattern: /(?:###?\s*)?6\.\s*Closing\s+Remarks?/i, key: 'closing', icon: <Award className="h-5 w-5" />, type: 'success' as const }
    ];

    const lines = feedbackText.split('\n');
    let currentSection: { title: string; content: string[]; icon: React.ReactNode; type: 'success' | 'warning' | 'info' | 'neutral' } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check if this line starts a new section
      const matchedPattern = sectionPatterns.find(p => p.pattern.test(line));
      
      if (matchedPattern) {
        // Save previous section
        if (currentSection) {
          sections.push({
            title: currentSection.title,
            content: cleanText(currentSection.content.join('\n')),
            icon: currentSection.icon,
            type: currentSection.type
          });
        }
        
        // Start new section
        currentSection = {
          title: line.replace(/(?:###?\s*)?(?:\d+\.\s*)?/, ''), // Remove numbering and markdown
          content: [],
          icon: matchedPattern.icon,
          type: matchedPattern.type
        };
      } else if (currentSection && line) {
        // Add content to current section
        currentSection.content.push(line);
      }
    }

    // Don't forget the last section
    if (currentSection) {
      sections.push({
        title: currentSection.title,
        content: cleanText(currentSection.content.join('\n')),
        icon: currentSection.icon,
        type: currentSection.type
      });
    }

    return sections;
  };

  const parsedSections = parseFeedback(feedback);

  const getSectionBorderColor = (type: string) => {
    switch (type) {
      case 'success': return 'border-l-green-500';
      case 'warning': return 'border-l-yellow-500';
      case 'info': return 'border-l-blue-500';
      default: return 'border-l-gray-500';
    }
  };

  const getSectionBgColor = (type: string) => {
    switch (type) {
      case 'success': return 'bg-green-50 hover:bg-green-100';
      case 'warning': return 'bg-yellow-50 hover:bg-yellow-100';
      case 'info': return 'bg-blue-50 hover:bg-blue-100';
      default: return 'bg-gray-50 hover:bg-gray-100';
    }
  };

  const getSectionIconColor = (type: string) => {
    switch (type) {
      case 'success': return 'text-green-600';
      case 'warning': return 'text-yellow-600';
      case 'info': return 'text-blue-600';
      default: return 'text-gray-600';
    }
  };

  const formatContent = (content: string) => {
    // Split into paragraphs and format lists
    const paragraphs = content.split('\n\n');
    
    return paragraphs.map((paragraph, index) => {
      // Check if it's a list
      if (paragraph.includes('• ')) {
        const listItems = paragraph.split('\n').filter(line => line.trim().startsWith('•'));
        return (
          <ul key={index} className="list-none space-y-2 my-4">
            {listItems.map((item, itemIndex) => (
              <li key={itemIndex} className="flex items-start gap-2">
                <span className="text-blue-500 text-sm mt-1">•</span>
                <span className="text-gray-700">{item.replace('• ', '').trim()}</span>
              </li>
            ))}
          </ul>
        );
      }
      
      // Regular paragraph
      return (
        <p key={index} className="text-gray-700 leading-relaxed mb-3">
          {paragraph.trim()}
        </p>
      );
    });
  };

  if (!parsedSections.length) {
    return (
      <div className="bg-gray-50 rounded-lg p-6">
        <p className="text-gray-600 whitespace-pre-wrap">{cleanText(feedback)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section Controls */}
      <div className="flex gap-2 mb-4">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={expandAllSections}
          className="text-sm"
        >
          <BookOpen className="h-4 w-4 mr-1" />
          Expand All
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={collapseAllSections}
          className="text-sm"
        >
          <Target className="h-4 w-4 mr-1" />
          Collapse All
        </Button>
      </div>

      {/* Feedback Sections */}
      {parsedSections.map((section, index) => {
        const sectionKey = `section-${index}`;
        const isExpanded = expandedSections.has(sectionKey);
        
        return (
          <Card 
            key={sectionKey} 
            className={`transition-all duration-200 border-l-4 ${getSectionBorderColor(section.type)}`}
          >
            <CardHeader 
              className={`cursor-pointer ${getSectionBgColor(section.type)} transition-colors`}
              onClick={() => toggleSection(sectionKey)}
            >
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={getSectionIconColor(section.type)}>
                    {section.icon}
                  </div>
                  <span className="text-lg font-semibold">{section.title}</span>
                  <Badge variant="outline" className="ml-2">
                    {section.type}
                  </Badge>
                </div>
                <div className="text-gray-400">
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            
            {isExpanded && (
              <CardContent className="pt-6">
                <div className="prose prose-sm max-w-none">
                  {formatContent(section.content)}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
};

export default AIFeedbackSections;
