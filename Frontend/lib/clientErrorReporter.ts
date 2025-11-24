const LOG_ENDPOINT = '/api/logs';
const MAX_MSG_LEN = 3000;
const MAX_STACK_LEN = 10000;

function send(payload: any) {
  try {
    const body = JSON.stringify(payload);
    if (navigator && (navigator as any).sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      (navigator as any).sendBeacon(LOG_ENDPOINT, blob);
      return;
    }
    fetch(LOG_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch (e) {
    // swallow
  }
}

function parseUA() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return { ua, platform };
}

export function initClientErrorReporting(opts: { includeEmail?: () => string | null } = {}) {
  // Dedup map to avoid flooding with the same error repeatedly.
  // key -> { ts: number, count: number }
  const dedupeMap = new Map<string, { ts: number; count: number }>();
  const DEDUPE_WINDOW_MS = 30_000; // suppress duplicates for 30s by default
  const MAX_REPEAT = 6; // allow up to 6 repeats within window before suppressing

  function shouldSend(key: string) {
    const now = Date.now();
    const entry = dedupeMap.get(key);
    if (!entry) {
      dedupeMap.set(key, { ts: now, count: 1 });
      return true;
    }
    // if within window
    if (now - entry.ts < DEDUPE_WINDOW_MS) {
      entry.count += 1;
      // update map
      dedupeMap.set(key, entry);
      return entry.count <= MAX_REPEAT;
    }
    // window expired -> reset
    dedupeMap.set(key, { ts: now, count: 1 });
    return true;
  }

  function getEmailFallback() {
    try {
      if (opts && opts.includeEmail) {
        const v = opts.includeEmail();
        if (v) return v;
      }
    } catch (e) {}
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem('__CURRENT_USER_EMAIL__') : null; } catch (e) { return null; }
  }

  window.addEventListener('error', (ev) => {
    try {
      if (ev instanceof ErrorEvent) {
        const key = `ErrorEvent|${(ev.message || '')}|${(ev.filename || '')}`;
        if (!shouldSend(key)) return;
        const { ua, platform } = parseUA();
        send({
          email_id: getEmailFallback(),
          error: (ev.message || '').slice(0, MAX_MSG_LEN),
          stack_trace: ev.error ? String(ev.error.stack || '').slice(0, MAX_STACK_LEN) : null,
          error_type: 'ErrorEvent',
          browser: ua,
          os: platform,
          device: platform,
          action: document.title || null,
          page_url: location.href,
        });
      } else if ((ev as any).target) {
        const t: any = ev.target;
        const resourceId = (t.src || t.href || t.localName || '');
        const key = `ResourceError|${resourceId}`;
        if (!shouldSend(key)) return;
        const { ua, platform } = parseUA();
        send({
          email_id: getEmailFallback(),
          error: `Resource failed: ${t.tagName}`,
          stack_trace: null,
          error_type: 'ResourceError',
          browser: ua,
          os: platform,
          device: platform,
          action: (t.src || t.href) || null,
          page_url: location.href,
        });
      }
    } catch (e) {}
  }, true);

  window.addEventListener('unhandledrejection', (ev) => {
    try {
      const reason = (ev as any).reason;
      const key = reason && (reason.stack || reason.message) ? String(reason.stack || reason.message) : JSON.stringify(reason);
      if (!shouldSend(String(key))) return;
      const { ua, platform } = parseUA();
      send({
        email_id: getEmailFallback(),
        error: (reason?.message || String(reason)).slice(0, MAX_MSG_LEN),
        stack_trace: reason?.stack ? String(reason.stack).slice(0, MAX_STACK_LEN) : null,
        error_type: 'UnhandledRejection',
        browser: ua,
        os: platform,
        device: platform,
        action: document.title || null,
        page_url: location.href,
      });
    } catch (e) {}
  });

  // optional: wrap fetch to capture server errors
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args: any[]) => {
    try {
      const res = await origFetch(...args);
      if (!res.ok && res.status >= 400) {
        const { ua, platform } = parseUA();
        const url = (args && args[0]) || res.url;
        // build a dedupe key that includes url and status so repeated 404s for same url are suppressed
        const key = `FetchError|${String(url)}|${res.status}`;
        if (shouldSend(key)) {
          // Optionally, only log server errors (>=500). For now we log 4xx too but deduped.
          send({
            email_id: getEmailFallback(),
            error: `Fetch failed ${res.status} ${res.statusText}`,
            stack_trace: null,
            error_type: 'FetchError',
            browser: ua,
            os: platform,
            device: platform,
            action: String(url),
            page_url: location.href,
          });
        }
      }
      return res;
    } catch (err) {
      const { ua, platform } = parseUA();
      const key = `FetchException|${JSON.stringify(args)}`;
      if (shouldSend(key)) {
        send({
          email_id: getEmailFallback(),
          error: (err?.message || String(err)).slice(0, MAX_MSG_LEN),
          stack_trace: err?.stack ? String(err.stack).slice(0, MAX_STACK_LEN) : null,
          error_type: 'FetchException',
          browser: ua,
          os: platform,
          device: platform,
          action: JSON.stringify(args),
          page_url: location.href,
        });
      }
      throw err;
    }
  };
}
