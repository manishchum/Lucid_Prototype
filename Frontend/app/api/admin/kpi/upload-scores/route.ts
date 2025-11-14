import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { parse } from "csv-parse/sync";
import * as xlsx from "xlsx";

async function getCompanyId(req: Request): Promise<string | null> {
	const companyId = req.headers.get("x-company-id");
	return companyId || null;
}

export async function POST(req: Request) {
	try {
		const formData = await req.formData();
		const file = formData.get("file") as File | null;
		if (!file || !file.name) {
			return NextResponse.json({ error: "No file uploaded or file has no name" }, { status: 400 });
		}
		const companyId = await getCompanyId(req);
		if (!companyId) {
			return NextResponse.json({ error: "Missing company_id (admin auth required)" }, { status: 401 });
		}
	// Read file buffer
	const arrayBuffer = await file.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);
	let rows: string[][] = [];
	const adminId = req.headers.get("x-admin-id") || null;
		if (file.name.endsWith(".csv")) {
			const csvRows = parse(buffer, { columns: false, skip_empty_lines: true });
			rows = csvRows;
		} else if (file.name.endsWith(".xlsx")) {
			const workbook = xlsx.read(buffer, { type: "buffer" });
			const sheet = workbook.Sheets[workbook.SheetNames[0]];
			rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
		} else {
			return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
		}
		// Remove header row if present
		if (rows.length > 0 && rows[0][0]?.toLowerCase().includes("company_user_id")) {
			rows = rows.slice(1);
		}
		let created = 0, updated = 0, skipped: { row: number; reason: string }[] = [];
		let affectedEmployees: string[] = [];
		for (let i = 0; i < rows.length; i++) {
			const [companyEmpId, email, rawKpi, rawScore] = rows[i];
			if (!email || !rawKpi || !rawScore) {
				skipped.push({ row: i + 1, reason: "Missing required fields" });
				continue;
			}
			const kpiName = rawKpi.trim().toLowerCase();
			const score = Number(rawScore);
			if (isNaN(score)) {
				skipped.push({ row: i + 1, reason: "Invalid score" });
				continue;
			}
			// Upsert employee by email + company
			let employeeId: string | null = null;
			const { data: empData, error: empErr } = await supabase
				.from("users")
				.select("user_id")
				.eq("email", email.trim().toLowerCase())
				.eq("company_id", companyId)
				.maybeSingle();
			if (empErr) {
				skipped.push({ row: i + 1, reason: "DB error finding employee" });
				continue;
			}
			if (empData && empData.user_id) {
				employeeId = empData.user_id;
			} else {
				// Insert user
				const { data: newEmp, error: insEmpErr } = await supabase
					.from("users")
					.insert({
						email: email.trim().toLowerCase(),
						company_id: companyId,
						company_user_id: companyEmpId,
						enrolled_by: adminId
					})
					.select("user_id")
					.single();
				if (insEmpErr || !newEmp) {
					skipped.push({ row: i + 1, reason: "Failed to insert employee" });
					continue;
				}
				employeeId = newEmp.user_id;
			}
			// Upsert KPI by name + company
			let kpiId: string | null = null;
			const { data: kpiData, error: kpiErr } = await supabase
				.from("kpis")
				.select("kpi_id")
				.eq("name", kpiName)
				.eq("company_id", companyId)
				.maybeSingle();
			if (kpiErr) {
				skipped.push({ row: i + 1, reason: "DB error finding KPI" });
				continue;
			}
			if (kpiData && kpiData.kpi_id) {
				kpiId = kpiData.kpi_id;
			} else {
				// Insert KPI
				const { data: newKpi, error: insKpiErr } = await supabase
					.from("kpis")
					.insert({ name: kpiName, company_id: companyId })
					.select("kpi_id")
					.single();
				if (insKpiErr || !newKpi) {
					skipped.push({ row: i + 1, reason: "Failed to insert KPI" });
					continue;
				}
				kpiId = newKpi.kpi_id;
			}
			// Upsert employee_kpi row
			const { data: ekpiData, error: ekpiErr } = await supabase
				.from("employee_kpi")
				.select("employee_kpi_id")
				.eq("user_id", employeeId)
				.eq("kpi_id", kpiId)
				.maybeSingle();
			if (ekpiErr) {
				skipped.push({ row: i + 1, reason: "DB error finding employee_kpi" });
				continue;
			}
			// Always insert into employee_kpi_history
			const { error: historyErr } = await supabase
				.from("employee_kpi_history")
				.insert({
					user_id: employeeId,
					kpi_id: kpiId,
					score,
					recorded_at: new Date().toISOString(),
					uploader_admin_id: adminId
				});
			if (historyErr) {
				skipped.push({ row: i + 1, reason: "Failed to insert KPI history" });
			}

			if (ekpiData && ekpiData.employee_kpi_id) {
				// Update
				const { error: updateErr } = await supabase
					.from("employee_kpi")
					.update({ score, scored_at: new Date().toISOString() })
					.eq("employee_kpi_id", ekpiData.employee_kpi_id);
				if (updateErr) {
					skipped.push({ row: i + 1, reason: "Failed to update employee_kpi" });
				} else {
					updated++;
					if (employeeId) affectedEmployees.push(employeeId);
				}
			} else {
				// Insert
				const { error: insertErr } = await supabase
					.from("employee_kpi")
					.insert({ user_id: employeeId, company_id: companyId, kpi_id: kpiId, score, scored_at: new Date().toISOString() });
				if (insertErr) {
					skipped.push({ row: i + 1, reason: "Failed to insert employee_kpi" });
				} else {
					created++;
					if (employeeId) affectedEmployees.push(employeeId);
				}
			}
		}
		return NextResponse.json({ created, updated, skipped, affectedEmployees });
	} catch (err) {
		return NextResponse.json({ error: "Fatal error", detail: String(err) }, { status: 500 });
	}
}
