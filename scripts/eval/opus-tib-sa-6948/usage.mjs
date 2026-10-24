#!/usr/bin/env node
// PRIOR ART: claude-translate.mjs writes calls.jsonl (per call: pages, secs, usage tokens, list_cost_usd); the climits
// meter (/root/.claude-limits/latest.json) gives the account's %. Nothing joins them per arm; this does, $0.
/**
 * usage.mjs DIR... [--meter-start=F --meter-end=F]  — per read dir: calls, pages read, tokens and list-price
 * equivalent per 100 pages, seconds per page. With two meter snapshots, the weekly and 5-hour % moved over the window
 * is split across the dirs by their list-price share, giving "% of the week per 100 pages" per dir. The meter also
 * counts every other use of the account in the window (this job's own session included), so that figure is an
 * upper bound.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dirs = args.filter((a) => !a.startsWith('--'));
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const rows = dirs.map((d) => {
  const calls = fs.existsSync(path.join(d, 'calls.jsonl')) ? fs.readFileSync(path.join(d, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const pages = fs.readdirSync(d).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))).filter((m) => m.exit === 0).length;
  const sum = (f) => calls.reduce((s, c) => s + (f(c) || 0), 0);
  return { dir: path.basename(d), calls: calls.length, refused_calls: calls.filter((c) => c.cls).length, pages_ok: pages,
    list_usd: +sum((c) => c.usage?.list_cost_usd).toFixed(2), out_tokens: sum((c) => c.usage?.output), in_tokens: sum((c) => (c.usage?.input || 0) + (c.usage?.cache_read || 0) + (c.usage?.cache_creation || 0)), secs: sum((c) => c.secs) };
});
let meter = null;
if (opt('meter-start') && opt('meter-end')) {
  const acct = (f) => { const m = JSON.parse(fs.readFileSync(f, 'utf8')); const email = JSON.parse(fs.readFileSync(`${process.env.HOME}/.claude.json`, 'utf8')).oauthAccount.emailAddress; const a = m.accounts.find((x) => x.email === email); const g = (k) => a.limits.find((l) => l.key === k)?.percent; return { at: m.checked_at, weekly: g('weekly_all:all'), session: g('session:all'), sessionReset: a.limits.find((l) => l.key === 'session:all')?.resets_at }; };
  meter = { start: acct(opt('meter-start')), end: acct(opt('meter-end')) };
  meter.weekly_delta = meter.end.weekly - meter.start.weekly;
}
const totalUsd = rows.reduce((s, r) => s + r.list_usd, 0);
for (const r of rows) {
  const per = (x) => (r.pages_ok ? +(x * 100 / r.pages_ok).toFixed(2) : null);
  Object.assign(r, { list_usd_per_100p: per(r.list_usd), out_tokens_per_page: r.pages_ok ? Math.round(r.out_tokens / r.pages_ok) : null, secs_per_page: r.pages_ok ? +(r.secs / r.pages_ok).toFixed(1) : null,
    ...(meter && totalUsd > 0 && { weekly_pct_per_100p_upper: per(meter.weekly_delta * (r.list_usd / totalUsd)) }) });
}
console.log(JSON.stringify({ meter, rows }, null, 1));
