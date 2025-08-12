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
      content: "Summarize this document and break it into modules, topics, and objectives.",
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
      // Try to find a summary before any module headings
      // Remove unsupported 's' flag and use [\s\S] for multiline matching
      const summaryMatch = message.match(/^(.*?)(?=(?:###|\d+\.\s|\*\*Module|Module\s\d+:))/);
      if (summaryMatch) {
        summary = summaryMatch[1].trim();
      } else {
        // Fallback: try to match up to first module heading using [\s\S]
        const fallbackMatch = message.match(/^(.*?)(?=(###|\d+\.\s|\*\*Module|Module\s\d+:))/);
        summary = fallbackMatch ? fallbackMatch[1].trim() : "";
      }

      // Find module blocks by various heading styles
      const moduleRegex = /(?:###\s*Module\s*\d+:|\*\*Module\s*\d+:|Module\s*\d+:|\d+\.\s\*\*Module\*\*|\d+\.\s)([\s\S]*?)(?=(?:###\s*Module\s*\d+:|\*\*Module\s*\d+:|Module\s*\d+:|\d+\.\s\*\*Module\*\*|\d+\.\s|$))/gi;
      let moduleMatches = [];
      let match;
      while ((match = moduleRegex.exec(message)) !== null) {
        moduleMatches.push(match[1].trim());
      }

      // If no module blocks found, fallback to topics/objectives extraction from the whole message
      if (moduleMatches.length === 0) {
        moduleMatches = [message];
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
        gpt_summary: summary,
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

    // Insert each ai_module into processed_modules
    let processedCount = 0;
    let processedModuleIds: string[] = [];
    for (let i = 0; i < ai_modules.length; i++) {
      const mod = ai_modules[i];
      const { title, topics, objectives } = mod;
      const content = JSON.stringify({ topics, objectives });
      const { data: insertData, error: procErr } = await supabase
        .from("processed_modules")
        .insert({
          original_module_id: moduleId,
          title: title || `Module ${i + 1}`,
          content: "", // leave content empty for now
          section_type: null,
          order_index: i,
        })
        .select();
      if (!procErr && insertData && insertData[0]?.id) {
        processedCount++;
        processedModuleIds.push(insertData[0].id);
      }
    }

    // Automatically generate content for each processed module
    let updated = 0;
    for (const id of processedModuleIds) {
      try {
        // Fetch module title
        const { data: modData, error: fetchErr } = await supabase
          .from("processed_modules")
          .select("id, title, content")
          .eq("id", id)
          .single();
        if (fetchErr || !modData) continue;
        const prompt = `Generate detailed training content for the module titled: "${modData.title}". The content should cover all topics from basic to advanced. Structure the content clearly, use explanations, examples, and practical tips. Make it suitable for new hires in a corporate setting.`;
        const completion = await openai.chat.completions.create({
          model: "gpt-4-turbo",
          messages: [
            { role: "system", content: "You are an expert corporate trainer and instructional designer." },
            { role: "user", content: prompt },
          ],
          max_tokens: 2048,
          temperature: 0.7,
        });
        const aiContent = completion.choices[0]?.message?.content?.trim() || "";
        if (!aiContent) continue;
        const { error: updateError } = await supabase
          .from("processed_modules")
          .update({ content: aiContent })
          .eq("id", id);
        if (!updateError) updated++;
      } catch (err) {
        // log error but continue
        console.error(`Error generating content for module ${id}:`, err);
      }
    }

    return NextResponse.json({
      summary,
      ai_modules,
      ai_topics,
      ai_objectives,
      supabaseResult: data,
      processedModulesInserted: processedCount,
      processedModulesContentGenerated: updated,
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
 
