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
    .select('id, title, content, original_module_id, learning_style, training_modules(ai_modules, ai_topics, ai_objectives)')
    .or('content.is.null,content.eq.\'\',content.eq.""');

  if (error) {
    console.error('Supabase fetch error:', error);
    throw new Error(error.message);
  }

  console.log(`Fetched ${modules?.length || 0} modules for content generation.`);

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
      const stylePrompt = `You are an expert instructional designer. Your task is to write a complete, self-contained training module for new hires, as if it were a chapter in a professional textbook.

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
4. Adapt the content for the following Gregorc learning style: ${style}
  - CS (Concrete Sequential): Use hands-on activities, clear instructions, logical sequence, deadlines, and factual information.
  - CR (Concrete Random): Encourage experimentation, discovery, trial-and-error, flexibility, and problem-solving.
  - AS (Abstract Sequential): Focus on analysis, intellectual exploration, theoretical models, and independent research.
  - AR (Abstract Random): Foster reflection, emotional connection, group harmony, open-ended activities, and personal engagement.
5. Write in a professional, engaging, and instructional tone suitable for new hires in a corporate setting.
6. Output only the full module content, ready for direct use in training. Do not include meta commentary or instructions—just the content itself.
7. If relevant, include section headings, subheadings, and formatting for readability.

Goal: The output should be a comprehensive, ready-to-use training module that fully addresses the topics and objectives, tailored to the specified learning style, and suitable for direct delivery to learners.`;
      console.log(`Calling OpenAI for module: ${mod.title} (${mod.id}) with learning style: ${style}`);
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are an expert corporate trainer and instructional designer.' },
          { role: 'user', content: stylePrompt },
        ],
        max_tokens: 8000,
        temperature: 0.7,
      });
      const aiContent = completion.choices[0]?.message?.content?.trim() || '';
      if (!aiContent) {
        console.warn(`No content generated for module: ${mod.id} style: ${style}`);
        continue;
      }
      // Update the processed_modules row for this module and learning style
      const { error: updateError } = await supabase
        .from('processed_modules')
        .update({ content: aiContent })
        .eq('id', mod.id);
      if (updateError) {
        console.error(`Failed to update content for module ${mod.id} style ${style}:`, updateError);
      } else {
        updated++;
        console.log(`Updated module ${mod.id} with AI content for style ${style}.`);
      }
    } catch (err) {
      console.error(`Error processing module ${mod.id}:`, err);
    }
  }

  return { message: `Updated ${updated} modules with AI-generated content.` };
}

module.exports = { generateModuleContent };