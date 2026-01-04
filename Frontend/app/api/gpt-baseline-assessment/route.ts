import { NextRequest, NextResponse } from 'next/server';

// Lightweight baseline assessment route. This endpoint should only create
// baseline assessment templates for modules that are marked as requiring a
// baseline in the `learning_plan` table. Previously this created a single
// company-wide baseline for any incoming request which caused all modules
// to be considered baseline-enabled. The updated logic filters modules by
// the learning plan and inserts one assessment row per module when needed.

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { modules, answers, user_id } = body;

  if (!modules || !Array.isArray(modules) || modules.length === 0) {
    return NextResponse.json({ error: 'Modules (array) are required' }, { status: 400 });
  }
  if (!user_id) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // Resolve company for the user
  const { data: employee, error: employeeError } = await supabase
    .from('users')
    .select('company_id')
    .eq('user_id', user_id)
    .maybeSingle();
  if (employeeError || !employee?.company_id) {
    return NextResponse.json({ error: 'Could not find company for employee' }, { status: 400 });
  }
  const company_id = employee.company_id;

  // If a single module_id was provided explicitly (top-level), prefer a
  // focused per-user/company check: only generate baseline for that module
  // when the learning_plan row for that user (or company) & module has
  // baseline_assessment === 1.
  const singleModuleId = body.module_id || body.moduleId || null;
  if (singleModuleId) {
    // Look for a learning_plan row for this user-module or company-module
    const { data: lpRow, error: lpErr } = await supabase
      .from('learning_plan')
      .select('learning_plan_id, baseline_assessment, user_id, company_id')
      .or(`user_id.eq.${user_id},company_id.eq.${company_id}`)
      .eq('module_id', String(singleModuleId))
      .limit(1)
      .maybeSingle();

    if (lpErr) {
      return NextResponse.json({ error: 'Failed to check learning_plan for module', detail: lpErr }, { status: 500 });
    }

    if (!lpRow || Number(lpRow.baseline_assessment) !== 1) {
      return NextResponse.json({ error: 'Baseline not required for this module/user according to learning_plan' }, { status: 403 });
    }

    // Build the modulesToCreate array from the provided modules array (if
    // present) or synthesize a minimal module object using the module id.
    let modulesToCreate: any[] = [];
    if (Array.isArray(modules) && modules.length > 0) {
      modulesToCreate = modules.filter((m: any) => String(m?.module_id) === String(singleModuleId) || String(m?.processed_module_id) === String(singleModuleId));
    }
    if (modulesToCreate.length === 0) {
      modulesToCreate = [{ module_id: String(singleModuleId), processed_module_id: null, title: null }];
    }

    // Generate questions and insert for this single module (reuse existing
    // insert flow semantics but scoped to modulesToCreate we just built).
    const questions = modulesToCreate.flatMap((mod: any, idx: number) => {
      return Array.from({ length: 2 }, (_, i) => ({
        id: `${mod.title || mod.module_id}-${i + 1}`,
        question: `Sample question ${i + 1} for module: ${mod.title || mod.module_id}`,
        module: mod.title || mod.module_id,
      }));
    });

    const rowsToInsert = modulesToCreate.map((m: any) => ({
      type: 'baseline',
      questions: JSON.stringify(questions),
      company_id,
      module_id: m?.module_id || null,
      processed_module_id: m?.processed_module_id || null,
    }));

    const { data: insertData, error: insertError } = await supabase
      .from('assessments')
      .insert(rowsToInsert)
      .select('assessment_id, module_id, processed_module_id');

    if (insertError) {
      return NextResponse.json({ error: 'Failed to insert baseline assessment for module', detail: insertError }, { status: 500 });
    }

    if (answers) {
      let score = 0;
      const weakTopics: string[] = [];
      questions.forEach((q: any) => {
        const ans = answers[q.id] || '';
        if (ans && String(ans).length > 10) score++;
        else weakTopics.push(q.module);
      });
      return NextResponse.json({ score, maxScore: questions.length, weakTopics, company_id, inserted: insertData });
    }

    return NextResponse.json({ questions, company_id, inserted: insertData });
  }

  // Collect module identifiers sent by the client. Prefer `module_id`, fall
  // back to `title` if module_id is not provided (best-effort matching).
  const requestedModuleIds = new Set<string>();
  const requestedModuleTitles = new Set<string>();
  for (const m of modules) {
    if (m == null) continue;
    if (m.module_id) requestedModuleIds.add(String(m.module_id));
    if (m.processed_module_id) requestedModuleIds.add(String(m.processed_module_id));
    if (m.title) requestedModuleTitles.add(String(m.title).toLowerCase());
  }

  // Fetch learning_plan rows for this company (and user) that indicate
  // `baseline_assessment` is required. We aggregate module ids referenced
  // directly in `module_id` column as well as those encoded inside `plan_json`.
  const { data: plans } = await supabase
    .from('learning_plan')
    .select('module_id, plan_json, baseline_assessment, user_id, company_id')
    .or(`company_id.eq.${company_id},user_id.eq.${user_id}`);

  const baselineModuleIds = new Set<string>();
  if (Array.isArray(plans)) {
    for (const p of plans) {
      try {
        if (p && Number(p.baseline_assessment) === 1) {
          if (p.module_id) baselineModuleIds.add(String(p.module_id));
          if (p.plan_json) {
            let parsed = p.plan_json;
            if (typeof parsed === 'string') {
              try { parsed = JSON.parse(parsed); } catch { parsed = null; }
            }
            const mods = parsed?.modules || parsed?.learning_plan?.modules || parsed?.plan?.modules;
            if (Array.isArray(mods)) {
              for (const mm of mods) {
                if (mm?.module_id) baselineModuleIds.add(String(mm.module_id));
                if (mm?.original_module_id) baselineModuleIds.add(String(mm.original_module_id));
                if (mm?.processed_module_id) baselineModuleIds.add(String(mm.processed_module_id));
                if (mm?.title) requestedModuleTitles.add(String(mm.title).toLowerCase());
              }
            }
          }
        }
      } catch (e) {
        // ignore malformed rows
      }
    }
  }

  // Determine which requested modules actually require a baseline
  const modulesToCreate: any[] = [];
  for (const m of modules) {
    const mid = m?.module_id ? String(m.module_id) : m?.processed_module_id ? String(m.processed_module_id) : null;
    const title = m?.title ? String(m.title).toLowerCase() : null;
    const matchesId = mid && baselineModuleIds.has(mid);
    const matchesTitle = title && requestedModuleTitles.has(title);
    if (matchesId || matchesTitle) modulesToCreate.push(m);
  }

  if (modulesToCreate.length === 0) {
    // No modules here require a baseline according to learning_plan; return
    // a clear response so callers won't create baselines for all company modules.
    return NextResponse.json({ error: 'No requested modules require baseline according to learning_plan', company_id, matched: Array.from(baselineModuleIds) }, { status: 400 });
  }

  // Generate questions for the filtered modules (simple simulated questions for now).
  const questions = modulesToCreate.flatMap((mod: any, idx: number) => {
    return Array.from({ length: 2 }, (_, i) => ({
      id: `${mod.title || mod.module_id}-${i + 1}`,
      question: `Sample question ${i + 1} for module: ${mod.title || mod.module_id}`,
      module: mod.title || mod.module_id,
    }));
  });

  // Insert one baseline assessment row per module (idempotent behavior is
  // intentionally minimal—if duplicates occur upstream DB constraints will
  // handle them). We keep the per-module association where possible.
  const rowsToInsert = modulesToCreate.map((m: any) => ({
    type: 'baseline',
    questions: JSON.stringify(questions),
    company_id,
    module_id: m?.module_id || null,
    processed_module_id: m?.processed_module_id || null,
  }));



  // console.log("Error inside the insrtion block:", rowsToInsert);
  console.log("Error inside the insrtion block:", rowsToInsert);

  const { data: insertData, error: insertError } = await supabase
    .from('assessments')
    .insert(rowsToInsert)
    .select('assessment_id, module_id, processed_module_id');

  if (insertError) {
    // If insertion failed due to unique constraints or concurrency, return a
    // helpful error instead of silently creating company-wide baseline.
    return NextResponse.json({ error: 'Failed to insert baseline assessments', detail: insertError }, { status: 500 });
  }

  // If answers were submitted, simulate a simple evaluation for the filtered set
  if (answers) {
    let score = 0;
    const weakTopics: string[] = [];
    questions.forEach((q: any) => {
      const ans = answers[q.id] || '';
      if (ans && String(ans).length > 10) score++;
      else weakTopics.push(q.module);
    });
    return NextResponse.json({ score, maxScore: questions.length, weakTopics, company_id, inserted: insertData });
  }

  return NextResponse.json({ questions, company_id, inserted: insertData });
}
