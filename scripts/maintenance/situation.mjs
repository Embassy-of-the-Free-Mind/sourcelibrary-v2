#!/usr/bin/env node
// situation.mjs — "what is going on across the boxes?" in one read, from ANY box, the laptop, or a headless job.
//
// PRIOR ART: scripts/maintenance/work-board-push.mjs and pipeline-now-push.mjs WRITE the per-box reports this
// reads (ops_reports `work-board:<box>` every 10 min, `pipeline-now:<box>` hourly, `claude-limits:latest`);
// /admin/work and /admin/pipeline/now render them for a browser. ~/sourcelibrary-ops/bin/sl-status is the
// laptop-only ssh sweep: it reaches two of the four boxes and takes minutes. Nothing printed these reports
// as text for a session, so each one rebuilt the picture by hand or trusted RUNNING.md.
//
// Read-only: one ops_reports read plus the latest stage_coverage_snapshots row, one ntfy poll, and RUNNING.md /
// DECISIONS-PENDING.md from the ops repo's origin/main (after a fetch). Writes nothing, calls no model, costs $0.
//
// What it prints, in order (#368): alarms with STANDING ones first (an alarm that fired in this window AND in the
// 48 h before it, from main's work-board alarm_log, because ntfy.sh forgets after ~12 h); per box its jobs (the
// clock is the newer of the log and the wrapper heartbeat; QUIET only when both are 45 min old) and its cron
// lanes (on / wrote in the hour / silent past their schedule); pools; accounts; pages per day from the corpus
// report; the nightly stage-coverage snapshot line (the "Pipeline line" pages come from it); the ops repo, its
// drift from origin, and the unmarked job DECISION lines on every box.
//
// Usage (from a checkout with .env.production.local):
//   node --env-file=.env.production.local scripts/maintenance/situation.mjs [--hours=12] [--box=gex45] [--json]
//   --hours  window for alarms, finished and dead jobs (default 12)
//   --box    only that box's jobs and lanes (pools, accounts and alarms stay fleet-wide)
//   --json   the assembled object instead of text
//   --brief  the morning brief (#379): NEEDS YOU (top 3, each with its default), BROKE (each with its owner, or
//            NO OWNER), FINE (yesterday per stage, pools, Claude weeks, spend). Alarms over 24 h.
//   --brief --send [--at-local=7 --tz=Europe/Amsterdam]  also post it to ntfy sourcelibrary-uptime (main's cron,
//            05:23Z and 06:23Z; only the run at 07 local sends, so it is 07:23 Amsterdam in summer and winter)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cronMaxGapMin, CRON_ROWS } from '../lib/lanes.mjs';

const NTFY = 'https://ntfy.sh/sourcelibrary-uptime';
// The reports name main "hetzner"; people say "main".
const BOX_ALIAS = { hetzner: 'main' };
const boxName = (b) => BOX_ALIAS[b] || b;
export const BOXES = ['hetzner', 'gex45', 'l7a', 'cloudlayer'];
// A report older than this is itself a finding: the push on that box stopped.
const STALE_MIN = { 'work-board': 30, 'pipeline-now': 150 };
/** A running job is QUIET when its log AND its heartbeat are both older than this (#368 item 2). */
export const QUIET_MIN = 45;
/** An alarm that fired this far back (and within the window too) is STANDING (#368 item 5). */
export const STANDING_HOURS = 48;

const ageMin = (t, now) => (t ? (now - new Date(t).getTime()) / 60000 : Infinity);
const fmtMin = (m) => (m < 90 ? `${Math.round(m)}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`);
const ago = (t, now) => { const m = ageMin(t, now); return Number.isFinite(m) ? `${fmtMin(m)} ago` : 'never'; };
const until = (t, now) => { const m = -ageMin(t, now); return Number.isFinite(m) ? fmtMin(m) : '?'; };
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
// The wrapper's own notices say nothing about the job; show "-" rather than hide what it last said behind them.
const said = (s) => (/^Warning: this sign-in ends/.test(String(s || '')) ? '-' : s);
const pct = (f) => (f == null ? '?' : `${Math.round(f * 100)}%`);
const num = (n) => (n == null ? '?' : Number(n).toLocaleString('en-US'));
const hhmm = (t) => new Date(t).toISOString().slice(11, 16) + 'Z';

// ───────────────────────────────────────────── pure pieces (tests/unit/situation.test.ts)

// cronMaxGapMin lives in scripts/lib/lanes.mjs since #379 (LOG SILENT uses it); re-exported for the tests.
export { cronMaxGapMin };

/** Silent = the log has not moved for longer than the schedule's longest gap plus half of it (at least 30 min). */
export const silentAfterMin = (gap) => gap + Math.max(30, gap / 2);

/**
 * A box's cron lanes from its pipeline-now report (#368 item 1), judged at the report's own time: lanes on
 * (not disabled, not a one-shot), how many wrote their log in the hour before, and the ones silent past their
 * schedule. A lane with no log path cannot be judged and is counted as such.
 */
export function laneSummary(pn) {
  if (!pn?.lines) return null;
  const at = new Date(pn.generated_at).getTime();
  const on = pn.lines.filter((l) => !l.disabled && !l.one_shot);
  const wrote = [], silent = [], nolog = [];
  for (const l of on) {
    if (!l.log) { nolog.push(l); continue; }
    const age = ageMin(l.log_at, at);
    if (age <= 60) wrote.push(l);
    const gap = cronMaxGapMin(l.schedule);
    if (gap != null && age > silentAfterMin(gap)) silent.push({ script: l.script, mode: l.mode ?? null, schedule: l.schedule, log_at: l.log_at ?? null, gap_min: gap });
  }
  return {
    at: pn.generated_at,
    on: on.length,
    wrote_1h: wrote.length,
    page_lanes_wrote_1h: wrote.filter((l) => l.stage === 'ocr' || l.stage === 'translate').length,
    silent,
    no_log: nolog.length,
  };
}

