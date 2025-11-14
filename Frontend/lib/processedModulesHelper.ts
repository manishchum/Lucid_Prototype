import { supabase } from "@/lib/supabase";
import fetch from "node-fetch";

/**
 * Ensure processed_modules exist for modules referenced in the plan.
 * - plan.modules is expected to be an array with objects containing at least `title` or `name`.
 * - For each module, try to resolve its training_modules.module_id by title (case-insensitive)
 * - Insert a processed_modules row for the resolved original_module_id if one does not already exist
 * - Set learning_style if provided
 * - Trigger content generation by POSTing to /api/generate-module-content with processed_module_id
 */
export async function ensureProcessedModulesForPlan(employee_id: string, company_id: string, plan: any) {
  try {
    if (!plan || !Array.isArray(plan.modules) || plan.modules.length === 0) return { created: 0 };

    // Fetch company's training modules (id + title)
    const { data: tmRows, error: tmError } = await supabase
      .from("training_modules")
      .select("module_id, title")
      .eq("company_id", company_id);
    if (tmError) {
      console.error("[processedModulesHelper] Error fetching training_modules:", tmError);
      return { error: tmError.message };
    }

    const created: string[] = [];

    const normalize = (s: string) => (s || "").toString().toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

    // For each plan module, attempt to find a training_module by title or name
    for (const m of plan.modules) {
      const title = (m.title || m.name || "").toString().trim();
      if (!title) continue;

      const normTitle = normalize(title);

      // 1) exact (case-insensitive) match
      let match = (tmRows || []).find((t: any) => normalize(t.title) === normTitle);

      // 2) substring/fuzzy fallback: either training title contains plan title or vice-versa
      if (!match) {
        match = (tmRows || []).find((t: any) => {
          const tn = normalize(t.title || "");
          return tn.includes(normTitle) || normTitle.includes(tn);
        });
        if (match) {
          console.log("[processedModulesHelper] Fuzzy matched plan module to training_module:", title, "=>", match.title);
        }
      }

      if (!match) {
        console.log("[processedModulesHelper] No matching training_module for plan module:", title);
        continue;
      }

      const original_module_id = match.module_id;

      // Check if a processed_modules row already exists for this original_module_id and learning_style (null allowed)
      const { data: existing, error: exErr } = await supabase
        .from("processed_modules")
        .select("processed_module_id")
        .eq("original_module_id", original_module_id)
        .limit(1);
      if (exErr) {
        console.error("[processedModulesHelper] Error checking existing processed_modules:", exErr);
        continue;
      }
      if (existing && existing.length > 0) {
        // Already exists — skip
        continue;
      }

      // Insert processed_module row with basic fields
      const insertPayload: any = {
        original_module_id,
        title,
        // content will be generated later by generate-module-content
        content: "",
        section_type: m.section_type || null,
        order_index: typeof m.order_index === "number" ? m.order_index : null,
        learning_style: m.learning_style || null,
      };

      const { data: insData, error: insErr } = await supabase
        .from("processed_modules")
        .insert(insertPayload)
        .select("processed_module_id")
        .limit(1);
      if (insErr) {
        console.error("[processedModulesHelper] Error inserting processed_module", insErr, insertPayload);
        continue;
      }
      const newId = insData && insData[0] && insData[0].processed_module_id ? insData[0].processed_module_id : null;
      if (newId) created.push(newId);

      // Fire off content generation for this processed_module (best-effort, don't block on response)
      try {
        // Use relative URL - on server this should resolve; if not, consider using NEXT_PUBLIC_BASE_URL
        fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/generate-module-content`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ processed_module_ids: [newId] }),
        }).catch((e) => console.error("[processedModulesHelper] Content generation request failed:", e));
      } catch (e: any) {
        console.error("[processedModulesHelper] Trigger fetch failed:", e?.message || e);
      }
    }

    return { createdCount: created.length, created };
  } catch (err: any) {
    console.error("[processedModulesHelper] Unexpected error:", err);
    return { error: err?.message || String(err) };
  }
}

export default ensureProcessedModulesForPlan;
