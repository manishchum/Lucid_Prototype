import { supabaseAdmin } from './supabaseAdmin';
import crypto from 'crypto';

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

    try {
      // call the DB helper function which will perform insert or increment atomically
      const { error: rpcErr } = await supabaseAdmin.rpc('log_error_dedupe', { p: row });
      if (rpcErr) {
        // RPC not available or failed. Fallback to a plain insert using only known columns
        // console.error('logError: rpc error, falling back to plain insert', rpcErr);
        const fallbackRow: any = {
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
        const { error } = await supabaseAdmin.from('error_logs').insert([fallbackRow]);
        if (error) {
          console.error('logError: supabase insert error (fallback)', error);
          return { ok: false, error: String(error.message || error) };
        }
        return { ok: true };
      }
      return { ok: true };
    } catch (e) {
      console.error('logError: rpc failed', e);
      try {
        const fallbackRow: any = {
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
        const { error } = await supabaseAdmin.from('error_logs').insert([fallbackRow]);
        if (error) {
          console.error('logError: supabase insert error (final fallback)', error);
          return { ok: false, error: String(error.message || error) };
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
