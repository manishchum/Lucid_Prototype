require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
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

    const scriptsDir = path.dirname(__filename);
    const tmpFile = path.join(scriptsDir, `test-upload-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, `Test upload from script: ${new Date().toISOString()}`);

    const bucket = 'content library';
    const destPath = `test-uploads/${Date.now()}_${path.basename(tmpFile)}`;
    // Use Buffer for Node uploads to avoid undici "duplex" stream issue
    const fileBuffer = fs.readFileSync(tmpFile);

    // console.log('Uploading to storage (buffer)...', { bucket, destPath });
    let { data: storageData, error: storageError } = await supabase.storage.from(bucket).upload(destPath, fileBuffer, { upsert: true });
    if (storageError) {
      console.error('Storage upload error:', storageError);
      // If bucket not found, attempt to create it (requires service_role key)
      const status = storageError.status || storageError.statusCode || null;
      if (status === 404 || status === '404' || status === 400) {
        // console.log(`Bucket '${bucket}' not found — attempting to create it as public.`);
        try {
          const { data: cbData, error: cbErr } = await supabase.storage.createBucket(bucket, { public: true });
          if (cbErr) {
            console.error('Create bucket error:', cbErr);
          } else {
            // console.log('Bucket created:', cbData);
            // retry upload
            const retry = await supabase.storage.from(bucket).upload(destPath, fileBuffer, { upsert: true });
            storageData = retry.data;
            storageError = retry.error;
            if (storageError) console.error('Retry upload error:', storageError);
            else{} // console.log('Retry upload success:', storageData);
          }
        } catch (cbCatch) {
          console.error('Create bucket failed', cbCatch);
        }
      }
    } else {
      // console.log('Storage upload result:', storageData);
    }

    const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(destPath);
    const publicUrl = publicData?.publicUrl || null;
    // console.log('Public URL:', publicUrl);

    const payload = {
      title: `Test Course ${Date.now()}`,
      description: 'Inserted by test_upload script',
      category_id: null,
      created_at: new Date().toISOString(),
      module: publicUrl || destPath,
    };

    // console.log('Inserting course row...', payload);
    const { data: inserted, error: insertError } = await supabase.from('courses').insert([payload]).select();
    if (insertError) {
      console.error('Insert error:', insertError);
    } else {
      // console.log('Insert success:', inserted);
    }

    // cleanup temp file
    try { fs.unlinkSync(tmpFile); } catch (e) {}

    process.exit(0);
  } catch (err) {
    console.error('Unexpected error', err);
    process.exit(1);
  }
})();
