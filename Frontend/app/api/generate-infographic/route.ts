import { NextRequest, NextResponse } from 'next/server';
import { generateInfographicData } from '../infographic-generator/services/geminiService';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { content, title, processed_module_id } = await req.json();

    if (!content || !title) {
      return NextResponse.json(
        { error: 'Content and title are required' },
        { status: 400 }
      );
    }

    console.log('[generate-infographic] Generating infographic for:', title);
    console.log('[generate-infographic] Content length:', content.length);
    console.log('[generate-infographic] Module ID:', processed_module_id);

    // Check if infographic data already exists in database
    if (processed_module_id) {
      const { data: existingModule, error: fetchError } = await supabase
        .from('processed_modules')
        .select('infographic_data')
        .eq('processed_module_id', processed_module_id)
        .single();

      if (!fetchError && existingModule?.infographic_data) {
        console.log('[generate-infographic] Returning cached infographic data');
        return NextResponse.json(existingModule.infographic_data);
      }
    }

    // Call the infographic generator service
    const infographicData = await generateInfographicData(content);

    console.log('[generate-infographic] Successfully generated infographic');

    // Save to database if processed_module_id is provided
    if (processed_module_id) {
      const { error: updateError } = await supabase
        .from('processed_modules')
        .update({ infographic_data: infographicData })
        .eq('processed_module_id', processed_module_id);

      if (updateError) {
        console.error('[generate-infographic] Failed to save to database:', updateError);
        // Don't fail the request, just log the error
      } else {
        console.log('[generate-infographic] Successfully saved to database');
      }
    }

    return NextResponse.json(infographicData);
  } catch (error: any) {
    console.error('[generate-infographic] Error:', error);
    console.error('[generate-infographic] Error message:', error?.message);
    console.error('[generate-infographic] Error stack:', error?.stack);
    return NextResponse.json(
      { error: error.message || 'Failed to generate infographic' },
      { status: 500 }
    );
  }
}
