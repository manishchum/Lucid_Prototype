import { NextResponse } from "next/server";
import OpenAI from "openai";
import fs from "fs/promises";
import * as nodefs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { supabase } from "../../../lib/supabase";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


export async function POST(req: Request) {
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
    console.log("🟢 File written to:", tempFilePath);

    // Upload to OpenAI
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

    const message: string = (firstContent?.text?.value || firstContent?.text || "").trim();
    console.log("🟡 Raw GPT response:", message);

    let summary: string | null = null;
    let ai_modules: any[] = [];
    let ai_topics: string[] = [];
    let ai_objectives: string[] = [];

    if (message) {
      // Only parse modules under 'Learning Modules and Structure' section
      let modulesSection = message;
      // Find the start of modules section
      const modulesStart = modulesSection.match(/Learning Modules and Structure/i);
      if (modulesStart) {
        modulesSection = modulesSection.substring(modulesStart.index!);
      }
      // Cut off at first non-module section (e.g., 'Module Splitting Checks', 'Sequencing', etc.)
      const cutoffRegex = /(Module Splitting Checks|Sequencing|Module Independence|Additional Clarifying Questions)/i;
      const cutoffMatch = modulesSection.match(cutoffRegex);
      if (cutoffMatch) {
        modulesSection = modulesSection.substring(0, cutoffMatch.index!);
      }
      // Find module blocks by strict heading: 'Module X:' or '#### Module X:'
      const moduleRegex = /(####\s*Module\s*\d+:|Module\s*\d+:)([\s\S]*?)(?=(####\s*Module\s*\d+:|Module\s*\d+:|$))/gi;
      let moduleMatches = [];
      let match;
      while ((match = moduleRegex.exec(modulesSection)) !== null) {
        moduleMatches.push(match[2].trim());
      }
      // If no module blocks found, fallback to previous logic but ignore non-module sections
      if (moduleMatches.length === 0) {
        // Fallback: try to find all 'Module X:' headings in the whole message
        const fallbackRegex = /(####\s*Module\s*\d+:|Module\s*\d+:)([\s\S]*?)(?=(####\s*Module\s*\d+:|Module\s*\d+:|$))/gi;
        let fallbackMatches = [];
        while ((match = fallbackRegex.exec(message)) !== null) {
          fallbackMatches.push(match[2].trim());
        }
        moduleMatches = fallbackMatches;
      }
      for (let i = 0; i < moduleMatches.length; i++) {
        const block = moduleMatches[i];
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

      console.log("✅ Parsed summary:", summary);
      console.log("✅ Modules:", ai_modules.length);
      console.log("✅ Topics:", ai_topics.length);
      console.log("✅ Objectives:", ai_objectives.length);
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
      .eq("id", moduleId)
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

