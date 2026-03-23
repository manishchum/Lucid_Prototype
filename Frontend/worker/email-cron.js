/**
 * email-cron.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Email dispatch worker for one-time and recurring schedules.
 *
 * Run from the repo root or the Frontend/ folder:
 *   node Frontend/worker/email-cron.js
 *
 * What it does every POLL_INTERVAL_MS (default 90 s):
 *  
 *  FOR ONE-TIME SCHEDULES:
 *   1. Fetch rows from `scheduled_emails` with schedule_type='one_time'
 *   2. Check if scheduled_date=TODAY and scheduled_time <= NOW
 *   3. Send to all recipient_emails
 *   4. Update status='sent' and set sent_at timestamp
 *
 *  FOR RECURRING SCHEDULES:
 *   1. Fetch rows from `scheduled_emails` with schedule_type='recurring'
 *   2. Check if today's day-of-week is in each row's `days_of_week` array.
 *   3. Check if scheduled_time <= NOW (time to send)
 *   4. Find all `email_dispatch_log` rows whose status is 'pending'
 *   5. Send the email via SMTP.
 *   6. Update each log row to 'sent' (or 'failed' on error).
 *
 * Tables used:
 *   scheduled_emails(scheduled_email_id, company_id, subject, body, recipient_emails,
 *                    schedule_type, scheduled_date, scheduled_time, days_of_week,
 *                    status, retry_count, created_at, sent_at)
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
  const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;

  console.log(`[email-cron] Polling at ${now.toISOString()} | today = ${todayDay} (${todayStr}) | time = ${currentTime}`);

  try {
    // ════════════════════════════════════════════════════════════════════════════
    // PART 1: HANDLE ONE-TIME SCHEDULES
    // ════════════════════════════════════════════════════════════════════════════
    console.log('[email-cron] ── Checking ONE-TIME schedules ──');
    
    const { data: oneTimeSchedules, error: oneTimeErr } = await supabase
      .from('scheduled_emails')
      .select('scheduled_email_id, subject, body, recipient_emails, scheduled_date, scheduled_time, status')
      .eq('schedule_type', 'one_time')
      .eq('status', 'pending')
      .eq('is_active', true);

    if (oneTimeErr) {
      console.error('[email-cron] Failed to fetch one-time schedules:', oneTimeErr.message);
    } else if (oneTimeSchedules && oneTimeSchedules.length > 0) {
      console.log(`[email-cron] Found ${oneTimeSchedules.length} one-time schedule(s).`);

      for (const schedule of oneTimeSchedules) {
        const { scheduled_email_id, subject, body, recipient_emails, scheduled_date, scheduled_time } = schedule;
        
        // Check if this schedule is due NOW
        if (scheduled_date === todayStr && currentTime >= scheduled_time) {
          console.log(`[email-cron] ✓ One-time schedule ${scheduled_email_id} is DUE | sending to ${recipient_emails?.length || 0} recipients`);
          
          let sentCount = 0;
          let failedCount = 0;

          // Send to all recipients
          for (const recipientEmail of (recipient_emails || [])) {
            try {
              await transporter.sendMail({
                from: FROM_EMAIL,
                to: recipientEmail,
                subject,
                html: body,
              });
              console.log(`[email-cron]   ✓ Sent to ${recipientEmail}`);
              sentCount++;
            } catch (sendErr) {
              const errorMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
              console.error(`[email-cron]   ✗ Failed to send to ${recipientEmail}: ${errorMsg}`);
              failedCount++;
              
              // Update retry count
              const { data: current } = await supabase
                .from('scheduled_emails')
                .select('retry_count, max_retries')
                .eq('scheduled_email_id', scheduled_email_id)
                .single();

              if (current) {
                const newRetryCount = (current.retry_count || 0) + 1;
                const maxRetries = current.max_retries || 3;
                
                await supabase
                  .from('scheduled_emails')
                  .update({
                    retry_count: newRetryCount,
                    last_error: errorMsg,
                    last_attempt_at: new Date().toISOString(),
                    status: newRetryCount >= maxRetries ? 'failed' : 'pending',
                  })
                  .eq('scheduled_email_id', scheduled_email_id);
              }
            }
          }

          // Mark as sent if all successful
          if (failedCount === 0) {
            await supabase
              .from('scheduled_emails')
              .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
              })
              .eq('scheduled_email_id', scheduled_email_id);
            console.log(`[email-cron]   ✓ Updated status to 'sent' | sent=${sentCount}, failed=${failedCount}`);
          } else {
            console.log(`[email-cron]   ⚠️  Partial failure | sent=${sentCount}, failed=${failedCount}`);
          }
        } else {
          const dueAt = `${scheduled_date} ${scheduled_time}`;
          console.log(`[email-cron] ⏳ One-time schedule ${scheduled_email_id} not yet due | due at ${dueAt}`);
        }
      }
    } else {
      console.log('[email-cron] No pending one-time schedules found.');
    }

    // ════════════════════════════════════════════════════════════════════════════
    // PART 2: HANDLE RECURRING SCHEDULES (original logic)
    // ════════════════════════════════════════════════════════════════════════════
    console.log('[email-cron] ── Checking RECURRING schedules ──');

    const { data: recurringSchedules, error: recurringErr } = await supabase
      .from('scheduled_emails')
      .select('scheduled_email_id, subject, body, days_of_week, scheduled_time, status')
      .eq('schedule_type', 'recurring')
      .eq('status', 'pending')
      .eq('is_active', true);

    if (recurringErr) {
      console.error('[email-cron] Failed to fetch recurring schedules:', recurringErr.message);
      return;
    }

    if (!recurringSchedules || recurringSchedules.length === 0) {
      console.log('[email-cron] No pending recurring schedules found.');
      return;
    }

    // Filter schedules where: (1) today's day is in days_of_week AND (2) current time >= scheduled_time
    const dueRecurringSchedules = recurringSchedules.filter((s) => {
      const days = Array.isArray(s.days_of_week) ? s.days_of_week : [];
      const dayMatch = days.includes(todayDay);
      const timeMatch = currentTime >= s.scheduled_time;
      return dayMatch && timeMatch;
    });

    if (dueRecurringSchedules.length === 0) {
      console.log(`[email-cron] No recurring schedules due at this time on ${todayDay}.`);
      return;
    }

    console.log(`[email-cron] ${dueRecurringSchedules.length} recurring schedule(s) due today.`);

    for (const schedule of dueRecurringSchedules) {
      const { scheduled_email_id, subject, body } = schedule;
      console.log(`[email-cron] Processing recurring schedule ${scheduled_email_id} | days: ${JSON.stringify(schedule.days_of_week)}`);

      // 3. Fetch ALL log rows for this schedule
      const { data: pendingLogs, error: logErr } = await supabase
        .from('email_dispatch_log')
        .select('email_dispatch_log_id, email_id, user_id, status, attempted_at')
        .eq('scheduled_emails', scheduled_email_id);

      if (logErr) {
        console.error(`[email-cron] Failed to fetch log rows for ${scheduled_email_id}:`, logErr.message);
        continue;
      }

      if (!pendingLogs || pendingLogs.length === 0) {
        console.log(`[email-cron] No log rows found for schedule ${scheduled_email_id}.`);
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
        console.log(`[email-cron] All recipients for schedule ${scheduled_email_id} already handled today.`);
        continue;
      }

      console.log(`[email-cron] Sending to ${toSend.length} recipient(s) for schedule ${scheduled_email_id}…`);

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

    console.log('[email-cron] ─────────────────────────────────────');
  } catch (err) {
    console.error('[email-cron] Unhandled error in pollAndSend:', err);
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
