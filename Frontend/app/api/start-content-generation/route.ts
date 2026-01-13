import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Enqueue content generation for a training module
// POST body: { module_id: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const module_id: string | undefined = body?.module_id || body?.moduleId;

    if (!module_id || typeof module_id !== "string" || module_id.trim() === "") {
      return NextResponse.json({ error: "Missing or invalid module_id" }, { status: 400 });
    }

    // Prevent duplicate jobs for the same module while pending/in-progress
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("content_jobs")
      .select("id, status")
      .eq("module_id", module_id)
      .in("status", ["pending", "in-progress"])
      .limit(1);

    if (existingError) {
      console.error("Failed to check existing jobs:", existingError);
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    if (existing && existing.length > 0) {
      return NextResponse.json({
        message: "Job already queued or in progress",
        module_id,
        job_status: existing[0].status,
      });
    }

    // Enqueue new job
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("content_jobs")
      .insert({ module_id, status: "pending" })
      .select("id, status")
      .maybeSingle();

    if (insertError) {
      console.error("Failed to enqueue job:", insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      started: true,
      module_id,
      job_id: inserted?.id,
      job_status: inserted?.status || "pending",
    });
  } catch (error: any) {
    console.error("start-content-generation error:", error);
    return NextResponse.json({ error: "Failed to enqueue content generation" }, { status: 500 });
  }
}
   import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const { module_id } = await req.json();
  if (!module_id) {
    return NextResponse.json({ error: "Missing module_id" }, { status: 400 });
  }

  // Insert a job into content_jobs with status 'pending'
  const { error: jobError } = await supabase
    .from("content_jobs")
    .insert({ module_id, status: "pending" });

  if (jobError) {
    return NextResponse.json({ error: "Failed to create job", detail: jobError.message }, { status: 500 });
  }

  return NextResponse.json({
    started: true,
    module_id,
    job_status: "pending"
  });
}
