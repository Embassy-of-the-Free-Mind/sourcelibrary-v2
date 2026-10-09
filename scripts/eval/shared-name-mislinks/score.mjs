#!/usr/bin/env node
// PRIOR ART: scripts/eval/search-recall/run.mjs — scores search result lists against expected
// books. scripts/eval/benchmark-score.mjs — scores OCR output against references. Neither scores
// by-eye "which person is this" verdicts against the Wikidata id a record carries.
/**
 * Score the by-eye verdicts of the shared-surname sample (#5950). Reads sample.jsonl, frame.json
 * and verdicts.tsv from this directory; no database, no model.
 *
 * A mention is MISLINKED when its bare-surname record carries a Wikidata id and the page means
 * someone (or something) else. A record with no Wikidata id claims nobody, so it cannot mislink:
 * for those the split between the people is reported instead.
 *
 * Intervals: Wilson 95% on the pooled count, and a percentile bootstrap that resamples whole
 * surnames (mentions of one surname are not independent — the rate is a property of the record).
 *
 * Usage: node scripts/eval/shared-name-mislinks/score.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sample = fs.readFileSync(path.join(HERE, 'sample.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const frame = JSON.parse(fs.readFileSync(path.join(HERE, 'frame.json'), 'utf8'));
const [head, ...lines] = fs.readFileSync(path.join(HERE, 'verdicts.tsv'), 'utf8').trim().split('\n');
const cols = head.split('\t').map(c => c === 'wikidata_id_in_entities' ? 'wikidata_id' : c);
const verdicts = new Map(lines.map(l => { const v = Object.fromEntries(l.split('\t').map((x, i) => [cols[i], x])); return [v.key, v]; }));

export function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 1];
  const p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const missing = sample.filter(r => !verdicts.has(r.key)).map(r => r.key);
if (missing.length) { console.error(`no verdict for: ${missing.join(', ')}`); process.exit(1); }

const per = [];
for (const f of frame.surnames) {
  const rows = sample.filter(r => r.surname === f.surname).map(r => verdicts.get(r.key));
  const split = {};
  for (const v of rows) split[v.person] = (split[v.person] ?? 0) + 1;
  const row = { surname: f.surname, record_wikidata_id: f.record_wikidata_id, frame_live_books: f.frame_live_books, n: rows.length, split };
  if (f.record_wikidata_id) {
    row.right = rows.filter(v => v.wikidata_id.split('+').includes(f.record_wikidata_id)).length;
    row.mislinked = row.n - row.right;
  } else {
    const top = Object.entries(split).filter(([p]) => p !== 'undetermined').sort((a, b) => b[1] - a[1])[0];
    row.largest_share = { person: top[0], n: top[1] };
    row.undetermined = split.undetermined ?? 0;
  }
  per.push(row);
}

const claimed = per.filter(p => p.record_wikidata_id);
const k = claimed.reduce((s, p) => s + p.mislinked, 0), n = claimed.reduce((s, p) => s + p.n, 0);
const weighted = (rows) => rows.reduce((s, p) => s + p.frame_live_books * p.mislinked / p.n, 0) / rows.reduce((s, p) => s + p.frame_live_books, 0);
const rnd = mulberry32(5950);
const boot = [], bootW = [];
for (let i = 0; i < 10000; i++) {
  const draw = claimed.map(() => claimed[Math.floor(rnd() * claimed.length)]);
  boot.push(draw.reduce((s, p) => s + p.mislinked, 0) / draw.reduce((s, p) => s + p.n, 0));
  bootW.push(weighted(draw));
}
const pct = (arr, q) => [...arr].sort((a, b) => a - b)[Math.floor(q * (arr.length - 1))];
const report = {
  records_with_wikidata_id: {
    surnames: claimed.length, mentions: n, mislinked: k, rate: k / n,
    wilson95: wilson(k, n), surname_bootstrap95: [pct(boot, 0.025), pct(boot, 0.975)],
    weighted_by_frame_books: { rate: weighted(claimed), surname_bootstrap95: [pct(bootW, 0.025), pct(bootW, 0.975)] },
    mislinked_books_estimate: Math.round(claimed.reduce((s, p) => s + p.frame_live_books * p.mislinked / p.n, 0)),
    frame_books: claimed.reduce((s, p) => s + p.frame_live_books, 0),
  },
  records_without_wikidata_id: {
    surnames: per.length - claimed.length,
    mentions: per.filter(p => !p.record_wikidata_id).reduce((s, p) => s + p.n, 0),
    frame_books: per.filter(p => !p.record_wikidata_id).reduce((s, p) => s + p.frame_live_books, 0),
  },
  confidence: Object.fromEntries(['high', 'medium', 'low'].map(c => [c, [...verdicts.values()].filter(v => v.confidence === c).length])),
  per_surname: per,
};

if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  const f = (x) => (100 * x).toFixed(0) + '%';
  for (const p of per) {
    const tail = p.record_wikidata_id ? `mislinked ${p.mislinked}/${p.n}` : `no id; largest: ${p.largest_share.person} ${p.largest_share.n}/${p.n}`;
    console.log(`${p.surname.padEnd(12)} ${String(p.record_wikidata_id ?? '—').padEnd(10)} frame ${String(p.frame_live_books).padStart(4)}  ${tail}`);
  }
  const r = report.records_with_wikidata_id;
  console.log(`\nrecords with a Wikidata id: ${r.mislinked}/${r.mentions} mislinked = ${f(r.rate)}  Wilson 95% ${f(r.wilson95[0])}–${f(r.wilson95[1])}  by-surname bootstrap 95% ${f(r.surname_bootstrap95[0])}–${f(r.surname_bootstrap95[1])}`);
  console.log(`weighted by each record's books: ${f(r.weighted_by_frame_books.rate)} (${f(r.weighted_by_frame_books.surname_bootstrap95[0])}–${f(r.weighted_by_frame_books.surname_bootstrap95[1])}) ≈ ${r.mislinked_books_estimate} of ${r.frame_books} books`);
  console.log(`confidence of verdicts: ${JSON.stringify(report.confidence)}`);
}
