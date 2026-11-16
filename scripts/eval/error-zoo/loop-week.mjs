#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/convergent-audit-weekly.mjs `score` (one run's rates and top findings; it never compares
 * weeks, never says whether the risk stratum earned its place, and never looks at what happened to findings) and
 * scripts/audit/convergent-audit-pool.mjs (pools a week's spare rounds into one comment, rates only). This is the
 * weekly loop digest of #8632: what the audits found, by class and language, this week against the four before; how the
 * risk stratum did against the random one (the aim check); and the repair queue's state. No model calls, no writes
 * except the digest file and, with --post, one comment.
 *
 *   node [--env-file=…] scripts/eval/error-zoo/loop-week.mjs --base DIR[,DIR] [--book-checks] [--queue queue.json] [--out digest.md] [--post 8632]
 * DIR holds audit runs (<run>/draw.json + <run>/readers/<reader>/reviews/<packet>.json), as the weekly wrapper and
 * the spare rounds write them. "This week" = runs drawn in the last 7 days; "before" = the 28 days before that.
 *
 * --book-checks (v3#381) also reads the paired-fifths book checks (book_checks, method paired-fifths-check) of the
 * same windows from Mongo: since 2026-11-15 the daily lane on cloudlayer is the QA read and the weekly single-page
 * round is off by default, so without it "this week" would be empty. Their strata are books, not pages: `pf-uniform`
 * (uniform inside a language x form cell, equal books a cell, so NOT the library rate) and `pf-risk`
 * (book-check-priority); a check with no book stratum is `pf-other`, counted in the totals only. Classes are compared
 * only within one instrument.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const BASES = (arg('base', '') || '').split(',').filter(Boolean);
const QUEUE = arg('queue'), OUT = arg('out', '/tmp/loop-week.md'), POST = arg('post');
const now = Date.now(), DAY = 86400e3;
const CODE = /\b([IOTDE]\d{1,2})\b/;
const langOf = (l) => String(l || '?').split(/[,;/(]| and /)[0].trim() || '?';

const weeks = { this: [], before: [] };
for (const base of BASES) for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
  const f = path.join(base, d, 'draw.json'); if (!fs.existsSync(f)) continue;
  let draw; try { draw = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  const age = (now - Date.parse(draw.drawn_at)) / DAY;
  const bucket = age <= 7 ? 'this' : age <= 35 ? 'before' : null; if (!bucket) continue;
  for (const reader of ['opus', 'gemini37']) {
    const rd = path.join(base, d, 'readers', reader, 'reviews'); if (!fs.existsSync(rd)) continue;
    for (const pg of draw.pages) {
      let rv; try { rv = JSON.parse(fs.readFileSync(path.join(rd, `${pg.packet}.json`), 'utf8'))[0].pages[0]; } catch { continue; }
      const errs = [...(rv.ocr_errors || []), ...(rv.tr_errors || []), ...(rv.other || [])].filter((e) => e.severity === 'serious');
      weeks[bucket].push({ run: d, reader, stratum: pg.stratum, lang: langOf(pg.language), serious: errs.length > 0 || rv.right_page === 'no', classes: [...new Set(errs.map((e) => (String(e.class || '').match(CODE) || [])[1]).filter(Boolean))] });
    }
  }
}
// The paired-fifths book checks (v3#381): one row per page read, serious = the page has a finding.
if (process.argv.includes('--book-checks')) {
  const { MongoClient } = await import('mongodb');
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  try {
    const since = new Date(now - 35 * DAY);
    const cur = client.db('bookstore').collection('book_checks').find({ method_id: 'paired-fifths-check', checked_at: { $gte: since } },
      { projection: { run_id: 1, checked_at: 1, frame: 1, pages_read: 1, page_findings: 1 } }).batchSize(1000);
    for await (const c of cur) {
      const age = (now - new Date(c.checked_at).getTime()) / DAY;
      const bucket = age <= 7 ? 'this' : 'before';
      const pf = new Map((c.page_findings || []).map((f) => [f.page_number, f]));
      // A check with no book stratum (the one-off runs before the rounds, e.g. pfc-p5-2026-11-10) is neither: pf-other.
      const stratum = { uniform: 'pf-uniform', risk: 'pf-risk' }[c.frame?.stratum] ?? 'pf-other';
      for (const pn of c.pages_read || []) {
        const f = pf.get(pn);
        weeks[bucket].push({ run: c.run_id, reader: 'paired-fifths', stratum, lang: langOf(String(c.frame?.cell || '?').split('/')[0]), serious: !!f,
          classes: [...new Set((f?.errors || []).map((e) => (String(e.class || '').match(CODE) || [])[1]).filter(Boolean))] });
      }
    }
  } finally { await client.close(); }
}
const pct = (k, n) => (n ? `${Math.round(100 * k / n)}%` : '—');
const md = [`**Weekly loop digest (#8632)**: ${new Date().toISOString().slice(0, 10)}`, ''];
const W = weeks.this, B = weeks.before;
md.push(`Reads this week: ${W.length} page reads from ${new Set(W.map((x) => x.run)).size} audit runs; the four weeks before: ${B.length} from ${new Set(B.map((x) => x.run)).size}.`, '');

// aim check: risk stratum vs random, this week and before
md.push('**Did the risk stratum earn its place?** Share of pages with a serious finding:', '', '| | random | risk top decile | lane-B written | paired-fifths uniform | paired-fifths risk |', '|---|---|---|---|---|---|');
for (const [lab, X] of [['this week', W], ['4 weeks before', B]]) {
  const r = (s) => { const xs = X.filter((x) => x.stratum === s); return `${pct(xs.filter((x) => x.serious).length, xs.length)} of ${xs.length}`; };
  md.push(`| ${lab} | ${r('random')} | ${r('risk-top-decile')} | ${r('lane-b-written')} | ${r('pf-uniform')} | ${r('pf-risk')} |`);
}
md.push('', 'Random is the library rate (single pages). Paired-fifths uniform is ten pages a book, equal books in every language x form cell, so it over-weights small cells and is not the library rate. The risk columns are the precision of the aim and are never quoted as rates.', '');

// class movers, per instrument, on its unaimed stratum (single pages: random; paired fifths: uniform), per 100 page reads
for (const [ref, name] of [['random', 'single-page random stratum'], ['pf-uniform', 'paired-fifths uniform stratum']]) {
  const nW = W.filter((x) => x.stratum === ref).length;
  if (!nW) continue;
  const per = (X, c) => { const xs = X.filter((x) => x.stratum === ref); return xs.length ? (100 * xs.filter((x) => x.classes.includes(c)).length) / xs.length : 0; };
  const classes = [...new Set([...W, ...B].filter((x) => x.stratum === ref).flatMap((x) => x.classes))];
  const nB = B.filter((x) => x.stratum === ref).length;
  if (!nB) {
    const top = classes.map((c) => ({ c, now: per(W, c) })).sort((a, b) => b.now - a.now).slice(0, 6);
    md.push(`**Most frequent error classes this week** (${name}, pages per 100 with a serious finding of the class). No earlier window to compare with yet, so no movers:`, '', '| class | this week |', '|---|---|');
    for (const m of top) md.push(`| ${m.c} | ${m.now.toFixed(1)} |`);
  } else {
    const movers = classes.map((c) => ({ c, now: per(W, c), was: per(B, c) })).map((m) => ({ ...m, d: m.now - m.was })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6);
    md.push(`**Error classes that moved** (${name}, pages per 100 with a serious finding of the class):`, '', '| class | this week | 4 weeks before | change |', '|---|---|---|---|');
    for (const m of movers) md.push(`| ${m.c} | ${m.now.toFixed(1)} | ${m.was.toFixed(1)} | ${m.d >= 0 ? '+' : ''}${m.d.toFixed(1)} |`);
  }
  md.push('', nW < 40 ? `Only ${nW} ${ref} reads this week: treat any move as noise until it repeats.` : 'A move counts as a pattern only when it repeats next week; then it gets a hypothesis and a paired test.', '');
}
if (!W.some((x) => x.stratum === 'random' || x.stratum === 'pf-uniform')) md.push('No unaimed reads this week (neither a single-page random stratum nor a paired-fifths uniform round), so no class rates.', '');

// languages: random stratum serious rate, this week vs before, where both have 10+ reads
const langs = [...new Set(W.map((x) => x.lang))];
const unaimed = (x) => x.stratum === 'random' || x.stratum === 'pf-uniform';
const lrow = langs.map((l) => { const a = W.filter((x) => unaimed(x) && x.lang === l), b = B.filter((x) => unaimed(x) && x.lang === l); return { l, a, b }; }).filter((x) => x.a.length >= 10 && x.b.length >= 10);
if (lrow.length) {
  md.push('**By language** (unaimed reads: single-page random and paired-fifths uniform pages, 10+ in both windows):', '', '| language | this week | before |', '|---|---|---|');
  for (const x of lrow) md.push(`| ${x.l} | ${pct(x.a.filter((y) => y.serious).length, x.a.length)} of ${x.a.length} | ${pct(x.b.filter((y) => y.serious).length, x.b.length)} of ${x.b.length} |`);
  md.push('');
}

// repair queue
if (QUEUE && fs.existsSync(QUEUE)) {
  const Q = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  md.push(`**Repair queue** (built ${String(Q.built_at).slice(0, 10)}${Q.second_read_at ? `, second read ${String(Q.second_read_at).slice(0, 10)}` : ''}, router table ${Q.router_table}): ${Q.n} flagged pages.`, '');
  md.push('| status | pages |', '|---|---|', ...Object.entries(Q.by_status).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`), '');
  const noRoute = Object.entries(Q.by_cell).map(([c, v]) => [c, v.statuses['no-route'] || 0]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (noRoute.length) md.push(`Largest cells with findings but no decided route: ${noRoute.map(([c, n]) => `\`${c}\` ${n}`).join(', ')}. A route test there unlocks the most flagged pages.`, '');
}
md.push('_Built by `scripts/eval/error-zoo/loop-week.mjs`; reads only. Repairs from the queue are a decision, never automatic._');
fs.writeFileSync(OUT, md.join('\n') + '\n');
console.log(md.join('\n'));
if (POST) {
  // v2#8632 lives on the public mirror since the 2026-11-12 move; origin (v3) has no such issue.
  const r = spawnSync('gh', ['issue', 'comment', POST, '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--body-file', OUT], { encoding: 'utf8' });
  console.log(r.status === 0 ? `posted on #${POST}` : `post failed: ${r.stderr}`);
}
