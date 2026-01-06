import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  try {
    const { moduleId } = await req.json();
    
    // Build query for processed_modules with empty content
    let query = supabase
      .from("processed_modules")
      .select("processed_module_id, title, content, original_module_id, learning_style, training_modules(ai_modules, ai_topics, ai_objectives)")
      .or("content.is.null,content.eq.'',content.eq.\"\"");
    
    // If moduleId is provided, filter by original_module_id
    if (moduleId) {
      query = query.eq('original_module_id', moduleId);
    }
    
    const { data: modules, error } = await query;

    if (error) {
      console.error("Supabase fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // console.log(`Fetched ${modules?.length || 0} modules for content generation.`);

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

        // Compose prompt for the learning style of this row
        const style = mod.learning_style;
        const stylePrompt = `You are an expert instructional designer. Your task is to write a complete, self-contained training module for employees, as if it were a chapter in a professional textbook.

Module Title: "${mod.title}"
${topicsText}
${objectivesText}

Instructions:
1. Structure the content with clear sections using these EXACT section headers (use these exact labels):
- Start with "Learning Objectives:" followed by a numbered list of 3-5 objectives
- Create AT LEAST 3-5 main content sections using "Section 1: [descriptive title]", "Section 2: [descriptive title]", etc.
- After EACH section, include a corresponding activity: "Activity 1: [descriptive title]", "Activity 2: [descriptive title]", etc.
- End with "Module Summary:" for the conclusion
2. For EACH section, provide:
- Detailed explanations (2-4 paragraphs minimum)
- Practical examples and real-world scenarios
- Key concepts and frameworks
- Best practices and tips
3. For EACH activity, provide:
- Clear objectives for the activity
- Step-by-step instructions (numbered steps)
- Expected outcomes
- Reflection questions or discussion prompts
- Estimated time to complete (e.g., "Time: 15 minutes")
4. Ensure comprehensive coverage:
- Each section should be substantial (300-500 words)
- Activities should be practical and hands-on
- Connect each section to real workplace scenarios
- Use concrete examples from business settings

5. Adapt the content for the following Gregorc learning style: ${style}
- CS (Concrete Sequential): Use hands-on activities, clear instructions, logical sequence, deadlines, and factual information with checklists.
- CR (Concrete Random): Encourage experimentation, discovery, trial-and-error, flexibility, and problem-solving with open-ended tasks.
- AS (Abstract Sequential): Focus on analysis, intellectual exploration, theoretical models, research, and analytical activities.
- AR (Abstract Random): Foster reflection, emotional connection, group discussion, collaborative activities, and personal engagement.
6. Format each section clearly:
- Use the section headers mentioned above (Learning Objectives:, Section 1:, Activity 1:, etc.)
- Separate each major section with a blank line
- Use clear paragraph breaks within sections
- Use bullet points (•) or numbered lists (1., 2., 3.) where appropriate
- NEVER use Markdown formatting (no # headings, no **, no backticks)
- NEVER include learning style codes (CS, CR, AS, AR) in the content

EXAMPLE STRUCTURE (follow this pattern):

Learning Objectives:
1. [First objective]
2. [Second objective]
3. [Third objective]

Section 1: Introduction to [Topic]
[Detailed explanation paragraph 1...]
[Detailed explanation paragraph 2...]
[Examples and scenarios...]
[Key takeaways...]

Activity 1: [Activity Name]
Objective: [What learners will achieve]
Time: 20 minutes
Instructions:
1. [Step 1]
2. [Step 2]
3. [Step 3]
Reflection: [Questions for thinking]

Section 2: [Next Major Topic]
[Detailed content...]

Activity 2: [Next Activity]
[Activity content...]

Section 3: [Advanced Concepts]
[Detailed content...]

Activity 3: [Practical Application]
[Activity content...]

Module Summary:
[Comprehensive summary of all key points...]

IMPORTANT: Create AT LEAST 2-3 full sections with corresponding activities. Make the content rich, practical, and workplace-relevant.`;
        
        // console.log(`Calling Gemini for module: ${mod.title} (${mod.processed_module_id}) with learning style: ${style}`);
        
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        const result = await model.generateContent(stylePrompt);
        const response = await result.response;
        let aiContent = response.text();
        
        // Clean the response to remove any potential markdown artifacts
        if (aiContent) {
          // Remove markdown code blocks if present
          if (aiContent.includes('```')) {
            aiContent = aiContent.replace(/```[\s\S]*?```/g, '');
          }
          // Remove any leading/trailing whitespace
          aiContent = aiContent.trim();
        }
        
        if (!aiContent) {
          console.warn(`No content generated for module: ${mod.processed_module_id} style: ${style}`);
          continue;
        }

        // Sanitize AI output to remove common Markdown artifacts that are distracting
        const sanitize = (text: string) => {
          if (!text) return text;
          let s = text;
          // Remove fenced code blocks
          s = s.replace(/```[\s\S]*?```/g, "");
          // Remove ATX headings (e.g. # Heading)
          s = s.replace(/^#{1,6}\s*/gm, "");
          // Remove setext-style underlined headings (==== or ----)
          s = s.replace(/^[=-]{2,}\s*$/gm, "");
          // Replace Markdown horizontal rule lines (---, ___, ***) with a plain-text divider
          s = s.replace(/^(-{3,}|_{3,}|\*{3,})\s*$/gm, "\n────────────────────────────────\n");
          // Remove inline code backticks
          s = s.replace(/`([^`]+)`/g, "$1");
          // Remove bold/italic markers (simple cases)
          s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
          s = s.replace(/\*([^*]+)\*/g, "$1");
          s = s.replace(/__([^_]+)__/g, "$1");
          s = s.replace(/_([^_]+)_/g, "$1");
          // Collapse excessive blank lines
          s = s.replace(/\n{3,}/g, "\n\n");
          return s.trim();
        };

        const cleanedContent = sanitize(aiContent);
        if (!cleanedContent) {
          console.warn(`Sanitized content empty for module: ${mod.processed_module_id} style: ${style}`);
          continue;
        }
        // Update the processed_modules row for this module and learning style
        const { error: updateError } = await supabase
          .from("processed_modules")
          .update({ content: cleanedContent })
          .eq("processed_module_id", mod.processed_module_id);
        if (updateError) {
          console.error(`Failed to update content for module ${mod.processed_module_id} style ${style}:`, updateError);
        } else {
          updated++;
          // console.log(`Updated module ${mod.processed_module_id} with AI content for style ${style}.`);
        }
      } catch (err) {
        console.error(`Error processing module ${mod.processed_module_id}:`, err);
      }
    }

    return NextResponse.json({ message: `Updated ${updated} modules with AI-generated content.` });
  } catch (error) {
    console.error("Content generation error:", error);
    return NextResponse.json({ error: "Content generation failed" }, { status: 500 });
  }
}
