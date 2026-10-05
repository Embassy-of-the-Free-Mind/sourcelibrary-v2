#!/usr/bin/env node
/**
 * PRIOR ART: scripts/import/ia-ocr-ingest.mjs — the provisional `ia_djvu` lane. It reads the Archive
 * OCR of the SAME item the book was scanned from, leaf k ↔ page k, and it has already refused both
 * Birch volumes (#5811: agreement 0.62 on the Ghent scans, long-s). It has no notion of a different
 * copy, so it cannot map leaves of another scan onto our pages. This script reuses its pieces
 * unchanged — iaOcrMeta/iaFetch/iaProvenance (ia-ocr-meta.mjs), agreement() (ia-ocr-agreement.mjs),
 * the per-language cutoff (ia-ocr-gate.mjs), dehyphenateLineBreaks, wasRecitationRefused — and adds
 * only the cross-copy page mapping.
 *
 * other-copy-ocr-5811 — fill RECITATION-refused pages from ANOTHER scan of the same edition (#5811).
 *
 * MAPPING (why a page is safe to fill). For every page we already read, find the other copy's leaf
 * that matches it best (agreement over a ±12-leaf window around the running offset). A refused page P
 * is filled from leaf L only when ALL hold:
 *   1. bracket: the nearest read pages before and after P map with the SAME offset (L = P + offset),
 *      each at ≥ BRACKET_MIN — so no leaf was skipped or doubled between them in either scan;
 *   2. the copy as a whole clears the language cutoff (median over all matched pages; English 0.80);
 *   3. catchword: in the other copy, leaf L-1's catchword opens leaf L, or leaf L's catchword opens
 *      leaf L+1 (at least one link; the Archive garbles some catchwords, e.g. "attracl"). A page with no catchword on either side is reported, not filled.
 *   4. plausibility: leaf L has ≥ 40 words.
 * Written as `ocr.source: 'ia_djvu'` (the reader already tones it amber as Archive OCR) with
 * `ocr.ia.item` = the OTHER item and `ocr.other_copy` = { leaf, offset, bracket, catchword } —
 * never onto a page that already has text (human edits included), with a page_revisions save first.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/other-copy-ocr-5811.mjs \
 *     --book <id> --items a,b,c [--lexicon-books id,id] [--use <item> --apply]
 */
import { withMongo } from '../lib/mongo.mjs';
import { iaFetch, iaOcrMeta, iaProvenance } from '../lib/ia-ocr-meta.mjs';
import { agreement, tokensBody } from '../lib/ia-ocr-agreement.mjs';
import { iaOcrMinAgreement } from '../lib/ia-ocr-gate.mjs';
import { dehyphenateLineBreaks } from '../lib/dehyphenate.mjs';
import { wasRecitationRefused } from '../lib/ia-ocr-cohort.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';

