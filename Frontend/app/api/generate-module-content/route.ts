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
        const stylePrompt = `You are an expert Instructional Designer and Technical Writer. Your task is to write a complete, self-contained training module for employees, formatted as a high-end professional e-learning chapter.

**Module Context:**
* **Module Title:** "${mod.title}"
* **Topics to Cover:** ${topicsText}
* **Target Objectives:** ${objectivesText}
* **Learning Style Focus:** ${style}

**Core Instructions:**
1.  **Tone & Style:** Professional, engaging, and instructive. Adapt the delivery to the specific Learning Style provided below.
2.  **Visual Formatting (Strict Requirement):**
    * Use **Markdown** extensively to create visual hierarchy (H2 '##', H3 '###').
    * Use **Bold text** to emphasize key terms and takeaways.
    * Use **Tables** to compare concepts or list steps where appropriate.
    * Use **Blockquotes** ('>') for tips, warnings, or key definitions.
    * Use **Horizontal Rules** ('---') to separate sections.
3.  **Visual Aids:** Insert specific image tags  where a diagram or illustration would aid understanding. Do not use them just for decoration; they must be instructive 
**Learning Style Adaptation (${style}):**
* **If CS (Concrete Sequential):** Use structured checklists, step-by-step tables, clear deadlines, and factual headings.
* **If CR (Concrete Random):** Use problem-solving scenarios, "Try this" experiments, and open-ended formatting.
* **If AS (Abstract Sequential):** Use logic flowcharts (text-based), theoretical models, comparisons, and deep analysis.
* **If AR (Abstract Random):** Use group scenarios, emotional context, narrative examples, and collaborative prompts.

---

**REQUIRED STRUCTURE:**

## Learning Objectives
(Provide a numbered list of 3-5 clear, measurable objectives).

---

## Section 1: [Descriptive Title]
(Minimum 300 words).
* **Concept:** Explain the core concept in depth.
* **Real-World Context:** Provide specific business examples.
* **Visual:** Insert a relevant  tag here.
* **Key Takeaway:** Use a blockquote for the most important point.

### Activity 1: [Activity Name]
* **Objective:** What will the learner achieve?
* **Time:** [Estimated time]
* **Instructions:** (Numbered steps).
* **Reflection/Output:** (Specific question or deliverable).

---

## Section 2: [Descriptive Title]
(Minimum 300 words).
* **Deep Dive:** Explore the next topic or a more advanced aspect.
* **Comparison/Data:** Use a **Table** here to compare strategies, pros/cons, or data points.
* **Scenario:** A detailed workplace scenario applying this concept.

### Activity 2: [Activity Name]
* **Objective:** What will the learner achieve?
* **Time:** [Estimated time]
* **Instructions:** (Numbered steps).
* **Reflection/Output:** (Specific question or deliverable).

---

## Section 3: [Descriptive Title]
(Minimum 300 words).
* **Advanced Application:** How to apply this in complex situations.
* **Best Practices:** Bulleted list of dos and don'ts.
* **Visual:** Insert a relevant  tag here.

### Activity 3: [Activity Name]
* **Objective:** What will the learner achieve?
* **Time:** [Estimated time]
* **Instructions:** (Numbered steps).
* **Reflection/Output:** (Specific question or deliverable).

---

## Module Summary
(A comprehensive wrap-up of the module. Use bullet points to summarize the top 3-5 takeaways).

## Next Steps
(A specific call to action for the learner to apply this knowledge immediately).`
        
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
