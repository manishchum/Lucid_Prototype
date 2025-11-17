import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const module_id = req.nextUrl.searchParams.get("module_id");
  if (!module_id) {
    return NextResponse.json({ error: "Missing module_id" }, { status: 400 });
  }

  // Get processed_modules progress
  const { data: rows, error } = await supabase
    .from("processed_modules")
    .select("content")
    .eq("original_module_id", module_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = rows?.length || 0;
  const completed = rows?.filter((r: any) => r.content && r.content.trim() !== "").length || 0;
  const percent = total ? Math.round((completed / total) * 100) : 0;

  // Get job status from content_jobs
  let jobStatus = null;
  const { data: jobs, error: jobError } = await supabase
    .from("content_jobs")
    .select("status")
    .eq("module_id", module_id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (!jobError && jobs && jobs.length > 0) {
    jobStatus = jobs[0].status;
  }

  return NextResponse.json({ total, completed, percent, jobStatus });
}
