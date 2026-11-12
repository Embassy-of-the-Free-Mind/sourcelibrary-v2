#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/convergent-audit-weekly.mjs `score` (one run's rates and top findings; it never compares
 * weeks, never says whether the risk stratum earned its place, and never looks at what happened to findings) and
 * scripts/audit/convergent-audit-pool.mjs (pools a week's spare rounds into one comment, rates only). This is the
 * weekly loop digest of #8632: what the audits found, by class and language, this week against the four before; how the
 * risk stratum did against the random one (the aim check); and the repair queue's state. No model calls, no writes
 * except the digest file and, with --post, one comment.
 *
 *   node scripts/eval/error-zoo/loop-week.mjs --base DIR[,DIR] [--queue queue.json] [--out digest.md] [--post 8632]
 * DIR holds audit runs (<run>/draw.json + <run>/readers/<reader>/reviews/<packet>.json), as the weekly wrapper and
 * the spare rounds write them. "This week" = runs drawn in the last 7 days; "before" = the 28 days before that.
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
const pct = (k, n) => (n ? `${Math.round(100 * k / n)}%` : '—');
const md = [`**Weekly loop digest (#8632)**: ${new Date().toISOString().slice(0, 10)}`, ''];
const W = weeks.this, B = weeks.before;
md.push(`Reads this week: ${W.length} page reads from ${new Set(W.map((x) => x.run)).size} audit runs; the four weeks before: ${B.length} from ${new Set(B.map((x) => x.run)).size}.`, '');

// aim check: risk stratum vs random, this week and before
md.push('**Did the risk stratum earn its place?** Share of pages with a serious finding:', '', '| | random | risk top decile | lane-B written |', '|---|---|---|---|');
for (const [lab, X] of [['this week', W], ['4 weeks before', B]]) {
  const r = (s) => { const xs = X.filter((x) => x.stratum === s); return `${pct(xs.filter((x) => x.serious).length, xs.length)} of ${xs.length}`; };
  md.push(`| ${lab} | ${r('random')} | ${r('risk-top-decile')} | ${r('lane-b-written')} |`);
}
md.push('', 'Random is the library rate. The risk column is the precision of the aim and is never quoted as a rate.', '');

// class movers on the random stratum, per 100 page reads
const per = (X, c) => { const xs = X.filter((x) => x.stratum === 'random'); return xs.length ? (100 * xs.filter((x) => x.classes.includes(c)).length) / xs.length : 0; };
const classes = [...new Set([...W, ...B].flatMap((x) => x.classes))];
const nB = B.filter((x) => x.stratum === 'random').length;
if (!nB) {
  const top = classes.map((c) => ({ c, now: per(W, c) })).sort((a, b) => b.now - a.now).slice(0, 6);
  md.push('**Most frequent error classes this week** (random stratum, pages per 100 with a serious finding of the class). No earlier window to compare with yet, so no movers:', '', '| class | this week |', '|---|---|');
  for (const m of top) md.push(`| ${m.c} | ${m.now.toFixed(1)} |`);
} else {
  const movers = classes.map((c) => ({ c, now: per(W, c), was: per(B, c) })).map((m) => ({ ...m, d: m.now - m.was })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6);
  md.push('**Error classes that moved** (random stratum, pages per 100 with a serious finding of the class):', '', '| class | this week | 4 weeks before | change |', '|---|---|---|---|');
  for (const m of movers) md.push(`| ${m.c} | ${m.now.toFixed(1)} | ${m.was.toFixed(1)} | ${m.d >= 0 ? '+' : ''}${m.d.toFixed(1)} |`);
}
const nW = W.filter((x) => x.stratum === 'random').length;
md.push('', nW < 40 ? `Only ${nW} random reads this week: treat any move as noise until it repeats.` : 'A move counts as a pattern only when it repeats next week; then it gets a hypothesis and a paired test.', '');

// languages: random stratum serious rate, this week vs before, where both have 10+ reads
const langs = [...new Set(W.map((x) => x.lang))];
const lrow = langs.map((l) => { const a = W.filter((x) => x.stratum === 'random' && x.lang === l), b = B.filter((x) => x.stratum === 'random' && x.lang === l); return { l, a, b }; }).filter((x) => x.a.length >= 10 && x.b.length >= 10);
if (lrow.length) {
  md.push('**By language** (random stratum, 10+ reads in both windows):', '', '| language | this week | before |', '|---|---|---|');
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
  const r = spawnSync('gh', ['issue', 'comment', POST, '--body-file', OUT], { encoding: 'utf8' });
  console.log(r.status === 0 ? `posted on #${POST}` : `post failed: ${r.stderr}`);
}
