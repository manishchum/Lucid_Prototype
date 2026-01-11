import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as XLSX from 'xlsx';
import path from 'path';
import { promises as fs } from 'fs';
import nodefs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/**
 * Downloads file from Supabase storage URL and extracts text content
 */
async function downloadAndExtractFileContent(fileUrl: string): Promise<string> {
  let tempFilePath: string | undefined;
  
  try {
    // Remove token from URL
    const cleanUrl = fileUrl.split('?token=')[0];
    
    // Download file
    const response = await fetch(cleanUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Determine file type from URL
    const fileName = cleanUrl.split('/').pop() || 'unknown';
    const isSpreadsheet = fileName.match(/\.(xlsx|xls|csv)$/i);
    const isPdf = fileName.match(/\.pdf$/i);
    
    if (isSpreadsheet) {
      // Extract spreadsheet content
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      let extractedText = `Spreadsheet Content from ${fileName}:\n\n`;
      
      workbook.SheetNames.forEach((sheetName: string) => {
        extractedText += `\n=== Sheet: ${sheetName} ===\n`;
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        jsonData.forEach((row: any, idx: number) => {
          if (Array.isArray(row) && row.length > 0) {
            extractedText += `Row ${idx + 1}: ${row.join(' | ')}\n`;
          }
        });
      });
      
      return extractedText;
    } else if (isPdf) {
      // For PDFs, save temp file and use pdf-parse or similar
      const tempDir = process.platform === "win32" ? (process.env.TEMP || "C:\\Windows\\Temp") : "/tmp";
      tempFilePath = path.join(tempDir, `${uuidv4()}_${fileName}`);
      await fs.writeFile(tempFilePath, buffer);
      
      // You'll need to add pdf-parse: npm install pdf-parse
      const pdfParse = require('pdf-parse');
      const pdfData = await pdfParse(buffer);
      return `PDF Content from ${fileName}:\n\n${pdfData.text}`;
      
      // Fallback if pdf-parse not available
      return `[PDF file detected: ${fileName}. Content extraction requires pdf-parse library.]`;
    } else {
      // Assume text-based file
      return buffer.toString('utf-8');
    }
  } catch (error) {
    console.error('Error downloading/extracting file:', error);
    return `[Error extracting file content: ${error}]`;
  } finally {
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { moduleId } = await req.json();
    
    // Build query for processed_modules with empty content
    let query = supabase
      .from("processed_modules")
      .select("processed_module_id, title, content, original_module_id, learning_style")
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

    const{trainingData} = await supabase
    .from("training_modules")
    .select("*")
    .eq("module_id",moduleId)
    .single();
    let updated = 0;
    for (const mod of modules || []) {
      try {
        // Extract topics and objectives from all related training_modules/ai_modules
        let topics: string[] = [];
        let objectives: string[] = [];
        let globalObjectives: string[] = [];
        let originalFileContent = "";
        
        if (Array.isArray(mod.training_modules)) {
          for (const tm of mod.training_modules) {
            // Download and extract file content if file_url exists
            if (trainingData.file_url) {
              originalFileContent = await downloadAndExtractFileContent(trainingData.file_url);
            }
            
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

        // Add original file content to prompt if available
        const fileContentSection = originalFileContent 
          ? `\n\n**Original Source Material:**\nBelow is the content from the original training document. You MUST use this as the primary source of information. Elaborate and expand on the concepts presented here while preserving the exact meaning, terminology, and specific details mentioned in the document. Do not introduce new concepts that aren't present in this source material.\n\n---\n${originalFileContent}\n---\n\n`
          : "";

        const style = mod.learning_style;
        const stylePrompt = `You are an expert Instructional Designer and Technical Writer. Your task is to write a complete, self-contained training module for employees, formatted as a high-end professional e-learning chapter with rich HTML formatting.

**Module Context:**
* **Module Title:** "${mod.title}"
* **Topics to Cover:** ${topicsText}
* **Target Objectives:** ${objectivesText}
* **Learning Style Focus:** ${style}

${fileContentSection}

**Core Instructions:**
1.  **Content Fidelity:** ${originalFileContent ? "You MUST base your content on the original source material provided above. Expand and elaborate on the existing content while maintaining its exact meaning, terminology, and key points. Do not deviate from the source material's intent." : "Create comprehensive content based on the topics and objectives provided."}
2.  **Tone & Style:** Professional, engaging, and instructive. Adapt the delivery to the specific Learning Style provided below.
3.  **HTML Formatting (STRICT REQUIREMENT):**
    * Use semantic HTML5 elements: <h2>, <h3>, <p>, <strong>, <em>, <table>, <ul>, <ol>, <li>, <blockquote>, <section>, <article>.
    * For tables: Use proper <table>, <thead>, <tbody>, <tr>, <th>, <td> tags. Add data-comparison="true" attribute to comparison tables.
    * For callouts/tips: Use <div class="callout tip">, <div class="callout warning">, or <div class="callout definition">.
    * For lists: Use <ul> for unordered and <ol> for ordered lists with proper <li> items.
    * For key takeaways: Use <blockquote class="key-takeaway">.
    * NO Markdown syntax - output pure HTML only. Do NOT use **, ##, ---, etc.
    * Do NOT wrap everything in a single <div> - use semantic section organization.
4.  **Table Requirements (CRITICAL):**
    * When comparing concepts, create comparison tables with clear headers and rows.
    * When listing steps, create step tables with Step #, Action, and Details columns.
    * When presenting data, use appropriate data visualization tables.
    * Tables MUST use <thead> for headers and <tbody> for content.
    * Each table MUST have a descriptive <caption> element or preceding context.
5.  **Visual Aids:** Insert descriptive <img> tags with data-type="diagram", data-type="chart", data-type="infographic" attributes and clear alt text. These will be replaced with actual assets later. Do not use them just for decoration.

**Learning Style Adaptation (${style}):**
* **If CS (Concrete Sequential):** Use structured step tables, numbered lists, clear procedural content with checkpoints, and factual headings.
* **If CR (Concrete Random):** Use problem-solving scenarios, interactive prompts, open-ended formatting, and "Try this" sections.
* **If AS (Abstract Sequential):** Use comparison tables, theoretical models, logical frameworks, data tables, and deep analysis.
* **If AR (Abstract Random):** Use group scenario sections, emotional context, narrative examples, collaborative prompts, and discussion tables.

---

**REQUIRED HTML STRUCTURE:**

<section class="learning-objectives">
<h2>Learning Objectives</h2>
<ol>
<li>Clear, measurable objective 1${originalFileContent ? " based on the source material" : ""}</li>
<li>Clear, measurable objective 2</li>
<li>Clear, measurable objective 3</li>
</ol>
</section>

<section class="module-section">
<h2>Section 1: [Descriptive Title]</h2>

<h3>Concept</h3>
<p>Explain the core concept in depth${originalFileContent ? " as presented in the source document" : ""}. Use 300+ words with clear explanations.</p>

<h3>Real-World Context</h3>
<p>Provide specific business examples${originalFileContent ? " referenced in the source or aligned with it" : ""}. Include practical applications.</p>

<h3>Key Points Comparison</h3>
<table>
<thead>
<tr><th>Aspect</th><th>Description</th><th>Example</th></tr>
</thead>
<tbody>
<tr><td>Point 1</td><td>Details</td><td>Example</td></tr>
</tbody>
</table>

<blockquote class="key-takeaway"><strong>Key Takeaway:</strong> State the most important point from this section.</blockquote>
</section>

<section class="activity">
<h3>Activity 1: [Activity Name]</h3>
<p><strong>Objective:</strong> What will the learner achieve?</p>
<p><strong>Time:</strong> [Estimated time]</p>
<h4>Instructions</h4>
<ol>
<li>First instruction step</li>
<li>Second instruction step</li>
<li>Reflection question or deliverable</li>
</ol>
</section>

(Continue with Section 2, 3, etc. following the same HTML structure with tables, comparisons, and activities)

<section class="module-section">
<h2>Section 2: [Descriptive Title]</h2>

<h3>Deep Dive</h3>
<p>Explore the next topic or a more advanced aspect${originalFileContent ? " from the source material" : ""}. Use 300+ words with detailed analysis.</p>

<h3>Comparison/Strategy Analysis</h3>
<table data-comparison="true">
<thead>
<tr><th>Strategy</th><th>Pros</th><th>Cons</th><th>Best For</th></tr>
</thead>
<tbody>
<tr><td>Approach 1</td><td>Benefits</td><td>Limitations</td><td>Use case</td></tr>
<tr><td>Approach 2</td><td>Benefits</td><td>Limitations</td><td>Use case</td></tr>
</tbody>
</table>

<h3>Workplace Scenario</h3>
<p>A detailed realistic scenario showing how this concept applies in a professional context. Include specific details and outcomes.</p>
</section>

<section class="activity">
<h3>Activity 2: [Activity Name]</h3>
<p><strong>Objective:</strong> What will the learner achieve?</p>
<p><strong>Time:</strong> [Estimated time]</p>
<h4>Instructions</h4>
<ol>
<li>First instruction step</li>
<li>Second instruction step</li>
<li>Third step with reflection question</li>
</ol>
</section>

(Continue for 2-5 sections total, each following the pattern above with tables where appropriate for comparisons, procedures, or data...)

<section class="module-summary">
<h2>Module Summary</h2>
<h3>Key Takeaways</h3>
<ul>
<li>Takeaway 1${originalFileContent ? " from the source material" : ""}</li>
<li>Takeaway 2</li>
<li>Takeaway 3</li>
<li>Takeaway 4</li>
<li>Takeaway 5</li>
</ul>
</section>

<section class="next-steps">
<h2>Next Steps</h2>
<p>A specific, actionable call to action for the learner to immediately apply this knowledge in their role. Include concrete examples and timelines.</p>
<div class="callout tip">
<strong>Pro Tip:</strong> Include a specific action the learner should take within the next week.
</div>
</section>

---

**IMPORTANT REMINDERS:**
- Output ONLY valid HTML5, no Markdown syntax.
- Ensure proper semantic structure with <section>, <h2>, <h3>, <p>, <table>, <ul>, <ol> tags.
- Do NOT output any markdown characters like #, ##, ***, ---, >, etc.
- Do NOT output code blocks with \`\`\`.
- Do NOT use any markdown formatting - use HTML only.
- All tables MUST have proper <thead> and <tbody> structure.
- All lists MUST use <ul>/<ol> with <li> elements.
- All emphasis MUST use <strong> or <em> tags, NOT ** or * symbols.
- Close all HTML tags properly.
- Generate 3-5 comprehensive sections, each with supporting tables or structured content where appropriate.`;
        
        console.log(`Calling Gemini for module: ${mod.title} (${mod.processed_module_id}) with learning style: ${style}`);
        
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        const result = await model.generateContent(stylePrompt);
        const response = await result.response;
        let aiContent = response.text();
        
        // Clean the response to remove any potential markdown artifacts
        if (aiContent) {
          if (aiContent.includes('```')) {
            aiContent = aiContent.replace(/```[\s\S]*?```/g, '');
          }
          aiContent = aiContent.trim();
        }
        
        if (!aiContent) {
          console.warn(`No content generated for module: ${mod.processed_module_id} style: ${style}`);
          continue;
        }

        // Helper to extract JSON between markers or first JSON object/array
        const extractJson = (text: string | undefined) => {
          if (!text) return null;
          const m = text.match(/BEGIN_JSON\s*([\s\S]*?)\s*END_JSON/im);
          if (m && m[1]) {
            try { return JSON.parse(m[1]); } catch (e) { return null; }
          }
          const objMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/m);
          if (objMatch && objMatch[0]) {
            try { return JSON.parse(objMatch[0]); } catch (e) { return null; }
          }
          return null;
        };

        let parsedJson = extractJson(aiContent);
        // retry once if parse failed
        if (!parsedJson) {
          try {
            console.warn('[generate-module-content] initial JSON parse failed; retrying with stricter prompt');
            const retryPrompt = `The previous response did not follow instructions. Return ONLY the JSON between BEGIN_JSON and END_JSON using the exact shape requested earlier. Do not include any other text.\n\nStudy Text:\n${topicsText}\n${objectivesText}\n${mod.content || ''}`;
            const retryResult = await model.generateContent(retryPrompt);
            const retryResp = await retryResult.response;
            const retryText = retryResp.text();
            parsedJson = extractJson(retryText);
            if (!parsedJson) console.warn('[generate-module-content] retry failed to produce valid JSON');
          } catch (e) {
            console.warn('[generate-module-content] retry threw error', e);
          }
        }

        // Sanitize AI output to remove common Markdown artifacts that are distracting
        const sanitize = (text: string) => {
          if (!text) return text;
          let s = text;
          s = s.replace(/```[\s\S]*?```/g, "");
          s = s.replace(/^#{1,6}\s*/gm, "");
          s = s.replace(/^[=-]{2,}\s*$/gm, "");
          s = s.replace(/^(-{3,}|_{3,}|\*{3,})\s*$/gm, "\n────────────────────────────────\n");
          s = s.replace(/`([^`]+)`/g, "$1");
          s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
          s = s.replace(/\*([^*]+)\*\*/g, "$1");
          s = s.replace(/__([^_]+)__/g, "$1");
          s = s.replace(/_([^_]+)_/g, "$1");
          s = s.replace(/\n{3,}/g, "\n\n");
          return s.trim();
        };

        const cleanedContent = sanitize(aiContent);

        // If we were able to parse JSON, convert the JSON into the exact textual layout
        let finalContent = cleanedContent;
        if (parsedJson) {
          const toTextModule = (json: any) => {
            const parts: string[] = [];
            if (json.title) parts.push(`${json.title}`);

            if (Array.isArray(json.learning_objectives) && json.learning_objectives.length) {
              parts.push(`\nLearning Objectives:`);
              json.learning_objectives.forEach((lo: any, idx: number) => {
                parts.push(`${idx + 1}. ${String(lo).trim()}`);
              });
            }

            if (Array.isArray(json.sections)) {
              json.sections.forEach((sec: any, idx: number) => {
                const secIndex = idx + 1;
                parts.push(`\nSection ${secIndex}: ${sec.heading || ""}`);
                if (sec.body) parts.push(`${sec.body}`);

                const act = sec.activity || {};
                parts.push(`\nActivity ${secIndex}: ${act.title || ""}`);
                if (act.objective) parts.push(`Objective: ${act.objective}`);
                if (act.time) parts.push(`Time: ${act.time}`);
                if (Array.isArray(act.instructions) && act.instructions.length) {
                  parts.push(`Instructions:`);
                  act.instructions.forEach((ins: any) => parts.push(`- ${String(ins).trim()}`));
                }
                if (Array.isArray(act.reflection_questions) && act.reflection_questions.length) {
                  parts.push(`Reflection Questions:`);
                  act.reflection_questions.forEach((q: any) => parts.push(`- ${String(q).trim()}`));
                }
              });
            }

            if (json.module_summary) {
              parts.push(`\nModule Summary:\n${json.module_summary}`);
            }

            return parts.join("\n");
          };

          try {
            const converted = toTextModule(parsedJson);
            const convertedSanitized = sanitize(converted);
            if (convertedSanitized && convertedSanitized.length > 0) {
              finalContent = convertedSanitized;
            }
          } catch (e) {
            console.warn(`[generate-module-content] failed to convert parsed JSON to text for module ${mod.processed_module_id}:`, e);
          }
        }

        if (!finalContent) {
          console.warn(`Sanitized content empty for module: ${mod.processed_module_id} style: ${style}`);
          continue;
        }
        
        // Update the processed_modules row
        const { error: updateError } = await supabase
          .from("processed_modules")
          .update({ content: finalContent })
          .eq("processed_module_id", mod.processed_module_id);
          
        if (updateError) {
          console.error(`Failed to update content for module ${mod.processed_module_id} style ${style}:`, updateError);
        } else {
          updated++;
          console.log(`Updated module ${mod.processed_module_id} with AI content for style ${style}.`);
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
