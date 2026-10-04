#!/usr/bin/env node
/**
 * Can a cheap PAGE signal tell that a page's OCR is the reason its English is wrong? ($0) #5700.
 *
 * PRIOR ART: scripts/lib/ocr-garble-score.mjs — garbleFeatures (dictionary-hit rate against a
 * corpus-derived lexicon, vowel-less / mixed-script / fragment tokens) and ocrSelfCaution (the
 * OCR's own <unclear>/<warning>); REUSED here, not rebuilt. scripts/lib/ocr-garble-verdict.mjs —
 * its thresholds were tuned against a judge's "garbled" label, never against an image-checked
 * CAUSE. scripts/audit/ocr-garble-lexicon.mjs builds the lexicon from the ~/sl-corpus mirror,
 * which this host does not have, so a smaller Greek + Latin lexicon is built here from Mongo with
 * the same units and the same >= 3 books rule (calibration books excluded). Nothing measures any
 * of these against "OCR was the primary cause", which is the question a translate gate asks.
 *
 * Calibration set: every page of #5695 whose image was opened and whose defects were attributed
 * (T1 image-check/*.json, T2 cause-by-image.jsonl, T3 image-check.jsonl, T4 image-check.json,
 * T5 image-pass.jsonl). Positive = the reader named the OCR as the PRIMARY cause.
 *
 * Signals, each swept over thresholds:
 *   unclear     share of the page inside <unclear> plus the OCR's own gap markers ([...], […], [?])
 *   mismatch    1 − share of letters in the script the book's language is written in
 *   oov         dictionary-miss rate (Greek, Latin pages only)
 *   self        ocrSelfCaution fires (binary)
 *   no_vowel / mixed / fragment   garbleFeatures' token garbage
 *
 * Usage: node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ocr-trust-page-signal-calibration.mjs
 *          --labels=<dir with the five tracks' label files>  [--out=scripts/eval/results/ocr-trust-gate-2026-10]
 * Read-only. No model calls.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { garbleFeatures, garbleBody, tokensOf, lexiconUnitsOf, makeLexicon, ocrSelfCaution, scriptOfCodePoint, familyOf } from '../lib/ocr-garble-score.mjs';
import { stripMarkupTags } from '../lib/strip-markup-tags.mjs';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const LABELS = arg('labels');
const OUT = arg('out', 'scripts/eval/results/ocr-trust-gate-2026-10');
if (!LABELS) throw new Error('--labels=DIR (t1/ … t5/ label files; see the README for how they were collected)');
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');

// ── labels ─────────────────────────────────────────────────────────────────────────────────
const jsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const OCR_CAUSE = /^ocr_/;   // ocr_misread, and T1's ocr_abbrev (unexpanded/mis-expanded abbreviations)
const labels = [];
const add = (track, id, cause) => {
  const m = /^(.*)_(\d+)$/.exec(id);
  labels.push({ id, track, book_id: m[1], page_number: Number(m[2]), cause: cause || 'none', ocr_primary: OCR_CAUSE.test(String(cause)) });
};
for (const f of fs.readdirSync(path.join(LABELS, 't1'))) { const d = JSON.parse(fs.readFileSync(path.join(LABELS, 't1', f), 'utf8')); add('T1', d.id, d.page_cause); }
for (const d of jsonl(path.join(LABELS, 't2/cause-by-image.jsonl'))) add('T2', d.id, d.primary_cause);
for (const d of jsonl(path.join(LABELS, 't3/image-check.jsonl'))) add('T3', d.id, d.primary_cause_served);
for (const d of JSON.parse(fs.readFileSync(path.join(LABELS, 't4/image-check.json'), 'utf8'))) add('T4', d.id, d.primary_cause);
for (const d of jsonl(path.join(LABELS, 't5/image-pass.jsonl'))) add('T5', d.id, d.primary_cause);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

// ── the pages ──────────────────────────────────────────────────────────────────────────────
const EVAL_DATE = new Date('2026-10-01T00:00:00Z');   // #5695 drew its pages on 2026-10-01/02
const bookIds = [...new Set(labels.map((l) => l.book_id))];
const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }, { projection: { _id: 0, id: 1, language: 1, year: 1, published: 1 } }).toArray()).map((b) => [b.id, b]));
for (const l of labels) {
  const p = await db.collection('pages').findOne({ book_id: l.book_id, page_number: l.page_number }, { projection: { _id: 0, 'ocr.data': 1, 'ocr.model': 1, 'ocr.updated_at': 1, script_type: 1 } });
  l.language = books.get(l.book_id)?.language ?? null;
  l.ocr = p?.ocr?.data || '';
  l.ocr_model = p?.ocr?.model ?? null;
  l.script_type = p?.script_type ?? null;
  l.reread_since_eval = !!(p?.ocr?.updated_at && new Date(p.ocr.updated_at) > EVAL_DATE);
}

// ── a Greek + Latin lexicon from Mongo (units seen in >= 3 books), calibration books excluded ──
const PAGES_PER_BOOK = 8;
async function lexiconBooks(rx, cap) {
  return db.collection('books').find({ visible: true, pages_count: { $gt: 20 }, language: rx, id: { $nin: bookIds } }, { projection: { _id: 0, id: 1, pages_count: 1 } })
    .sort({ id: 1 }).limit(cap).toArray();
}
const lexBooks = [...await lexiconBooks(/^\s*(ancient\s+)?greek\b/i, 600), ...await lexiconBooks(/^\s*latin\b/i, 1200)];
const bf = new Map(), tf = new Map(), totals = {};
let lexPages = 0;
for (const b of lexBooks) {
  const step = Math.max(1, Math.floor(b.pages_count / (PAGES_PER_BOOK + 1)));
  const nums = Array.from({ length: PAGES_PER_BOOK }, (_, i) => (i + 1) * step);
  const pages = await db.collection('pages').find({ book_id: b.id, page_number: { $in: nums } }, { projection: { _id: 0, 'ocr.data': 1 } }).toArray();
  const seen = new Set();
  for (const p of pages) {
    if (!p.ocr?.data) continue;
    lexPages += 1;
    for (const [k, u] of lexiconUnitsOf(tokensOf(garbleBody(p.ocr.data)))) {
      const id = k + '\t' + u;
      tf.set(id, (tf.get(id) || 0) + 1);
      totals[k] = (totals[k] || 0) + 1;
      seen.add(id);
    }
  }
  for (const id of seen) bf.set(id, (bf.get(id) || 0) + 1);
}
const entries = {};
for (const [id, n] of bf) {
  const tab = id.indexOf('\t');
  (entries[id.slice(0, tab)] ||= []).push([id.slice(tab + 1), n, tf.get(id)]);
}
const lexicon = makeLexicon(entries, { minBooks: 3, totals });
console.error(`lexicon: ${lexBooks.length} books, ${lexPages} pages; Greek ${lexicon.size('Greek')} words, Latin ${lexicon.size('Latin')} words`);
await client.close();

// ── signals ────────────────────────────────────────────────────────────────────────────────
const EXPECTED = [
  [/^\s*(ancient\s+)?greek\b/i, 'Greek'], [/^\s*(hebrew|aramaic|yiddish)\b/i, 'Hebrew'], [/^\s*(arabic|persian|farsi|ottoman|urdu)\b/i, 'Arabic'],
  [/^\s*(sanskrit|hindi|pali|prakrit)\b/i, 'Devanagari'], [/^\s*(classical\s+)?chinese\b/i, 'CJK'], [/^\s*japanese\b/i, 'CJK'], [/^\s*tibetan\b/i, 'Tibetan'],
];
const expectedScript = (language) => EXPECTED.find(([rx]) => rx.test(String(language ?? '')))?.[1] ?? 'Latin';

function signals(l) {
  const body = garbleBody(l.ocr);
  let letters = 0, inScript = 0;
  const want = expectedScript(l.language);
  for (const ch of body) {
    const s = scriptOfCodePoint(ch.codePointAt(0));
    if (!s) continue;
    letters += 1;
    if (familyOf(s) === want) inScript += 1;
  }
  const plain = stripMarkupTags(l.ocr, '').replace(/\s+/g, ' ').trim();
  let unclear = 0;
  for (const m of l.ocr.matchAll(/<unclear[^>]*>([\s\S]*?)<\/unclear>/gi)) unclear += stripMarkupTags(m[1], '').trim().length || 3;
  const gaps = (l.ocr.match(/\[\s*(?:\.{2,}|…+|\?+|illegible|unclear|lacuna|gap)[^\]]{0,20}\]/gi) || []).length;
  const f = garbleFeatures(l.ocr, { lexicon, language: l.language });
  const lexScript = f.script === 'Greek' || f.script === 'Latin';
  return {
    letters, expected_script: want,
    unclear: plain.length ? (unclear + gaps * 5) / plain.length : null,
    mismatch: letters >= 40 ? 1 - inScript / letters : null,
    oov: f.judged && lexScript ? f.oov : null,
    self: ocrSelfCaution(l.ocr) ? 1 : 0,
    no_vowel: f.no_vowel, mixed: f.mixed, fragment: f.fragment,
  };
}
const rows = labels.filter((l) => l.ocr).map((l) => ({ ...l, ocr: undefined, sig: signals(l) }));
const missing = labels.filter((l) => !l.ocr).map((l) => l.id);

// ── precision / recall ─────────────────────────────────────────────────────────────────────
const wilson = (k, n) => {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [+((c - w) / d).toFixed(3), +((c + w) / d).toFixed(3)];
};
function sweep(set, key) {
  const judged = set.filter((r) => r.sig[key] != null);
  const pos = judged.filter((r) => r.ocr_primary).length;
  const cuts = [...new Set(judged.map((r) => r.sig[key]))].sort((a, b) => a - b);
  const points = cuts.map((t) => {
    const flagged = judged.filter((r) => r.sig[key] >= t);
    const tp = flagged.filter((r) => r.ocr_primary).length;
    return { threshold: +t.toFixed(4), flagged: flagged.length, tp, precision: +(tp / flagged.length).toFixed(3), recall: pos ? +(tp / pos).toFixed(3) : null, precision_ci: wilson(tp, flagged.length) };
  }).filter((p) => p.threshold > 0);
  // The widest-recall point that meets the bar, and (for the record) the best-F1 point.
  const ok = points.filter((p) => p.precision >= 0.8 && p.flagged >= 5).sort((a, b) => b.recall - a.recall)[0] || null;
  const f1 = (p) => (p.precision + p.recall ? 2 * p.precision * p.recall / (p.precision + p.recall) : 0);
  const best = [...points].sort((a, b) => f1(b) - f1(a))[0] || null;
  return { judged: judged.length, positives: pos, base_rate: judged.length ? +(pos / judged.length).toFixed(3) : null, meets_bar: ok, best_f1: best };
}
const SIGNALS = ['unclear', 'mismatch', 'oov', 'self', 'no_vowel', 'mixed', 'fragment'];
const groups = { all: rows, greek: rows.filter((r) => r.sig.expected_script === 'Greek'), latin_script: rows.filter((r) => r.sig.expected_script === 'Latin'), rtl: rows.filter((r) => ['Arabic', 'Hebrew'].includes(r.sig.expected_script)), indic_cjk: rows.filter((r) => ['Devanagari', 'CJK', 'Tibetan'].includes(r.sig.expected_script)) };
const result = {
  generated_at: new Date().toISOString(),
  bar: 'precision >= 0.8 (at least 5 pages flagged) at a useful recall, against "OCR was the primary cause" (image opened)',
  labelled: labels.length, scored: rows.length, missing_ocr: missing,
  positives: rows.filter((r) => r.ocr_primary).length,
  by_track: Object.fromEntries(['T1', 'T2', 'T3', 'T4', 'T5'].map((t) => [t, { n: rows.filter((r) => r.track === t).length, ocr_primary: rows.filter((r) => r.track === t && r.ocr_primary).length }])),
  reread_since_eval: rows.filter((r) => r.reread_since_eval).map((r) => r.id),
  lexicon: { books: lexBooks.length, pages: lexPages, greek_words: lexicon.size('Greek'), latin_words: lexicon.size('Latin'), rule: 'unit in >= 3 books; calibration books excluded' },
  signals: Object.fromEntries(SIGNALS.map((s) => [s, Object.fromEntries(Object.entries(groups).map(([g, set]) => [g, sweep(set, s)]))])),
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'page-signal-calibration.json'), JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(OUT, 'page-signal-rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`${rows.length} pages scored (${result.positives} OCR-primary); ${missing.length} without OCR`);
for (const s of SIGNALS) for (const [g, v] of Object.entries(result.signals[s])) {
  if (!v.judged) continue;
  const m = v.meets_bar, b = v.best_f1;
  console.log(`${s.padEnd(9)} ${g.padEnd(13)} n ${String(v.judged).padStart(3)} pos ${String(v.positives).padStart(2)} | meets bar: ${m ? `t>=${m.threshold} P ${m.precision} R ${m.recall} (${m.tp}/${m.flagged})` : 'no'} | best F1: ${b ? `t>=${b.threshold} P ${b.precision} R ${b.recall} (${b.tp}/${b.flagged})` : '-'}`);
}
