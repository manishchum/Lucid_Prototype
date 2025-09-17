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