/** The corpus report's pages per day, summed over lanes, complete days only (the report's own day is partial). */
export function corpusRate(corpus, days = 3) {
  if (!corpus) return null;
  const today = String(corpus.generated_at instanceof Date ? corpus.generated_at.toISOString() : corpus.generated_at).slice(0, 10);
  const sum = (rows) => {
    const by = {};
    for (const r of rows ?? []) if (r.day < today) by[r.day] = (by[r.day] ?? 0) + (r.pages || 0);
    return Object.entries(by).sort((a, b) => b[0].localeCompare(a[0])).slice(0, days).map(([day, pages]) => ({ day, pages }));
  };
  return { at: corpus.generated_at, ocr: sum(corpus.ocr_per_day), translated: sum(corpus.translated_per_day) };
}

/**
 * A running job's clock (#368 item 2): the newer of its last activity (log, transcript) and the wrapper's heartbeat,
 * which moves every minute while the job sits in one long tool call. QUIET only when both are old.
 */
export function jobClock(j, now) {
  const act = ageMin(j.last_activity, now), hb = ageMin(j.heartbeat_at, now);
  const newer = Math.min(act, hb);
  return { age_min: newer, by: hb < act ? 'heartbeat' : 'log', log_min: act, hb_min: hb, quiet: act > QUIET_MIN && hb > QUIET_MIN };
}

/** One alarm across its firings: the title before ": " (what follows names the job or the count), digits folded. */
export const alarmKey = (title) => String(title || '').split(': ')[0].replace(/\d+/g, '#').trim() || '(untitled)';

/**
 * Group alarm rows (ntfy messages: id, time in s, priority, title, message) that fired in the last `hours`.
 * STANDING = the same alarm also fired between `hours` and 48 h ago. STANDING first, then newest.
 */
export function groupAlarms(rows, now, hours) {
  const winFrom = now / 1000 - hours * 3600, floor = now / 1000 - STANDING_HOURS * 3600;
  const seen = new Set(), by = new Map();
  for (const m of rows) {
    if (!m?.id || seen.has(m.id) || m.time < floor) continue;
    seen.add(m.id);
    const key = alarmKey(m.title || cut(m.message, 60));
    const g = by.get(key) ?? { key, title: '', message: '', priority: 0, count: 0, last: 0, first: Infinity, earlier: 0 };
    if (m.time >= winFrom) {
      g.count++;
      if (m.time > g.last) { g.last = m.time; g.title = m.title || key; g.message = m.message || ''; }
    } else g.earlier++;
    g.first = Math.min(g.first, m.time);
    g.priority = Math.max(g.priority, m.priority || 3);
    by.set(key, g);
  }
  return [...by.values()].filter((g) => g.count > 0)
    .map((g) => ({ ...g, standing: g.earlier > 0 }))
    .sort((a, b) => Number(b.standing) - Number(a.standing) || b.last - a.last);
}

