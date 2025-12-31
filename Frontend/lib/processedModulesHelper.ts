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
    console.log('[processedModulesHelper] Ensuring processed_modules for plan:', plan);
    console.log('[processedModulesHelper] user_id:', user_id, 'company_id:', company_id);
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
        existingQuery = existingQuery
          .eq("original_module_id", original_module_id)
          .eq("user_id", user_id);
        } else {
        console.log("[processedModulesHelper] Checking existing processed_module for original_module_id:", original_module_id);
        existingQuery = existingQuery
          .ilike("title", title)
          .eq("user_id", user_id);
      }
      const { data: existing, error: exErr } = await existingQuery;
      if (exErr) {
        console.error("[processedModulesHelper] Error checking existing processed_modules:", exErr);
        continue;
      }
      console.log(title)
      console.log('Existing processed_module check result:',)
      console.log(existing)
      
      // If already exists, check if it has content
      if (existing && existing.length > 0) {
        const existingId = existing[0].processed_module_id;
        m.processed_module_id = existingId; // Store the ID in the plan
        
        // Check if this processed_module needs content generation
        const { data: moduleData } = await supabase
          .from("processed_modules")
          .select("content, original_module_id")
          .eq("processed_module_id", existingId)
          .single();
        
        // If content is empty and we have an original_module_id, trigger content generation
        if (moduleData && original_module_id && (!moduleData.content || moduleData.content.trim() === '')) {
          try {
            console.log('[processedModulesHelper] Existing module has no content, generating for:', existingId);
            const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
            const contentResponse = await fetch(`${baseUrl}/api/generate-module-content`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ moduleId: original_module_id }),
            });
            
            if (!contentResponse.ok) {
              const errorText = await contentResponse.text();
              console.error(`[processedModulesHelper] Content generation failed for existing ${existingId}:`, errorText);
            } else {
              const result = await contentResponse.json();
              console.log('[processedModulesHelper] Content generation completed for existing module:', result);
            }
          } catch (e: any) {
            console.error("[processedModulesHelper] Content generation fetch failed:", e?.message || e);
          }
        }
        continue; // Skip to next module since this one already exists
      }
      console.log('[processedModulesHelper] Creating new processed_module for plan module:', title);
      console.log('[processedModulesHelper] original_module_id:', original_module_id);
      console.log(m)

      // Insert processed_module row with basic fields
      const insertPayload: any = {
        original_module_id: original_module_id || null,
        title,
        // content will be generated later by generate-module-content
        content: "",
        section_type: m.section_type || null,
        order_index: typeof m.order_index === "number" ? m.order_index : null,
        learning_style: m.learning_style || userLearningStyle || null,
        user_id: user_id,
      };

      // Use upsert to avoid race conditions and reduce duplicates when a unique
      // constraint exists on the conflict target. If the DB lacks the required
      // unique constraint (Postgres 42P10), fall back to insert + re-query.
      const conflictTarget = original_module_id ? 'original_module_id,user_id' : 'title,user_id';
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
            requery = await supabase
              .from('processed_modules')
              .select('processed_module_id')
              .eq('original_module_id', original_module_id)
              .eq('user_id', user_id)
              .limit(1);
          } else {
            requery = await supabase
              .from('processed_modules')
              .select('processed_module_id')
              .ilike('title', title)
              .eq('user_id', user_id)
              .limit(1);
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
      if (newId) {
        created.push(newId);
        // Store the processed_module_id back into the plan module object so the frontend can use it
        m.processed_module_id = newId;
      }

      // Generate content SYNCHRONOUSLY (wait for it to complete before moving to next module)
      if (newId && original_module_id) {
        try {
          console.log('[processedModulesHelper] Generating content for processed_module_id:', newId, 'original_module_id:', original_module_id);
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
          const contentResponse = await fetch(`${baseUrl}/api/generate-module-content`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ moduleId: original_module_id }),
          });
          
          if (!contentResponse.ok) {
            const errorText = await contentResponse.text();
            console.error(`[processedModulesHelper] Content generation failed for ${newId}:`, errorText);
          } else {
            const result = await contentResponse.json();
            console.log('[processedModulesHelper] Content generation completed:', result);
          }
        } catch (e: any) {
          console.error("[processedModulesHelper] Content generation fetch failed:", e?.message || e);
        }
      }
    }

    return { createdCount: created.length, created, plan };
  } catch (err: any) {
    console.error("[processedModulesHelper] Unexpected error:", err);
    return { error: err?.message || String(err) };
  }
}

export default ensureProcessedModulesForPlan;
