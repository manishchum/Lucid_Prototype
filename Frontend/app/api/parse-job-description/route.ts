import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(request: NextRequest) {
  try {
    const { roleName, jobDescription } = await request.json();

    if (!roleName || !jobDescription) {
      return NextResponse.json(
        { error: 'Role name and job description are required' },
        { status: 400 }
      );
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    const prompt = `Analyze the following job description for the role of "${roleName}" and extract Key Performance Indicators (KPIs).

Job Description:
${jobDescription}

For each KPI, provide:
1. **Name**: A clear, concise name for the KPI
2. **Description**: A detailed explanation of what this KPI measures and why it's important
3. **Formula**: The calculation or measurement method (if applicable). Use clear mathematical notation or describe the data collection method.

Provide exactly 3 Lead Indicators (proactive metrics that predict future performance) and exactly 3 Lag Indicators (outcome metrics that measure past performance).

Also provide:
- Learning Strategy: A comprehensive strategy for training and development for this role
- Data Strategy: A strategy for data collection, analysis, and utilization for tracking these KPIs

IMPORTANT: Return ONLY valid JSON without any markdown formatting, code blocks, or additional text.

Return the response in this exact JSON format:
{
  "leadIndicators": [
    {
      "name": "KPI Name",
      "description": "Detailed description of what this measures",
      "formula": "Formula or measurement method"
    }
  ],
  "lagIndicators": [
    {
      "name": "KPI Name",
      "description": "Detailed description of what this measures",
      "formula": "Formula or measurement method"
    }
  ],
  "learningStrategy": "detailed learning strategy text",
  "dataStrategy": "detailed data strategy text"
}

Ensure all formulas are practical and measurable. Make sure all JSON strings are properly escaped and do not contain line breaks within string values.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    console.log('Raw AI Response:', text);

    // Clean the response
    // Remove markdown code blocks if present
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    
    // Trim whitespace
    text = text.trim();

    // Extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in response:', text);
      throw new Error('Failed to extract JSON from AI response');
    }

    let jsonString = jsonMatch[0];

    // Clean up common JSON issues
    // Replace newlines within strings with spaces
    jsonString = jsonString.replace(/\n(?=([^"]*"[^"]*")*[^"]*$)/g, ' ');
    
    // Fix potential trailing commas
    jsonString = jsonString.replace(/,(\s*[}\]])/g, '$1');

    console.log('Cleaned JSON:', jsonString);

    try {
      const parsedData = JSON.parse(jsonString);
      
      // Validate the structure
      if (!parsedData.leadIndicators || !parsedData.lagIndicators) {
        throw new Error('Missing required fields in response');
      }

      return NextResponse.json(parsedData);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
      console.error('Attempted to parse:', jsonString);
      throw new Error('Failed to parse AI response as valid JSON');
    }

  } catch (error) {
    console.error('Error parsing job description:', error);
    return NextResponse.json(
      { error: 'Failed to parse job description. Please try again.' },
      { status: 500 }
    );
  }
}