/** "### title" lines under "## Open" in DECISIONS-PENDING.md, up to the next "## " heading. */
export function parseOpenDecisions(text) {
  const open = String(text || '').split(/^## /m).find((s) => /^Open\b/.test(s));
  return open ? open.split('\n').filter((l) => l.startsWith('### ')).map((l) => l.slice(4).trim()) : [];
}

/**
 * The Open rows with their recommended default (#379): { title, default } in file order, `default` being the text of
 * the row's first "**Default: …**" bold run, or null when the row states none.
 */
export function parseOpenDecisionRows(text) {
  const open = String(text || '').split(/^## /m).find((s) => /^Open\b/.test(s));
  if (!open) return [];
  return open.split(/^### /m).slice(1).map((chunk) => {
    const [head, ...body] = chunk.split('\n');
    const m = body.join('\n').match(/\*\*Default:\s*([\s\S]*?)\*\*/);
    return { title: head.trim(), default: m ? m[1].replace(/\s+/g, ' ').trim() : null };
  });
}

export function summarize({ reports, live = {}, ops = { dir: null }, snapshot = null }, { now = Date.now(), hours = 12, only = null } = {}) {
  const out = { generated_at: new Date(now).toISOString(), hours, boxes: [], pools: [], accounts: [], stalls: [], alarms: [], alarms_error: live.error || null, alarm_log: null, ops, infra_flags: [], decisions: [], stages: null };

  for (const b of BOXES) {
    const wb = reports[`work-board:${b}`];
    const pn = reports[`pipeline-now:${b}`];
    // Decisions are fleet-wide: every box, whatever --box says.
    out.decisions.push({ box: boxName(b), read_at: wb?.generated_at ?? null, ...(wb?.decisions ?? { missing: true }) });
    if (only && boxName(b) !== only && b !== only) continue;
    const jobs = wb?.jobs || [];
    const recent = (j) => ageMin(j.last_activity || j.started, now) <= hours * 60;
    const stale = [];
    if (ageMin(wb?.generated_at, now) > STALE_MIN['work-board']) stale.push(`work-board ${ago(wb?.generated_at, now)}`);
    if (ageMin(pn?.generated_at, now) > STALE_MIN['pipeline-now']) stale.push(`pipeline-now ${ago(pn?.generated_at, now)}`);
    out.boxes.push({
      box: boxName(b),
      reports: { work_board: wb?.generated_at || null, pipeline_now: pn?.generated_at || null, stale },
      running: jobs.filter((j) => j.state === 'running' || j.state === 'live').map((j) => ({ ...j, clock: jobClock(j, now) })),
      // A job that stopped without a DONE: the ones somebody has to look at.
      stuck: jobs.filter((j) => ['gave-up', 'dead', 'blocked'].includes(j.state) && recent(j)),
      done_recent: jobs.filter((j) => j.state === 'done' && ageMin(j.done_at, now) <= hours * 60).length,
      lanes: laneSummary(pn),
      red_lines: (pn?.lines || []).filter((l) => l.red?.length && !l.disabled).map((l) => ({ script: l.script, mode: l.mode ?? null, schedule: l.schedule, red: l.red, registry: l.registry ?? null, log_at: l.log_at, log_last: l.log_last })),
      stops: [...(pn?.stops || []), ...(wb?.stops || [])].filter((s, i, a) => a.findIndex((x) => (x.id || x.lane) === (s.id || s.lane)) === i),
      gpu_queue: pn?.gpu_queue || null,
    });
    // Pools are per Google account and shared across boxes: keep the freshest reading of each.
    for (const p of pn?.agy_pools || []) {
      const prev = out.pools.find((x) => x.pool === p.pool);
      if (!prev || new Date(pn.generated_at) > new Date(prev.read_at)) {
        if (prev) out.pools.splice(out.pools.indexOf(prev), 1);
        out.pools.push({ ...p, read_on: boxName(b), read_at: pn.generated_at });
      }
    }
  }

  // Alarms: main's 48 h log plus the live poll (newer than main's last push), one row per message id.
  const main = reports['work-board:hetzner'];
  out.alarm_log = main?.alarm_log ? { rows: main.alarm_log.length, read_at: main.generated_at, error: main.alarm_log_error ?? null } : null;
  out.alarms = groupAlarms([...(live.rows || []), ...(main?.alarm_log || [])], now, hours);

  const lim = reports['claude-limits:latest'];
  out.accounts_read_at = lim?.checked_at || null;
  for (const a of lim?.accounts || []) {
    const get = (k) => a.limits?.find((l) => l.key === k);
    const week = get('weekly_all:all');
    const fable = get('weekly_scoped:Fable');
    out.accounts.push({ email: a.email, ok: a.ok, error: a.error, week: week?.percent ?? null, week_resets: week?.resets_at ?? null, fable: fable?.percent ?? null, burn_pct_per_h: week?.burn_pct_per_h ?? null, budget_pct_per_h: week?.budget_pct_per_h ?? null });
  }

  const corpus = reports['pipeline-now:corpus'];
  out.corpus_read_at = corpus?.generated_at || null;
  out.rate = corpusRate(corpus);
  out.stalls = (corpus?.stalls || []).filter((s) => s.stalled || s.unknown);
  out.dial = corpus?.dial || null;
  if (snapshot) out.stages = { at: snapshot.timestamp, stalled: snapshot.stalled ?? [], stages: snapshot.stages ?? [] };
  for (const id of ['work-board:infra-scaleway', 'work-board:infra-hetzner']) out.infra_flags.push(...(reports[id]?.flags || []));
  return out;
}

export function format(s) {
  const now = Date.parse(s.generated_at);
  const L = [];
  L.push(`SITUATION ${s.generated_at.slice(0, 16)}Z — read from ops_reports (pushed by each box), ntfy, and the ops repo`);

  // ── alarms first, STANDING ones at the top
  L.push('');
  if (s.alarms_error && !s.alarm_log) L.push(`== alarms: ${s.alarms_error}`);
  else {
    const hi = s.alarms.filter((a) => a.priority >= 4);
    const st = hi.filter((a) => a.standing);
    const logNote = s.alarm_log ? `48 h log from main, pushed ${ago(s.alarm_log.read_at, now)}${s.alarm_log.error ? `, last poll failed: ${s.alarm_log.error}` : ''}` : 'NO 48 h log (main\'s work-board has no alarm_log): STANDING cannot be told';
    L.push(`== alarms, last ${s.hours}h: ${s.alarms.length} distinct (${hi.length} high, ${st.length} STANDING) on ntfy sourcelibrary-uptime [${logNote}]${s.alarms_error ? ` · live poll: ${s.alarms_error}` : ''}`);
    for (const a of hi.slice(0, 15)) {
      const tag = a.standing ? `STANDING since ${new Date(a.first * 1000).toISOString().slice(5, 16).replace('T', ' ')}Z (${a.earlier} earlier) ` : '';
      L.push(`   ${hhmm(a.last * 1000)} ${tag}${a.count > 1 ? `x${a.count} ` : ''}${cut(a.title, 50)}: ${cut(a.message, 100)}`);
    }
  }

  // ── boxes
  for (const b of s.boxes) {
    L.push('');
    L.push(`== ${b.box}${b.reports.stale.length ? `   !! STALE REPORT: ${b.reports.stale.join(', ')} (the push on this box stopped; what follows may be old)` : ''}`);
    const quiet = b.running.filter((j) => j.clock.quiet).length;
    L.push(`   jobs: ${b.running.length} running${quiet ? ` (${quiet} QUIET)` : ''} · ${b.stuck.length} stopped without DONE · ${b.done_recent} done in ${s.hours}h`);
    for (const j of b.running) {
      const c = j.clock;
      const clock = c.quiet
        ? `QUIET ${Number.isFinite(c.age_min) ? fmtMin(c.age_min) : '?'} (log ${Number.isFinite(c.log_min) ? fmtMin(c.log_min) : 'never'}, heartbeat ${Number.isFinite(c.hb_min) ? fmtMin(c.hb_min) : 'none'})`
        : `active ${fmtMin(c.age_min)} ago${c.by === 'heartbeat' && c.log_min > 15 ? ` (heartbeat; log ${Number.isFinite(c.log_min) ? fmtMin(c.log_min) : 'never'})` : ''}`;
      L.push(`   RUN   ${cut(j.name, 34).padEnd(34)} → ${(j.reports_to || []).map((n) => '#' + n).join(' ') || '-'}  ${clock}${j.resumes ? `, resumed ${j.resumes}x` : ''}  ${cut(said(j.last_said), 70)}`);
    }
    for (const j of b.stuck) L.push(`   ${j.state.toUpperCase().padEnd(5)} ${cut(j.name, 34).padEnd(34)} → ${(j.reports_to || []).map((n) => '#' + n).join(' ') || '-'}  ${ago(j.last_activity, now)}  ${cut(j.last_said || j.last_wrapper_line, 80)}`);
    const ln = b.lanes;
    if (!ln) L.push('   lanes: no pipeline-now report');
    else {
      L.push(`   lanes (report ${ago(ln.at, now)}): ${ln.on} on · ${ln.wrote_1h} wrote in the hour before (${ln.page_lanes_wrote_1h} OCR/translate) · ${ln.silent.length} silent past their schedule${ln.no_log ? ` · ${ln.no_log} with no log to judge` : ''}`);
      for (const x of ln.silent.slice(0, 6)) L.push(`   SILENT ${cut(`${path.basename(x.script || '?')}${x.mode ? ' ' + x.mode : ''}`, 40).padEnd(40)} '${x.schedule}' (gap ${fmtMin(x.gap_min)}), log last written ${x.log_at ? ago(x.log_at, now) : 'never'}`);
      if (ln.silent.length > 6) L.push(`   SILENT … ${ln.silent.length - 6} more (--json)`);
    }
    for (const l of b.red_lines) L.push(`   RED   ${cut(l.script, 50)}: ${l.red.map((r) => `${r.flag} (${cut(r.why, 70)})`).join('; ')}`);
    if (b.stops.length) {
      const due = b.stops.filter((x) => x.review_by && new Date(x.review_by) <= new Date(now + 3 * 864e5));
      L.push(`   stops: ${b.stops.length} standing${due.length ? `, ${due.length} due for review within 3 days` : ''}: ${b.stops.map((x) => cut(x.id || x.lane, 30) + (x.issue || x.ticket ? ` #${x.issue || x.ticket}` : '')).join(', ')}`);
    }
    if (b.gpu_queue) L.push(`   gpu queue: ${b.gpu_queue.pending} pending, ${b.gpu_queue.held} held, lock ${b.gpu_queue.lock}`);
  }

  // ── pools, accounts
  L.push('');
  L.push('== Gemini pools (agy; per Google account, shared by every box)');
  for (const p of s.pools) L.push(`   ${p.pool.padEnd(12)} week ${pct(p.weekly).padStart(4)} left (resets in ${until(p.weekly_reset, now)}) · 5h ${pct(p.five_hour).padStart(4)} left${p.busy ? ' · busy' : ''}   [read on ${p.read_on} ${ago(p.read_at, now)}]`);
  L.push(`== Claude accounts (week used; read ${ago(s.accounts_read_at, now)})`);
  for (const a of s.accounts) {
    if (!a.ok) { L.push(`   ${a.email.padEnd(28)} UNREADABLE ${cut(a.error, 60)}`); continue; }
    const pace = a.burn_pct_per_h != null && a.budget_pct_per_h != null && a.burn_pct_per_h > a.budget_pct_per_h * 1.5 ? '  over pace' : '';
    L.push(`   ${a.email.padEnd(28)} week ${String(a.week).padStart(3)}% · Fable ${String(a.fable ?? '?').padStart(3)}% · resets in ${until(a.week_resets, now)}${pace}`);
  }
  if (s.dial) L.push(`== spend dial: ${s.dial.paused ? 'PAUSED' : 'on'}, daily budget $${s.dial.daily_budget_usd}`);

  // ── fleet throughput and the nightly stage line
  if (s.rate) {
    const d = (rows) => rows.length ? rows.map((r) => `${r.day.slice(5)} ${num(r.pages)}`).join(' · ') : 'none';
    L.push(`== pages per day, all lanes (corpus report ${ago(s.rate.at, now)}): OCR ${d(s.rate.ocr)}; translated ${d(s.rate.translated)}`);
  } else L.push('== pages per day: no pipeline-now:corpus report');
  if (s.stalls.length) {
    L.push(`== hand-off stalls (corpus report ${ago(s.corpus_read_at, now)})`);
    for (const x of s.stalls) L.push(`   ${x.stalled ? 'STALLED' : 'UNKNOWN'} ${x.label}`);
  }
  if (s.stages) {
    const parts = s.stages.stages.map((x) => {
      if (x.status !== 'ok') return `${x.stage} PROBE BROKEN`;
      const dl = x.delta == null ? '' : ` ${x.delta >= 0 ? '+' : ''}${num(x.delta)}`;
      const res = x.residue != null ? `, residue ${num(x.residue)} no worker takes` : '';
      return `${x.stage} ${num(x.covered)}/${num(x.total)}${dl}${x.queue_depth ? ` (queue ${num(x.queue_depth)}${res})` : res ? ` (${res.slice(2)})` : ''}${s.stages.stalled.includes(x.stage) ? ' STALLED' : ''}`;
    });
    L.push(`== stage snapshot ${ago(s.stages.at, now)} (nightly; the "Pipeline line" alarm reads it; change since the snapshot before):`);
    L.push(`   ${parts.join(' · ')}`);
  } else L.push('== stage snapshot: none readable (stage_coverage_snapshots)');
  if (s.infra_flags.length) L.push(`== infra: ${s.infra_flags.length} flag(s): ${s.infra_flags.map((f) => `${f.provider} ${cut(f.name, 30)} (${f.kind})`).join(', ')}`);

  // ── ops repo and decisions
  L.push('');
  const o = s.ops;
  if (o.dir) {
    const src = o.ref ? `read from ${o.ref}${o.fetch_error ? ` (fetch FAILED: ${cut(o.fetch_error, 60)}; may be old)` : ''}` : `read from the checkout on disk (${cut(o.ref_error || 'no origin ref', 60)})`;
    const drift = o.behind || o.ahead ? `   !! checkout ${o.behind ?? '?'} behind, ${o.ahead ?? '?'} not pushed` : '';
    L.push(`== ops repo ${o.dir} ${src}${drift}`);
    L.push(`   RUNNING.md edited ${ago(o.runningAt, now)} (approvals, ceilings, why); DECISIONS-PENDING.md ${o.openDecisions?.length ?? '?'} open`);
    for (const d of o.openDecisions || []) L.push(`   waiting on Derek: ${cut(d, 100)}`);
  } else L.push('== ops repo not checked out here (RUNNING.md, DECISIONS-PENDING.md): gh repo clone Embassy-of-the-Free-Mind/sourcelibrary-ops');
  const dec = s.decisions;
  const known = dec.filter((d) => !d.missing && !d.error);
  const total = known.reduce((a, d) => a + d.unmarked, 0);
  L.push(`== job DECISION lines nobody has marked (decisions.txt on each box): ${total}${known.length < dec.length ? '+' : ''} · ` +
    dec.map((d) => `${d.box} ${d.missing ? '? (not pushed)' : d.error ? '? (unreadable)' : d.unmarked + (d.oldest ? ` since ${d.oldest.slice(5)}` : '')}`).join(', '));
  const oldest = known.flatMap((d) => (d.oldest_rows || []).map((r) => ({ ...r, box: d.box }))).sort((a, b) => a.day.localeCompare(b.day)).slice(0, 3);
  for (const r of oldest) L.push(`   ${r.day.slice(5)} ${r.box} ${cut(r.job, 28)}: ${cut(r.text, 110)}`);
  if (total) L.push('   jobs that asked: ' + known.filter((d) => d.unmarked).map((d) => `${d.box}: ${d.jobs.slice(0, 5).join(', ')}${d.jobs.length > 5 ? ' …' : ''}`).join(' · ') + ' — mark with box.sh <box> decisions-mark');
  L.push('   Who launched a job and why: job-ledger.sh why <job>. One job\'s words: box.sh <box> brief <job>. Browser: https://sourcelibrary.org/admin/work · https://sourcelibrary.org/admin/pipeline/now');
  return L.join('\n');
}

// ───────────────────────────────────────────── the morning brief (#379)
//
// Derek's five-line read, and the first thing an agent reads when it wakes: what needs him (at most 3, each with
// the recommended default, so "defaults" answers them), what broke (each with its owner, or NO OWNER), and one
// line saying the rest is fine, in books where books are the unit.

/** Red flags that mean a line is broken, not merely out of policy (PAST REVIEW etc. are counted, not listed). */
export const BROKE_FLAGS = ['LOG SILENT', 'IDLE 7 DAYS', 'RETIRED BUT LIVE'];
/** The CRON_ROWS row whose line feeds the downstream side of each hand-off edge (hand-off-stalls.mjs): its issue owns a stall. */
export const STALL_ROW = { 'ft_search->ft_ingest': 'main-ft-nightly', 'translate->enrich': 'main-enrich-agy', 'gpu_draft->armc_correct': 'gex45-armc-campaign' };
/** Alarms a Broke row already covers (stuck jobs, stalls). */
const ALARM_COVERED = /^(Job GAVE UP|Job DIED|Pipeline: hand-off stalled)/;
/** Alarms about readers' traffic: watched, not broken. */
const ALARM_WATCH = /^(Traffic anomaly|Crawler reading the library)/;
/**
 * The brief goes to ntfy.sh, a public topic; this repo's rule is that infra and security detail stays in the private
 * ops repo. A row matching this sends its title only.
 */
export const SENSITIVE = /\b(security|secret|credential|password|token|api key|ssh|RLS|anon[- ]key|firewall|audit of access)\b/i;
const issueIn = (t) => { const m = String(t || '').match(/(?:v[23] ?)?#\d{1,5}\b/); return m ? m[0].replace(' ', '') : null; };
const dropRef = (t) => String(t || '').replace(/\s*\((?:v[23] ?)?#[^)]*\)\s*$/, '').trim();

/** The first sentence of a default, cut for a phone line. */
export function shortDefault(d, n = 70) {
  if (!d) return 'no default stated';
  const first = String(d).split(/(?<=[.;])\s/)[0].replace(/[.;]$/, '');
  return cut(first, n);
}

/** Who owns an item: a running job whose name or issues match one of `keys`, else the issue the item names. */
function ownerOf({ issue = null, keys = [] }, running) {
  const ks = keys.filter(Boolean);
  const j = running.find((x) => ks.some((k) => String(x.name).includes(k) || (x.reports_to || []).some((n) => `#${n}` === k)));
  if (j) return `job ${j.name}`;
  return issue || null;
}

/** An account's short name for a public topic: the local part on sourcelibrary.org, else a cut one and the domain's first word. */
export const who = (email) => {
  const [u = '', d = ''] = String(email).split('@');
  return d === 'sourcelibrary.org' ? u : `${u.replace(/\d+$/, '').slice(0, 5)}@${d.split('.')[0]}`;
};

/**
 * Assemble the brief from summarize()'s object plus `extra` (readBriefExtra): pure, so the tests feed it fixtures.
 * Returns { needs: [{ title, default, ref }], needs_more, job_questions, broke: [{ what, owner }], policy_flags, watch, fine }.
 */
export function briefOf(s, extra = {}) {
  const running = s.boxes.flatMap((b) => b.running.map((j) => ({ ...j, box: b.box })));

  // ── needs you: DECISIONS-PENDING rows (triaged, in the file's order) first; the oldest unmarked job questions fill to 3
  const rows = (s.ops?.openDecisionRows || []).map((r) => ({ title: dropRef(r.title), default: SENSITIVE.test(`${r.title} ${r.default}`) ? 'default in DECISIONS-PENDING (security: not sent)' : shortDefault(r.default), ref: issueIn(r.title) }));
  const known = s.decisions.filter((d) => !d.missing && !d.error);
  const jobQuestions = known.reduce((a, d) => a + (d.unmarked || 0), 0);
  const jobRows = known.flatMap((d) => (d.oldest_rows || []).map((r) => ({ ...r, box: d.box })))
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((r) => {
      const [q, dflt] = String(r.text).split(/\s+—\s+default:\s*/);
      return { title: cut(q, 80), default: shortDefault(dropRef(dflt)), ref: issueIn(r.text) || `job ${r.job}` };
    });
  const needs = [...rows, ...jobRows].slice(0, 3);
  const needsMore = Math.max(0, rows.length - 3);

  // ── broke: stopped pushes, stuck jobs, broken cron lines, hand-off stalls, unreadable accounts, other high alarms
  const broke = [];
  for (const b of s.boxes) {
    if (b.reports.stale.length) broke.push({ what: `${b.box}: report push stopped (${b.reports.stale.join(', ')})`, owner: null });
    // Stuck jobs, one line per box, state and owner (three dead slices of one job family are one item).
    const groups = new Map();
    for (const j of b.stuck) {
      const owner = (j.reports_to || []).map((n) => `#${n}`).join(' ') || null;
      const key = `${j.state}|${owner}`;
      groups.set(key, { state: j.state, owner, names: [...(groups.get(key)?.names ?? []), j.name] });
    }
    for (const g of groups.values()) broke.push({ what: `${b.box}: ${g.names.length > 1 ? `${g.names.length} jobs ${g.state} (${g.names.slice(0, 3).join(', ')}${g.names.length > 3 ? ', …' : ''})` : `job ${g.names[0]} ${g.state}`}`, owner: g.owner });
    for (const l of b.red_lines) {
      const flags = l.red.filter((r) => BROKE_FLAGS.includes(r.flag));
      if (!flags.length) continue;
      const name = path.basename(l.script || '?').replace(/\.(mjs|sh|js|ts|py)$/, '');
      const issue = l.registry?.issue ? `#${l.registry.issue}` : null;
      broke.push({ what: `${b.box}: ${name}${l.mode ? ` ${l.mode}` : ''} ${flags.map((f) => `${f.flag}, ${f.why}`).join('; ')}`, owner: ownerOf({ issue, keys: [name, issue] }, running) });
    }
  }
  for (const x of s.stalls) {
    const row = CRON_ROWS.find((r) => r.id === STALL_ROW[x.edge]);
    const issue = row?.issue ? `#${row.issue}` : null;
    broke.push({ what: `${x.stalled ? 'stalled' : 'cannot tell'}: ${x.label} (corpus report ${ago(s.corpus_read_at, Date.parse(s.generated_at))})`, owner: ownerOf({ issue, keys: [issue] }, running) });
  }
  for (const a of s.accounts) if (!a.ok) broke.push({ what: `Claude account ${who(a.email)} unreadable`, owner: null });
  const hi = s.alarms.filter((a) => a.priority >= 4 && !ALARM_COVERED.test(a.title || a.key));
  for (const a of hi.filter((x) => !ALARM_WATCH.test(x.title || x.key))) {
    broke.push({ what: `${a.standing ? 'standing ' : ''}alarm: ${a.title}`, owner: ownerOf({ issue: issueIn(`${a.title} ${a.message}`) }, running) });
  }
  // Unowned first: nobody is on those.
  broke.sort((a, b) => Number(Boolean(a.owner)) - Number(Boolean(b.owner)));
  const policyFlags = s.boxes.reduce((n, b) => n + b.red_lines.filter((l) => l.red.some((r) => !BROKE_FLAGS.includes(r.flag))).length, 0);

  // ── fine: yesterday (UTC), per stage
  const y = extra.day ?? null;
  const pagesOn = (r) => r?.find((x) => x.day === y)?.pages ?? null;
  const ho = extra.handoffs?.find((r) => r.day === y) ?? null;
  const fine = {
    day: y,
    ocr_pages: pagesOn(s.rate?.ocr), translated_pages: pagesOn(s.rate?.translated),
    enrich_books: ho?.enrich_books ?? null, ft_books: ho?.ft_ingest ?? null,
    qa_books: extra.qa?.books ?? null, qa_last: extra.qa?.last ?? null,
    done_books: extra.done?.books ?? null, done_delta: extra.done?.delta ?? null,
    pools: s.pools.map((p) => ({ pool: p.pool.replace(/^\.agy-/, ''), left: p.weekly })),
    accounts: s.accounts.filter((a) => a.ok).map((a) => ({ who: who(a.email), week: a.week })),
    spend: extra.spend ?? null,
    dial: s.dial,
  };
  return { at: s.generated_at, needs, needs_more: needsMore, job_questions: jobQuestions, broke, policy_flags: policyFlags, watch: hi.filter((x) => ALARM_WATCH.test(x.title || x.key)).map((a) => String(a.title || a.key).split(':')[0]), fine };
}

const kilo = (n) => (n == null ? '?' : n >= 10_000 ? `${Math.round(n / 1000)}K` : num(n));

/** The brief as plain text for a phone. */
export function formatBrief(b, { maxBroke = 4 } = {}) {
  const L = [];
  if (!b.needs.length) L.push('NEEDS YOU: nothing.');
  else {
    L.push(`NEEDS YOU (${b.needs.length}${b.needs_more ? ` of ${b.needs.length + b.needs_more}` : ''}; reply "defaults" to take them):`);
    b.needs.forEach((n, i) => L.push(`${i + 1}. ${cut(n.title, 70)} → ${n.default}${n.ref ? ` (${n.ref})` : ''}`));
  }
  if (!b.broke.length) L.push('BROKE: nothing.');
  else {
    const shown = b.broke.slice(0, maxBroke);
    const unowned = b.broke.filter((x) => !x.owner).length;
    L.push(`BROKE (${b.broke.length}; ${unowned ? `${unowned} with no owner` : 'all owned'}):`);
    for (const x of shown) L.push(`- ${cut(x.what, 100)} · ${x.owner ? `owner ${x.owner}` : 'NO OWNER'}`);
    if (b.broke.length > shown.length) L.push(`- and ${b.broke.length - shown.length} more (situation --brief on main)`);
  }
  const f = b.fine;
  const stages = [
    `OCR ${kilo(f.ocr_pages)} pages`, `translated ${kilo(f.translated_pages)} pages`, `enriched ${kilo(f.enrich_books)} books`,
    `FT ${kilo(f.ft_books)} books`, `QA ${kilo(f.qa_books)} books${f.qa_books === 0 && f.qa_last ? ` (last ${f.qa_last.slice(5)})` : ''}`,
    `finished ${f.done_delta == null ? '?' : `${f.done_delta >= 0 ? '+' : ''}${num(f.done_delta)}`} books`,
  ].join(', ');
  const pools = f.pools.length ? `agy week left: ${f.pools.map((p) => `${p.pool} ${pct(p.left)}`).join(', ')}` : 'agy pools unread';
  const claude = f.accounts.length ? `Claude week used: ${f.accounts.map((a) => `${a.who} ${a.week}%`).join(', ')}` : 'Claude accounts unread';
  const spend = f.spend ? `paid ${f.spend.day.slice(5)}: $${Number(f.spend.paid_usd).toFixed(2)}` : 'paid spend unread';
  L.push(`FINE ${f.day ? f.day.slice(5) : '?'}: ${stages}. ${pools}. ${claude}. ${spend}, dial $${f.dial?.daily_budget_usd ?? '?'}/day.`);
  const tail = [];
  if (b.policy_flags) tail.push(`${b.policy_flags} cron line(s) out of policy`);
  if (b.watch.length) tail.push(`watching ${b.watch.join(', ')}`);
  if (b.job_questions) tail.push(`${num(b.job_questions)} job questions unmarked (#8551)`);
  if (tail.length) L.push(`Also: ${tail.join(' · ')}.`);
  return L.join('\n');
}

// ───────────────────────────────────────────── readers (I/O)

async function readReports() {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20_000 });
  await client.connect();
  try {
    const db = client.db('bookstore');
    const [docs, snapshot] = await Promise.all([
      db.collection('ops_reports')
        .find({ _id: { $in: [...BOXES.flatMap((b) => [`work-board:${b}`, `pipeline-now:${b}`]), 'pipeline-now:corpus', 'claude-limits:latest', 'work-board:infra-scaleway', 'work-board:infra-hetzner'] } })
        .toArray(),
      // The nightly stage-coverage snapshot (#368 item 6): the newest row only.
      db.collection('stage_coverage_snapshots').find({}, { projection: { timestamp: 1, stages: 1, stalled: 1 } }).sort({ timestamp: -1 }).limit(1).maxTimeMS(15_000).next().catch(() => null),
    ]);
    return { reports: Object.fromEntries(docs.map((d) => [d._id, d])), snapshot };
  } finally {
    await client.close();
  }
}

/** The live poll: what ntfy still holds (~12 h). Main's work-board alarm_log carries the 48 h. */
async function readAlarms() {
  try {
    const res = await fetch(`${NTFY}/json?poll=1&since=${STANDING_HOURS}h`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { error: `ntfy ${res.status}` };
    const rows = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.event === 'message');
    return { rows };
  } catch (e) {
    return { error: `ntfy unreachable: ${e.message}` };
  }
}

const git = (dir, args, timeout = 5000) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// The ops repo sits at ~/sourcelibrary-ops on the laptop and /root/work/sourcelibrary-ops on the boxes. Read it from
// origin after a fetch, never from whatever the checkout holds (#368 item 3: a laptop checkout 68 behind served a
// day-old RUNNING.md and decision list), and say how far the checkout has drifted.
function readOps() {
  const dir = [process.env.SL_OPS_DIR, path.join(os.homedir(), 'sourcelibrary-ops'), '/root/work/sourcelibrary-ops']
    .filter(Boolean).find((d) => fs.existsSync(path.join(d, 'RUNNING.md')));
  if (!dir) return { dir: null };
  const out = { dir, ref: null, fetch_error: null, ref_error: null, behind: null, ahead: null, runningAt: null, openDecisions: null, openDecisionRows: null };
  try { git(dir, ['fetch', '-q', 'origin'], 20_000); } catch (e) { out.fetch_error = String(e.stderr || e.message).trim().split('\n')[0]; }
  for (const ref of ['origin/main', 'origin/HEAD']) {
    try { git(dir, ['rev-parse', '--verify', '-q', ref]); out.ref = ref; break; } catch { /* try the next */ }
  }
  if (!out.ref) out.ref_error = 'no origin/main';
  const read = (f) => (out.ref ? git(dir, ['show', `${out.ref}:${f}`]) : fs.readFileSync(path.join(dir, f), 'utf8'));
  try { out.runningAt = git(dir, ['log', '-1', '--format=%cI', ...(out.ref ? [out.ref] : []), '--', 'RUNNING.md']) || null; } catch { /* not a git checkout */ }
  try { const t = read('DECISIONS-PENDING.md'); out.openDecisions = parseOpenDecisions(t); out.openDecisionRows = parseOpenDecisionRows(t); } catch { /* no file */ }
  if (out.ref) {
    try {
      const [ahead, behind] = git(dir, ['rev-list', '--left-right', '--count', `HEAD...${out.ref}`]).split(/\s+/).map(Number);
      Object.assign(out, { ahead, behind });
    } catch { /* detached or shallow */ }
  }
  return out;
}

/**
 * What the brief needs beyond the situation (#379), all from Mongo and all for one UTC day `day` (yesterday): the
 * corpus report's hand-offs (books enriched, FT books ingested), books judged by the lane judge (QA), the net change
 * in books at step done (the daily pipeline-next reports), and paid spend (spend-daily).
 */
async function readBriefExtra(now) {
  const day = new Date(now - 864e5).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20_000 });
  await client.connect();
  try {
    const db = client.db('bookstore');
    const ops = db.collection('ops_reports');
    // Each read stands alone: one that fails reads ? in the brief, and the brief still goes out.
    const got = await Promise.allSettled([
      ops.findOne({ _id: 'pipeline-now:corpus' }, { projection: { handoffs_per_day: 1 } }),
      ops.find({ type: 'pipeline_next_daily', day: { $lte: today } }, { projection: { day: 1, steps: 1 } }).sort({ day: -1 }).limit(2).toArray(),
      ops.findOne({ _id: `spend-daily-${day}` }, { projection: { day: 1, status: 1, 'checks.ledger.paid_usd': 1 } }),
      // all origins: QA activity counts whoever wrote the verdict. judged_at is an ISO string; ~12K rows, a scan is cheap.
      db.collection('lane_judge_verdicts').distinct('book_id', { judged_at: { $gte: day, $lt: today } }),
      db.collection('lane_judge_verdicts').find({}, { projection: { judged_at: 1 } }).sort({ judged_at: -1 }).limit(1).next(),
    ]);
    const [corpus, next = [], spend, qa, qaLast] = got.map((r) => (r.status === 'fulfilled' ? r.value : undefined));
    const doneOf = (d) => d?.steps?.find((x) => x.step === 'done')?.live?.books ?? null;
    const done = next.length === 2 && doneOf(next[0]) != null && doneOf(next[1]) != null
      ? { books: doneOf(next[0]), delta: doneOf(next[0]) - doneOf(next[1]), from: next[1].day, to: next[0].day } : null;
    return {
      day,
      handoffs: corpus?.handoffs_per_day ?? null,
      qa: qa ? { books: qa.length, last: qaLast?.judged_at ? String(qaLast.judged_at).slice(0, 10) : null } : null,
      done,
      spend: spend?.checks?.ledger?.paid_usd != null ? { day: spend.day, paid_usd: spend.checks.ledger.paid_usd, status: spend.status } : null,
    };
  } finally {
    await client.close();
  }
}

/** The hour on the wall clock of `tz` at `now` (cron here runs in UTC and has no CRON_TZ). */
export const localHour = (now, tz) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));

