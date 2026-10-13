#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-prereg-6388/score.mjs (the #6388 scorer: it compares ARMS under one normaliser, and
// cannot score one arm under two) and scripts/eval/quality-dashboard/trends.mjs scorePanel (today's dashboard
// point, current normaliser only). Neither puts the before and the after of a normaliser change side by side.
/**
 * What keeping digits changes (#6203 repair 1): the 90-page #6388 panel and the reference-tier pages, scored under
 * normalizeForScript v3 (letters only) and v4 (digits kept). $0, no model call. Read-only.
 *
 *   node scripts/eval/ocr-prereg-6388/rescore-digits.mjs --out DIR                      # panel, the committed P reads (2026-10-10 stored text)
 *   node --env-file=.env.production.local scripts/eval/ocr-prereg-6388/rescore-digits.mjs --out DIR --live   # + today's pages.ocr.data, + ref tiers
 *
 * v3 is reproduced exactly for the panel: its characters are v4's with the digits taken out (the panel scores
 * space-stripped text, and v3 and v4 differ only in the digits kept). For the reference tiers v3 is the committed
 * metrics.mjs of --base (default origin/main~0 before this change), loaded from git.
 * Reference tiers: ground-truth/ pages carry a book and page, so their SERVED text is re-scored (not the benchmark
 * engines' outputs, which live with the run on the main box). ground-truth-ws/ pages are not ours, so only a BOUND
 * is given: the reference's digit share, the most a page's CER can move.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as lib from './panel-key.mjs';
import { scorePanel } from '../quality-dashboard/trends.mjs';
import * as v4 from '../lib/metrics.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('out'); if (!OUT) { console.error('--out DIR required'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const REPO = path.resolve(lib.HERE, '../../..');
const pct = (x) => (x == null ? '–' : `${(100 * x).toFixed(1)}%`);
const noDigits = (a) => a.filter((c) => !/[0-9]/.test(c));

/** The panel under v3: the same pages with every digit removed from every read before the key is built. */
const v3lib = { ...lib, pageOf: (s, reads) => {
  const page = lib.pageOf(s, reads);
  if (!lib.isZh(s.stratum)) for (const [a, x] of Object.entries(page.arm)) { x.chars = noDigits(x.chars); x.outcome = lib.outcomeOf(reads[a].get(s.uid), x.chars); }
  return page;
} };
const panelOf = () => ({ sample: lib.readSample(), keyReads: Object.fromEntries(['G', 'S', 'O'].map((a) => [a, lib.readArm(a)])), keys: new Map() });
function both(texts) {
  const after = scorePanel(texts, panelOf(), lib), before = scorePanel(texts, panelOf(), v3lib);
  const moved = Object.keys(after.per_page).filter((u) => after.per_page[u] != null && before.per_page[u] != null && Math.abs(after.per_page[u] - before.per_page[u]) > 0.01)
    .map((u) => ({ uid: u, v3: before.per_page[u], v4: after.per_page[u] })).sort((a, b) => Math.abs(b.v4 - b.v3) - Math.abs(a.v4 - a.v3));
  const panel = panelOf();
  const digitPages = panel.sample.map((s) => { const d = lib.digitScore(lib.pageOf(s, { ...panel.keyReads, X: texts }), lib.READERS(s.stratum), 'X'); return d && { uid: s.uid, errors: Math.round(d.errors), key_digits: Math.round(d.denom), cer_v4: after.per_page[s.uid] }; })
    .filter((d) => d && d.errors > 0).sort((a, b) => b.errors - a.errors);
  return { before: before.strata, after: after.strata, moved, digitPages };
}
function table(name, r) {
  const L = [`### ${name}`, '', '| stratum | mean CER, digits dropped (v3) | mean CER, digits kept (v4) | failed (empty, refusal, CER > 30%) | median CER, pages with text (v3 → v4) | digits wrong |', '|---|---|---|---|---|---|'];
  for (const st of lib.STRATA) {
    const b = r.before[st], a = r.after[st];
    L.push(`| ${st} | ${pct(b.mean_cer)} | ${pct(a.mean_cer)} | ${a.failures.k} of ${a.failures.n} (${Object.entries(a.failures.kinds).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}) | ${pct(b.median_cer_text)} → ${pct(a.median_cer_text)} (n=${a.n_text}) | ${a.digits ? `${pct(a.digits.rate)} of ${a.digits.key_digits} digits, ${a.digits.pages} pages` : 'too few'} |`);
  }
  L.push('', `Pages with digit errors: ${r.digitPages.length}. Most: ${r.digitPages.slice(0, 6).map((d) => `${d.uid} ${d.errors} of ${d.key_digits} digits (page CER ${pct(d.cer_v4)})`).join('; ') || 'none'}`);
  L.push('', `Pages whose CER moves by more than 1 pt: ${r.moved.length}${r.moved.length ? ` — ${r.moved.slice(0, 12).map((m) => `${m.uid} ${pct(m.v3)} → ${pct(m.v4)}`).join('; ')}` : ''}`, '');
  return L.join('\n');
}

