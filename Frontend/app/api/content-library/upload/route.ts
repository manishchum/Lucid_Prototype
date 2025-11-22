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

    // Support multiple files uploaded under the same form field name 'file'
    const files = (form.getAll('file') || []) as File[];
    // Fallback to single field for older clients
    if (files.length === 0) {
      const single = form.get('file') as File | null;
      if (single) files.push(single);
    }

    const groupTitle = (form.get('groupTitle') as string) || (form.get('title') as string) || '';
    const description = (form.get('description') as string) || '';
    console.log('Upload route received groupTitle=', groupTitle, 'description=', description);
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

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    // Accept optional parent_course_id from the client. If provided, child rows
    // will be linked to that parent. We DO NOT auto-create a parent row here —
    // that prevented single-file uploads from creating exactly one row.
    const parentRaw = form.get('parent_course_id') ?? form.get('parentCourseId') ?? null;
    let parentCourseId: number | null = null;
    if (parentRaw !== null && parentRaw !== undefined) {
      const p = Number(String(parentRaw));
      if (!Number.isNaN(p)) parentCourseId = p;
    }

    const childPayloads: any[] = [];
    // Upload each file to storage and collect child payloads
    for (let i = 0; i < files.length; i++) {
      const file = files[i] as File;
      try {
        const baseName = file.name || `upload_${Date.now()}`;
        const filePath = `uploads/${Date.now()}_${i}_${baseName}`;
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const { data: storageData, error: storageError } = await supabaseService.storage.from('content library').upload(filePath, buffer, { contentType: file.type, upsert: true });
        if (storageError) {
          console.error('Server upload error for file', file.name, storageError);
          // Skip this file but continue with others
          continue;
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

        const childPayload: any = {
          // Use the admin-provided groupTitle (module name) as the title for each child
          title: groupTitle || file.name || baseName,
          description: description || '',
          category_id: category_id !== null ? category_id : categoryIdRaw,
          created_at: new Date().toISOString(),
          module: fileUrl,
        };
        // Only set parent_course_id when passed from the client
        if (parentCourseId !== null) childPayload.parent_course_id = parentCourseId;
        // include file size so UI can estimate duration
        try { childPayload.file_size = buffer.length; } catch (e) { childPayload.file_size = null; }
        childPayloads.push(childPayload);
      } catch (err) {
        console.error('Failed to process file', files[i]?.name, err);
      }
    }

    if (childPayloads.length === 0) {
      return NextResponse.json({ error: 'No files were uploaded successfully' }, { status: 500 });
    }

    const { data: insertedChildren, error: insertError } = await supabaseService.from('courses').insert(childPayloads).select();
    if (insertError) {
      console.error('Server insert error', insertError);
      return NextResponse.json({ error: insertError.message || 'DB insert failed' }, { status: 500 });
    }

    return NextResponse.json({ parent_course_id: parentCourseId, inserted: insertedChildren });
  } catch (err: any) {
    console.error('Upload route error', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
