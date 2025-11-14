import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/*
  Idempotent migration endpoint.
  - Only inserts (original_module_id, order_index, learning_style) tuples that do not already exist.
  - Optional body flags:
      moduleId?: string  -> limit to a single training_module
      forceRemigrate?: boolean -> if true, will delete existing processed_modules for that moduleId before re-inserting
  - Returns counts of skipped, inserted, and existing rows.
*/
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { moduleId, forceRemigrate } = body || {};

    // Fetch training modules in scope
    let tmQuery = supabase
      .from("training_modules")
      .select("module_id, ai_modules");
    if (moduleId) tmQuery = tmQuery.eq("module_id", moduleId);
    const { data: modules, error: tmError } = await tmQuery;
    if (tmError) {
      return NextResponse.json({ error: tmError.message }, { status: 500 });
    }

    if (!modules || modules.length === 0) {
      return NextResponse.json({ message: "No training modules found for migration", inserted: 0, skipped: 0, existing: 0 });
    }

    // If forceRemigrate for a single module: purge existing processed rows first
    if (forceRemigrate && moduleId) {
      await supabase.from("processed_modules").delete().eq("original_module_id", moduleId);
    }

    let inserted = 0;
    let skipped = 0;
    let existing = 0;

    for (const mod of modules) {
      if (!mod.ai_modules) continue;
      let aiModulesArr: any[] = [];
      try {
        aiModulesArr = Array.isArray(mod.ai_modules) ? mod.ai_modules : JSON.parse(mod.ai_modules);
      } catch {
        continue; // malformed JSON
      }

      // Preload existing processed modules for this original module id for quick lookup
      const { data: existingRows } = await supabase
        .from("processed_modules")
        .select("order_index, learning_style")
        .eq("original_module_id", mod.module_id);
      const existingSet = new Set(
        (existingRows || []).map(r => `${r.order_index}|${r.learning_style}`)
      );

      for (let i = 0; i < aiModulesArr.length; i++) {
        const aiMod = aiModulesArr[i];
        const { title, content, section_type } = aiMod || {};
        const learningStyles = ["CS", "CR", "AS", "AR"];
        for (const style of learningStyles) {
          const key = `${i}|${style}`;
            if (existingSet.has(key) && !forceRemigrate) {
              skipped++;
              existing++;
              continue;
            }
          const { error: insertError } = await supabase
            .from("processed_modules")
            .insert({
              original_module_id: mod.module_id,
              title: title || `Module ${i + 1}`,
              content: content || "",
              section_type: section_type || null,
              order_index: i,
              learning_style: style,
            });
          if (!insertError) {
            inserted++;
            existingSet.add(key);
          }
        }
      }
    }

    return NextResponse.json({
      message: `Migration complete: inserted=${inserted}, skipped=${skipped}`,
      inserted,
      skipped,
      existing
    });
  } catch (error) {
    console.error("Migration error:", error);
    return NextResponse.json({ error: "Migration failed" }, { status: 500 });
  }
}
