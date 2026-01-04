require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

(async () => {
  try {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Supabase env vars not found. Check .env.local');
      process.exit(1);
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) Delete rows in courses matching test-upload patterns
    // console.log('Searching for test rows in courses...');
    const { data: candidates, error: selectError } = await supabase.from('courses').select('*').or("title.ilike.Test%25, module.ilike.%25test-upload%25, module.ilike.%25test-uploads%25");
    if (selectError) {
      console.error('Error querying courses:', selectError);
    }
    const idsToDelete = (candidates || []).map(r => r.course_id || r.id).filter(Boolean);
    if (idsToDelete.length === 0) {
      // console.log('No test rows found in courses.');
    } else {
      // console.log('Found', idsToDelete.length, 'rows, deleting...');
      const { error: delErr } = await supabase.from('courses').delete().in('course_id', idsToDelete);
      if (delErr) console.error('Delete error:', delErr);
      else { 
        
        // // console.log('Deleted rows from courses.');
      }
    }

    // 2) Remove objects under content library with prefix 'test-uploads' or names containing 'test-upload'
    const bucket = 'content library';
    // console.log('Listing objects under bucket', bucket, 'with prefix test-uploads/');
    try {
      const { data: listData, error: listErr } = await supabase.storage.from(bucket).list('test-uploads');
      if (listErr) {
        console.error('Error listing objects:', listErr.message || listErr);
      } else {
        if ((listData || []).length === 0) {
          // console.log('No objects found under test-uploads/');
        } else {
          const paths = (listData || []).map(o => o.name ? `test-uploads/${o.name}` : o.path).filter(Boolean);
          // console.log('Found storage objects:', paths);
          const { error: removeErr } = await supabase.storage.from(bucket).remove(paths);
          if (removeErr) console.error('Storage remove error:', removeErr);
          else{} // console.log('Removed storage objects under test-uploads/');
        }
      }
    } catch (e) {
      console.error('Listing/removal error', e);
    }

    // console.log('Cleanup completed.');
    process.exit(0);
  } catch (err) {
    console.error('Unexpected error', err);
    process.exit(1);
  }
})();
