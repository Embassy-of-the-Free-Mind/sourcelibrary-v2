#!/usr/bin/env node
// PRIOR ART: translation-vs-reference/fetch-served.mjs and from-ab-sample.mjs build harness records with ONE
// reference and machine candidates. Neither can put a human translation in the candidate seat or swap the
// reference. This turns the T1/T2 records plus the aligned second translation (ALIGN-BRIEF.md) into the two record
// sets the unchanged harness judges: reference A with B as a candidate, and reference B with A as a candidate.
/** Human ceiling (#5762): build the two harness record sets (reference = A, reference = B) with arms human / flash / lite / self, and check each B cut against its downloaded source file. */
/**
 *   node scripts/eval/translation-vs-reference/human-ceiling/build-records.mjs \
 *        --t1 <records-2.jsonl> --t2 <records-arms.jsonl> --align <dir with out-*.jsonl> --out <dir> [--min-verbatim 0.85]
 * Writes <out>/records-refA.jsonl, records-refB.jsonl (same pages, same order), pairs.json (one row per page: both
 * translators, independence, anchors, verbatim share; no texts) and dropped.json.
 * Arms: `human` = the other translator; `flash`, `lite` = the T1/T2 fresh arms (see ARM_OF); `self` = the reference
 * itself, cleaned as when it sits in the candidate seat (the judge's ceiling on its own reference: A vs A, B vs B).
 */
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, writeJsonl, itemId, words } from '../common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const OUT = opt('out'); const ALIGN = opt('align'); const MINV = Number(opt('min-verbatim', 0.85));
if (!OUT || !ALIGN || !opt('t1') || !opt('t2')) { console.error('--t1, --t2, --align and --out are required'); process.exit(1); }

// The fresh, single-page, prompt-v13 arms of the two tracks. T1 `prod-A` is production routing: Lite except the 8
// BPH books, which translate on Flash; there the Lite arm is `lite-noctx` (Lite without neighbour context, which T1
// measured inside the noise floor of Lite with it).
const ARM_OF = {
  T2: { flash: (r) => r.candidates.find((c) => c.arm === 'flash'), lite: (r) => r.candidates.find((c) => c.arm === 'lite-a') },
  T1: { flash: (r) => r.candidates.find((c) => c.arm === 'flash-0'),
    lite: (r) => { const p = r.candidates.find((c) => c.arm === 'prod-A'); return p && /lite/.test(p.model || '') ? p : r.candidates.find((c) => c.arm === 'lite-noctx'); } },
};
// A reference in the candidate seat: [context] lines lie outside the page by design; [margin] marks a marginal note.
const asCandidate = (t) => String(t).split('\n').filter((l) => !/^\s*\[context\]/i.test(l)).map((l) => l.replace(/^\s*\[margin\]\s*/i, '')).join('\n').trim();