const report = { generated_at: new Date().toISOString(), normaliser: { before: 3, after: v4.NORMALIZE_FOR_SCRIPT_VERSION } };
const md = ['## Panel (#6388, 90 pages, AI-consensus key)', ''];
report.panel_P = both(lib.readArm('P'));
md.push(table('Stored text as read on 2026-10-10 (reads/P.jsonl.gz)', report.panel_P));

if (argv.includes('--live')) {
  const { MongoClient } = await import('mongodb');
  const client = await MongoClient.connect(process.env.MONGODB_URI); const db = client.db('bookstore');
  const sample = lib.readSample();
  const rows = await db.collection('pages').find({ id: { $in: sample.map((s) => s.page_id) } }, { projection: { _id: 0, id: 1, 'ocr.data': 1 } }).toArray();
  const byId = new Map(rows.map((p) => [p.id, p]));
  report.panel_live = both(new Map(sample.map((s) => [s.uid, { text: byId.get(s.page_id)?.ocr?.data || '' }])));
  md.push(table(`Stored text today (pages.ocr.data, ${report.generated_at.slice(0, 10)})`, report.panel_live));

  // Reference tier 1: scripts/eval/ground-truth (curated passages; a book and page each). Served text, v3 vs v4.
  const base = opt('base', 'origin/main');
  const v3file = path.join(OUT, 'metrics-v3.mjs');
  fs.writeFileSync(v3file, execFileSync('git', ['show', `${base}:scripts/eval/lib/metrics.mjs`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1e8 }).replace("'../../lib/strip-markup-tags.mjs'", JSON.stringify(path.join(REPO, 'scripts/lib/strip-markup-tags.mjs'))));
  const v3 = await import(v3file);
  if (v3.NORMALIZE_FOR_SCRIPT_VERSION !== 3) throw new Error(`--base ${base} is normaliser v${v3.NORMALIZE_FOR_SCRIPT_VERSION}, not v3`);
  const gtDir = path.join(REPO, 'scripts/eval/ground-truth');
  const gts = fs.readdirSync(gtDir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => ({ slug: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(gtDir, f), 'utf8')) })).filter((g) => g.ocr_ground_truth && g.script === 'latin' && g.book_id);
  const pinned = [];
  for (const g of gts) {
    const p = await db.collection('pages').findOne({ book_id: g.book_id, page_number: g.page_number }, { projection: { 'ocr.data': 1 } });
    const text = p?.ocr?.data || '';
    const a = v3.scoreAgainstReference(g.ocr_ground_truth, text, 'latin'), b = v4.scoreAgainstReference(g.ocr_ground_truth, text, 'latin');
    const cer = (r) => (r.charAccuracyWindowed == null ? null : 1 - r.charAccuracyWindowed);
    pinned.push({ digits_scored: b.digitsScored, slug: g.slug, language: g.language, aligned_v3: a.aligned, aligned_v4: b.aligned, cer_v3: cer(a), cer_v4: cer(b), upper_v3: 1 - a.charAccuracy, upper_v4: 1 - b.charAccuracy, digits: v4.digitChannel(g.ocr_ground_truth, text) });
  }
  await client.close();
  report.ref_pinned_served = pinned;
  const mv = pinned.filter((r) => r.cer_v3 != null && r.cer_v4 != null && Math.abs(r.cer_v4 - r.cer_v3) > 0.01);
  md.push('## Reference tier `ref-pinned` (Latin-script pages), SERVED text', '', `${pinned.length} pages. Alignment verdict changes: ${pinned.filter((r) => r.aligned_v3 !== r.aligned_v4).length}. Windowed CER moves by more than 1 pt on ${mv.length}: ${mv.map((r) => `${r.slug} ${pct(r.cer_v3)} → ${pct(r.cer_v4)}`).join('; ') || 'none'}.`,
    `Median windowed CER ${pct(med(pinned.map((r) => r.cer_v3)))} → ${pct(med(pinned.map((r) => r.cer_v4)))}. References that carry digits (so digits are scored): ${pinned.filter((r) => r.digits_scored).length} of ${pinned.length}.`, '');
}

