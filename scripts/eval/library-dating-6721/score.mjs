#!/usr/bin/env node
/**
 * Score dating arms against external gold (#6721). Measure = ACCURACY against an external instrument, not agreement.
 *
 * WORK gold: Wikidata inception (P571) / publication (P577) / first performance (P1191) for the WORK a book holds,
 *   reached through `books.work_id` = QID or an exact original-script label match (non-Western traditions). Gold is an
 *   interval (Wikidata precision: year, decade, century). A gold date later than the edition we hold is dropped at
 *   build time (it is a later edition's or translation's item, not the work). HIT = the gold interval intersects the
 *   arm's [from, to]. Error = |year − gold| for point gold. The window width is reported beside the hit rate, so a
 *   wide-window arm cannot buy hits unseen.
 * EDITION gold: books whose first two text leaves print the catalogue year (Arabic or Roman numerals), dated with the
 *   catalogue date WITHHELD — so the arm has to read the imprint. Exact = year equal; title_page = basis survived the
 *   verbatim-evidence check.
 *
 * BAR (brief): work HIT ≥ 85% on gold rows the arm marked high/medium confidence.
 *
 * PRIOR ART: scripts/eval/lib/agreement-stats.mjs (wilson) is used for the CIs; no dating scorer existed
 * (git grep -il "inception\|work date" scripts/eval → none).
 *
 *   node scripts/eval/library-dating-6721/score.mjs <gold-work.json> <gold-edition.json> <ref-dir> [--existing existing.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { wilson } from '../lib/agreement-stats.mjs';

const [GW, GE, DIR] = process.argv.slice(2, 5);
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const goldW = new Map(JSON.parse(fs.readFileSync(GW, 'utf8')).map((g) => [g.book_id, g]));
const goldE = new Map(JSON.parse(fs.readFileSync(GE, 'utf8')).map((g) => [g.book_id, g]));
const read = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const pct = (k, n) => (n ? `${(100 * k / n).toFixed(1)}% (${(100 * wilson(k, n)[0]).toFixed(0)}–${(100 * wilson(k, n)[1]).toFixed(0)})` : '–');
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function scoreWork(rows) {
  const r = rows.filter((x) => goldW.has(x.book_id) && x.work && x.work.year != null);
  const hit = (x) => { const g = goldW.get(x.book_id); return x.work.from <= g.hi && x.work.to >= g.lo; };
  const hm = r.filter((x) => x.confidence !== 'low');
  const pointErr = r.filter((x) => goldW.get(x.book_id).lo === goldW.get(x.book_id).hi).map((x) => Math.abs(x.work.year - goldW.get(x.book_id).lo));
  const by = (key) => { const m = {}; for (const x of hm) { const k = goldW.get(x.book_id)[key]; (m[k] ||= [0, 0]); m[k][1]++; if (hit(x)) m[k][0]++; } return m; };
  return { n: r.length, of: goldW.size, hm: hm.length, hit_hm: hm.filter(hit).length, hit_all: r.filter(hit).length, low: r.length - hm.length,
    hit_low: r.filter((x) => x.confidence === 'low').filter(hit).length,
    med_err: median(pointErr), within25: pointErr.filter((e) => e <= 25).length, npoint: pointErr.length,
    med_width: median(r.map((x) => x.work.to - x.work.from)), downgraded: r.filter((x) => x.work.basis_claimed).length,
    by_trad: by('tradition'), by_era: by('era'), misses: hm.filter((x) => !hit(x)).map((x) => ({ book_id: x.book_id, gold: [goldW.get(x.book_id).lo, goldW.get(x.book_id).hi], got: [x.work.from, x.work.to], label: goldW.get(x.book_id).label, conf: x.confidence })) };
}
function scoreEdition(rows) {
  const r = rows.filter((x) => goldE.has(x.book_id) && x.edition);
  const exact = (x) => x.edition.year === goldE.get(x.book_id).gold_edition;
  const tp = r.filter((x) => x.edition.basis === 'title_page');
  const claimed = r.filter((x) => x.edition.basis === 'title_page' || x.edition.basis_claimed === 'title_page');
  return { n: r.length, of: goldE.size, exact: r.filter(exact).length, tp: tp.length, tp_exact: tp.filter(exact).length, claimed: claimed.length, downgraded: r.filter((x) => x.edition.basis_claimed).length };
}

const arms = new Map();
for (const f of fs.readdirSync(DIR).filter((f) => /^(work|edition)-.*\.jsonl$/.test(f) && !/\.(unparsed|calls)\.jsonl$/.test(f))) {
  const [, set, arm] = f.match(/^(work|edition)-(.*)\.jsonl$/);
  const calls = fs.existsSync(path.join(DIR, f.replace(/\.jsonl$/, '.calls.jsonl'))) ? read(path.join(DIR, f.replace(/\.jsonl$/, '.calls.jsonl'))) : [];
  (arms.has(arm) || arms.set(arm, {})) && (arms.get(arm)[set] = set === 'work' ? scoreWork(read(path.join(DIR, f))) : scoreEdition(read(path.join(DIR, f))));
  arms.get(arm)[`${set}_calls`] = calls.length;
  arms.get(arm)[`${set}_secs`] = calls.length ? Math.round(calls.reduce((s, c) => s + (c.secs || 0), 0) / calls.length) : null;
}
// Amendment 3 (2026-10-14 19:26): coverage alone rewards wide windows. Interval score (Gneiting & Raftery 2007,
// alpha = 0.1): IS = (to − from) + (2/alpha) × distance from the window to the gold interval (0 when they meet).
// Lower is better. Reported with coverage and median width by confidence and by period, beside the gold's own width.
const ALPHA = 0.1;
const PERIOD = (y) => (y < 500 ? 'ancient (<500)' : y < 1450 ? 'medieval (500–1449)' : y < 1800 ? 'early modern (1450–1799)' : 'modern (1800+)');
function intervalRows(rows) {
  return rows.filter((x) => goldW.has(x.book_id) && x.work && x.work.year != null).map((x) => {
    const g = goldW.get(x.book_id); const from = Math.min(x.work.from, x.work.year); const to = Math.max(x.work.to, x.work.year);
    const miss = g.hi < from ? from - g.hi : g.lo > to ? g.lo - to : 0;
    return { conf: x.confidence, period: PERIOD(g.lo), width: to - from, gwidth: g.hi - g.lo, cover: miss === 0, is: (to - from) + (2 / ALPHA) * miss };
  });
}
function intervalTable(armRows) {
  const keysP = ['ancient (<500)', 'medieval (500–1449)', 'early modern (1450–1799)', 'modern (1800+)'];
  const cell = (r) => (r.length ? `${(100 * r.filter((x) => x.cover).length / r.length).toFixed(0)}% · ${median(r.map((x) => x.width))} · ${Math.round(r.reduce((s, x) => s + x.is, 0) / r.length)} (n=${r.length})` : '–');
  const lines = ['\n**Interval score (α = 0.1) — cell = coverage · median width (y) · mean interval score (n); high/medium rows**\n',
    `| arm | all h/m | high | medium | low | ${keysP.join(' | ')} |`, `|---|---|---|---|---|${keysP.map(() => '---').join('|')}|`];
  for (const [arm, r] of armRows) {
    const hm = r.filter((x) => x.conf !== 'low');
    lines.push(`| ${arm} | ${cell(hm)} | ${cell(r.filter((x) => x.conf === 'high'))} | ${cell(r.filter((x) => x.conf === 'medium'))} | ${cell(r.filter((x) => x.conf === 'low'))} | ${keysP.map((k) => cell(hm.filter((x) => x.period === k))).join(' | ')} |`);
  }
  const any = [...armRows.values()][0] || [];
  lines.push(`| *gold interval width (median)* | ${median(any.map((x) => x.gwidth))} | | | | ${keysP.map((k) => median(any.filter((x) => x.period === k).map((x) => x.gwidth)) ?? '–').join(' | ')} |`);
  return lines.join('\n');
}
const ivRows = new Map();
for (const f of fs.readdirSync(DIR).filter((f) => /^work-.*\.jsonl$/.test(f) && !/\.(unparsed|calls)\.jsonl$/.test(f))) ivRows.set(f.replace(/^work-|\.jsonl$/g, ''), intervalRows(read(path.join(DIR, f))));

if (arg('--existing')) arms.set('existing source_work_dates (no call)', { work: scoreWork(JSON.parse(fs.readFileSync(arg('--existing'), 'utf8'))) });

console.log('| arm | work n | HIT high/med (95% CI) | BAR | low-conf rows (hit) | HIT all | median |err| (point gold) | ≤25 y | median window | work downgraded | edition n | edition exact | title_page kept (exact) | edition downgraded | calls (work+ed) | s/call |');
console.log('|---|---:|---|---|---:|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|');
for (const [arm, a] of arms) {
  const w = a.work || {}; const e = a.edition || {};
  const pass = w.hm ? (w.hit_hm / w.hm >= 0.85 ? '**pass**' : 'fail') : '–';
  console.log(`| ${arm} | ${w.n ?? '–'}/${w.of ?? '–'} | ${pct(w.hit_hm, w.hm)} n=${w.hm ?? 0} | ${pass} | ${w.low ?? '–'} (${w.hit_low ?? '–'}) | ${pct(w.hit_all, w.n)} | ${w.med_err ?? '–'} | ${w.npoint ? pct(w.within25, w.npoint) : '–'} | ${w.med_width ?? '–'} | ${w.downgraded ?? '–'} | ${e.n ?? '–'}/${e.of ?? '–'} | ${pct(e.exact, e.n)} | ${e.tp ?? '–'} (${e.tp_exact ?? '–'}) | ${e.downgraded ?? '–'} | ${(a.work_calls || 0) + (a.edition_calls || 0)} | ${a.work_secs ?? '–'} |`);
}
console.log('\nHIT (high/medium) by tradition and era:');
const keys = (k) => [...new Set([...arms.values()].flatMap((a) => Object.keys(a.work?.[k] || {})))].sort();
for (const k of ['by_trad', 'by_era']) {
  const ks = keys(k);
  console.log(`\n| arm | ${ks.join(' | ')} |\n|---|${ks.map(() => '---').join('|')}|`);
  for (const [arm, a] of arms) console.log(`| ${arm} | ${ks.map((t) => { const v = a.work?.[k]?.[t]; return v ? `${v[0]}/${v[1]}` : '–'; }).join(' | ')} |`);
}
console.log(intervalTable(ivRows));
if (arg('--misses')) fs.writeFileSync(arg('--misses'), JSON.stringify(Object.fromEntries([...arms].map(([k, a]) => [k, a.work?.misses || []])), null, 1));
