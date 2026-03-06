import { supabaseAdmin } from './supabaseAdmin';
import crypto from 'crypto';

/** Races a thenable (Supabase builder or Promise) against a timeout.
 *  Resolves with { data: null, error: TimeoutError } on timeout so callers
 *  can treat it the same as a Supabase error response.
 */
function withTimeout<T>(
  thenable: PromiseLike<T>,
  ms: number
): Promise<T | { data: null; error: Error }> {
  const timeout = new Promise<{ data: null; error: Error }>((resolve) =>
    setTimeout(() => resolve({ data: null, error: new Error(`Supabase call timed out after ${ms}ms`) }), ms)
  );
  return Promise.race([Promise.resolve(thenable), timeout]);
}

/**
 * New approach:
 * - compute a deterministic `dedupe_key` (sha256 of selected fields)
 * - call a DB function `log_error_dedupe(jsonb)` which INSERTs or ON CONFLICT increments occurrences
 * This is atomic and works across processes/instances.
 */

function makeDedupeKeyForPayload(payload: Record<string, any>) {
  const parts = [
    payload.action || '',
    payload.page_url || payload.pageUrl || '',
    payload.error_type || '',
    payload.error || '',
    payload.email_id || payload.email || '',
  ];
  const raw = parts.join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function logError(payload: {
  email_id?: string | null;
  error: string;
  stack_trace?: string | null;
  error_type?: string | null;
  browser?: string | null;
  os?: string | null;
  device?: string | null;
  action?: string | null;
  page_url?: string | null;
}) {
  try {
    const row: any = {
      email_id: payload.email_id || null,
      error: (payload.error || '').toString().slice(0, 3000),
      stack_trace: payload.stack_trace ? String(payload.stack_trace).slice(0, 10000) : null,
      error_type: payload.error_type || null,
      browser: payload.browser || null,
      os: payload.os || null,
      device: payload.device || null,
      action: payload.action || null,
      page_url: payload.page_url || null,
      occurrences: 1,
      last_seen: new Date().toISOString(),
    };

    // compute dedupe key
    row.dedupe_key = makeDedupeKeyForPayload(row);

    const fallbackRow = {
      email_id: row.email_id,
      error: row.error,
      stack_trace: row.stack_trace,
      error_type: row.error_type,
      browser: row.browser,
      os: row.os,
      device: row.device,
      action: row.action,
      page_url: row.page_url,
    };

    try {
      // call the DB helper function which will perform insert or increment atomically
      const rpcResult = await withTimeout(
        supabaseAdmin.rpc('log_error_dedupe', { p: row }),
        4000 // fail fast — do not block login for >4s
      );
      const rpcErr = (rpcResult as any)?.error;
      if (rpcErr) {
        // RPC not available or failed — fallback to plain insert
        const insertResult = await withTimeout(
          supabaseAdmin.from('error_logs').insert([fallbackRow]),
          4000
        );
        const insertErr = (insertResult as any)?.error;
        if (insertErr) {
          console.error('logError: supabase insert error (fallback)', insertErr);
          return { ok: false, error: String(insertErr?.message || insertErr) };
        }
        return { ok: true };
      }
      return { ok: true };
    } catch (e) {
      console.error('logError: rpc failed', e);
      try {
        const insertResult = await withTimeout(
          supabaseAdmin.from('error_logs').insert([fallbackRow]),
          4000
        );
        const insertErr = (insertResult as any)?.error;
        if (insertErr) {
          console.error('logError: supabase insert error (final fallback)', insertErr);
          return { ok: false, error: String(insertErr?.message || insertErr) };
        }
        return { ok: true };
      } catch (ie) {
        console.error('logError final insert failed', ie);
        return { ok: false, error: String(ie) };
      }
    }
  } catch (e) {
    console.error('logError failed', e);
    return { ok: false, error: String(e) };
  }
}
