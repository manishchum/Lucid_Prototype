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
export async function ensureProcessedModulesForPlan(user_id: string, company_id: string, plan: any) {
  try {
    // Fetch user's learning style to assign to processed modules when not provided in plan
    let userLearningStyle: string | null = null;
    try {
      const { data: lsRow, error: lsErr } = await supabase
        .from('employee_learning_style')
        .select('learning_style')
        .eq('user_id', user_id)
        .maybeSingle();
      if (lsErr) console.warn('[processedModulesHelper] learning style lookup warning:', lsErr);
      userLearningStyle = lsRow?.learning_style ?? null;
    } catch (e) {
      console.warn('[processedModulesHelper] Error fetching learning style:', e);
    }
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

      let original_module_id: string | null = null;
      if (!match) {
        console.log("[processedModulesHelper] No matching training_module for plan module:", title, "— will create a plan-only processed_module");
      } else {
        original_module_id = match.module_id;
      }

      // Check if a processed_modules row already exists for this original_module_id (if present)
      // or by title (for plan-only modules) to avoid duplicates
      let existingQuery: any = supabase.from("processed_modules").select("processed_module_id").limit(1);
      if (original_module_id) {
        existingQuery = existingQuery.eq("original_module_id", original_module_id);
      } else {
        existingQuery = existingQuery.ilike("title", title);
      }
      const { data: existing, error: exErr } = await existingQuery;
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
        original_module_id: original_module_id || null,
        title,
        // content will be generated later by generate-module-content
        content: "",
        section_type: m.section_type || null,
        order_index: typeof m.order_index === "number" ? m.order_index : null,
        learning_style: m.learning_style || userLearningStyle || null,
      };

      // Use upsert to avoid race conditions and reduce duplicates when a unique
      // constraint exists on the conflict target. If the DB lacks the required
      // unique constraint (Postgres 42P10), fall back to insert + re-query.
      const conflictTarget = original_module_id ? 'original_module_id' : 'title';
      let newId: string | null = null;
      const upsertRes = await supabase
        .from("processed_modules")
        .upsert(insertPayload, { onConflict: conflictTarget })
        .select("processed_module_id")
        .limit(1);
      if (!upsertRes.error && Array.isArray(upsertRes.data) && upsertRes.data[0] && upsertRes.data[0].processed_module_id) {
        newId = upsertRes.data[0].processed_module_id;
      } else if (upsertRes.error && upsertRes.error.code === '42P10') {
        console.warn('[processedModulesHelper] upsert failed (no unique constraint). Falling back to insert:', upsertRes.error.message);
        const insertRes = await supabase
          .from('processed_modules')
          .insert(insertPayload)
          .select('processed_module_id')
          .limit(1);
        if (!insertRes.error && Array.isArray(insertRes.data) && insertRes.data[0] && insertRes.data[0].processed_module_id) {
          newId = insertRes.data[0].processed_module_id;
        } else {
          // If insert failed (likely due to concurrent insert), re-query for the
          // existing processed_module by original_module_id or title.
          console.warn('[processedModulesHelper] insert fallback failed; re-querying for existing processed_module', insertRes.error);
          let requery: any;
          if (original_module_id) {
            requery = await supabase.from('processed_modules').select('processed_module_id').eq('original_module_id', original_module_id).limit(1);
          } else {
            requery = await supabase.from('processed_modules').select('processed_module_id').ilike('title', title).limit(1);
          }
          if (!requery.error && Array.isArray(requery.data) && requery.data[0] && requery.data[0].processed_module_id) {
            newId = requery.data[0].processed_module_id;
          } else {
            console.error('[processedModulesHelper] Failed to create or find processed_module', requery.error || insertRes.error);
            continue;
          }
        }
      } else if (upsertRes.error) {
        console.error('[processedModulesHelper] Error inserting processed_module', upsertRes.error, insertPayload);
        continue;
      }
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