// Reference tiers, ENGINE outputs: the five CLI arms whose reads are committed (results/ocr-pareto-6293/outputs-*.jsonl).
// v3 = scoreAgainstReference with { digits: false }, which reproduces the committed scores 779 of 779 (the control in
// ocr-pareto-6293/rescore-plan-note.mjs). The API engines' outputs are with the run on the main box.
{
  const RES = path.join(REPO, 'scripts/eval/results/ocr-pareto-6293');
  const gt = (stratum, slug) => { const f = path.join(REPO, 'scripts/eval', stratum === 'ref-pinned' ? 'ground-truth' : 'ground-truth-ws', `${slug}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const cer = (r) => (r.charAccuracyWindowed == null ? null : 1 - r.charAccuracyWindowed);
  const cells = {}, movedPages = [];
  let reads = 0;
  for (const f of fs.readdirSync(RES).filter((x) => /^outputs-.*\.jsonl$/.test(x)).sort()) for (const line of fs.readFileSync(path.join(RES, f), 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(line);
    if (!String(o.stratum).startsWith('ref-') || !(o.text || '').trim()) continue;
    const g = gt(o.stratum, o.slug);
    if (!g?.ocr_ground_truth || (g.script || 'latin') !== 'latin') continue;
    const a = v4.scoreAgainstReference(g.ocr_ground_truth, o.text, 'latin', undefined, { digits: false }), b = v4.scoreAgainstReference(g.ocr_ground_truth, o.text, 'latin');
    reads++;
    const c = (cells[`${o.stratum} · ${g.language} · ${o.engine}`] ??= { v3: [], v4: [], flips: 0 });
    if (a.aligned !== b.aligned) c.flips++;
    if (a.aligned && b.aligned) { c.v3.push(cer(a)); c.v4.push(cer(b)); if (Math.abs(cer(b) - cer(a)) > 0.01) movedPages.push({ page: `${o.stratum}|${o.slug}`, engine: o.engine, v3: cer(a), v4: cer(b), ref_digits: v4.digitsOf(g.ocr_ground_truth).length }); }
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  report.ref_tier_engines = { reads, cells: Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, { n: c.v3.length, median_v3: med(c.v3), median_v4: med(c.v4), mean_v3: mean(c.v3), mean_v4: mean(c.v4), alignment_flips: c.flips }])), moved_pages: movedPages };
  const big = Object.entries(report.ref_tier_engines.cells).filter(([, c]) => Math.abs(c.median_v4 - c.median_v3) > 0.01 || Math.abs(c.mean_v4 - c.mean_v3) > 0.01);
  md.push('## Reference tiers, engine outputs (the five committed CLI arms)', '', `${reads} Latin-script reads in ${Object.keys(cells).length} cells (tier · language · engine). Cells whose MEDIAN or MEAN windowed CER moves by more than 1 pt: ${big.length}${big.length ? ` — ${big.map(([k, c]) => `${k}: median ${pct(c.median_v3)} → ${pct(c.median_v4)}, mean ${pct(c.mean_v3)} → ${pct(c.mean_v4)} (n=${c.n})`).join('; ')}` : ''}. Alignment verdicts that flip: ${Object.values(cells).reduce((s, c) => s + c.flips, 0)}.`,
    '', `Reads whose CER moves by more than 1 pt: ${movedPages.length} on ${new Set(movedPages.map((m) => m.page)).size} pages — ${[...new Set(movedPages.map((m) => m.page))].map((pg) => { const m = movedPages.filter((x) => x.page === pg); return `${pg} (${m[0].ref_digits} reference digits; ${m.map((x) => `${x.engine.replace('+antigravity-cli', '')} ${pct(x.v3)} → ${pct(x.v4)}`).join(', ')})`; }).join('; ') || 'none'}.`, '',
    '| cell | n | median v3 → v4 | mean v3 → v4 |', '|---|---|---|---|', ...Object.entries(report.ref_tier_engines.cells).sort().map(([k, c]) => `| ${k} | ${c.n} | ${pct(c.median_v3)} → ${pct(c.median_v4)} | ${pct(c.mean_v3)} → ${pct(c.mean_v4)} |`), '');
}

// Reference tier 2: ground-truth-ws. No stored text of ours to re-score: the bound is the reference's digit share.
const wsDir = path.join(REPO, 'scripts/eval/ground-truth-ws');
const ws = fs.readdirSync(wsDir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => ({ slug: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(wsDir, f), 'utf8')) })).filter((g) => g.ocr_ground_truth && (g.script || 'latin') === 'latin');
const byLang = {};
for (const g of ws) {
  const n = v4.normalizeForScript(g.ocr_ground_truth, 'latin').replace(/ /g, ''), d = n.replace(/[^0-9]/g, '').length;
  (byLang[g.language] ??= []).push({ slug: g.slug, share: n.length ? d / n.length : 0, digits: d });
}
function med(a) { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; }
report.ref_ws_bound = Object.fromEntries(Object.entries(byLang).map(([l, a]) => [l, { n: a.length, median_digit_share: med(a.map((x) => x.share)), max_digit_share: Math.max(...a.map((x) => x.share)), pages_over_1pt: a.filter((x) => x.share > 0.01).length }]));
md.push('## Reference tier `ref-ws` (Wikisource pages): bound only', '', 'The digit share of each reference is the most that page\'s CER can move; a cell\'s median can move by more than 1 pt only if most of its pages are above 1%.', '', '| language | pages | median digit share | max | pages above 1% |', '|---|---|---|---|---|',
  ...Object.entries(report.ref_ws_bound).sort().map(([l, x]) => `| ${l} | ${x.n} | ${pct(x.median_digit_share)} | ${pct(x.max_digit_share)} | ${x.pages_over_1pt} |`), '');

fs.writeFileSync(path.join(OUT, 'rescore-digits.json'), JSON.stringify(report, null, 1) + '\n');
fs.writeFileSync(path.join(OUT, 'rescore-digits.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
