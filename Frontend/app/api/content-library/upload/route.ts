import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// This API route runs on the server and uses the service role key to
// upload files to Supabase Storage and insert rows into the `courses` table.
// It accepts a multipart/form-data POST with fields:
// - file: (File) the uploaded file
// - title: string
// - description: string
// - category_id: string or number (optional)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabaseService = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export async function POST(req: Request) {
  console.log('Upload route invoked');
  try {
    const form = await req.formData();
    console.log('Upload route received form data');
    console.log(form);
    // Log all form entries to help debug which fields the client actually sent
    for (const entry of form.entries()) {
      try {
        console.log('form entry:', entry[0], entry[1]);
      } catch (e) {
        console.log('form entry (binary):', entry[0]);
      }
    }

    const file = form.get('file') as File | null;
    const title = (form.get('title') as string) || '';
    const description = (form.get('description') as string) || '';
    console.log('Upload route received title=', title, 'description=', description);
    // Accept multiple possible field names for category to be defensive
    const categoryIdRaw = (form.get('category_id') ?? form.get('categoryId') ?? form.get('category')) as string | number | null;
    // Robust coercion: accept numeric strings and numbers; treat empty strings as null
    let category_id: number | null = null;
    if (categoryIdRaw !== null && categoryIdRaw !== undefined) {
      const s = String(categoryIdRaw).trim();
      if (s !== '') {
        const n = Number(s);
        if (!Number.isNaN(n)) category_id = n;
      }
    }

    console.log('Upload route received category_id raw=', categoryIdRaw, 'coerced=', category_id);

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Create a safe path under uploads/
    const baseName = file.name || `upload_${Date.now()}`;
    const filePath = `uploads/${Date.now()}_${baseName}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { data: storageData, error: storageError } = await supabaseService.storage.from('content library').upload(filePath, buffer, { contentType: file.type, upsert: true });
    if (storageError) {
      console.error('Server upload error', storageError);
      return NextResponse.json({ error: storageError.message || 'Upload failed' }, { status: 500 });
    }

    // Create a signed URL for the uploaded object
    const { data: signedUrlData, error: signedUrlError } = await supabaseService.storage.from('content library').createSignedUrl(storageData.path, 60 * 60);
    let fileUrl = '';
    if (signedUrlError) {
      const { data: publicData } = supabaseService.storage.from('content library').getPublicUrl(storageData.path);
      fileUrl = publicData?.publicUrl || '';
    } else {
      fileUrl = signedUrlData?.signedUrl || '';
    }

    const payload: any = {
      title: title || baseName,
      description: description || '',
      category_id: category_id !== null ? category_id : categoryIdRaw,
      created_at: new Date().toISOString(),
      module: fileUrl,
    };

    console.log('Inserting course payload', payload);
    console.log('Inserting course payload', payload);
    const { data: inserted, error: insertError } = await supabaseService.from('courses').insert([payload]).select();
    if (insertError) {
      console.error('Server insert error', insertError);
      return NextResponse.json({ error: insertError.message || 'DB insert failed' }, { status: 500 });
    }

    return NextResponse.json({ inserted: inserted && inserted[0] ? inserted[0] : null });
  } catch (err: any) {
    console.error('Upload route error', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
