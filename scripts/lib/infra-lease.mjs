/**
 * PRIOR ART: scripts/maintenance/gpu-lease-watchdog.mjs — the lease vocabulary (`lease-until=`,
 * `owner=`) and the 6 h nag, but only for Scaleway GPU types; scripts/lib/gpu-idle.mjs — idleness
 * by OUTPUT for a leased GPU it may power off. Neither covers a Hetzner server or a Scaleway CPU
 * instance, and neither may be reused as-is: those are never powered off by a machine (a stopped
 * Hetzner server still bills; deletion destroys data). This module is the FLAG-ONLY rule table.
 *
 * infra-lease — which always-on servers are costing money for nothing?
 *
 * WHY (2026-10-04). ~€298/month of Hetzner servers (sl-reocr-1/2/3 cax41 + sl-reocr-x86 cpx62)
 * sat idle for 20 days after their job (#4523) moved to leased GPUs. Nothing watched them (#5736).
 *
 * Lease grammar — Hetzner LABELS (key=value) or Scaleway TAGS ("key=value" strings):
 *   role=permanent              never flagged (clawdbot, earthai-live, ...)
 *   lease-until=<ISO>           flagged once it has passed
 *   owner=<issue>               who to ask; shown on the flag
 * No lease and not permanent → flagged. Leased, running, up ≥ 24 h, CPU < 5 % over 24 h → idle.
 * Hetzner labels cannot hold ':' — `lease-until=2026-10-10` or `2026-10-10T18-00-00Z` are accepted.
 */

export const IDLE_CPU_PCT = 5;
export const IDLE_WINDOW_H = 24;
const HOURS_PER_MONTH = 730;

/** Scaleway tags ["k=v", ...] or Hetzner labels {k: v} → {k: v}. */
export function leaseLabels(tagsOrLabels) {
  if (Array.isArray(tagsOrLabels)) {
    return Object.fromEntries(tagsOrLabels.filter(t => typeof t === 'string' && t.includes('='))
      .map(t => { const i = t.indexOf('='); return [t.slice(0, i), t.slice(i + 1)]; }));
  }
  return { ...(tagsOrLabels || {}) };
}

/** A lease date. Accepts full ISO, a bare date (end of that day UTC), and a label-safe time with '-' for ':'. */
export function parseLeaseUntil(v) {
  if (!v) return null;
  let s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T23:59:59Z';
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})(?:-(\d{2}))?(Z?)$/.exec(s);
  if (m) s = `${m[1]}T${m[2]}:${m[3]}:${m[4] || '00'}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * The rule table. One server → skip | ok | flag.
 * @param {object} p
 * @param {object} p.labels        leaseLabels() output
 * @param {boolean} p.running      provider state is running
 * @param {Date}   p.since         when it was created (Hetzner) or entered its state (Scaleway)
 * @param {Date}   p.now
 * @param {number|null} [p.cpuPct] mean CPU over the last IDLE_WINDOW_H, % of the whole server; null = unknown
 * @param {boolean} [p.checkCpu]   false for providers we do not read metrics from
 * @returns {{ action: 'skip'|'ok'|'flag', kind?: 'no-lease'|'bad-lease'|'expired'|'idle', reason: string }}
 */
export function leaseVerdict({ labels, running, since, now, cpuPct = null, checkCpu = true }) {
  if (labels.role === 'permanent') return { action: 'skip', reason: 'role=permanent' };
  if (!labels['lease-until']) return { action: 'flag', kind: 'no-lease', reason: 'no lease-until and not role=permanent' };
  const until = parseLeaseUntil(labels['lease-until']);
  if (!until) return { action: 'flag', kind: 'bad-lease', reason: `unreadable lease-until "${labels['lease-until']}"` };
  if (until <= now) return { action: 'flag', kind: 'expired', reason: `lease ended ${fmtAge(now - until)} ago (${until.toISOString().slice(0, 16)}Z)` };
  const left = `lease ${fmtAge(until - now)} left`;
  if (!running || !checkCpu) return { action: 'ok', reason: left };
  if (now - since < IDLE_WINDOW_H * 3.6e6) return { action: 'ok', reason: `${left}, up < ${IDLE_WINDOW_H} h` };
  if (cpuPct == null) return { action: 'ok', reason: `${left}, CPU unknown` };
  if (cpuPct < IDLE_CPU_PCT) return { action: 'flag', kind: 'idle', reason: `${left} but CPU ${cpuPct.toFixed(1)} % over ${IDLE_WINDOW_H} h (< ${IDLE_CPU_PCT} %)` };
  return { action: 'ok', reason: `${left}, CPU ${cpuPct.toFixed(1)} %` };
}

/** "5.2 h", "3 d". */
export function fmtAge(ms) {
  const h = ms / 3.6e6;
  return h < 48 ? `${h.toFixed(1)} h` : `${Math.round(h / 24)} d`;
}

/** Hetzner list price for this server's type at its location, €/month net. null when not listed. */
export function hetznerMonthlyEur(server) {
  const loc = server?.datacenter?.location?.name ?? server?.location?.name;
  const prices = server?.server_type?.prices ?? [];
  const p = prices.find(x => x.location === loc) ?? prices[0];
  const v = Number(p?.price_monthly?.net ?? p?.price_monthly?.gross);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

/** Scaleway product entry → €/month (monthly_price, else hourly × 730). */
export function scalewayMonthlyEur(product) {
  if (!product) return null;
  if (Number.isFinite(product.monthly_price)) return Math.round(product.monthly_price * 100) / 100;
  if (Number.isFinite(product.hourly_price)) return Math.round(product.hourly_price * HOURS_PER_MONTH * 100) / 100;
  return null;
}

/**
 * Mean CPU over a Hetzner metrics series, as % of the WHOLE server. Hetzner's `cpu` series is the
 * percentage of one core summed over cores (a busy 16-vCPU cax41 reads ~1600), so it is divided by
 * the core count. If that reading is ever wrong, the error flags a busy server as idle — a false
 * email, never a missed one, and nothing is stopped either way.
 */
export function meanCpuPct(values, cores) {
  const xs = (values || []).map(v => Number(Array.isArray(v) ? v[1] : v)).filter(Number.isFinite);
  if (!xs.length) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return mean / Math.max(1, Number(cores) || 1);
}

/** One line per flag, for the email and the log. */
export function flagLine(f) {
  return [
    `${f.name} (${f.provider} ${f.type}${f.location ? `, ${f.location}` : ''})`,
    f.eur_month != null ? `€${f.eur_month.toFixed(2)}/month` : '€?/month',
    f.status,
    f.age_days != null ? `age ${f.age_days} d` : null,
    f.cpu_24h != null ? `CPU ${f.cpu_24h.toFixed(1)} % (24 h)` : null,
    f.owner ? `owner ${f.owner}` : null,
    `${f.kind.toUpperCase()}: ${f.reason}`,
  ].filter(Boolean).join(' · ');
}
