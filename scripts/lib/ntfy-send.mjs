// PRIOR ART: scripts/lib/quality-gate.mjs (exports NTFY_TOPIC only), scripts/maintenance/ntfy-morning-digest.mjs (own fetch) — no shared sender existed; 40+ scripts each called fetch() on the topic directly.
//
// ntfyPost(url, init): drop-in for `fetch(topic, { method:'POST', headers, body })` that makes the
// alarm self-locating. Why: on 2026-10-27 two pages ("vector-service-down", "pipeline-stalled")
// could not be traced to a script, and ntfy keeps only ~12 h.
//   1. appends "— src: <script>@<host>" to the message body;
//   2. appends one JSONL line to the alarm log (ALARM_LOG, else /var/log/sourcelibrary/alarms.jsonl,
//      else ~/.sourcelibrary/alarms.jsonl). Logging failure is swallowed: an alarm never fails
//      because logging did.
// Returns the fetch Response, so callers that check `res.ok` keep working. Thresholds and wording
// are untouched. Shell equivalent: scripts/workers/ntfy-send.sh.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_ALARM_LOG = '/var/log/sourcelibrary/alarms.jsonl';

export function srcTag(src) {
  const script = src || (process.argv[1] ? path.basename(process.argv[1]) : 'unknown');
  return `${script}@${os.hostname()}`;
}

export function logAlarm(entry, logPath) {
  const candidates = logPath
    ? [logPath]
    : [process.env.ALARM_LOG, DEFAULT_ALARM_LOG, path.join(os.homedir(), '.sourcelibrary', 'alarms.jsonl')].filter(Boolean);
  for (const p of candidates) {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.appendFileSync(p, JSON.stringify(entry) + '\n');
      return p;
    } catch { /* try next; never throw */ }
  }
  return null;
}

export async function ntfyPost(url, init = {}, opts = {}) {
  const tag = srcTag(opts.src);
  const headers = init.headers || {};
  const body = init.body == null ? '' : String(init.body);
  try {
    logAlarm({
      at: new Date().toISOString(), src: tag, topic: String(url).split('/').pop(),
      title: headers.Title ?? headers.title ?? null, priority: headers.Priority ?? headers.priority ?? null,
      body: body.slice(0, 500),
    }, opts.logPath);
  } catch { /* never block the alarm */ }
  return (opts.fetchImpl || fetch)(url, { ...init, method: 'POST', body: `${body}\n— src: ${tag}` });
}
