'use strict';

require('./env').loadWorkerEnv();

const { createClient } = require('@supabase/supabase-js');
const fetch = global.fetch;

// ── Config ────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000; // 1 min (important for time-based sending)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v19.0';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[whatsapp-cron] Missing Supabase env');
  process.exit(1);
}

if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
  console.error('[whatsapp-cron] Missing WhatsApp credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ───────────────────────────────────────────────────

function utcNow() {
  return new Date();
}

function timeMatches(now, scheduledTime) {
  const nowHHMM = now.toISOString().slice(11, 16); // HH:mm
  const schedHHMM = scheduledTime.slice(0, 5);
  return nowHHMM === schedHHMM;
}

function isTodayMatch(schedule, now) {
  if (schedule.schedule_type === 'one_time') {
    if (!schedule.scheduled_date) return false;
    const today = now.toISOString().slice(0, 10);
    return schedule.scheduled_date === today;
  }

  // recurring
  const day = now.getUTCDay(); // 0–6
  return (schedule.days_of_week || []).includes(day);
}

function canRetry(dispatch) {
  return dispatch.retry_count < dispatch.max_retries;
}

// ── WhatsApp Sender ───────────────────────────────────────────

async function sendWhatsApp(dispatch, schedule) {
  const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  let payload = {
    messaging_product: 'whatsapp',
    to: dispatch.phone_number,
  };

  // TEXT MESSAGE
  if (!schedule.media_url) {
    payload.type = 'text';
    payload.text = { body: schedule.message_body };
  } else {
    // MEDIA MESSAGE
    payload.type = schedule.media_type;

    payload[schedule.media_type] = {
      link: schedule.media_url,
      caption: schedule.message_body || undefined,
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error?.message || 'WhatsApp API error');
  }

  return data;
}

// ── Core Cron ─────────────────────────────────────────────────

async function pollAndSend() {
  const now = utcNow();

  console.log(`[whatsapp-cron] Poll at ${now.toISOString()}`);

  // 1. Fetch active schedules
  const { data: schedules, error: schedErr } = await supabase
    .from('scheduled_whatsapp')
    .select('*')
    .eq('is_active', true);

  if (schedErr) {
    console.error('[whatsapp-cron] Schedule fetch error:', schedErr.message);
    return;
  }

  for (const schedule of schedules || []) {
    // 2. Check date/day match
    if (!isTodayMatch(schedule, now)) continue;

    // 3. Check time match
    if (!timeMatches(now, schedule.scheduled_time)) continue;

    console.log(`[whatsapp-cron] Triggering schedule ${schedule.scheduled_whatsapp_id}`);

    // 4. Fetch dispatch rows
    const { data: dispatches, error: dispatchErr } = await supabase
      .from('whatsapp_dispatch')
      .select('*')
      .eq('scheduled_whatsapp_id', schedule.scheduled_whatsapp_id);

    if (dispatchErr) {
      console.error('[whatsapp-cron] Dispatch fetch error:', dispatchErr.message);
      continue;
    }

    for (const dispatch of dispatches || []) {
      // Skip already sent/delivered
      if (['sent', 'delivered'].includes(dispatch.status)) continue;

      // Retry logic
      if (dispatch.status === 'failed' && !canRetry(dispatch)) continue;

      let status = 'sent';
      let errorMsg = null;
      let messageId = null;

      try {
        const res = await sendWhatsApp(dispatch, schedule);

        messageId = res?.messages?.[0]?.id || null;

        console.log(`✓ Sent to ${dispatch.phone_number}`);
      } catch (err) {
        status = 'failed';
        errorMsg = err.message;
        console.error(`✗ ${dispatch.phone_number}: ${errorMsg}`);
      }

      // 5. Update dispatch row
      await supabase
        .from('whatsapp_dispatch')
        .update({
          status,
          whatsapp_message_id: messageId,
          attempted_at: new Date().toISOString(),
          error_message: errorMsg,
          retry_count:
            status === 'failed'
              ? dispatch.retry_count + 1
              : dispatch.retry_count,
        })
        .eq('whatsapp_dispatch_id', dispatch.whatsapp_dispatch_id);
    }
  }
}

// ── Start ─────────────────────────────────────────────────────

console.log('[whatsapp-cron] Started. Interval:', POLL_INTERVAL_MS / 1000, 's');

pollAndSend().catch((e) =>
  console.error('[whatsapp-cron] Initial error:', e)
);

setInterval(() => {
  pollAndSend().catch((e) =>
    console.error('[whatsapp-cron] Poll error:', e)
  );
}, POLL_INTERVAL_MS);