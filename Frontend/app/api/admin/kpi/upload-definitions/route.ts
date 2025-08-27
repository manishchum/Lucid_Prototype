import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { parse } from "csv-parse/sync";
import * as xlsx from "xlsx";

// Helper to get company_id from admin session (replace with your auth logic)
async function getCompanyId(req: Request): Promise<string | null> {
	// Example: extract from Supabase session or JWT
	// For prototype, allow company_id in header (never in prod)
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
		if (rows.length > 0 && rows[0][0]?.toLowerCase().includes("kpi")) {
			rows = rows.slice(1);
		}
		let created = 0, updated = 0, skipped: { row: number; reason: string }[] = [];
		for (let i = 0; i < rows.length; i++) {
			const [rawName, rawDesc] = rows[i];
			if (!rawName || typeof rawName !== "string") {
				skipped.push({ row: i + 1, reason: "Missing KPI name" });
				continue;
			}
			const name = rawName.trim().toLowerCase();
			const description = (rawDesc || "").trim();
			// Upsert by (company_id, name)
			const { data: existing, error: fetchErr } = await supabase
				.from("kpis")
				.select("id")
				.eq("company_id", companyId)
				.eq("name", name)
				.maybeSingle();
			if (fetchErr) {
				skipped.push({ row: i + 1, reason: "DB error" });
				continue;
			}
			if (existing && existing.id) {
				// Update
				const { error: updateErr } = await supabase
					.from("kpis")
					.update({ description })
					.eq("id", existing.id);
				if (updateErr) {
					skipped.push({ row: i + 1, reason: "Update error" });
				} else {
					updated++;
				}
			} else {
				// Insert
				const { error: insertErr } = await supabase
					.from("kpis")
					.insert({ company_id: companyId, name, description });
				if (insertErr) {
					skipped.push({ row: i + 1, reason: "Insert error" });
				} else {
					created++;
				}
			}
		}
		return NextResponse.json({ created, updated, skipped });
	} catch (err) {
		return NextResponse.json({ error: "Fatal error", detail: String(err) }, { status: 500 });
	}
}
