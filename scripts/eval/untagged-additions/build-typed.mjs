#!/usr/bin/env node
// PRIOR ART: scripts/eval/benchmark-refs.mjs, latin-period-refs-5126.mjs, build-greek-corpus.mjs and
// build-reference-groundtruth.mjs BUILD the typed references (benchmark/refs/, ground-truth/) and benchmark-score.mjs
// scores OCR against them by CER. None pairs a typed page text with the page's stored TRANSLATION. This only joins
// the committed references to the live page (read-only) for the #5982 detector.
/** #5982 step 3b: live translated pages that also have a committed human-typed text of the page; one item against the typed text, one against our OCR. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/untagged-additions/build-typed.mjs
 * Sources (all committed, $0): benchmark/refs/ed-* (CAMENA, la.wikisource, EEBO-TCP; not the by-eye corrected OCR),
 * greek-* (Perseus, First1KGreek, el.wikisource windows), chinese-* (Kanripo, CBETA), ground-truth/*.json, and the
 * Esukhia folios of results/folio-markers-5678/pages (Tibetan: measured, never translated here).
 * Kept: a non-English page with a stored translation and OCR, whose typed text covers the page
 * (typed letters ÷ OCR running-text letters between 0.6 and 1.6). Output: typed.jsonl (ids; committed), work/typed-items.jsonl.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { sourceParts } from './detector.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const DIR = path.join(ROOT, 'results/untagged-additions-2026-10');
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
const letters = (t) => (String(t).match(/[\p{L}\p{N}]/gu) || []).length;
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const cands = [];
const REFS = path.join(ROOT, 'benchmark/refs');
// manifests give slug -> book/page for the greek and chinese windows
const bySlug = {};
for (const m of fs.readdirSync(path.join(ROOT, 'benchmark')).filter((f) => f.endsWith('.json'))) {
  const j = J(path.join(ROOT, 'benchmark', m));
  for (const key of ['pages', 'items', 'samples', 'sample', 'spares']) for (const r of Array.isArray(j[key]) ? j[key] : []) if (r.slug && r.book_id) bySlug[r.slug] = { book_id: r.book_id, page_number: Number(r.page_number), language: r.language };
  if (Array.isArray(j)) for (const r of j) if (r.slug && r.book_id) bySlug[r.slug] = { book_id: r.book_id, page_number: Number(r.page_number), language: r.language };
}
for (const f of fs.readdirSync(REFS).filter((x) => x.endsWith('.json') && /^(ed|greek|chinese)-/.test(x))) {
  const txt = path.join(REFS, f.replace(/\.json$/, '.txt')); if (!fs.existsSync(txt)) continue;
  const j = J(path.join(REFS, f)); const slug = f.replace(/\.json$/, '');
  if (j.kind === 'corrected-served-ocr') continue; // our OCR corrected by eye: not an independent typed text
  const at = j.book_id ? { book_id: j.book_id, page_number: Number(j.page_number), language: bySlug[slug]?.language } : bySlug[slug];
  if (!at) continue;
  cands.push({ ...at, typed: fs.readFileSync(txt, 'utf8'), ref: `benchmark/refs/${slug}`, ref_source: j.source || null, ref_kind: j.kind || (slug.startsWith('ed-') ? 'same-edition' : 'e-text-window'), licence: j.licence || null, overlap: j.window?.overlap ?? j.overlap ?? null });
}
for (const f of fs.readdirSync(path.join(ROOT, 'ground-truth')).filter((x) => x.endsWith('.json'))) {
  const j = J(path.join(ROOT, 'ground-truth', f)); if (!j.book_id || !j.ocr_ground_truth) continue;
  cands.push({ book_id: j.book_id, page_number: Number(j.page_number), language: j.language, typed: j.ocr_ground_truth, ref: `ground-truth/${f}`, ref_source: j.source || null, ref_kind: 'pinned-passage', licence: null, overlap: null });
}
const FOLIO = path.join(ROOT, 'results/folio-markers-5678/pages');
if (fs.existsSync(FOLIO)) for (const f of fs.readdirSync(FOLIO).filter((x) => x.endsWith('.json'))) {
  const j = J(path.join(FOLIO, f)); if (!j.book_id || !j.tibetan) continue;
  cands.push({ book_id: j.book_id, page_number: Number(j.page_number), language: 'Tibetan', typed: j.tibetan, ref: `results/folio-markers-5678/pages/${f}`, ref_source: 'Esukhia derge-tengyur e-text (stored as the page text)', ref_kind: 'esukhia-folio', licence: 'public domain', overlap: null });
}
console.log(`typed candidates: ${cands.length}`);

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const P = c.db('bookstore').collection('pages');
const rows = []; const items = []; const drop = {};
const seen = new Set();
for (const k of cands) {
  const id = `${k.book_id}_${String(k.page_number).padStart(5, '0')}`;
  const why = (w) => { drop[w] = (drop[w] || 0) + 1; };
  if (seen.has(id)) { why('second reference for the same page'); continue; }
  if (/^english$/i.test(String(k.language || ''))) { why('English page (no translation to check)'); continue; }
  const around = await P.find({ book_id: k.book_id, page_number: { $in: [k.page_number - 1, k.page_number, k.page_number + 1] } }).project({ _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1 }).toArray();
  const p = around.find((x) => x.page_number === k.page_number);
  if (!p) { why('page not found'); continue; }
  if (!p.translation?.data?.trim()) { why('no stored translation'); continue; }
  if (!p.ocr?.data?.trim()) { why('no stored OCR'); continue; }
  const ocrRun = sourceParts(p.ocr.data).text;
  const cover = letters(k.typed) / Math.max(1, letters(ocrRun));
  const tibetan = k.ref_kind === 'esukhia-folio';
  if (!tibetan && (cover < 0.6 || cover > 1.6)) { why(`typed text does not cover the page (ratio ${cover < 0.6 ? '< 0.6' : '> 1.6'})`); continue; }
  seen.add(id);
  const prev = around.find((x) => x.page_number === k.page_number - 1)?.ocr?.data || ''; const next = around.find((x) => x.page_number === k.page_number + 1)?.ocr?.data || '';
  rows.push({ id, book_id: k.book_id, page_number: k.page_number, language: k.language || null, ref: k.ref, ref_source: k.ref_source, ref_kind: k.ref_kind, licence: k.licence, overlap: k.overlap, cover: +cover.toFixed(2), model: p.translation.model || null, prompt_version: p.translation.prompt_version == null ? null : String(p.translation.prompt_version), ocr_model: p.ocr.model || null, ocr_source: p.ocr.source || null, ocr_is_the_typed_text: tibetan, translation_sha16: sha(p.translation.data), ocr_sha16: sha(p.ocr.data) });
  items.push({ id: `typed:${id}`, source: k.typed, source_kind: 'typed', translation: p.translation.data, prev: prev.slice(-1500), next: next.slice(0, 1500) });
  if (!tibetan) items.push({ id: `ocr:${id}`, source: p.ocr.data, source_kind: 'ocr', translation: p.translation.data, prev: prev.slice(-1500), next: next.slice(0, 1500) });
}
await c.close();
fs.writeFileSync(path.join(DIR, 'typed.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(DIR, 'work/typed-items.jsonl'), items.map((r) => JSON.stringify(r)).join('\n') + '\n');
const by = {}; for (const r of rows) { const k = `${r.language} / ${r.ref_kind}`; by[k] = (by[k] || 0) + 1; }
fs.writeFileSync(path.join(DIR, 'typed.meta.json'), JSON.stringify({ candidates: cands.length, kept: rows.length, dropped: drop, kept_by_language_and_kind: by }, null, 1));
console.log(`kept ${rows.length} pages (${items.length} items)`, by, '\ndropped', drop);
