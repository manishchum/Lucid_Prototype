import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    if (!email) {
      return NextResponse.json({ error: "Email parameter is required" }, { status: 400 });
    }

    const { data: employee, error } = await supabase
      .from("employees")
      .select("id, name, email, position")
      .eq("email", email)
      .single();

    if (error) {
      console.error("Error fetching employee details:", error);
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: employee.id,
      name: employee.name,
      email: employee.email,
      position: employee.position
    });
  } catch (error) {
    console.error("Error in get-employee-details:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}