#!/usr/bin/env node
// #6740 read-surface: publish the live state of the experiment to ONE ops_reports doc, `read-surface-6740:live`,
// read by /platform/admin/ocr-evidence/read-surface/live, which refits the response surface in the browser.
// Called by the experiment's run loop after every completed and scored run; makes no model call, reads no agy state
// but the pool file.
//
// PRIOR ART: surface6.mjs / fit.mjs (this directory: they aggregate score.json to run means and fit there; the live page
//   fits at the page level, so this keeps one row per target page per run and leaves every aggregate to the page; their
//   c1 / u1 pricing of a page left unread is copied here so a row's cost means the same thing);
//   scripts/audit/model-usage-snapshot.mjs (the one-fixed-_id ops_reports replaceOne pattern).
//
//   node --env-file=.env.production.local scripts/eval/read-surface-6740/publish-live.mjs \
//     --work=WORK[,WORK-IB...] (oldest first) [--weights=FILE[,FILE]] [--pools=/root/agy-quota/pools.json] [--calls-max=4000] [--apply] [--out=FILE]
//     [--confirm=LANG:SCORE.json[,LANG:SCORE.json]] [--confirm-only]
// Without --apply it prints a summary and (with --out) writes the doc to a file; nothing goes to Mongo.
// --confirm adds `confirmation.<lang>` (the page's Confirmation contract, lead.ts) from a queue confirmation's score
// file, either shape (confirm-de/score.json: absolute rule; confirm-de2/score-de2.json: relative, paired). With
// --confirm-only no --work is needed: only that field is $set on the existing doc, the rows are left as they are.
//
// Row fields (the data contract, also asserted on read by the page's shape.ts):
//   run_id, setting_id, lang, book_id, century, face, pool, cer (null when the target was not read), quota_cost (US $ a
//   page at list rates, the book's window), calls (production-equivalent agy calls a page, the book's window), wall_s
//   (seconds a page), accepted (a usable read: read, not wrong text, not a loop, not cut), wrong_text, loop, cut,
//   excluded (the target is on the frozen exclusion list), long_edge_px (pixels actually sent), completed_at.
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const WORKS = (arg('work') || '').split(',').filter(Boolean).map((w) => path.resolve(w));
const CONFIRM_ONLY = process.argv.includes('--confirm-only');
if (!WORKS.length && !CONFIRM_ONLY) { console.error('--work=DIR[,DIR] required (or --confirm-only)'); process.exit(2); }
const APPLY = process.argv.includes('--apply');
const POOLS = arg('pools', '/root/agy-quota/pools.json');
const CALLS_MAX = Number(arg('calls-max', 4000));   // Amendment 6.7: 4,000 agy calls in all
export const REPORT_ID = 'read-surface-6740:live';
// gemini-3.8-flash list rates, as score.mjs (Amendment 6.2): cached input at 10 % of input; agy's output includes thinking.
const RATE = { input: 0.75e-6, cached: 0.075e-6, output: 3.75e-6 };
const usdOf = (t) => (t.input - t.cache_read) * RATE.input + t.cache_read * RATE.cached + t.output * RATE.output;
const SERVED_MEDIAN = 2350;   // the panel median long edge (6.3.1), used only when a page's own size cannot be found

const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Width and height of a baseline/progressive JPEG from its SOF marker; null if not a JPEG. */
function jpegSize(file) {
  let b; try { b = fs.readFileSync(file); } catch { return null; }
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/** When a run finished: the latest finished_at of its page reads, else the run dir's mtime. */
function completedAt(dir) {
  let last = 0;
  try {
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.meta.json')) { const t = Date.parse(readJson(path.join(dir, f))?.finished_at); if (t > last) last = t; }
    for (const f of ['calls.jsonl']) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) for (const c of jsonl(p)) { const t = Date.parse(c.finished_at); if (t > last) last = t; }
    }
    if (!last) last = fs.statSync(dir).mtimeMs;
  } catch { /* no dir */ }
  return last ? new Date(last).toISOString() : null;
}