const fold = (w) => w.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ſ/g, 's').replace(/[^\p{L}\p{N}]/gu, '');
const foldAll = (t) => words(String(t).replace(/<[^<>]{0,300}>/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ').replace(/(\p{L})[-¬∣|]\s*\n\s*/gu, '$1')).map(fold).filter(Boolean);
/**
 * Share of the cut's words that sit inside a 3-word run found, consecutively, in the downloaded source file. Many
 * sources are archive.org OCR of the printed translation or EEBO-TCP XML with gap and line-break marks, so a strict
 * long-run match fails on honest cuts; three-word runs still separate a cut from a text that is not in the file.
 */
function verbatimShare(cut, file) {
  if (!file || !fs.existsSync(file)) return null;
  const src = foldAll(fs.readFileSync(file, 'utf8')); const K = 3; const grams = new Set();
  for (let i = 0; i + K <= src.length; i++) grams.add(src.slice(i, i + K).join(' '));
  const c = foldAll(cut); const cov = new Array(c.length).fill(false);
  for (let i = 0; i + K <= c.length; i++) if (grams.has(c.slice(i, i + K).join(' '))) for (let j = i; j < i + K; j++) cov[j] = true;
  return c.length ? cov.filter(Boolean).length / c.length : null;
}

const base = Object.fromEntries([...readJsonl(opt('t2')), ...readJsonl(opt('t1'))].map((r) => [itemId(r), r]));
const aligned = fs.readdirSync(ALIGN).filter((f) => /^out-.*\.jsonl$/.test(f)).sort().flatMap((f) => readJsonl(path.join(ALIGN, f)).map((x) => ({ ...x, group: f.replace(/^out-|\.jsonl$/g, '') })));
const refA = [], refB = [], pairs = [], dropped = [];
for (const x of aligned) {
  const r = base[x.id];
  if (!r) { dropped.push({ id: x.id, reason: 'id not in T1/T2 records' }); continue; }
  if (x.skipped) { dropped.push({ id: x.id, reason: `aligner skipped: ${x.reason}`, tried: x.tried }); continue; }
  if (x.independent === false) { dropped.push({ id: x.id, reason: `not independent: ${x.independence_note}` }); continue; }
  if (x.b_meta?.private) { dropped.push({ id: x.id, reason: 'B is not open' }); continue; }
  if (!Array.isArray(x.anchors) || x.anchors.length < 3) { dropped.push({ id: x.id, reason: 'fewer than three anchors logged' }); continue; }
  const share = verbatimShare(x.b_text, x.b_meta?.source_file);
  if (share == null || share < MINV) { dropped.push({ id: x.id, reason: `B cut not recoverable from its source file (verbatim share ${share == null ? 'n/a' : share.toFixed(2)})`, source_file: x.b_meta?.source_file }); continue; }
  const arm = ARM_OF[r.track]; const flash = arm.flash(r), lite = arm.lite(r);
  if (!flash?.text || !lite?.text) { dropped.push({ id: x.id, reason: 'no flash or lite arm on this page' }); continue; }
  const aText = asCandidate(r.reference_text), bText = String(x.b_text).trim();
  const shared = { track: r.track, lang: r.lang, book_id: r.book_id, page_number: r.page_number, source_text: r.source_text,
    ...(r.source_prev_tail ? { source_prev_tail: r.source_prev_tail } : {}), ...(r.source_next_head ? { source_next_head: r.source_next_head } : {}) };
  const machine = [{ arm: 'flash', text: flash.text, model: flash.model, from_arm: flash.arm }, { arm: 'lite', text: lite.text, model: lite.model, from_arm: lite.arm }];
  const bMeta = { title: x.b_meta.title, translator: x.b_meta.translator, year: x.b_meta.year ?? null, licence: x.b_meta.licence, private: false, style: x.b_meta.style,
    canonical: !!r.reference_meta.canonical, located: x.b_meta.located, url: x.b_meta.url, ...(x.b_meta.coverage_note ? { coverage_note: x.b_meta.coverage_note } : {}) };
  refA.push({ ...shared, reference_text: r.reference_text, reference_meta: r.reference_meta, candidates: [{ arm: 'human', text: bText }, ...machine, { arm: 'self', text: aText }] });
  refB.push({ ...shared, reference_text: bText, reference_meta: bMeta, candidates: [{ arm: 'human', text: aText }, ...machine, { arm: 'self', text: bText }] });
  pairs.push({ id: x.id, track: r.track, lang: r.lang, book_id: r.book_id, page_number: r.page_number, work: r.work || r.book?.title || null,
    a: { translator: r.reference_meta.translator, year: r.reference_meta.year, title: r.reference_meta.title, style: r.reference_meta.style, licence: r.reference_meta.licence, located: r.reference_meta.located, url: r.reference_meta.url || null },
    b: { translator: x.b_meta.translator, year: x.b_meta.year, title: x.b_meta.title, style: x.b_meta.style, licence: x.b_meta.licence, located: x.b_meta.located, url: x.b_meta.url, source_edition_used_by_translator: x.b_meta.source_edition_used_by_translator || null, coverage_note: x.b_meta.coverage_note || null },
    independent: x.independent, independence_note: x.independence_note, alignment_method: x.alignment_method, anchors: x.anchors, alignment_confidence: x.alignment_confidence, variant_note: x.variant_note || null,
    b_verbatim_share: Math.round(share * 1000) / 1000, canonical: !!r.reference_meta.canonical,
    arms: { flash: { from_arm: flash.arm, model: flash.model }, lite: { from_arm: lite.arm, model: lite.model } }, words: { a: words(aText).length, b: words(bText).length } });
}
fs.mkdirSync(OUT, { recursive: true });
writeJsonl(path.join(OUT, 'records-refA.jsonl'), refA);
writeJsonl(path.join(OUT, 'records-refB.jsonl'), refB);
fs.writeFileSync(path.join(OUT, 'pairs.json'), JSON.stringify(pairs, null, 1));
fs.writeFileSync(path.join(OUT, 'dropped.json'), JSON.stringify(dropped, null, 1));
const by = (f) => Object.fromEntries([...new Set(pairs.map(f))].map((k) => [k, pairs.filter((p) => f(p) === k).length]));
console.log(JSON.stringify({ aligned: aligned.length, kept: pairs.length, dropped: dropped.length, by_lang: by((p) => p.lang), books: new Set(pairs.map((p) => p.book_id)).size, independent: by((p) => String(p.independent)) }, null, 1));
