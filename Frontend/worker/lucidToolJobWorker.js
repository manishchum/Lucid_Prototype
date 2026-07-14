require('./env').loadWorkerEnv();

const { createClient } = require('@supabase/supabase-js');
const path = require('path');

console.log('Loading migrate-processed-lucid-tool...');
const {
  migrateProcessedLucidTool
} = require(
  path.join(
    __dirname,
    'api/migrate-processed-lucid-tool'
  )
);

console.log('Loading generate-lucid-tool-content...');
const {
  generateLucidToolContent
} = require(
  path.join(
    __dirname,
    'api/generate-lucid-tool-content'
  )
);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function processLucidJobs() {

  console.log(
    'Lucid Tool Worker started. Polling every 5 seconds...'
  );

  while (true) {

    const { data: jobs, error } =
      await supabase
        .from('lucid_tool_content_jobs')
        .select(`
          id,
          lucid_tool_job_id
        `)
        .eq('status', 'pending')
        .order('created_at', {
          ascending: true
        })
        .limit(1);

    if (error) {
      console.error(error);
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    if (!jobs?.length) {

      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    const job = jobs[0];

    try {

      console.log(
        `[LUCID] Processing ${job.id}`
      );

      await supabase
        .from('lucid_tool_content_jobs')
        .update({
          status: 'in-progress',
          updated_at: new Date()
        })
        .eq('id', job.id);

      await migrateProcessedLucidTool({
        lucidToolJobId: job.lucid_tool_job_id
      });

      await generateLucidToolContent({
        lucidToolJobId: job.lucid_tool_job_id
      });

      await supabase
        .from('lucid_tool_content_jobs')
        .update({
          status: 'completed',
          updated_at: new Date()
        })
        .eq('id', job.id);

      console.log(
        `[LUCID] Completed ${job.id}`
      );

    } catch (err) {

      console.error(err);

      await supabase
        .from('lucid_tool_content_jobs')
        .update({
          status: 'failed',
          updated_at: new Date()
        })
        .eq('id', job.id);
    }

    await new Promise(r => setTimeout(r, 5000));
  }
}

processLucidJobs();