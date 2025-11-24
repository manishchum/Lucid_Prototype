import { NextRequest, NextResponse } from 'next/server';
import { logError } from '../../../lib/logging';

// Simple in-memory dedupe cache to avoid duplicate inserts from repeated identical client errors.
// Note: this is process-local and not durable across server restarts or multiple instances.
const dedupeCache = new Map<string, number>();
const DEDUPE_MS = 30_000; // 30 seconds window

function makeDedupeKey(body: any) {
  // prefer action+page_url or error+action; include email when present
  const parts = [body.action || '<no-action>', body.page_url || body.pageUrl || body.url || '<no-url>'];
  if (body.error) parts.push(String(body.error));
  if (body.error_type) parts.push(String(body.error_type));
  if (body.email_id || body.email) parts.push(String(body.email_id || body.email));
  return parts.join('|');
}

export async function POST(req: NextRequest) {
  try {
    let body: any = null;
    try {
      body = await req.json();
    } catch (e) {
      // fallback: try text then parse
      try {
        const txt = await req.text();
        body = txt ? JSON.parse(txt) : {};
      } catch (ie) {
        // as a last resort, set empty object so we still record limited info
        body = {};
      }
    }

    const dedupeKey = makeDedupeKey(body);
    const now = Date.now();
    const prev = dedupeCache.get(dedupeKey);
    if (prev && now - prev < DEDUPE_MS) {
      // update timestamp to extend suppression slightly
      dedupeCache.set(dedupeKey, now);
      return NextResponse.json({ ok: true, deduped: true }, { status: 200 });
    }

    // set cache before attempting insert to avoid races
    dedupeCache.set(dedupeKey, now);

    // Map incoming fields to the table columns you provided
    const payload = {
      email_id: body.email_id || body.email || null,
      error: body.error || body.message || body.msg || 'Client reported error',
      stack_trace: body.stack_trace || body.stack || body.stackTrace || null,
      error_type: body.error_type || body.errorType || body.type || null,
      browser: body.browser || body.ua || null,
      os: body.os || body.platform || null,
      device: body.device || null,
      action: body.action || body.title || null,
      page_url: body.page_url || body.pageUrl || body.url || body.page || null,
    };

    const res = await logError(payload as any);
    if (!res || res.ok === false) {
      // surface DB/RPC errors so we can debug why logs aren't being persisted
      return NextResponse.json({ ok: false, error: res?.error || 'unknown logError failure' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deduped: false }, { status: 201 });
  } catch (err) {
    console.error('Logging endpoint error', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
