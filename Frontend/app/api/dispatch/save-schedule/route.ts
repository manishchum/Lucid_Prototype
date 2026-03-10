import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use service-role key so we can insert without RLS restrictions
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface RecipientEntry {
  user_id: string;
  email: string;
}

interface SaveScheduleBody {
  company_id: string;
  subject: string;
  body: string;
  days_of_week: string[];          // e.g. ["Mon", "Wed", "Fri"]
  scheduled_time: string;          // "HH:MM" UTC
  recipient_user_ids: RecipientEntry[];
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as SaveScheduleBody;

    const { company_id, subject, body, days_of_week, scheduled_time, recipient_user_ids } = payload;

    // ── Validation ────────────────────────────────────────────
    if (!company_id) {
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 });
    }
    if (!subject || !body) {
      return NextResponse.json({ error: 'subject and body are required' }, { status: 400 });
    }
    if (!Array.isArray(days_of_week) || days_of_week.length === 0) {
      return NextResponse.json({ error: 'days_of_week must be a non-empty array' }, { status: 400 });
    }
    if (!scheduled_time) {
      return NextResponse.json({ error: 'scheduled_time is required' }, { status: 400 });
    }
    if (!Array.isArray(recipient_user_ids) || recipient_user_ids.length === 0) {
      return NextResponse.json({ error: 'recipient_user_ids must be a non-empty array' }, { status: 400 });
    }

    // ── Build scheduled_at ────────────────────────────────────
    // scheduled_time comes from the UI time picker in the user's LOCAL timezone
    // (IST = UTC+5:30). We convert it to UTC so the cron (which runs in UTC) can
    // compare correctly.
    // We also store the raw scheduled_time string in the row so the cron can
    // use it for HH:MM matching without timezone confusion.
    const [hh, mm] = scheduled_time.split(':').map(Number);
    const now = new Date();
    // Build a local-calendar date at the chosen HH:MM, then store as UTC ISO.
    // new Date(year, month, day, hh, mm) uses the server's local timezone —
    // to be explicit we always treat the input as UTC (the cron uses UTC day names
    // and the UI now labels the picker "UTC").
    const scheduledAt = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm, 0),
    );

    // ── 1. Insert into scheduled_emails ──────────────────────
    const { data: scheduleRow, error: scheduleErr } = await supabase
      .from('scheduled_emails')
      .insert({
        company_id,
        subject,
        body,
        days_of_week,                // stored as JSONB array
        scheduled_at: scheduledAt.toISOString(),
      })
      .select('scheduled_emails_id')
      .single();

    if (scheduleErr || !scheduleRow) {
      console.error('[save-schedule] scheduled_emails insert error:', scheduleErr);
      return NextResponse.json(
        { error: scheduleErr?.message ?? 'Failed to save schedule' },
        { status: 500 },
      );
    }

    const scheduled_emails_id: string = scheduleRow.scheduled_emails_id;

    // ── 2. Insert a log row per recipient ─────────────────────
    const logRows = recipient_user_ids.map((r) => ({
      scheduled_emails: scheduled_emails_id,
      user_id: r.user_id,
      email_id: r.email,
      status: 'pending',
    }));

    const { error: logErr } = await supabase
      .from('email_dispatch_log')
      .insert(logRows);

    if (logErr) {
      // Non-fatal — log but still return success with the schedule ID
      console.error('[save-schedule] email_dispatch_log insert error:', logErr);
    }

    return NextResponse.json({
      status: 'saved_recurring',
      scheduled_emails_id,
      days_of_week,
      scheduled_time,
      recipient_count: recipient_user_ids.length,
    });
  } catch (err: any) {
    console.error('[save-schedule] unexpected error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}
