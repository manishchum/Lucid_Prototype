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
  // Convert current time to IST
  const nowIST = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );

  const nowHHMM = nowIST.toTimeString().slice(0, 5); // HH:mm
  const schedHHMM = scheduledTime.slice(0, 5);
  console.log(`Comparing times - Now (IST): ${nowHHMM}, Schedule: ${schedHHMM}`);
  return nowHHMM === schedHHMM;
}

function isTodayMatch(schedule, now) {
  if (schedule.schedule_type === 'one_time') {
    if (!schedule.scheduled_date) return false;
    const today = now.toISOString().slice(0, 10);
    return schedule.scheduled_date === today;
  }

  // recurring


  console.log(`Schedule ${schedule.scheduled_whatsapp_id} days_of_week:`, schedule.days_of_week);
  const day = now.getUTCDay(); // 0–6
  return (schedule.days_of_week || []).includes(day);
}

function canRetry(dispatch) {
  return dispatch.retry_count < dispatch.max_retries;
}

async function getUserNameById(userId) {
  if (!userId) return 'there';

  const { data, error } = await supabase
    .from('users')
    .select('name')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error(`[whatsapp-cron] Failed to fetch user name for ${userId}:`, error.message);
    return 'there';
  }

  const name = (data?.name || '').trim();
  return name || 'there';
}

function extractAudioPath(url) {
  if (!url) return null;

  const marker = '/module_audio/module-audio/';
  const index = url.indexOf(marker);

  if (index === -1) return null;

  return url.substring(index + marker.length);
}
function extractVideoPath(url) {
  if (!url) return null;

  const marker = '/module-visuals/';
  const index = url.indexOf(marker);

  if (index === -1) return null;

  return url.substring(index + marker.length);
}

function extractModuleName(message) {
  if (!message) return null;

  const match = message.match(/\*?Module:\*?\s*(.+)/i);

  if (!match) return null;

  return match[1]
    .split('\n')[0]     // stop at next line
    .replace(/\*/g, '') // remove any leftover *
    .trim();
}






// ── WhatsApp Sender ───────────────────────────────────────────

