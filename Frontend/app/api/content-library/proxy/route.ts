import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabaseService = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export async function GET(req: Request) {
  try {
    const urlObj = new URL(req.url);
    const path = urlObj.searchParams.get('path');
    const externalUrl = urlObj.searchParams.get('url');

    let fetchUrl: string | null = null;
    if (externalUrl) {
      // use provided full url (signed url) directly
      fetchUrl = externalUrl;
    } else if (path) {
      // Create a signed URL (or fallback to public URL) and fetch server-side
      const { data: signedUrlData } = await supabaseService.storage.from('content library').createSignedUrl(path, 60 * 60);
      fetchUrl = signedUrlData?.signedUrl || null;
      if (!fetchUrl) {
        const { data: publicData } = supabaseService.storage.from('content library').getPublicUrl(path);
        fetchUrl = publicData?.publicUrl || null;
      }
    }

    if (!fetchUrl) return NextResponse.json({ error: 'Missing path or url' }, { status: 400 });

    const resp = await fetch(fetchUrl, { redirect: 'follow' });
    if (!resp.ok) return NextResponse.json({ error: 'Failed to fetch file', status: resp.status }, { status: 502 });

    // Proxy response body but set Content-Disposition to inline so browsers preview PDFs instead of downloading
    const headers = new Headers();
    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    headers.set('content-type', contentType);
    // Derive a safe filename from the path for inline disposition
    try {
      const parts = path.split('/');
      const rawName = parts[parts.length - 1] || 'file';
      const filename = decodeURIComponent(rawName.replace(/\+/g, ' '));
      // Set inline disposition with filename
      headers.set('content-disposition', `inline; filename="${filename.replace(/\"/g, '')}"`);
    } catch (e) {
      // ignore filename extraction errors
    }
    // Stream the body directly
    return new Response(resp.body, { headers });
  } catch (err: any) {
    console.error('proxy route error', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
