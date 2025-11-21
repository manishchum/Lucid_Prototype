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
    if (!path || typeof path !== 'string') return NextResponse.json({ error: 'Missing path' }, { status: 400 });

    // Create a signed URL valid for 1 hour
    const { data: signedUrlData, error: signedUrlError } = await supabaseService.storage.from('content library').createSignedUrl(path, 60 * 60);
    if (signedUrlError) {
      console.error('Signed URL creation failed', signedUrlError);
      return NextResponse.json({ error: signedUrlError.message || 'Failed to create signed url' }, { status: 500 });
    }

    return NextResponse.json({ signedUrl: signedUrlData?.signedUrl || null });
  } catch (err: any) {
    console.error('signed-url route error', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