const centuryOf = (published) => { const y = parseInt(String(published ?? '').match(/\d{3,4}/)?.[0] ?? '', 10); return Number.isFinite(y) ? Math.floor((y - 1) / 100) + 1 : null; };
const poolOf = (home) => (!home || home === 'default' ? 'default' : path.basename(home).replace(/^\./, ''));
const promptOf = (r) => r.prompt || 'live';

export function build() {
  const settings = new Map(), rows = [];
  const levels = { pages_a_call: new Set(), long_edge: new Set(), thinking: new Set(['low', 'medium', 'high']), prompt_line: new Set() };
  let callsUsed = 0;
  for (const [wi, W] of WORKS.entries()) {
    const score = readJson(path.join(W, 'score.json'), { langs: {} });
    const plan = readJson(path.join(W, 'runs.json'), { runs: {} });
    const panel = readJson(path.join(W, 'panel.json'), { langs: {} });
    const imgs = new Map(jsonl(path.join(W, 'images.jsonl')).map((r) => [r.slug, r.long_edge]));
    const stageOf = (r) => (r.phase === 'IB' ? 'screen' : r.phase ? `bbd-${r.phase}` : 'bbd');
    // Planned settings, then the state of each from its run dir and the score.
    for (const [lang, list] of Object.entries(plan.runs || {})) for (const r of list) {
      const key = `${lang}:${r.id}`;
      const dir = path.join(W, 'runs', lang, r.id);
      const status = fs.existsSync(path.join(dir, 'run.json')) ? 'running' : 'planned';
      settings.set(key, { id: r.id, lang, stage: stageOf(r), pages_a_call: r.ppc, long_edge: r.edge ?? null, thinking: r.think, prompt_line: promptOf(r), live: !!r.live, status, work: wi });
    }
    for (const [lang, L] of Object.entries(score.langs || {})) {
      const targets = Object.fromEntries([...(panel.langs?.[lang]?.targets || []), ...(panel.langs?.[lang]?.spares || [])].map((t) => [t.slug, t]));
      const excluded = new Set((L.excluded || []).map((e) => e.slug));
      const one = L.runs.filter((r) => r.ppc === 1 && r.finished);
      const pagesOne = one.reduce((a, r) => a + r.pages_in_run, 0);
      const c1 = pagesOne ? one.reduce((a, r) => a + r.calls, 0) / pagesOne : 1;
      const secs1 = pagesOne ? one.reduce((a, r) => a + r.secs, 0) / pagesOne : 30;
      const u1Of = (think) => { const o = one.filter((r) => r.think === think); const os = o.length ? o : one; const p = os.reduce((a, r) => a + r.pages_in_run, 0); return p ? os.reduce((a, r) => a + r.usd, 0) / p : 0; };
      for (const r of L.runs) {
        const key = `${lang}:${r.id}`;
        const dir = path.join(W, 'runs', lang, r.id);
        const meta = readJson(path.join(dir, 'run.json'), {});
        const prior = settings.get(key);
        settings.set(key, { id: r.id, lang, stage: prior?.stage ?? stageOf(r), pages_a_call: r.ppc, long_edge: r.edge ?? null, thinking: r.think, prompt_line: promptOf(meta.prompt ? meta : r), live: !!r.live, status: r.finished ? 'done' : 'running', work: wi });
        callsUsed += r.calls || 0;
        if (!r.finished) continue;
        const done = completedAt(dir);
        const u1 = u1Of(r.think);
        for (const t of r.targets) {
          const bb = r.by_book?.[t.book_id];
          if (!bb || !bb.pages) continue;
          const tg = targets[t.slug];
          let served = imgs.get(t.slug);
          if (!served && tg?.page_id) for (const c of [path.join(W, 'cache', `${tg.page_id}.jpg`)]) { const s = jpegSize(c); if (s) served = Math.max(s.w, s.h); }
          const sent = r.edge ? Math.min(r.edge, served || r.edge) : served || SERVED_MEDIAN;
          const read = t.status === 'read';
          rows.push({
            run_id: r.id, setting_id: r.id, lang, book_id: t.book_id,
            century: centuryOf(tg?.published) ?? centuryOf(tg?.period?.replace(/00s$/, '01')), face: L.faces?.[t.slug] ?? null, pool: poolOf(r.agy_home),
            cer: read && Number.isFinite(t.cer) ? t.cer : null,
            quota_cost: (usdOf(bb.tokens) + (bb.unread || 0) * u1) / bb.pages,
            calls: (bb.calls + c1 * (bb.unread || 0)) / bb.pages,
            wall_s: (bb.secs + (bb.unread || 0) * secs1) / bb.pages,
            accepted: read && !t.wrong_text && !t.loop && !t.cut,
            wrong_text: !!t.wrong_text, loop: !!t.loop, cut: !!t.cut, excluded: excluded.has(t.slug),
            long_edge_px: sent, completed_at: done,
          });
        }
      }
    }
    // A setting planned in an earlier --work dir (list them oldest first) that never ran was superseded by a later
    // design (Amendment 6's second form by its third): aborted, not still planned.
    if (wi < WORKS.length - 1) for (const s of settings.values()) if (s.status === 'planned' && s.work === wi) s.status = 'aborted';
    // A run moved to aborted/ by the experiment is aborted, whatever the plan says.
    const ab = path.join(path.dirname(W), 'aborted');
    if (fs.existsSync(ab)) for (const d of fs.readdirSync(ab)) for (const lang of ['de', 'la', 'en']) {
      const p = path.join(ab, d, lang); if (!fs.existsSync(p)) continue;
      for (const id of fs.readdirSync(p)) { const s = settings.get(`${lang}:${id}`); if (s && s.status === 'planned') s.status = 'aborted'; }
    }
  }
  for (const s of settings.values()) {
    levels.pages_a_call.add(s.pages_a_call); levels.prompt_line.add(s.prompt_line);
    levels.long_edge.add(s.long_edge ?? 'served');
  }
  const pools = readJson(POOLS, null);
  const poolWeekly = pools ? Object.fromEntries(pools.pools.map((p) => [p.pool.replace(/^\./, ''), p.weekly])) : null;
  // --weights=A[,B]: {lang: {book_id: w}} files merged in order (the 40-book panel's frame, then the census frame).
  const weights = {};
  for (const f of (arg('weights') || '').split(',').filter(Boolean)) for (const [l, m] of Object.entries(readJson(path.resolve(f), {}))) Object.assign((weights[l] ||= {}), m);
  return {
    _id: REPORT_ID,
    updated_at: new Date().toISOString(),
    source: { script: 'scripts/eval/read-surface-6740/publish-live.mjs', works: WORKS.map((w) => path.basename(w)), issue: 6740 },
    design: {
      factors: [
        { key: 'pages_a_call', levels: [...levels.pages_a_call].sort((a, b) => a - b) },
        { key: 'long_edge', levels: [...levels.long_edge].sort((a, b) => (a === 'served' ? 1 : b === 'served' ? -1 : a - b)) },
        { key: 'thinking', levels: ['low', 'medium', 'high'] },
        { key: 'prompt_line', levels: [...levels.prompt_line].sort() },
      ],
      settings: [...settings.values()].map(({ work, ...s }) => s),
    },
    rows,
    weights,
    budget: { calls_used: callsUsed, calls_max: CALLS_MAX, pool_weekly: poolWeekly },
  };
}

