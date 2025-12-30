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
    const { indicator, type } = await request.json();

    if (!indicator) {
      return NextResponse.json(
        { error: 'Indicator is required' },
        { status: 400 }
      );
    }

    // Fetch all training modules
    const { data: modules, error: modulesError } = await supabase
      .from('training_modules')
      .select('module_id, title, description, content_type, gpt_summary')
      .eq('processing_status', 'completed')
      .limit(50);

    if (modulesError) {
      console.error('Error fetching modules:', modulesError);
      return NextResponse.json(
        { error: 'Failed to fetch training modules' },
        { status: 500 }
      );
    }

    if (!modules || modules.length === 0) {
      return NextResponse.json({
        module: null,
        dataSignal: generateDataSignal(indicator, type),
      });
    }

    // Use Gemini to find the best matching module
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    const prompt = `Given the following ${type} indicator: "${indicator}"

Find the most relevant training module from this list:
${modules.map((m, i) => `${i + 1}. ${m.title}: ${m.description || m.gpt_summary || 'No description'}`).join('\n')}

Also suggest an appropriate data signal that would be required to track this indicator.

Respond in JSON format:
{
  "moduleIndex": <index number starting from 1>,
  "dataSignal": "specific data source or metric needed"
}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({
        module: modules[0],
        dataSignal: generateDataSignal(indicator, type),
      });
    }

    const aiResponse = JSON.parse(jsonMatch[0]);
    const selectedModule = modules[aiResponse.moduleIndex - 1] || modules[0];

    return NextResponse.json({
      module: selectedModule,
      dataSignal: aiResponse.dataSignal || generateDataSignal(indicator, type),
    });
  } catch (error) {
    console.error('Error suggesting module:', error);
    return NextResponse.json(
      { error: 'Failed to suggest module' },
      { status: 500 }
    );
  }
}

function generateDataSignal(indicator: string, type: string): string {
  // Fallback data signal generation
  const signals: Record<string, string[]> = {
    lead: [
      'CRM Activity Logs or Calendar API',
      'Project Management Tool (Jira/Asana) or CRM Stage History',
      'QA Audit Scores or Manager Observation Forms',
    ],
    lag: [
      'ERP Invoicing Data or POS Transaction Logs',
      'CSAT/NPS Survey Data or Support Ticket Ratings',
      'Incident Reports or QC Rejection Logs',
    ],
  };

  const defaultSignals = signals[type] || signals.lead;
  return defaultSignals[Math.floor(Math.random() * defaultSignals.length)];
}
