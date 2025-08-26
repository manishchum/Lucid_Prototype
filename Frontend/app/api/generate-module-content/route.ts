import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  // Fetch all processed_modules with empty or placeholder content
  const { data: modules, error } = await supabase
    .from("processed_modules")
    .select("id, title, content, original_module_id, training_modules(ai_modules, ai_topics, ai_objectives)")
    .or("content.is.null,content.eq.'',content.eq.\"\"");

  if (error) {
    console.error("Supabase fetch error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(`Fetched ${modules?.length || 0} modules for content generation.`);

  let updated = 0;
  for (const mod of modules || []) {
    try {
      // Extract topics and objectives from all related training_modules/ai_modules
      let topics: string[] = [];
      let objectives: string[] = [];
      let globalObjectives: string[] = [];
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
        ? `Topics for this module:\n${topics.map((topic: string, idx: number) => `${idx + 1}. ${topic}`).join("\n")}`
        : "";
      const objectivesText = objectives.length > 0
        ? `Objectives for this module:\n${objectives.map((obj: string, idx: number) => `${idx + 1}. ${obj}`).join("\n")}`
        : "";

      // Learning styles
      const learningStyles = ["CS", "CR", "AS", "AR"];
      for (const style of learningStyles) {
        // Compose prompt for each learning style
        const stylePrompt = `Generate detailed training content for the module titled: \"${mod.title}\".\n${topicsText}\n${objectivesText}\nThe content should cover all topics from basic to advanced. Structure the content clearly, use explanations, examples, and practical tips. Make it suitable for new hires in a corporate setting. Adapt the content for the following learning style: ${style}.`;
        console.log(`Calling OpenAI for module: ${mod.title} (${mod.id}) with learning style: ${style}`);
        const completion = await openai.chat.completions.create({
          model: "gpt-4-turbo",
          messages: [
            { role: "system", content: "You are an expert corporate trainer and instructional designer." },
            { role: "user", content: stylePrompt },
          ],
          max_tokens: 2048,
          temperature: 0.7,
        });
        const aiContent = completion.choices[0]?.message?.content?.trim() || "";
        if (!aiContent) {
          console.warn(`No content generated for module: ${mod.id} style: ${style}`);
          continue;
        }
        // Insert a new processed_modules row for each learning style
        const { error: insertError } = await supabase
          .from("processed_modules")
          .insert({
            original_module_id: mod.original_module_id || mod.id,
            title: mod.title,
            content: aiContent,
            learning_style: style,
            section_type: null,
            order_index: null
          });
        if (insertError) {
          console.error(`Failed to insert content for module ${mod.id} style ${style}:`, insertError);
        } else {
          updated++;
          console.log(`Inserted module ${mod.id} with AI content for style ${style}.`);
        }
      }
    } catch (err) {
      console.error(`Error processing module ${mod.id}:`, err);
    }
  }

  return NextResponse.json({ message: `Updated ${updated} modules with AI-generated content.` });
}
