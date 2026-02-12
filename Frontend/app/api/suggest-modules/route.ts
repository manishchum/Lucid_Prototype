import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export async function POST(request: NextRequest) {
  try {
    const { leadIndicators, lagIndicators, roleName } = await request.json();

    if (!leadIndicators || !lagIndicators) {
      return NextResponse.json(
        { error: 'Lead and lag indicators are required' },
        { status: 400 }
      );
    }

    // Fetch existing training modules from database
    const { data: dbModules, error: modulesError } = await supabase
      .from('training_modules')
      .select('module_id, title, description, content_type, gpt_summary')
      .eq('processing_status', 'completed')
      .limit(20);

    if (modulesError) {
      console.error('Error fetching modules:', modulesError);
    }

    // Use Gemini to suggest modules (both from database and new ones)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    const dbModulesText = dbModules && dbModules.length > 0
      ? `\n\nExisting Training Modules in Database:\n${dbModules.map((m, i) => `${i + 1}. ${m.title}: ${m.description || m.gpt_summary || 'No description'}`).join('\n')}`
      : '';

    const prompt = `You are a training and development expert with deep knowledge of business data systems. Based on the following KPI indicators for the role of "${roleName}", suggest training modules that would help develop the required skills and competencies.

Lead Indicators (Behavioral/Predictive):
${leadIndicators.map((ind, i) => `${i + 1}. ${ind}`).join('\n')}

Lag Indicators (Outcome-based):
${lagIndicators.map((ind, i) => `${i + 1}. ${ind}`).join('\n')}
${dbModulesText}

For each KPI indicator (both lead and lag), suggest 1-2 relevant training modules.

For each suggested module, you must provide:
1. **target_kpi**: The exact KPI name from the list above that this module addresses
2. **kpi_type**: Either "lead" or "lag" 
3. **title**: Module title
4. **description**: Detailed description of what this module covers and how it relates to the specific KPI
5. **source**: "database" if it matches an existing module, "ai-generated" if it's a new suggestion
6. **content_type**: e.g., "video", "interactive course", "workshop", "assessment"
7. **relevance_score**: 0-100 based on how well it addresses the specific KPI
8. **database_title_match**: exact title from database if source is database, otherwise null
9. **suggested_datasets**: An array of 2-4 specific company data sources/systems that should be integrated or monitored to track this KPI and support the training module. Be specific about:
   - What system/tool (e.g., "Salesforce CRM", "Google Analytics", "HubSpot", "JIRA", "Employee Survey Platform")
   - What specific data points to track (e.g., "Deal progression stages", "Customer engagement metrics", "Ticket resolution times")
   - How this data relates to the module and KPI

Example of suggested_datasets:
[
  {
    "source": "Salesforce CRM",
    "data_points": ["Lead response time", "Follow-up frequency", "Meeting scheduling rate"],
    "purpose": "Track proactive engagement behaviors that predict sales success"
  },
  {
    "source": "Calendar API (Outlook/Google)",
    "data_points": ["Number of client meetings", "Meeting duration", "Meeting outcomes"],
    "purpose": "Measure customer interaction frequency and quality"
  }
]

Provide a response in the following JSON format:
{
  "modules": [
    {
      "target_kpi": "exact KPI name from the list",
      "kpi_type": "lead" or "lag",
      "title": "Module Title",
      "description": "Detailed description",
      "source": "database" or "ai-generated",
      "content_type": "video/interactive course/workshop/assessment",
      "relevance_score": 85,
      "database_title_match": "exact title from database or null",
      "suggested_datasets": [
        {
          "source": "System/Tool Name",
          "data_points": ["specific metric 1", "specific metric 2"],
          "purpose": "How this data supports the KPI and training"
        }
      ]
    }
  ]
}

Focus on practical, actionable training that directly addresses each specific KPI. Suggest real-world, commonly used business systems and tools. Ensure each KPI has at least one module suggestion with relevant datasets.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse AI response');
    }

    const aiResponse = JSON.parse(jsonMatch[0]);

    // Enrich database modules with their IDs
    const enrichedModules = aiResponse.modules.map((module: any) => {
      if (module.source === 'database' && module.database_title_match && dbModules) {
        const dbModule = dbModules.find(m => 
          m.title.toLowerCase().trim() === module.database_title_match.toLowerCase().trim()
        );
        if (dbModule) {
          return {
            ...module,
            module_id: dbModule.module_id,
          };
        }
      }
      return module;
    });

    return NextResponse.json({
      modules: enrichedModules,
    });
  } catch (error) {
    console.error('Error suggesting modules:', error);
    return NextResponse.json(
      { error: 'Failed to suggest modules' },
      { status: 500 }
    );
  }
}
