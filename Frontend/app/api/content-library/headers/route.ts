import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabaseService = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const path = body?.path;
    const externalUrl = body?.url;

    let fetchUrl: string | null = null;
    if (externalUrl) {
      fetchUrl = externalUrl;
    } else if (path) {
      const { data: signedUrlData } = await supabaseService.storage.from('content library').createSignedUrl(path, 60 * 60);
      fetchUrl = signedUrlData?.signedUrl || null;
      if (!fetchUrl) {
        const { data: publicData } = supabaseService.storage.from('content library').getPublicUrl(path);
        fetchUrl = publicData?.publicUrl || null;
      }
    }

    if (!fetchUrl) return NextResponse.json({ error: 'Missing path or url' }, { status: 400 });

    // Try HEAD first; if not allowed, do GET to read headers
    let resp: Response;
    try {
      resp = await fetch(fetchUrl, { method: 'HEAD', redirect: 'follow' });
      if (resp.status === 405) throw new Error('HEAD not allowed');
    } catch (e) {
      resp = await fetch(fetchUrl, { method: 'GET', redirect: 'follow' });
    }

    if (!resp) return NextResponse.json({ error: 'Failed to fetch headers' }, { status: 502 });

    const contentType = resp.headers.get('content-type') || null;
    const contentDisposition = resp.headers.get('content-disposition') || null;
    return NextResponse.json({ contentType, contentDisposition });
  } catch (err: any) {
    console.error('headers route error', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
