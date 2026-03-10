/**
 * email-cron.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Recurring email dispatch worker.
 *
 * Run from the repo root or the Frontend/ folder:
 *   node Frontend/worker/email-cron.js
 *
 * What it does every POLL_INTERVAL_MS (default 90 s):
 *  1. Fetch all rows from `scheduled_emails`.
 *  2. Check if today's day-of-week is in each row's `days_of_week` array.
 *  3. For each matching schedule, find all `email_dispatch_log` rows whose
 *     status is 'pending' (or that haven't been sent today yet).
 *  4. Send the email via SMTP.
 *  5. Update each log row to 'sent' (or 'failed' on error).
 *
 * Tables used:
 *   scheduled_emails(scheduled_emails_id, company_id, subject, body,
 *                    days_of_week JSONB, scheduled_at)
 *   email_dispatch_log(email_dispatch_log_id, email_id, scheduled_emails UUID,
 *                      user_id, status, attempted_at, error_message)
 *
 * Environment variables required (loaded from Frontend/.env or Frontend/.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SMTP_HOST   (default: smtp.gmail.com)
 *   SMTP_PORT   (default: 587)
 *   SMTP_USER
 *   SMTP_PASS
 *   FROM_EMAIL  (defaults to SMTP_USER)
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

require('./env').loadWorkerEnv();

const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 90_000; // 90 seconds

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[email-cron] FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}
if (!SMTP_USER || !SMTP_PASS) {
  console.error('[email-cron] FATAL: SMTP_USER and SMTP_PASS must be set.');
  process.exit(1);
}

// ── Supabase client (service role — bypasses RLS) ─────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── SMTP transporter ──────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

// ── Day-of-week helpers ───────────────────────────────────────

/** Returns the short day name (Mon, Tue, …, Sun) for a given Date (UTC). */
function utcDayName(date) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
}

/** Returns a "YYYY-MM-DD" string in UTC for the given Date. */
function utcDateStr(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Returns true if the log row should be skipped — i.e. it was already
 * SUCCESSFULLY sent today.
 * A row with status='pending' (even if attempted_at=today by DB default)
 * must still be retried.
 */
function alreadySentToday(log, todayStr) {
  if (log.status !== 'sent') return false;          // pending / failed → retry
  if (!log.attempted_at) return false;
  return utcDateStr(new Date(log.attempted_at)) === todayStr;
}

// ── Core poll function ────────────────────────────────────────

async function pollAndSend() {
  const now = new Date();
  const todayDay = utcDayName(now);
  const todayStr = utcDateStr(now);

  console.log(`[email-cron] Polling at ${now.toISOString()} | today = ${todayDay} (${todayStr})`);

  // 1. Fetch all scheduled email configurations
  const { data: schedules, error: schedErr } = await supabase
    .from('scheduled_emails')
    .select('scheduled_emails_id, subject, body, days_of_week, scheduled_at');

  if (schedErr) {
    console.error('[email-cron] Failed to fetch scheduled_emails:', schedErr.message);
    return;
  }

  if (!schedules || schedules.length === 0) {
    console.log('[email-cron] No scheduled emails found.');
    return;
  }

  // 2. Filter schedules where today's day is in days_of_week
  const dueSchedules = schedules.filter((s) => {
    const days = Array.isArray(s.days_of_week) ? s.days_of_week : [];
    return days.includes(todayDay);
  });

  if (dueSchedules.length === 0) {
    console.log(`[email-cron] No schedules due on ${todayDay}.`);
    return;
  }

  console.log(`[email-cron] ${dueSchedules.length} schedule(s) due today.`);

  for (const schedule of dueSchedules) {
    const { scheduled_emails_id, subject, body } = schedule;
    console.log(`[email-cron] Processing schedule ${scheduled_emails_id} | days: ${JSON.stringify(schedule.days_of_week)}`);

    // 3. Fetch ALL log rows for this schedule (we need status to decide)
    const { data: pendingLogs, error: logErr } = await supabase
      .from('email_dispatch_log')
      .select('email_dispatch_log_id, email_id, user_id, status, attempted_at')
      .eq('scheduled_emails', scheduled_emails_id);

    if (logErr) {
      console.error(`[email-cron] Failed to fetch log rows for ${scheduled_emails_id}:`, logErr.message);
      continue;
    }

    if (!pendingLogs || pendingLogs.length === 0) {
      console.log(`[email-cron] No log rows found for schedule ${scheduled_emails_id}.`);
      continue;
    }

    console.log(`[email-cron] ${pendingLogs.length} log row(s) found. Checking which need sending…`);
    pendingLogs.forEach((log) => {
      const skip = alreadySentToday(log, todayStr);
      console.log(`[email-cron]   email=${log.email_id} status=${log.status} attempted_at=${log.attempted_at} → ${skip ? 'SKIP (sent today)' : 'SEND'}`);
    });

    // Filter: skip only rows that were already SUCCESSFULLY sent today
    const toSend = pendingLogs.filter((log) => !alreadySentToday(log, todayStr));

    if (toSend.length === 0) {
      console.log(`[email-cron] All recipients for schedule ${scheduled_emails_id} already handled today.`);
      continue;
    }

    console.log(`[email-cron] Sending to ${toSend.length} recipient(s) for schedule ${scheduled_emails_id}…`);

    // 4. Send and update log per recipient
    for (const log of toSend) {
      const recipientEmail = log.email_id;
      if (!recipientEmail) {
        console.warn(`[email-cron] Log row ${log.email_dispatch_log_id} has no email_id — skipping.`);
        continue;
      }

      let sendStatus = 'sent';
      let errorMsg = null;

      try {
        await transporter.sendMail({
          from: FROM_EMAIL,
          to: recipientEmail,
          subject,
          html: body,
        });
        console.log(`[email-cron]   ✓ Sent to ${recipientEmail}`);
      } catch (sendErr) {
        sendStatus = 'failed';
        errorMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        console.error(`[email-cron]   ✗ Failed to send to ${recipientEmail}: ${errorMsg}`);
      }

      // 5. Update the log row
      const { error: updateErr } = await supabase
        .from('email_dispatch_log')
        .update({
          status: sendStatus,
          attempted_at: new Date().toISOString(),
          error_message: errorMsg,
        })
        .eq('email_dispatch_log_id', log.email_dispatch_log_id);

      if (updateErr) {
        console.error(`[email-cron]   Could not update log row ${log.email_dispatch_log_id}:`, updateErr.message);
      }
    }
  }
}

// ── Startup ───────────────────────────────────────────────────

console.log('[email-cron] Starting. Poll interval:', POLL_INTERVAL_MS / 1000, 's');
console.log('[email-cron] SMTP:', SMTP_HOST + ':' + SMTP_PORT, '| From:', FROM_EMAIL);

// Run once immediately, then on the interval
pollAndSend().catch((e) => console.error('[email-cron] Unhandled error on first poll:', e));
setInterval(() => {
  pollAndSend().catch((e) => console.error('[email-cron] Unhandled error during poll:', e));
}, POLL_INTERVAL_MS);
