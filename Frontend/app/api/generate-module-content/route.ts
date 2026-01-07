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
        const stylePrompt = `You are an expert Instructional Designer and Technical Writer. Your task is to write a complete, self-contained training module for employees, formatted as a high-end professional e-learning chapter.

**Module Context:**
* **Module Title:** "${mod.title}"
* **Topics to Cover:** ${topicsText}
* **Target Objectives:** ${objectivesText}
* **Learning Style Focus:** ${style}

${fileContentSection}

**Core Instructions:**
1.  **Content Fidelity:** ${originalFileContent ? "You MUST base your content on the original source material provided above. Expand and elaborate on the existing content while maintaining its exact meaning, terminology, and key points. Do not deviate from the source material's intent." : "Create comprehensive content based on the topics and objectives provided."}
2.  **Tone & Style:** Professional, engaging, and instructive. Adapt the delivery to the specific Learning Style provided below.
3.  **Visual Formatting (Strict Requirement):**
    * Use **Markdown** extensively to create visual hierarchy (H2 '##', H3 '###').
    * Use **Bold text** to emphasize key terms and takeaways.
    * Use **Tables** to compare concepts or list steps where appropriate.
    * Use **Blockquotes** ('>') for tips, warnings, or key definitions.
    * Use **Horizontal Rules** ('---') to separate sections.
4.  **Visual Aids:** Insert specific image tags where a diagram or illustration would aid understanding. Do not use them just for decoration; they must be instructive.

**Learning Style Adaptation (${style}):**
* **If CS (Concrete Sequential):** Use structured checklists, step-by-step tables, clear deadlines, and factual headings.
* **If CR (Concrete Random):** Use problem-solving scenarios, "Try this" experiments, and open-ended formatting.
* **If AS (Abstract Sequential):** Use logic flowcharts (text-based), theoretical models, comparisons, and deep analysis.
* **If AR (Abstract Random):** Use group scenarios, emotional context, narrative examples, and collaborative prompts.

---

**REQUIRED STRUCTURE:**

## Learning Objectives
(Provide a numbered list of 3-5 clear, measurable objectives${originalFileContent ? " based on the source material" : ""}).

---

## Section 1: [Descriptive Title]
(Minimum 300 words).
* **Concept:** Explain the core concept in depth${originalFileContent ? " as presented in the source document" : ""}.
* **Real-World Context:** Provide specific business examples${originalFileContent ? " referenced in the source or aligned with it" : ""}.
* **Visual:** Insert a relevant tag here.
* **Key Takeaway:** Use a blockquote for the most important point.

### Activity 1: [Activity Name]
* **Objective:** What will the learner achieve?
* **Time:** [Estimated time]
* **Instructions:** (Numbered steps).
* **Reflection/Output:** (Specific question or deliverable).

---

## Section 2: [Descriptive Title]
(Minimum 300 words).
* **Deep Dive:** Explore the next topic or a more advanced aspect${originalFileContent ? " from the source material" : ""}.
* **Comparison/Data:** Use a **Table** here to compare strategies, pros/cons, or data points.
* **Scenario:** A detailed workplace scenario applying this concept.

### Activity 2: [Activity Name]
* **Objective:** What will the learner achieve?
* **Time:** [Estimated time]
* **Instructions:** (Numbered steps).
* **Reflection/Output:** (Specific question or deliverable).

---

(Continue for 2-5 sections total...)

---

## Module Summary
(A comprehensive wrap-up of the module. Use bullet points to summarize the top 3-5 takeaways${originalFileContent ? " from the source material" : ""}).

## Next Steps
(A specific call to action for the learner to apply this knowledge immediately).`;
        
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

        // Sanitize AI output
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
        if (!cleanedContent) {
          console.warn(`Sanitized content empty for module: ${mod.processed_module_id} style: ${style}`);
          continue;
        }
        
        // Update the processed_modules row
        const { error: updateError } = await supabase
          .from("processed_modules")
          .update({ content: cleanedContent })
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
