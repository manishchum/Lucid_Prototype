const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function startLucidContentGeneration(lucidToolJobId) {
  if (!lucidToolJobId) {
    throw new Error('Missing lucid_tool_job_id');
  }

  const { error } = await supabase
    .from('lucid_tool_content_jobs')
    .insert({
      lucid_tool_job_id: lucidToolJobId,
      status: 'pending'
    });

  if (error) {
    throw new Error(error.message);
  }

  return {
    started: true,
    lucid_tool_job_id: lucidToolJobId
  };
}

module.exports = {
  startLucidContentGeneration
};