const arg = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const BOOK = arg('--book');
const ITEMS = (arg('--items') || '').split(',').filter(Boolean);
const APPLY = process.argv.includes('--apply');
const ONLY_ITEM = arg('--use');
const LEX_BOOKS = (arg('--lexicon-books') || '').split(',').filter(Boolean);           // with --apply: the item chosen from the dry run
const CACHE = '/tmp/other-copy-5811';
const SWEEP = 'drebbel-creative-5811';
// A neighbour is "the same printed page" at ≥ 0.6 (unrelated pages of this book score < 0.3); the
// QUALITY bar is the copy's median against the language cutoff, applied separately.
const BRACKET_MIN = 0.6;
if (!BOOK || !ITEMS.length) { console.error('usage: --book <id> --items a,b [--use <item> --apply]'); process.exit(1); }
fs.mkdirSync(CACHE, { recursive: true });

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
// Same leaf → text rule as ia-ocr-ingest.mjs leafTexts (not exported there).
function leafTexts(xml) {
  return xml.split(/<OBJECT\b/).slice(1).map((o) => o.split(/<PARAGRAPH\b/).slice(1).map((p) =>
    p.split(/<LINE\b/).slice(1).map((l) => [...l.matchAll(/<WORD[^>]*>([\s\S]*?)<\/WORD>/g)].map((m) => decode(m[1]).trim()).filter(Boolean).join(' '))
      .filter(Boolean).join('\n')).filter(Boolean).join('\n\n'));
}
async function leaves(item) {
  const f = `${CACHE}/${item}.leaves.json`;
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const meta = await iaOcrMeta(item);
  if (meta.djvu_xml_files?.length !== 1) return { error: `djvu xml files: ${JSON.stringify(meta.djvu_xml_files)}` };
  const res = await iaFetch(`https://archive.org/download/${item}/${meta.djvu_xml_files[0]}`);
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const out = { meta, file: meta.djvu_xml_files[0], leaves: leafTexts(await res.text()).map(dehyphenateLineBreaks) };
  fs.writeFileSync(f, JSON.stringify(out));
  return out;
}
// LONG-S. ABBYY reads the 1756 ſ as f ("fociety"), which is what sank the same-scan lane (0.62).
// Restore it against a lexicon built from THIS book's own model-read pages (same edition, same
// spelling; the model keeps ſ, folded to s here): a word containing f that the lexicon does not know is replaced by the f→s variant the
// lexicon knows best, if that s-form is at least 5× as frequent as the f-form ("of", "first", "fire" stay). Counted per page.
function buildLexicon(texts) {
  const lex = new Map();
  for (const t of texts) for (const w of (t || '').replace(/<[^>]+>/g, ' ').replace(/ſ/g, 's').toLowerCase().match(/\p{L}+/gu) || []) lex.set(w, (lex.get(w) || 0) + 1);
  return lex;
}
function restoreLongS(text, lex) {
  let n = 0;
  const out = text.replace(/\p{L}+/gu, (w) => {
    const lw = w.toLowerCase();
    if (!lw.includes('f')) return w;
    const fN = lex.get(lw) || 0; // the model itself writes "fhould" now and then (4 vs 585 in Birch II)
    const idx = [...lw].map((c, i) => (c === 'f' ? i : -1)).filter((i) => i >= 0);
    if (idx.length > 5) return w;
    let best = null, bestN = 0;
    for (let mask = 1; mask < 1 << idx.length; mask++) {
      const cand = [...lw]; idx.forEach((i, b) => { if (mask & (1 << b)) cand[i] = 's'; });
      const c = cand.join(''); const f = lex.get(c) || 0;
      if (f > bestN) { best = c; bestN = f; }
    }
    if (!best || bestN < 5 * fN || bestN < 2) return w;
    n++;
    return [...w].map((ch, i) => (ch === 'f' && best[i] === 's' ? 's' : ch === 'F' && best[i] === 's' ? 'S' : ch)).join('');
  });
  return { text: out, n };
}
const words = (t) => (t || '').replace(/<[^>]+>/g, ' ').replace(/->|<-/g, ' ').split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, '').toLowerCase().replace(/ſ/g, 's')).filter(Boolean);
// long-s blind: the Archive reads ſ as f; compare catchwords with f≡s.
const fold = (w) => (w || '').replace(/f/g, 's');
const lastWord = (t) => fold(words(t).at(-1));
const firstBody = (t) => { const w = words(t); return w.slice(0, 12).map(fold); }; // header (running title, folio) precedes the first body word

