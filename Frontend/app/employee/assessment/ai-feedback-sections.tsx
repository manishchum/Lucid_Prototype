// AI Feedback Sections: Utility to parse and render AI feedback in sections (like learning style feedback)
"use client";

import React, { useEffect, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";

// Helper to parse feedback into better structured sections
export function parseFeedbackSections(feedback: string, employeeName?: string) {
  // Replace placeholders
  let processedFeedback = feedback
    .replace('[Your Name]', 'Lucid')
    .replace('Hi [Employee Name]', `Dear ${employeeName || 'Employee'}`)
    .replace('Subject: Your Baseline Assessment: A Foundation for Growth!','')
    .replace('[Your Name/HR Learning Coach]', 'Lucid Learning Team');
  
  const sections: { title: string; content: string; color: string; type: 'summary' | 'detail' }[] = [];
  const lines = processedFeedback.split('\n').filter(line => line.trim());
  
  let currentSection = { title: '', content: '', color: 'blue', type: 'summary' as 'summary' | 'detail' };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) continue;
    
    // Check for markdown headers (## or ###) or section patterns
    if (trimmed.match(/^#{1,3}\s+(.+)/) || 
        trimmed.match(/^\*\*(.+)\*\*:?$/) ||
        trimmed.match(/^### (.+)/) ||
        trimmed.match(/^## (.+)/) ||
        trimmed.toLowerCase().includes('strengths at a glance') ||
        trimmed.toLowerCase().includes('next steps') ||
        (trimmed.toLowerCase().includes('remember') && trimmed.includes('(')) ||
        (trimmed.toLowerCase().includes('understand') && trimmed.includes('(')) ||
        (trimmed.toLowerCase().includes('apply') && trimmed.includes('(')) ||
        (trimmed.toLowerCase().includes('analyze') && trimmed.includes('(')) ||
        (trimmed.toLowerCase().includes('evaluate') && trimmed.includes('(')) ||
        (trimmed.toLowerCase().includes('create') && trimmed.includes('('))) {
      
      // Save previous section if it has content
      if (currentSection.title && currentSection.content.trim()) {
        sections.push({ ...currentSection });
      }
      
      // Extract title
      let title = trimmed
        .replace(/^#{1,3}\s+/, '')
        .replace(/^\*\*/, '')
        .replace(/\*\*:?$/, '')
        .replace(/^### /, '')
        .replace(/^## /, '')
        .trim();
      
      // Determine color and type based on content
      let color = 'blue';
      let type: 'summary' | 'detail' = 'detail';
      
      if (title.toLowerCase().includes('personalized feedback') || 
          title.toLowerCase().includes('baseline assessment') ||
          title.toLowerCase().includes('overall') ||
          trimmed.toLowerCase().includes('great effort')) {
        color = 'blue'; type = 'summary';
      } else if (title.toLowerCase().includes('strength') || 
                 title.toLowerCase().includes('at a glance') ||
                 title.toLowerCase().includes('you demonstrated')) {
        color = 'purple'; type = 'summary';
      } else if (title.toLowerCase().includes('remember') && title.includes('(')) {
        color = 'green'; type = 'detail';
      } else if (title.toLowerCase().includes('understand') && title.includes('(')) {
        color = 'blue'; type = 'detail';
      } else if (title.toLowerCase().includes('apply') && title.includes('(')) {
        color = 'orange'; type = 'detail';
      } else if (title.toLowerCase().includes('analyze') && title.includes('(')) {
        color = 'indigo'; type = 'detail';
      } else if (title.toLowerCase().includes('evaluate') && title.includes('(')) {
        color = 'red'; type = 'detail';
      } else if (title.toLowerCase().includes('create') && title.includes('(')) {
        color = 'purple'; type = 'detail';
      } else if (title.toLowerCase().includes('next steps') || 
                 title.toLowerCase().includes('recommendations')) {
        color = 'green'; type = 'summary';
      }
      
      currentSection = { title, content: '', color, type };
      
      // Look ahead to collect content for this section
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j].trim();
        
        // Check if this is the start of a new section
        if (nextLine.match(/^#{1,3}\s+(.+)/) || 
            nextLine.match(/^\*\*(.+)\*\*:?$/) ||
            nextLine.match(/^### (.+)/) ||
            nextLine.match(/^## (.+)/) ||
            nextLine.toLowerCase().includes('strengths at a glance') ||
            nextLine.toLowerCase().includes('next steps') ||
            (nextLine.toLowerCase().includes('remember') && nextLine.includes('(')) ||
            (nextLine.toLowerCase().includes('understand') && nextLine.includes('(')) ||
            (nextLine.toLowerCase().includes('apply') && nextLine.includes('(')) ||
            (nextLine.toLowerCase().includes('analyze') && nextLine.includes('(')) ||
            (nextLine.toLowerCase().includes('evaluate') && nextLine.includes('(')) ||
            (nextLine.toLowerCase().includes('create') && nextLine.includes('('))) {
          break;
        }
        
        // Add content to current section
        if (nextLine) {
          currentSection.content += (currentSection.content ? '\n\n' : '') + nextLine;
        }
        j++;
      }
      
      i = j - 1; // Skip the lines we've already processed
    } else if (!currentSection.title) {
      // Handle opening content (usually greeting) - first few lines without a section header
      if (!sections.length) {
        currentSection = { 
          title: 'Assessment Overview', 
          content: trimmed, 
          color: 'blue',
          type: 'summary'
        };
        
        // Collect the initial content until we hit a section header
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j].trim();
          
          // Check if this is the start of a section
          if (nextLine.match(/^#{1,3}\s+(.+)/) || 
              nextLine.match(/^\*\*(.+)\*\*:?$/) ||
              nextLine.toLowerCase().includes('strengths at a glance') ||
              (nextLine.toLowerCase().includes('remember') && nextLine.includes('('))) {
            break;
          }
          
          if (nextLine) {
            currentSection.content += '\n\n' + nextLine;
          }
          j++;
        }
        
        i = j - 1;
      }
    }
  }
  
  // Add the last section
  if (currentSection.title && currentSection.content.trim()) {
    sections.push({ ...currentSection });
  }
  
  // If no sections were found, create a single section from all content
  if (sections.length === 0 && processedFeedback.trim()) {
    sections.push({
      title: 'Assessment Feedback',
      content: processedFeedback.trim(),
      color: 'blue',
      type: 'summary'
    });
  }
  
  return sections;
}

// Renders the feedback sections with improved spacing and organization
export function AIFeedbackSections({ feedback }: { feedback: string }) {
  const { user } = useAuth();
  const [employeeName, setEmployeeName] = useState<string>('');
  
  useEffect(() => {
    const fetchEmployeeName = async () => {
      if (!user?.email) return;
      try {
        const response = await fetch(`/api/get-employee-details?email=${encodeURIComponent(user.email)}`);
        if (response.ok) {
          const data = await response.json();
          setEmployeeName(data.name || '');
        }
      } catch (error) {
        console.error('Error fetching employee name:', error);
      }
    };
    
    fetchEmployeeName();
  }, [user?.email]);
  
  const sections = parseFeedbackSections(feedback, employeeName);
  if (!sections.length) return null;
  
  const summarySection = sections.find(s => s.type === 'summary');
  const detailSections = sections.filter(s => s.type === 'detail');
  
  return (
    <div className="space-y-8">
      {/* Summary Section */}
      {summarySection && (
        <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200 shadow-md">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl text-blue-800 font-semibold">
              Feedback Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="prose prose-blue max-w-none">
              <div className="text-blue-700 leading-relaxed space-y-4">
                {summarySection.content.split('\n\n').map((paragraph, index) => (
                  <p key={index} className="mb-4 last:mb-0">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Other summary sections as individual cards */}
      {sections.filter(s => s.type === 'summary' && s !== summarySection).map((section, index) => (
        <Card key={`summary-${index}`} className={`shadow-sm border-l-4 ${
          section.color === 'green' ? 'bg-green-50 border-green-400' :
          section.color === 'purple' ? 'bg-purple-50 border-purple-400' :
          section.color === 'orange' ? 'bg-orange-50 border-orange-400' :
          'bg-blue-50 border-blue-400'
        }`}>
          <CardHeader className="pb-3">
            <CardTitle className={`text-lg font-semibold ${
              section.color === 'green' ? 'text-green-800' :
              section.color === 'purple' ? 'text-purple-800' :
              section.color === 'orange' ? 'text-orange-800' :
              'text-blue-800'
            }`}>
              {section.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-3">
              {section.content.split('\n\n').map((paragraph, pIndex) => (
                <p key={pIndex} className={`leading-relaxed ${
                  section.color === 'green' ? 'text-green-700' :
                  section.color === 'purple' ? 'text-purple-700' :
                  section.color === 'orange' ? 'text-orange-700' :
                  'text-blue-700'
                }`}>
                  {paragraph}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
      
      {/* Detailed sections as accordion */}
      {detailSections.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-gray-800">
              Detailed Insights & Recommendations
            </CardTitle>
            <p className="text-sm text-gray-600 mt-2">
              Expand each section below for more specific feedback and actionable recommendations.
            </p>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="space-y-3">
              {detailSections.map((section, index) => (
                <AccordionItem 
                  key={index} 
                  value={`detail-${index}`} 
                  className={`border-2 rounded-lg px-4 transition-all duration-200 ${
                    section.color === 'orange' ? 'border-orange-200 hover:border-orange-300' :
                    section.color === 'indigo' ? 'border-indigo-200 hover:border-indigo-300' :
                    'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <AccordionTrigger className="hover:no-underline py-4">
                    <span className={`font-semibold text-left ${
                      section.color === 'orange' ? 'text-orange-800' :
                      section.color === 'indigo' ? 'text-indigo-800' :
                      'text-gray-800'
                    }`}>
                      {section.title}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-6">
                    <div className={`p-6 rounded-lg border-l-4 ${
                      section.color === 'orange' ? 'bg-orange-50 border-orange-400' :
                      section.color === 'indigo' ? 'bg-indigo-50 border-indigo-400' :
                      'bg-gray-50 border-gray-400'
                    }`}>
                      <div className="space-y-4">
                        {section.content.split('\n\n').map((paragraph, pIndex) => (
                          <p key={pIndex} className="leading-relaxed text-gray-700">
                            {paragraph}
                          </p>
                        ))}
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
