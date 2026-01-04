// Standalone version of generate-module-content for VM worker
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
require('dotenv').config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateModuleContent() {
  // Fetch all processed_modules with empty or placeholder content
  const { data: modules, error } = await supabase
    .from('processed_modules')
    .select('processed_module_id, title, content, original_module_id, learning_style, training_modules(ai_modules, ai_topics, ai_objectives)')
    .or('content.is.null,content.eq.\'\',content.eq.""');

  if (error) {
    console.error('Supabase fetch error:', error);
    throw new Error(error.message);
  }

  // console.log(`Fetched ${modules?.length || 0} modules for content generation.`);

  let updated = 0;
  for (const mod of modules || []) {
    try {
      // Extract topics and objectives from all related training_modules/ai_modules
      let topics = [];
      let objectives = [];
      let globalObjectives = [];
      if (Array.isArray(mod.training_modules)) {
        for (const tm of mod.training_modules) {
          if (Array.isArray(tm.ai_modules)) {
            for (const aimod of tm.ai_modules) {
              if (Array.isArray(aimod.topics)) {
                topics.push(...aimod.topics);
              }
              if (Array.isArray(aimod.objectives)) {
                objectives.push(...aimod.objectives);
              }
            }
          }
          if (Array.isArray(tm.ai_objectives)) {
            globalObjectives.push(...tm.ai_objectives);
          }
        }
      }
      topics = [...new Set(topics)];
      objectives = [...new Set(objectives)];
      globalObjectives = [...new Set(globalObjectives)];
      if (objectives.length === 0 && globalObjectives.length > 0) {
        objectives = globalObjectives;
      }
      const topicsText = topics.length > 0
        ? `Topics for this module:\n${topics.map((topic, idx) => `${idx + 1}. ${topic}`).join('\n')}`
        : '';
      const objectivesText = objectives.length > 0
        ? `Objectives for this module:\n${objectives.map((obj, idx) => `${idx + 1}. ${obj}`).join('\n')}`
        : '';

      // Compose prompt for the learning style of this row
      const style = mod.learning_style;
      const stylePrompt = `You are an expert instructional designer. Your task is to write a complete, self-contained training module for employees, as if it were a chapter in a professional textbook.

Module Title: "${mod.title}"
${topicsText}
${objectivesText}

Instructions:
1. Structure the content with clear sections, logical flow, and progressive depth (from basic to advanced).
2. For each topic and objective, provide:
  - Detailed explanations
  - Practical examples and case studies
  - Step-by-step exercises and activities
  - Actionable tips and best practices
3. Ensure the module is fully self-contained: all information, context, and learning activities must be included so the learner does not need to reference any other material.
4. Adapt the content for the following learning style: ${style}
  - If style is "CS": Use hands-on activities, clear instructions, logical sequence, deadlines, and factual information.
  - If style is "CR": Encourage experimentation, discovery, trial-and-error, flexibility, and problem-solving.
  - If style is "AS": Focus on analysis, intellectual exploration, theoretical models, and independent research.
  - If style is "AR": Foster reflection, emotional connection, group harmony, open-ended activities, and personal engagement.
5. Write in a professional, engaging, and instructional tone suitable for new hires in a corporate setting.
6. Output only the full module content, ready for direct use in training. Do not include meta commentary or instructions—just the content itself.
7. IMPORTANT FORMATTING REQUIREMENTS:
   - Use clear section headers with actual bold text (do NOT use markdown like **text** or ## symbols)
   - Format headers as: [HEADER TEXT IN CAPITAL OR TITLE CASE] followed by a new line
   - Use plain, clean text throughout - no markdown symbols, no asterisks, no hyphens for lists
   - Use numbered lists (1. 2. 3.) for step-by-step content
   - Use bullet points with simple dashes (dash space) for non-sequential items
   - CRITICAL: NEVER include learning style codes (CS, CR, AS, AR) anywhere in the content - not in titles, not in parentheses, not anywhere
   - Do not add any abbreviations or codes after activity titles or section names
   - Break content into digestible paragraphs
   - Make it engaging and consumable for busy professionals

Goal: The output should be a comprehensive, ready-to-use training module that fully addresses the topics and objectives, tailored to the specified learning style, and suitable for direct delivery to learners with clean, professional formatting.`;
      // console.log(`Calling OpenAI for module: ${mod.title} (${mod.processed_module_id}) with learning style: ${style}`);
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are an expert corporate trainer and instructional designer.' },
          { role: 'user', content: stylePrompt },
        ],
        max_tokens: 8000,
        temperature: 0.7,
      });
      let aiContent = completion.choices[0]?.message?.content?.trim() || '';
      if (!aiContent) {
        console.warn(`No content generated for module: ${mod.module_id} style: ${style}`);
        continue;
      }
      
      // Remove any learning style code references (CS, CR, AS, AR) from content
      aiContent = aiContent.replace(/\s*\([CS|CR|AS|AR|cs|cr|as|ar|,\s]+\)/gi, '');
      aiContent = aiContent.replace(/\b(CS|CR|AS|AR)\b/g, '');
      // Upsert the content using processed_module_id as the conflict key.
      const { data: upserted, error: updateError } = await supabase
        .from('processed_modules')
        .upsert({ processed_module_id: mod.processed_module_id, content: aiContent }, { onConflict: 'processed_module_id' })
        .select('processed_module_id');
      if (updateError) {
        console.error(`Failed to upsert content for processed_module ${mod.processed_module_id} style ${style}:`, updateError);
      } else {
        updated++;
        // console.log(`Upserted content for processed_module ${mod.processed_module_id} with AI content for style ${style}.`);
      }
    } catch (err) {
      console.error(`Error processing module ${mod.module_id}:`, err);
    }
  }

  return { message: `Updated ${updated} modules with AI-generated content.` };
}

module.exports = { generateModuleContent };