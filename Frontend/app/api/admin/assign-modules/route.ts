import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Simple helper to get admin id from request header (prototype pattern used elsewhere)
async function getAdminId(req: Request): Promise<string | null> {
  const adminId = req.headers.get("x-admin-id");
  console.log(adminId)
  return adminId || null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { employee_id, moduleIds } = body || {};
    if (!employee_id || !Array.isArray(moduleIds) || moduleIds.length === 0) {
      return NextResponse.json({ error: "Missing employee_id or moduleIds" }, { status: 400 });
    }

    const adminId = await getAdminId(req);
    if (!adminId) {
      return NextResponse.json({ error: "Missing admin id header (x-admin-id)" }, { status: 401 });
    }

    // Fetch admin record to validate company
    const { data: adminData, error: adminErr } = await supabase
      .from("admins")
      .select("id, company_id")
      .eq("id", adminId)
      .maybeSingle();

    if (adminErr || !adminData) {
      return NextResponse.json({ error: "Admin not found or unauthorized" }, { status: 403 });
    }

    const companyId = adminData.company_id;

    // Verify employee belongs to same company
    const { data: emp, error: empErr } = await supabase
      .from("employees")
      .select("id, company_id")
      .eq("id", employee_id)
      .maybeSingle();
    if (empErr || !emp || emp.company_id !== companyId) {
      return NextResponse.json({ error: "Employee not found in your company" }, { status: 403 });
    }


    console.log("Error Here")
    // Verify modules belong to this company
    const { data: mods, error: modsErr } = await supabase
      .from("training_modules")
      .select("id, title")
      .in("id", moduleIds || [])
      .eq("company_id", companyId);
    if (modsErr) {
      return NextResponse.json({ error: modsErr.message }, { status: 500 });
    }

    const modIdsFound = (mods || []).map((m: any) => m.id);
    if (modIdsFound.length === 0) {
      return NextResponse.json({ error: "No matching modules found for your company" }, { status: 400 });
    }

    // Prepare rows: one learning_plan row per module with module_id set
    const rowsToInsert = (mods || []).map((m: any) => ({
      employee_id,
      module_id: m.id,
      status: "ASSIGNED",
      reasoning: `Manual assignment by admin ${adminId}`,
      assigned_on: new Date().toISOString(),
    }));

    console.log("CHECK 1 : employee_id:", employee_id);
    console.log("CHECK 2 : mods:", mods);


    // Avoid inserting duplicates: fetch existing assigned module rows for this employee
    const { data: existingRows, error: existingErr } = await supabase
      .from("learning_plan")
      .select("id, module_id")
      .eq("employee_id", employee_id)
      .in("module_id", (mods || []).map((m: any) => m.id));

    if (existingErr) {
      return NextResponse.json({ error: existingErr.message }, { status: 500 });
    }

    const alreadyAssignedModuleIds = new Set((existingRows || []).map((r: any) => r.module_id));
    const filteredRows = rowsToInsert.filter((r: any) => !alreadyAssignedModuleIds.has(r.module_id));

    if (filteredRows.length === 0) {
      return NextResponse.json({ success: true, message: "Modules already assigned to this employee" });
    }
    // Insert multiple rows
    const { data: insertData, error: insertErr } = await supabase
    .from("learning_plan")
    .insert(filteredRows)
    .select();
    
    console.log(insertData)
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message || 'DB insert error' }, { status: 500 });
    }

    return NextResponse.json({ success: true, plan: insertData });
  } catch (err: any) {
    console.log("Error in the last")
    return NextResponse.json({ error: "Server error", detail: String(err) }, { status: 500 });
  }
}
