const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function migrateProcessedLucidTool({
  lucidToolJobId = null
} = {}) {

  let query = supabase
    .from('lucid_tool_jobs')
    .select(`
      id,
      source_document_id,
      semantic_retrieval_query,
      tools(name)
    `);

  if (lucidToolJobId) {
    query = query.eq('id', lucidToolJobId);
  }

  const { data: jobs, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  if (!jobs?.length) {
    return {
      inserted: 0
    };
  }

  let inserted = 0;

  for (const job of jobs) {

    const { data: exists } = await supabase
      .from('processed_lucid_tools')
      .select('processed_tool_id')
      .eq('lucid_tool_job_id', job.id)
      .maybeSingle();

    if (exists) {
      continue;
    }

    const { error: insertError } = await supabase
      .from('processed_lucid_tools')
      .insert({
        lucid_tool_job_id: job.id,
        source_document_id: job.source_document_id,

        tool_name: job.tools?.name || null,
        semantic_query: job.semantic_retrieval_query,

        generated_content: ''
      });

    if (!insertError) {
      inserted++;
    }
  }

  return {
    inserted
  };
}

module.exports = {
  migrateProcessedLucidTool
};