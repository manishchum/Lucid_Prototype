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
						const [rawName, rawDesc, rawBenchmark, rawDatatype] = rows[i];
						if (!rawName || typeof rawName !== "string") {
							skipped.push({ row: i + 1, reason: "Missing KPI name" });
							continue;
						}
						const name = rawName.trim().toLowerCase();
						const description = (rawDesc || "").trim();
						let benchmark: number | null = null;
						let datatype: string | null = null;
						if (rawDatatype && typeof rawDatatype === "string") {
							const dt = rawDatatype.trim().toLowerCase();
							if (["percentage", "numeric", "ratio"].includes(dt)) {
								datatype = dt;
							} else {
								datatype = null; // Accept only valid types, else null
							}
						}
						if (rawBenchmark !== undefined && rawBenchmark !== null && rawBenchmark !== "") {
							if (datatype === "percentage") {
								let val = parseFloat(rawBenchmark);
								if (!isNaN(val)) {
									// Accept 0.75 as 75, 75 as 75
									if (val <= 1) {
										val = val * 100;
									}
									benchmark = Math.round(val);
								} else {
									benchmark = null;
								}
								if (benchmark !== null && (benchmark < 0 || benchmark > 100)) {
									skipped.push({ row: i + 1, reason: "Benchmark out of range (0-100)" });
									continue;
								}
							} else if (datatype === "numeric") {
								const val = parseFloat(rawBenchmark);
								benchmark = isNaN(val) ? null : val;
							} else if (datatype === "ratio") {
								// Accept x:y as x/y float
								const parts = String(rawBenchmark).split(":");
								if (parts.length === 2) {
									const x = parseFloat(parts[0]);
									const y = parseFloat(parts[1]);
									if (!isNaN(x) && !isNaN(y) && y !== 0) {
										benchmark = x / y;
									} else {
										benchmark = null;
									}
								} else {
									// fallback: try to parse as float
									const val = parseFloat(rawBenchmark);
									benchmark = isNaN(val) ? null : val;
								}
							} else {
								// fallback: try to parse as float
								const val = parseFloat(rawBenchmark);
								benchmark = isNaN(val) ? null : val;
							}
						}
						// Upsert by (company_id, name)
						const { data: existing, error: fetchErr } = await supabase
							.from("kpis")
							.select("kpi_id")
							.eq("company_id", companyId)
							.eq("name", name)
							.maybeSingle();
						if (fetchErr) {
							skipped.push({ row: i + 1, reason: "DB error" });
							continue;
						}
						if (existing && existing.kpi_id) {
							// Update
							const { error: updateErr } = await supabase
								.from("kpis")
								.update({ description, benchmark, datatype })
								.eq("kpi_id", existing.kpi_id);
							if (updateErr) {
								skipped.push({ row: i + 1, reason: "Update error" });
							} else {
								updated++;
							}
						} else {
							// Insert
							const { error: insertErr } = await supabase
								.from("kpis")
								.insert({ company_id: companyId, name, description, benchmark, datatype });
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
