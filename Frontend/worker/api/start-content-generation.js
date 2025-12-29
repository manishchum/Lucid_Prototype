// // Standalone version of start-content-generation for VM worker
// const { createClient } = require('@supabase/supabase-js');
// require('dotenv').config();

// const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// async function startContentGeneration(module_id) {
//   if (!module_id) {
//     throw new Error('Missing module_id');
//   }
//   const { error: jobError } = await supabase
//     .from('content_jobs')
//     .insert({ module_id, status: 'pending' });
//   if (jobError) {
//     throw new Error('Failed to create job: ' + jobError.message);
//   }
//   return { started: true, module_id, job_status: 'pending' };
// }

// module.exports = { startContentGeneration };
