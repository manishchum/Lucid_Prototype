import { NextResponse } from "next/server";
import OpenAI from "openai";
import fs from "fs/promises";
import * as nodefs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { supabase } from "../../../lib/supabase";
import * as XLSX from "xlsx";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Type guard for assistant message content blocks that carry text
type TextContentBlock = { type: "text"; text: string | { value?: string } };
function isTextContentBlock(c: any): c is TextContentBlock {
  if (!c || typeof c !== "object") return false;
  if (c.type !== "text") return false;
  if (typeof c.text === "string") return true;
  if (c.text && typeof c.text === "object" && ("value" in c.text || Object.keys(c.text).length === 0)) return true;
  return false;
}


export async function POST(req: Request) {
  let tempFilePath: string | undefined;

  try {
    const contentType = req.headers.get("content-type");
    
    // Handle two scenarios: file upload (multipart) or text content (JSON)
    if (contentType?.includes("multipart/form-data")) {
      // Traditional file upload (documents)
      return await handleFileUpload(req);
    } else if (contentType?.includes("application/json")) {
      // Text content upload (multimedia transcriptions)
      return await handleTextUpload(req);
    } else {
      return NextResponse.json({ error: "Unsupported content type" }, { status: 400 });
    }
  } catch (error) {
    console.error("❌ Fatal Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function handleFileUpload(req: Request) {
  let tempFilePath: string | undefined;

  try {
    // Parse multipart/form-data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const moduleId = formData.get("moduleId") as string | null;

    if (!file || !file.name) {
      return NextResponse.json({ error: "No file uploaded or file has no name" }, { status: 400 });
    }

    if (!moduleId || moduleId === "null") {
      return NextResponse.json({ error: "Missing or invalid moduleId" }, { status: 400 });
    }

    // Save the file temporarily
    const tempDir = process.platform === "win32"
      ? process.env.TEMP || process.env.TMP || "C:\\Windows\\Temp"
      : "/tmp";

    tempFilePath = path.join(tempDir, `${uuidv4()}_${file.name}`);
    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(tempFilePath, Buffer.from(arrayBuffer));
    // console.log("🟢 File written to:", tempFilePath);

    // Check if file is a spreadsheet (unsupported by OpenAI file_search)
    const isSpreadsheet = file.name.match(/\.(xlsx|xls|csv)$/i);
    
    if (isSpreadsheet) {
      // console.log("📊 Detected spreadsheet file, extracting text locally...");
      
      // Read file as buffer (needed for XLSX.read in Next.js)
      const fileBuffer = await fs.readFile(tempFilePath);
      
      // Extract text from spreadsheet
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      let extractedText = `Spreadsheet Analysis: ${file.name}\n\n`;
      
      // Process each sheet
      workbook.SheetNames.forEach((sheetName: string) => {
        extractedText += `\n=== Sheet: ${sheetName} ===\n`;
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        
        // Convert to readable text format
        jsonData.forEach((row: any, idx: number) => {
          if (Array.isArray(row) && row.length > 0) {
            extractedText += `Row ${idx + 1}: ${row.join(' | ')}\n`;
          }
        });
      });
      
      // console.log("📊 Spreadsheet text extracted, length:", extractedText.length);
      
      // Clean up temp file
      await fs.unlink(tempFilePath);
      
      // Route to text upload handler
      return await handleTextUpload(req, extractedText, moduleId);
    }

    // Upload to OpenAI (non-spreadsheet files)
    const openaiFile = await openai.files.create({
      file: nodefs.createReadStream(tempFilePath),
      purpose: "assistants",
    });

    const thread = await openai.beta.threads.create();

   await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: `You are an expert instructional designer. Your job is to decompose any single learning asset (text, slide deck, video series, mixed media, or course) into a clear sequence of self-contained learning modules that together cover the entire subject matter. Follow these exact steps and output formats. Do not deviate.

Processing steps (apply exactly):
1. Identify Overall Learning Goal
  - State a single concise end competency or performance outcome learners should achieve after completing the whole module. Phrase it as a measurable competency (e.g., "Create, test, and deploy a REST API that meets company security standards").
2. Segment into Themes
  - Read the file and cluster related ideas into one single module
3. Apply One Core Idea Rule
  - Ensure each module is centered on one core concept. If a module contains unrelated ideas, split it.
4. Apply Module Splitting Checks (for every module)
  - Time-to-Mastery Rule: estimate how much complex the topic is. If high complexity, split.
  - Single-Outcome Rule: if module yields more than one distinct learning outcome, split into separate modules.
  - Cognitive Load Rule: if the module introduces >3–5 new concepts, split into smaller modules.
  - For each module, list which (if any) rules triggered a split and what you did.
5. Arrange Modules Logically
  - Order modules from foundational → intermediate → advanced, or simple → complex. Provide sequencing rationale.
6. Validate Module Independence
  - For each module, ensure it is self-contained and delivers one clear learning outcome that can be assessed independently.

Additional instructions to maximize quality:
- If source is incomplete or ambiguous, list specific clarifying questions to help refine modulization (e.g., target proficiency level, mandatory compliance items, preferred duration).
- Keep module durations realistic for active learning (typical module: 45–60 minutes reading time unless justified).
- Ensure nothing from the source that is a distinct subject-matter point is omitted; explicitly call out any gaps between source content and the stated Overall Learning Goal.
`,
    attachments: [{
      file_id: openaiFile.id,
      tools: [{ type: "file_search" }],
    }],
   });

    const assistantId = process.env.OPENAI_ASSISTANT_ID;
    if (!assistantId) throw new Error("OPENAI_ASSISTANT_ID is not set");

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
    });

    // Poll for completion
    let status = run.status;
    let result = null;
    const MAX_POLL = 40;
    let pollCount = 0;

    while (status !== "completed" && status !== "failed" && pollCount < MAX_POLL) {
      await new Promise((r) => setTimeout(r, 2000));
      pollCount++;
      const updatedRun = await openai.beta.threads.runs.retrieve(run.id, {
        thread_id: thread.id,
      });
      status = updatedRun.status;
      if (status === "completed") {
        result = await openai.beta.threads.messages.list(thread.id);
      }
    }

    if (status !== "completed") {
      throw new Error("Assistant run did not complete in time.");
    }

    await fs.unlink(tempFilePath);

    // Parse GPT Response
    const assistantMessage = result?.data?.find((msg: any) => msg.role === "assistant");
    const firstContent = assistantMessage?.content?.find((c: any) => c.type === "text");

    let message: string = "";
    if (isTextContentBlock(firstContent)) {
      if (typeof firstContent.text === "string") {
        message = firstContent.text;
      } else {
        message = firstContent.text?.value ?? "";
      }
    }
    message = message.trim();
    // console.log("🟡 Raw GPT response:", message);

    let summary: string | null = null;
    let ai_modules: any[] = [];
    let ai_topics: string[] = [];
    let ai_objectives: string[] = [];

    if (message) {
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
      
      // Find module blocks - support multiple formats:
      // Format 1: "Module 1:" or "#### Module 1:"
      // Format 2: "1. **Module Name**" (numbered list with bold)
      const moduleRegex = /(####\s*Module\s*\d+:|Module\s*\d+:|\d+\.\s*\*\*[^*]+\*\*)([\s\S]*?)(?=(####\s*Module\s*\d+:|Module\s*\d+:|\d+\.\s*\*\*[^*]+\*\*|$))/gi;
      let moduleMatches = [];
      let match;
      while ((match = moduleRegex.exec(modulesSection)) !== null) {
        moduleMatches.push({
          header: match[1].trim(),
          content: match[2].trim()
        });
      }
      
      // If no module blocks found, fallback to previous logic
      if (moduleMatches.length === 0) {
        const fallbackRegex = /(####\s*Module\s*\d+:|Module\s*\d+:)([\s\S]*?)(?=(####\s*Module\s*\d+:|Module\s*\d+:|$))/gi;
        let fallbackMatches = [];
        while ((match = fallbackRegex.exec(message)) !== null) {
          fallbackMatches.push({
            header: match[1].trim(),
            content: match[2].trim()
          });
        }
        moduleMatches = fallbackMatches;
      }
      
      for (let i = 0; i < moduleMatches.length; i++) {
        const moduleData = moduleMatches[i];
        const block = typeof moduleData === 'string' ? moduleData : moduleData.content;
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
        // Fallback: If topics/objectives not found, try to extract bullet points
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

      // console.log("✅ Parsed summary:", summary);
      // console.log("✅ Modules:", ai_modules.length);
      // console.log("✅ Topics:", ai_topics.length);
      // console.log("✅ Objectives:", ai_objectives.length);
    }

    // Insert into Supabase (training_modules)
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
      console.error("❌ Supabase update error:", error);
      return NextResponse.json({ error: "Failed to update Supabase", detail: error }, { status: 500 });
    }

    // Call long-running content generation endpoint
    const baseUrl = process.env.INTERNAL_API_BASE_URL;
    let startGenResult: any = null;
    try {
      const startRes = await fetch(`${baseUrl}/api/start-content-generation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module_id: moduleId }),
      });
      startGenResult = await startRes.json().catch(() => null);
    } catch (e) {
      console.error("Failed to call start-content-generation:", e);
    }

    return NextResponse.json({
      summary,
      ai_modules,
      ai_topics,
      ai_objectives,
      supabaseResult: data,
      startGenResult,
    });
  } catch (err) {
    console.error("❌ Fatal Error:", err);
    if (tempFilePath) {
      try {
        await fs.unlink(tempFilePath);
      } catch {}
    }
    return NextResponse.json(
      { error: "OpenAI Assistants API failed", detail: `${err}` },
      { status: 500 }
    );
  }
}

async function handleTextUpload(req: Request, providedText?: string, providedModuleId?: string) {
  try {
    // Accept text/moduleId from parameters (for spreadsheet handling) or from request body
    let text: string;
    let moduleId: string;
    
    if (providedText && providedModuleId) {
      text = providedText;
      moduleId = providedModuleId;
    } else {
      const body = await req.json();
      text = body.text;
      moduleId = body.moduleId;
    }

    if (!text) {
      return NextResponse.json({ error: "No text content provided" }, { status: 400 });
    }

    if (!moduleId) {
      return NextResponse.json({ error: "Missing moduleId" }, { status: 400 });
    }

    // console.log("📝 Processing text content with OpenAI Assistant...");

    // Create OpenAI thread and process text directly
    const thread = await openai.beta.threads.create();

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `You are an expert instructional designer. Your job is to decompose any single learning asset (text, slide deck, video series, mixed media, or course) into a clear sequence of self-contained learning modules that together cover the entire subject matter. Follow these exact steps and output formats. Do not deviate.

IMPORTANT: The content to analyze is provided directly in this message below. Do NOT ask for file uploads. Process the content provided here.

Processing steps (apply exactly):
1. Identify Overall Learning Goal
  - State a single concise end competency or performance outcome learners should achieve after completing the whole module. Phrase it as a measurable competency (e.g., "Create, test, and deploy a REST API that meets company security standards").
2. Segment into Themes
  - Read the content below and cluster related ideas into one single module
3. Apply One Core Idea Rule
  - Ensure each module is centered on one core concept. If a module contains unrelated ideas, split it.
4. Apply Module Splitting Checks (for every module)
  - Time-to-Mastery Rule: estimate how much complex the topic is. If high complexity, split.
  - Single-Outcome Rule: if module yields more than one distinct learning outcome, split into separate modules.
  - Cognitive Load Rule: if the module introduces >3–5 new concepts, split into smaller modules.
  - For each module, list which (if any) rules triggered a split and what you did.
5. Arrange Modules Logically
  - Order modules from foundational → intermediate → advanced, or simple → complex. Provide sequencing rationale.
6. Validate Module Independence
  - For each module, ensure it is self-contained and delivers one clear learning outcome that can be assessed independently.

Additional instructions to maximize quality:
- If source is incomplete or ambiguous, list specific clarifying questions to help refine modulization (e.g., target proficiency level, mandatory compliance items, preferred duration).
- Keep module durations realistic for active learning (typical module: 45–60 minutes reading time unless justified).
- Ensure nothing from the source that is a distinct subject-matter point is omitted; explicitly call out any gaps between source content and the stated Overall Learning Goal.

===== BEGIN CONTENT =====
${text}
===== END CONTENT =====
`,
    });

    const assistantId = process.env.OPENAI_ASSISTANT_ID;
    if (!assistantId) throw new Error("OPENAI_ASSISTANT_ID is not set");

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
    });

    // Poll for completion (same logic as file upload)
    let status = run.status;
    let result = null;
    const MAX_POLL = 40;
    let pollCount = 0;

    while (status !== "completed" && status !== "failed" && pollCount < MAX_POLL) {
      await new Promise((r) => setTimeout(r, 2000));
      pollCount++;
      const updatedRun = await openai.beta.threads.runs.retrieve(run.id, {
        thread_id: thread.id,
      });
      status = updatedRun.status;
      if (status === "completed") {
        result = await openai.beta.threads.messages.list(thread.id);
      }
    }

    if (status !== "completed") {
      throw new Error("Assistant run did not complete in time.");
    }

    // Parse GPT Response (same logic as file upload)
    const assistantMessage = result?.data?.find((msg: any) => msg.role === "assistant");
    const firstContent = assistantMessage?.content?.find((c: any) => c.type === "text");

    let message: string = "";
    if (isTextContentBlock(firstContent)) {
      if (typeof firstContent.text === "string") {
        message = firstContent.text;
      } else {
        message = firstContent.text?.value ?? "";
      }
    }
    message = message.trim();
    // console.log("🟡 Raw GPT response:", message);

    // Parse the response and save to database (same logic as file upload)
    let summary: string | null = null;
    let ai_modules: any[] = [];
    let ai_topics: string[] = [];
    let ai_objectives: string[] = [];

    if (message) {
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
      
      // Find module blocks - support multiple formats:
      // Format 1: "Module 1:" or "#### Module 1:"
      // Format 2: "1. **Module Name**" (numbered list with bold)
      const moduleRegex = /(####\s*Module\s*\d+:|Module\s*\d+:|\d+\.\s*\*\*[^*]+\*\*)([\s\S]*?)(?=(####\s*Module\s*\d+:|Module\s*\d+:|\d+\.\s*\*\*[^*]+\*\*|$))/gi;
      let moduleMatches = [];
      let match;
      while ((match = moduleRegex.exec(modulesSection)) !== null) {
        moduleMatches.push({
          header: match[1].trim(),
          content: match[2].trim()
        });
      }
      
      // If no module blocks found, fallback to previous logic
      if (moduleMatches.length === 0) {
        const fallbackRegex = /(####\s*Module\s*\d+:|Module\s*\d+:)([\s\S]*?)(?=(####\s*Module\s*\d+:|Module\s*\d+:|$))/gi;
        let fallbackMatches = [];
        while ((match = fallbackRegex.exec(message)) !== null) {
          fallbackMatches.push({
            header: match[1].trim(),
            content: match[2].trim()
          });
        }
        moduleMatches = fallbackMatches;
      }
      
      for (let i = 0; i < moduleMatches.length; i++) {
        const moduleData = moduleMatches[i];
        const block = typeof moduleData === 'string' ? moduleData : moduleData.content;
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
        // Fallback: If topics/objectives not found, try to extract bullet points
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

      // console.log("✅ Parsed summary:", summary);
      // console.log("✅ Modules:", ai_modules.length);
      // console.log("✅ Topics:", ai_topics.length);
      // console.log("✅ Objectives:", ai_objectives.length);
    }

    // Insert into Supabase (training_modules)
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
      console.error("❌ Supabase update error:", error);
      return NextResponse.json({ error: "Failed to update Supabase", detail: error }, { status: 500 });
    }

    // Call long-running content generation endpoint (same as file upload)
    const baseUrl = process.env.INTERNAL_API_BASE_URL;
    let startGenResult: any = null;
    try {
      const startRes = await fetch(`${baseUrl}/api/start-content-generation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module_id: moduleId }),
      });
      startGenResult = await startRes.json().catch(() => null);
    } catch (e) {
      console.error("Failed to call start-content-generation:", e);
    }

    // console.log("✅ Successfully processed text content and triggered background worker");

    return NextResponse.json({
      summary,
      ai_modules,
      ai_topics,
      ai_objectives,
      supabaseResult: data,
      startGenResult,
    });

    return NextResponse.json({ error: "No content received from OpenAI" }, { status: 500 });

  } catch (err) {
    console.error("❌ Text processing error:", err);
    return NextResponse.json(
      { error: "Text processing failed", detail: `${err}` },
      { status: 500 }
    );
  }
}