await withMongo(async (db) => {
  const book = await db.collection('books').findOne({ id: BOOK }, { projection: { id: 1, title: 1, language: 1 } });
  const { cutoff } = iaOcrMinAgreement(book.language);
  const pages = await db.collection('pages').find({ book_id: BOOK }).project({ id: 1, page_number: 1, ocr: 1 }).sort({ page_number: 1 }).toArray();
  // --lexicon-books: other volumes of the same edition widen the lexicon (same printer, same spelling).
  const lexExtra = (await db.collection('pages').find({ book_id: { $in: LEX_BOOKS }, 'ocr.source': { $in: ['batch_api', 'pipeline_preview', 'ai'] } })
    .project({ 'ocr.data': 1 }).toArray()).map((p) => p.ocr.data);
  const has = (p) => typeof p.ocr?.data === 'string' && p.ocr.data.trim().length > 0;
  const read = pages.filter(has);
  const refused = pages.filter((p) => !has(p) && wasRecitationRefused(p));
  console.log(`${BOOK} "${book.title.slice(0, 60)}" ${book.language} cutoff ${cutoff} · ${pages.length} pages · read ${read.length} · refused+empty ${refused.length}`);

  for (const item of ITEMS) {
    if (ONLY_ITEM && item !== ONLY_ITEM) continue;
    const L = await leaves(item);
    if (L.error) { console.log(`  ${item}: SKIP ${L.error}`); continue; }
    const lex = buildLexicon([...read.map((p) => p.ocr.data), ...lexExtra]);
    const restored = L.leaves.map((t) => restoreLongS(t, lex));
    const lv = restored.map((r) => r.text);
    // 1. best leaf per read page, tracking the running offset
    const map = new Map(); let off = 0;
    for (const p of read) {
      let best = { a: 0, k: -1 };
      for (let k = Math.max(0, p.page_number - 1 + off - 12); k <= Math.min(lv.length - 1, p.page_number - 1 + off + 12); k++) {
        const a = agreement(p.ocr.data, lv[k]); if (a > best.a) best = { a, k };
      }
      if (best.a >= 0.5) { off = best.k - (p.page_number - 1); map.set(p.page_number, { k: best.k, off, a: +best.a.toFixed(3) }); }
    }
    const as = [...map.values()].map((m) => m.a).sort((x, y) => x - y);
    const median = as.length ? as[Math.floor(as.length / 2)] : 0;
    console.log(`  ${item}: ${lv.length} leaves · ${L.meta.engine || '?'} ${L.meta.version || ''} · contributor ${L.meta.contributor || '-'} · matched ${map.size}/${read.length} · median agreement ${median}`);
    // 2. refused pages
    const plan = [];
    for (const p of refused) {
      const n = p.page_number;
      let before = null, after = null;
      for (let q = n - 1; q >= 1 && !before; q--) if (map.has(q)) before = { q, ...map.get(q) };
      for (let q = n + 1; q <= pages.length && !after; q++) if (map.has(q)) after = { q, ...map.get(q) };
      const r = { page: n, ok: false };
      if (!before || !after || before.off !== after.off) { r.why = `bracket ${before?.q}:${before?.off} / ${after?.q}:${after?.off}`; plan.push(r); continue; }
      if (before.a < BRACKET_MIN || after.a < BRACKET_MIN) { r.why = `bracket agreement ${before.a}/${after.a}`; plan.push(r); continue; }
      const k = n - 1 + before.off; const text = lv[k] || '';
      r.leaf = k; r.offset = before.off; r.bracket = [before.q, after.q, before.a, after.a];
      const prevOurs = pages.find((x) => x.page_number === n - 1);
      const cw = lastWord(lv[k - 1]);
      const ourCw = has(prevOurs || {}) ? lastWord(prevOurs.ocr.data) : null;
      // Catchword chain inside the other copy: leaf k-1's catchword opens leaf k (in), and leaf k's
      // catchword opens leaf k+1 (out). Either link proves leaf k sits between its neighbours; both
      // are recorded. Our own previous page's last word is recorded only — the model text usually
      // drops the catchword and may order footnotes differently, so it is not a test.
      const cwOut = lastWord(text);
      const inLeaf = !!cw && firstBody(text).includes(cw);
      const outLeaf = !!cwOut && firstBody(lv[k + 1]).includes(cwOut);
      r.catchword = { prev_leaf_last: cw, chain_in: inLeaf, leaf_last: cwOut, chain_out: outLeaf, our_prev_last: ourCw };
      if (words(text).length < 40) { r.why = `only ${words(text).length} words`; plan.push(r); continue; }
      if (!inLeaf && !outLeaf) { r.why = `no catchword link ("${cw}" → leaf, "${cwOut}" → next)`; plan.push(r); continue; }
      r.ok = true; r.text = text; plan.push(r);
    }
    const ok = plan.filter((r) => r.ok);
    console.log(`  → fillable ${ok.length}/${refused.length}${median < cutoff ? ` (COPY BELOW CUTOFF ${cutoff}: nothing will be written)` : ''}`);
    for (const r of plan) console.log(`    p${r.page} ${r.ok ? 'OK ' : 'NO '} leaf ${r.leaf ?? '-'} ${r.why || ''} ${r.catchword ? JSON.stringify(r.catchword) : ''}`);
    if (!APPLY || !ONLY_ITEM || median < cutoff) continue;
    const run = `other-copy-ocr-5811/${new Date().toISOString().slice(0, 19)}/${os.hostname()}@${execSync('git rev-parse --short HEAD').toString().trim()}`;
    let written = 0;
    for (const r of ok) {
      const now = new Date();
      const ocr = {
        data: r.text, source: 'ia_djvu', model: `ia-ocr/${L.meta.engine || 'unknown'}${L.meta.version ? ' ' + L.meta.version : ''}`,
        language: book.language,
        source_url: `https://archive.org/download/${item}/${L.file}#leaf=${r.leaf}`,
        updated_at: now, content_hash: createHash('sha256').update(r.text).digest('hex').slice(0, 16),
        ia: { ...iaProvenance(item, L.meta), ingest_run: run },
        other_copy: { reason: 'RECITATION refused on every Gemini tier for this scan; text from another scan of the same edition (#5811)',
          item, leaf: r.leaf, offset: r.offset, bracket: { before_page: r.bracket[0], after_page: r.bracket[1], before_agreement: r.bracket[2], after_agreement: r.bracket[3] },
          catchword: r.catchword, copy_median_agreement: median, cutoff,
          long_s_restored: { words: restored[r.leaf].n, rule: "f→s where the f-form is absent from and the s-form present in this book's own model-read pages", lexicon_words: lex.size, lexicon_books: [BOOK, ...LEX_BOOKS] } },
      };
      // Only an EMPTY page is written (the filter is in the update itself, so a concurrent writer wins).
      const res = await db.collection('pages').updateOne({ id: pages.find((x) => x.page_number === r.page).id, $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': '' }, { 'ocr.data': null }] },
        { $set: { ocr: { ...(pages.find((x) => x.page_number === r.page).ocr || {}), ...ocr } } });
      if (res.modifiedCount) { written++; await recordSweepAction(db, { sweep: SWEEP, book_id: BOOK, action: 'other_copy_ocr', detail: { page: r.page, item, leaf: r.leaf, hash: ocr.content_hash } }); }
    }
    console.log(`  WROTE ${written} pages from ${item} (run ${run})`);
  }
});