const frac = (s) => s.split('/').map(Number);   // "22/25" -> [22, 25]

/** confirmation.<lang> for the 8-a-call route from one confirmation's score file. */
export function confirmationFrom(file) {
  const s = readJson(path.resolve(file));
  if (!s) throw new Error(`${file}: unreadable`);
  const ROUTE = 'agy-flash-low@8', LIVE = 'agy-flash-low@4';
  if (s.unweighted) {   // relative rule (confirm-de2): paired on the books both routes read
    const u = s.unweighted, why = Object.entries(u.clauses).filter(([, ok]) => !ok).map(([k]) => `clause ${k}`);
    return {
      route: ROUTE, queue_pages: s.n_drawn, n: u.paired.n, accepted: u.paired.acc_o, wrong_text: u.paired.wt_o,
      usd_1k_accepted: u.usd_per_1k_accepted[ROUTE], passes: !!u.passes,
      why: `${s.rule.split(' ')[0]}: paired with live ${u.paired.o_only}-${u.paired.a_only}, live ${u.usd_per_1k_accepted[LIVE]} $/1k accepted; ` +
        (u.passes ? 'all clauses hold' : `fails ${why.join(', ')}`) + (u.paired.inv_o ? `; ${u.paired.inv_o} page judged invented` : ''),
    };
  }
  const r = s.strata?.all?.routes?.[ROUTE];   // absolute rule (confirm-de)
  if (!r) throw new Error(`${file}: no ${ROUTE} route`);
  const [acc, n] = frac(r.written.accept), [wt] = frac(r.written.wrong_text);
  return {
    route: ROUTE, queue_pages: s.strata.all.n_drawn, n, accepted: acc, wrong_text: wt,
    usd_1k_accepted: r.quota_usd_per_1k_accepted, passes: !!r.eligible,
    why: `${s.rule.split(' ')[0]}: wrong text ${r.written.wrong_text} over the absolute bar` + (r.written.wrong_text_ok ? '' : ' (live fails it too)'),
  };
}
export function confirmations() {
  const out = {};
  for (const spec of (arg('confirm') || '').split(',').filter(Boolean)) { const [lang, file] = spec.split(':'); out[lang] = confirmationFrom(file); }
  return out;
}

