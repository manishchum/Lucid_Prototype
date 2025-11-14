import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const email = searchParams.get("email")
  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 })
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service key missing" }, { status: 500 })
  }
  const adminClient = createClient(supabaseUrl, supabaseServiceKey)
  const { data, error } = await adminClient
    .from("users")
    .select("user_id")
    .eq("email", email)
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ user_id: data?.user_id || null })
}