async function sendWhatsApp(dispatch, schedule, userName) {
  const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  // let payload = {
  //   messaging_product: 'whatsapp',
  //   to: dispatch.phone_number,
  // };

  // // TEXT MESSAGE
  // if (!schedule.media_url) {
  //   payload.type = 'text';
  //   payload.text = { body: schedule.message_body };
  // } else {
  //   // MEDIA MESSAGE
  //   payload.type = schedule.media_type;

  //   payload[schedule.media_type] = {
  //     link: schedule.media_url,
  //     caption: schedule.message_body || undefined,
  //   };
  // }


//   let payload = {
//   messaging_product: 'whatsapp',
//   to: dispatch.phone_number,
//   type: 'template',
//   template: {
//     name: 'testing', // use your approved template
//     language: { code: 'en' },
//   },
// };



console.log(schedule)
console.log(schedule.message_body)


//  let payload = {
//   messaging_product: 'whatsapp',
//   to: dispatch.phone_number,
//   type: 'template',
//   template: {
//     name: 'testing',
//     language: { code: 'en' }, // make sure this matches EXACT template language (often 'en_US')
//     components: [
//       {
//         type: 'body',
//         parameters: [

//           {
//             type: 'text',
//             parameter_name:'username',
//             text: userName

//           },
//           {
//             type: 'text',
//             parameter_name:'contentofbody',
//             text: schedule.message_body || 'Default body content'
//           }
          
//         ]
//       }
//     ]
//   }
// };






// let payload = {
//   messaging_product: 'whatsapp',
//   to: dispatch.phone_number,
//   type: 'template',
//   template: {
//     name: 'lucidwhatsapp',
//     language: { code: 'en' }, // 🔥 MUST match exactly

//     components: [
//       // ✅ BODY PARAM (username)
//       {
//         type: 'body',
//         parameters: [
//           {
//             type: 'text',
//             parameter_name: 'username', // 🔥 MUST match EXACT placeholder name in template
//             text: userName || 'Learner'
//           },
//           {
//             type: 'text',
//             parameter_name: 'content', // 🔥 MUST match EXACT placeholder name in template
//             text: schedule.message_body || 'Default body content'

//           }
//         ]
//       },

//       // ✅ BUTTON PARAM (for dynamic URL)
//       {
//         type: 'button',
//         sub_type: 'url',
//         index: '1', // ⚠️ second button (0-based index)
//         parameters: [
//           {
//             type: 'text',
//             text: "e8be8e06-de88-4408-8af9-b43408926590/e3fd2afc-b24e-4cff-bbda-e8b8be4e9d19.wav"
//           }
//         ]
//       }
//     ]
//   }
// };





const audioPath = extractAudioPath(schedule.media_url);
const moduleName = extractModuleName(schedule.message_body);


console.log("Audio Path",audioPath)
console.log("Module Name",moduleName)
if (!audioPath) {
  console.warn('Invalid audio URL:', schedule.media_url);
}
let payload = {
  messaging_product: 'whatsapp',
  to: dispatch.phone_number,
  type: 'template',
  template: {
    name: 'workflowwwhatsapp',
    language: { code: 'en' },

    components: [
      {
        type: 'body',
        parameters: [
          {
            type: 'text',
            parameter_name: 'username',
            text: userName || 'Learner'
          },
          {
            type: 'text',
            parameter_name: 'content',
            text: moduleName || 'Default body content'
          }
        ]
      },

      {
        type: 'button',
        sub_type: 'url',
        index: '1',
        parameters: [
          {
            type: 'text',
            text: audioPath
          }
        ]
      }
    ]
  }
};








// let videoPath = "https://fmkikkebrxyzjsffqgex.supabase.co/storage/v1/object/public/module-visuals/80aa6778-8475-4243-9e4a-9a6af5931e74/4036939b-4b9c-40f7-b2aa-7521d157a38a_notebooklm_video.mp4";
let videoPath = "80aa6778-8475-4243-9e4a-9a6af5931e74/4036939b-4b9c-40f7-b2aa-7521d157a38a_notebooklm_video.mp4";

let videoPathExtracted = extractVideoPath(schedule.media_url);
console.log("Video Path",videoPath)
console.log("Module Name",moduleName)
if (!videoPath) {
  console.warn('Invalid video URL:', schedule.media_url);
}
let payload2 = {
  messaging_product: 'whatsapp',
  to: dispatch.phone_number,
  type: 'template',
  template: {
    name: 'lucidwhatsapp',
    language: { code: 'en' },

    components: [
      {
        type: 'body',
        parameters: [
          {
            type: 'text',
            parameter_name: 'username',
            text: userName || 'Learner'
          },
          {
            type: 'text',
            parameter_name: 'content',
            text: moduleName || 'Default body content'
          }
        ]
      },

      {
        type: 'button',
        sub_type: 'url',
        index: '1',
        parameters: [
          {
            type: 'text',
            text: videoPath
          }
        ]
      }
    ]
  }
};



// let payload = {
//   messaging_product: 'whatsapp',
//   to: dispatch.phone_number,
//   type: 'template',
//   template: {
//     name: 'lucid',
//     language: { code: 'en' }, // 🔥 MUST match exactly

//     components: [
//       // ✅ BODY PARAM (username)
//       {
//         type: 'body',
//         parameters: [
//           {
//             type: 'text',
//             parameter_name: 'username', // 🔥 MUST match EXACT placeholder name in template
//             text: userName || 'Learner'
//           },
//           {
//             type: 'text',
//             parameter_name: 'content_of_body', // 🔥 MUST match EXACT placeholder name in template
//             text: schedule.message_body || 'Default body content'

//           }
//         ]
//       },

//       // ✅ BUTTON PARAM (for dynamic URL)
//       {
//         type: 'button',
//         sub_type: 'url',
//         index: '1', // ⚠️ second button (0-based index)
//         parameters: [
//           {
//             type: 'text',
//             text: "https://fmkikkebrxyzjsffqgex.supabase.co/storage/v1/object/public/module_audio/module-audio/e8be8e06-de88-4408-8af9-b43408926590/e3fd2afc-b24e-4cff-bbda-e8b8be4e9d19.wav"
//           }
//         ]
//       }
//     ]
//   }
// };
  console.log("Sending the request to the meta")
  console.log(payload)
  console.log(url)
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
        console.log("Stuck Here")
        const userName = await getUserNameById(dispatch.user_id);
        const res = await sendWhatsApp(dispatch, schedule, userName);


        messageId = res?.messages?.[0]?.id || null;
        console.log(res)

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