/** The same contract the page asserts on read, checked before anything is written. */
export function check(doc) {
  const bad = [];
  if (!Array.isArray(doc.design?.settings) || !doc.design.settings.length) bad.push('design.settings empty');
  if (!Array.isArray(doc.rows) || !doc.rows.length) bad.push('rows empty');
  for (const [i, r] of (doc.rows || []).entries()) {
    for (const k of ['run_id', 'setting_id', 'lang', 'book_id', 'pool']) if (typeof r[k] !== 'string') bad.push(`rows[${i}].${k}`);
    for (const k of ['quota_cost', 'calls', 'wall_s', 'long_edge_px']) if (!Number.isFinite(r[k])) bad.push(`rows[${i}].${k}`);
    if (r.cer !== null && !Number.isFinite(r.cer)) bad.push(`rows[${i}].cer`);
    if (bad.length > 10) break;
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}` && CONFIRM_ONLY) {
  const confirmation = confirmations();
  if (!Object.keys(confirmation).length) { console.error('--confirm-only needs --confirm=LANG:FILE'); process.exit(2); }
  for (const [l, c] of Object.entries(confirmation)) console.log(`confirmation.${l}: ${JSON.stringify(c)}`);
  if (!APPLY) { console.log('dry run — pass --apply to $set confirmation on ops_reports/' + REPORT_ID); process.exit(0); }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const set = Object.fromEntries(Object.entries(confirmation).map(([l, c]) => [`confirmation.${l}`, c]));
    const res = await client.db(process.env.MONGODB_DB || 'bookstore').collection('ops_reports').updateOne({ _id: REPORT_ID }, { $set: set });
    console.log(`ops_reports/${REPORT_ID}: matched ${res.matchedCount}, modified ${res.modifiedCount}`);
    if (!res.matchedCount) process.exit(1);
  } finally { await client.close(); }
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const doc = { ...build(), confirmation: confirmations() };
  const bad = check(doc);
  const byLang = {};
  for (const r of doc.rows) (byLang[r.lang] ||= new Set()).add(r.run_id);
  console.log(`${doc.rows.length} rows; runs ${Object.entries(byLang).map(([l, s]) => `${l} ${s.size}`).join(', ')}; settings ${doc.design.settings.length} (${['done', 'running', 'planned', 'aborted'].map((s) => `${doc.design.settings.filter((x) => x.status === s).length} ${s}`).join(', ')}); calls ${doc.budget.calls_used}/${doc.budget.calls_max}`);
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(doc));
  if (bad.length) { console.error(`shape check failed, nothing written: ${bad.slice(0, 10).join('; ')}`); process.exit(1); }
  if (!APPLY) { console.log('dry run — pass --apply to replace ops_reports/' + REPORT_ID); process.exit(0); }
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI missing'); process.exit(2); }
  const client = new MongoClient(uri);
  await client.connect();
  try {
    await client.db(process.env.MONGODB_DB || 'bookstore').collection('ops_reports').replaceOne({ _id: REPORT_ID }, doc, { upsert: true });
    console.log(`ops_reports/${REPORT_ID} replaced`);
  } finally { await client.close(); }
}
