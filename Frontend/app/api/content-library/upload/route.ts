import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// This API route runs on the server and uses the server key to
// upload files to Supabase Storage and insert rows into the `courses` table.
// It accepts a multipart/form-data POST with fields:
// - file: (File) the uploaded file
// - title: string
// - description: string
// - category_id: string or number (optional)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
// console.log('Supabase URL:', SUPABASE_URL);
const SUPABASE_SERVER_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
// console.log('Server key:', SUPABASE_SERVER_KEY);

const ADMIN_ROLES = new Set(['ADMIN', 'CEO', 'SUPER_ADMIN', 'DEVELOPER']);

function createRequestScopedClient(req: Request) {
  const authHeader = req.headers.get('authorization') || '';
  return createClient(SUPABASE_URL, SUPABASE_SERVER_KEY, {
    auth: { persistSession: false },
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

async function assertAdminAccess(req: Request, supabaseService: any) {
  const authHeader = req.headers.get('authorization') || '';
  const adminId = (req.headers.get('x-admin-id') || '').trim();
  const companyId = (req.headers.get('x-company-id') || '').trim();

  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { ok: false as const, status: 401, error: 'Missing bearer token' };
  }
  if (!adminId || !companyId) {
    return { ok: false as const, status: 400, error: 'Missing x-admin-id or x-company-id' };
  }

  const { data: userDataRaw, error: userError } = await supabaseService
    .from('users')
    .select('user_id, company_id, is_active')
    .eq('user_id', adminId)
    .maybeSingle();

  const userData = userDataRaw as { company_id?: string | null; is_active?: boolean } | null;

  if (userError || !userData) {
    return { ok: false as const, status: 403, error: 'Admin not found for authenticated context' };
  }
  if (!userData.is_active) {
    return { ok: false as const, status: 403, error: 'Admin account is inactive' };
  }
  if (String(userData.company_id) !== companyId) {
    return { ok: false as const, status: 403, error: 'Admin does not belong to the requested company' };
  }

  const { data: roleRows, error: rolesError } = await supabaseService
    .from('user_role_assignments')
    .select('scope_type, scope_id, is_active, roles!inner(name)')
    .eq('user_id', adminId)
    .eq('is_active', true);

  if (rolesError) {
    return { ok: false as const, status: 403, error: 'Unable to validate admin roles' };
  }

  const hasAdminRole = (roleRows || []).some((row: any) => {
    const roleName = String(row?.roles?.name || '').toUpperCase();
    if (!ADMIN_ROLES.has(roleName)) return false;
    if (roleName === 'SUPER_ADMIN' || roleName === 'DEVELOPER') return true;
    return row?.scope_type === 'COMPANY' && String(row?.scope_id || '') === companyId;
  });

  if (!hasAdminRole) {
    return { ok: false as const, status: 403, error: 'Admin role required to upload content' };
  }

  return { ok: true as const, adminId, companyId };
}

const INSERTED_COURSE_COLUMNS = 'course_id, title, description, category_id, created_at, module, parent_course_id';

export async function POST(req: Request) {
  //console.log('Upload route invoked');
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVER_KEY) {
      return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
    }

    const supabaseService = createRequestScopedClient(req);
    const access = await assertAdminAccess(req, supabaseService);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const form = await req.formData();
    //console.log('Upload route received form data');
    //console.log(form);
    // Log all form entries to help debug which fields the client actually sent
    for (const entry of form.entries()) {
      try {
        // console.log('form entry:', entry[0], entry[1]);
      } catch (e) {
        // console.log('form entry (binary):', entry[0]);
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
    // console.log('Upload route received groupTitle=', groupTitle, 'description=', description);
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

    // console.log('Upload route received category_id raw=', categoryIdRaw, 'coerced=', category_id);

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
        const baseName = sanitizeFileName(file.name || `upload_${Date.now()}`);
        const filePath = `${access.companyId}/uploads/${Date.now()}_${i}_${baseName}`;
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const { data: storageData, error: storageError } = await supabaseService.storage
          .from('content library')
          .upload(filePath, buffer, { contentType: file.type, cacheControl: '3600' });
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

    // Try inserting including file_size if possible. If the DB schema doesn't have that column,
    // retry the insert without it (some deployments may not have migrated the column).
    let insertedChildren = null;
    try {
      const resp = await supabaseService.from('courses').insert(childPayloads).select(INSERTED_COURSE_COLUMNS);
      insertedChildren = resp.data;
      if (resp.error) throw resp.error;
    } catch (insertError: any) {
      console.error('Server insert error (initial)', insertError?.message || insertError);
      const msg = String(insertError?.message || insertError || '');
      // Detect Postgres / Supabase error about unknown column and retry without file_size
      if (msg.toLowerCase().includes("file_size") && (msg.toLowerCase().includes('column') || msg.toLowerCase().includes('does not exist') || msg.toLowerCase().includes('schema cache'))) {
        try {
          const fallback = childPayloads.map(p => {
            const copy = { ...p };
            delete copy.file_size;
            return copy;
          });
          const resp2 = await supabaseService.from('courses').insert(fallback).select(INSERTED_COURSE_COLUMNS);
          insertedChildren = resp2.data;
          if (resp2.error) throw resp2.error;
        } catch (finalErr: any) {
          console.error('Server insert error (fallback without file_size)', finalErr?.message || finalErr);
          return NextResponse.json({ error: finalErr?.message || 'DB insert failed (fallback)' }, { status: 500 });
        }
      } else {
        return NextResponse.json({ error: insertError?.message || 'DB insert failed' }, { status: 500 });
      }
    }

    return NextResponse.json({ parent_course_id: parentCourseId, inserted: insertedChildren });
  } catch (err: any) {
    console.error('Upload route error', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