async function sendBrief(text, title) {
  const res = await fetch(NTFY, { method: 'POST', body: text, headers: { Title: title, Tags: 'sunrise' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}

async function main() {
  const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
  if (!process.env.MONGODB_URI) {
    console.error('situation: MONGODB_URI is not set. Run with node --env-file=.env.production.local (from /root/sourcelibrary on a box).');
    process.exit(2);
  }
  const brief = process.argv.includes('--brief');
  const send = brief && process.argv.includes('--send');
  const now = Date.now();
  // --at-local=7 --tz=Europe/Amsterdam: cron fires at 05:23Z and 06:23Z; only the run that is 07:xx there does anything.
  const at = arg('at-local', null), tz = arg('tz', 'Europe/Amsterdam');
  if (send && at != null && localHour(now, tz) !== Number(at)) { console.log(`[brief] not sent: it is ${localHour(now, tz)}h in ${tz}, not ${at}h`); return; }
  let reports, snapshot, live;
  try {
    [{ reports, snapshot }, live] = await Promise.all([readReports(), readAlarms()]);
  } catch (e) {
    // A brief that cannot be built still tells the phone so, rather than not arriving.
    if (send) await sendBrief(`The morning brief could not be built on main: ${cut(e.message, 200)}. Log: /var/log/sourcelibrary/morning-brief.log (v3#379)`, 'Morning brief FAILED').catch(() => {});
    throw e;
  }
  // The brief reads the night: 24 h of alarms unless --hours says otherwise.
  const s = summarize({ reports, live, ops: readOps(), snapshot }, { now, hours: Number(arg('hours', brief ? 24 : 12)), only: arg('box', null) });
  if (!brief) {
    if (process.argv.includes('--json')) console.log(JSON.stringify(s, null, 2));
    else console.log(format(s));
    return;
  }
  const b = briefOf(s, await readBriefExtra(now));
  if (process.argv.includes('--json')) { console.log(JSON.stringify(b, null, 2)); return; }
  const text = formatBrief(b);
  const title = `Morning brief ${new Date(now).toISOString().slice(0, 10)}`;
  console.log(`${title}\n${text}`);
  if (!send) return;
  await sendBrief(text, title);
  console.log('[brief] sent');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(`situation: ${e.stack || e}`); process.exit(1); });
}
