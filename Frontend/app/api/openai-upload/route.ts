import { NextResponse } from "next/server";
import OpenAI from "openai";
import fs from "fs/promises";
import * as nodefs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { supabase } from "../../../lib/supabase";
import * as XLSX from "xlsx";
import CloudConvert from "cloudconvert";

const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY || "");

async function convertDocToPdf(inputPath: string, outputPath: string) {
  if (!process.env.CLOUDCONVERT_API_KEY) {
    throw new Error("CLOUDCONVERT_API_KEY is not set for document conversion.");
  }

  const job = await cloudConvert.jobs.create({
    tasks: {
      "upload-file": { operation: "import/upload" },
      "convert-file": { operation: "convert", input: "upload-file", output_format: "pdf" },
      "export-file": { operation: "export/url", input: "convert-file" },
    },
  });

  const uploadTask: any = job.tasks.find((task: any) => task.name === "upload-file");
  if (!uploadTask) throw new Error("CloudConvert upload task missing.");

  await cloudConvert.tasks.upload(uploadTask, nodefs.createReadStream(inputPath));

  const completedJob = await cloudConvert.jobs.wait(job.id);
  const exportTask: any = completedJob.tasks.find((task: any) => task.name === "export-file");
  const fileUrl = exportTask?.result?.files?.[0]?.url;
  if (!fileUrl) throw new Error("CloudConvert export URL missing.");

  console.log(`[convertDocToPdf] Converted PDF URL: ${fileUrl}`);

  const response = await fetch(fileUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const INSTRUCTION_PROMPT = `You are an expert instructional designer. Your job is to decompose a learning asset into a clear sequence of self-contained learning modules. CRITICAL RULES:

⚠️ STRICTLY FOLLOW THESE RULES:
1. **ONLY USE SOURCE MATERIAL** - Every module, topic, and objective MUST be derived from the provided content. Do NOT add, infer, or extrapolate information outside the source.
2. **ACCURATE MODULE TITLES** - Use descriptive titles directly reflecting the source content (e.g., "Introduction to REST API Architecture" not "API Basics").
3. **EXTRACT TOPICS FROM SOURCE** - List only topics explicitly mentioned or directly implied in the source material.
4. **GROUND OBJECTIVES IN SOURCE** - Each objective must state what learners will know/do based on content present in the source.
5. **NO HALLUCINATION** - Do not create, assume, or infer learning outcomes not supported by the source material.

Processing steps (apply exactly):
1. Identify Overall Learning Goal
  - State the single end competency learners achieve after completing ALL modules, derived ONLY from source content.
2. Segment into Themes
  - Cluster related ideas from the SOURCE into natural, self-contained modules.
3. Apply One Core Idea Rule
  - Each module centers on ONE core concept from the source. If a module mixes unrelated source topics, split it.
4. Apply Module Splitting Checks (for every module)
  - Time-to-Mastery Rule: If the source topic is complex, split into smaller modules.
  - Single-Outcome Rule: Split if the source presents multiple distinct learning outcomes.
  - Cognitive Load Rule: Split if the source introduces >3–5 new concepts at once.
  - For each module, list which rules triggered a split based on SOURCE ANALYSIS.
5. Arrange Modules Logically
  - Order from foundational → intermediate → advanced based on the SOURCE structure.
  - Provide sequencing rationale based on source material flow.
6. Validate Module Independence
  - Ensure each module is self-contained using only source content and delivers one clear learning outcome assessable from the source.

Output format for each module:
#### Module [#]: [Accurate Title from Source]
**Topics:**
- [topic explicitly in source]
- [topic explicitly in source]

**Objectives:**
- Learners will [action] [concept from source]
- Learners will [action] [concept from source]

⚠️ IF SOURCE IS INCOMPLETE: List clarifying questions about missing context (e.g., target proficiency, compliance requirements) but DO NOT INVENT CONTENT.
⚠️ NEVER EXTRAPOLATE: Strictly bind all content to source material. Gaps in source = gaps in modules, not invention.
`;

// Type guard for assistant message content blocks that carry text
type TextContentBlock = { type: "text"; text: string | { value?: string } };
function isTextContentBlock(c: any): c is TextContentBlock {
  if (!c || typeof c !== "object") return false;
  if (c.type !== "text") return false;
  if (typeof c.text === "string") return true;
  if (c.text && typeof c.text === "object" && ("value" in c.text || Object.keys(c.text).length === 0)) return true;
  return false;
}

/**
 * Parses the GPT response and updates the Supabase training_modules table.
 * Changes processing_status to 'completed'.
 */
async function processAndStoreResults(moduleId: string, message: string) {
  console.log(`[processAndStoreResults] Starting for moduleId: ${moduleId}`);
  console.log(`[processAndStoreResults] Message length: ${message?.length || 0}`);

  if (!message) {
    console.warn("[processAndStoreResults] Received empty message, skipping parsing.");
    return { error: "Empty message from GPT" };
  }

  let ai_modules: any[] = [];
  let ai_topics: string[] = [];
  let ai_objectives: string[] = [];

  try {
    // Parse modules - support both "Learning Modules and Structure" and "Modules and Topics" formats
    let modulesSection = message;

    // Try to find the start of modules section (flexible matching)
    const modulesStart = modulesSection.match(/(Learning Modules and Structure|Modules and Topics|###\s*Modules)/i);
    if (modulesStart) {
      modulesSection = modulesSection.substring(modulesStart.index!);
    }

    // Cut off at first non-module section (e.g., 'Module Splitting Checks', 'Sequencing', etc.)
    const cutoffRegex = /(Module Splitting Checks|Sequencing Rationale|Module Independence|Additional Clarifying Questions)/i;
    const cutoffMatch = modulesSection.match(cutoffRegex);
    if (cutoffMatch) {
      modulesSection = modulesSection.substring(0, cutoffMatch.index!);
    }

    // Find module blocks
    const moduleRegex = /(####\s*Module\s*\d+:|Module\s*\d+:|\d+\.\s*\*\*[^*]+\*\*)([\s\S]*?)(?=(####\s*Module\s*\d+:|Module\s*\d+:|\d+\.\s*\*\*[^*]+\*\*|$))/gi;
    let moduleMatches = [];
    let match;
    while ((match = moduleRegex.exec(modulesSection)) !== null) {
      moduleMatches.push({
        header: match[1].trim(),
        content: match[2].trim()
      });
    }

    // Fallback logic
    if (moduleMatches.length === 0) {
      const fallbackRegex = /(####\s*Module\s*\d+:|Module\s*\d+:)([\s\S]*?)(?=(####\s*Module\s*\d+:|Module\s*\d+:|$))/gi;
      while ((match = fallbackRegex.exec(message)) !== null) {
        moduleMatches.push({
          header: match[1].trim(),
          content: match[2].trim()
        });
      }
    }

    console.log(`[processAndStoreResults] Found ${moduleMatches.length} module matches.`);

    for (let i = 0; i < moduleMatches.length; i++) {
      const moduleData = moduleMatches[i];
      const block = moduleData.content;
      // Try to extract module title
      let titleMatch = block.match(/^(?:\*\*|###)?\s*([A-Za-z0-9 .\-]+)(?:\*\*|:)?/);
      const title = titleMatch ? titleMatch[1].trim() : `Module ${i + 1}`;
      const topics: string[] = [];
      const objectives: string[] = [];

      // Find topics section
      const topicsSection = block.match(/topics?:\s*([\s\S]*?)(?=objectives?:|$)/i);
      if (topicsSection && topicsSection[1]) {
        topics.push(...topicsSection[1]
          .split(/\n|\r/)
          .map(line => line.trim())
          .filter(line => line && (/^[-*]/.test(line) || /^[A-Za-z0-9 .\-]+$/.test(line)))
          .map(line => line.replace(/^[-*]\s*/, "").replace(/^\*\*?Topic:?\*\*?/i, "").trim())
          .filter(Boolean)
        );
      }
      // Find objectives section
      const objectivesSection = block.match(/objectives?:\s*([\s\S]*)/i);
      if (objectivesSection && objectivesSection[1]) {
        objectives.push(...objectivesSection[1]
          .split(/\n|\r/)
          .map(line => line.trim())
          .filter(line => line && (/^[-*]/.test(line) || /^[A-Za-z0-9 .\-]+$/.test(line)))
          .map(line => line.replace(/^[-*]\s*/, "").replace(/^\*\*?Objective:?\*\*?/i, "").trim())
          .filter(Boolean)
        );
      }

      // Fallback: bullet points
      if (topics.length === 0) {
        topics.push(...block.split(/\n|\r/)
          .map(line => line.trim())
          .filter(line => /^[-*]/.test(line) && !/objective/i.test(line))
          .map(line => line.replace(/^[-*]\s*/, "").trim())
          .filter(Boolean)
        );
      }
      if (objectives.length === 0) {
        objectives.push(...block.split(/\n|\r/)
          .map(line => line.trim())
          .filter(line => /^[-*]/.test(line) && /objective/i.test(line))
          .map(line => line.replace(/^[-*]\s*/, "").trim())
          .filter(Boolean)
        );
      }

      ai_modules.push({ title, topics, objectives });
      ai_topics.push(...topics);
      ai_objectives.push(...objectives);
    }
  } catch (parseError) {
    console.error("[processAndStoreResults] Error during parsing:", parseError);
    // Continue anyway to store the raw message even if parsing fails
  }

  console.log(`[processAndStoreResults] Attempting to update database for moduleId: ${moduleId}`);
  // Update Supabase
  const { data, error } = await supabase
    .from("training_modules")
    .update({
      gpt_summary: message,
      ai_modules: ai_modules,
      ai_topics: ai_topics,
      ai_objectives: ai_objectives,
      processing_status: "completed",
    })
    .eq("module_id", moduleId)
    .select();

  if (error) {
    console.error(`[processAndStoreResults] Supabase update error:`, error);
    throw new Error(`Failed to update Supabase: ${error.message}`);
  }

  if (!data || data.length === 0) {
    console.warn(`[processAndStoreResults] No rows updated for moduleId: ${moduleId}. Check if the ID exists in training_modules table.`);
  } else {
    console.log(`[processAndStoreResults] Successfully updated ${data.length} row(s).`);
  }

  // Trigger content generation
  const baseUrl = process.env.INTERNAL_API_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (baseUrl) {
    try {
      await fetch(`${baseUrl}/api/start-content-generation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module_id: moduleId }),
      });
    } catch (e) {
      console.error("Failed to call start-content-generation:", e);
    }
  }

  return { ai_modules, ai_topics, ai_objectives, supabaseResult: data };
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type");

    if (contentType?.includes("multipart/form-data")) {
      return await handleFileUpload(req);
    } else if (contentType?.includes("application/json")) {
      return await handleTextUpload(req);
    } else {
      return NextResponse.json({ error: "Unsupported content type" }, { status: 400 });
    }
  } catch (error) {
    console.error("❌ Fatal Error:", error);
    return NextResponse.json({ error: "Internal server error", detail: String(error) }, { status: 500 });
  }
}

async function handleFileUpload(req: Request) {
  let tempFilePath: string | undefined;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const moduleId = formData.get("moduleId") as string | null;

    if (!file || !file.name || !moduleId || moduleId === "null") {
      return NextResponse.json({ error: "Missing file or moduleId" }, { status: 400 });
    }

    const tempDir = process.platform === "win32" ? (process.env.TEMP || "C:\\Windows\\Temp") : "/tmp";
    tempFilePath = path.join(tempDir, `${uuidv4()}_${file.name}`);
    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(tempFilePath, Buffer.from(arrayBuffer));

    const isDocx = file.name.match(/\.docx$/i);
    const isDoc = file.name.match(/\.doc$/i);
    const isSpreadsheet = file.name.match(/\.(xlsx|xls|csv)$/i);

    // Convert .doc or .docx to PDF using CloudConvert (no local LibreOffice dependency)
    if (isDocx || isDoc) {
      try {
        const pdfPath = tempFilePath.replace(/\.docx?$/i, '.pdf');
        await convertDocToPdf(tempFilePath, pdfPath);
        await fs.unlink(tempFilePath).catch(() => {});
        tempFilePath = pdfPath;
        console.log(`Converted ${file.name} to PDF for processing via CloudConvert`);
      } catch (conversionError) {
        console.error('CloudConvert conversion failed:', conversionError);
        throw new Error('Failed to convert document to PDF via CloudConvert.');
      }
    }

    if (isSpreadsheet) {
      const fileBuffer = await fs.readFile(tempFilePath);
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      let extractedText = `Spreadsheet Analysis: ${file.name}\n\n`;

      workbook.SheetNames.forEach((sheetName: string) => {
        extractedText += `\n=== Sheet: ${sheetName} ===\n`;
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        jsonData.forEach((row: any, idx: number) => {
          if (Array.isArray(row) && row.length > 0) extractedText += `Row ${idx + 1}: ${row.join(' | ')}\n`;
        });
      });

      await fs.unlink(tempFilePath).catch(() => { });
      return await processTextContent(extractedText, moduleId);
    }

    // Use Assistant for other documents
    const openaiFile = await openai.files.create({
      file: nodefs.createReadStream(tempFilePath),
      purpose: "assistants",
    });

    const assistantId = process.env.OPENAI_ASSISTANT_ID;
    if (!assistantId) throw new Error("OPENAI_ASSISTANT_ID is not set");

    const run = await openai.beta.threads.createAndRunPoll({
      assistant_id: assistantId,
      thread: {
        messages: [{
          role: "user",
          content: INSTRUCTION_PROMPT,
          attachments: [{ file_id: openaiFile.id, tools: [{ type: "file_search" }] }],
        }],
      },
    });

    if (run.status !== "completed") {
      throw new Error(`Assistant run failed with status: ${run.status}`);
    }

    const messages = await openai.beta.threads.messages.list(run.thread_id);
    const assistantMessage = messages.data.find(m => m.role === "assistant");
    const firstContent = assistantMessage?.content?.find(c => c.type === "text");

    let message = "";
    if (isTextContentBlock(firstContent)) {
      message = typeof firstContent.text === "string" ? firstContent.text : (firstContent.text?.value ?? "");
    }

    await fs.unlink(tempFilePath).catch(() => { });
    const results = await processAndStoreResults(moduleId, message.trim());
    return NextResponse.json(results);

  } catch (err) {
    if (tempFilePath) await fs.unlink(tempFilePath).catch(() => { });
    throw err;
  }
}

async function handleTextUpload(req: Request) {
  const { text, moduleId } = await req.json();
  if (!text || !moduleId) {
    return NextResponse.json({ error: "Missing text or moduleId" }, { status: 400 });
  }
  return await processTextContent(text, moduleId);
}

async function processTextContent(text: string, moduleId: string) {
  // Use Chat Completions for text - MUCH faster than Assistant
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: INSTRUCTION_PROMPT },
      { role: "user", content: `Process the content provided here:\n\n===== BEGIN CONTENT =====\n${text}\n===== END CONTENT =====` }
    ],
    temperature: 0.1,
  });

  const message = response.choices[0].message.content || "";
  const results = await processAndStoreResults(moduleId, message.trim());
  return NextResponse.json(results);
}

