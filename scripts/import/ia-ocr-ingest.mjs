#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/reocr-launch-books.mjs (re-enrols under-OCR'd books for
 * a PAID Gemini pass — this script fills the same pages for free where the Internet
 * Archive already ran OCR); scripts/import/ia-bundle-import.mjs (IA metadata import,
 * never touched page text). Nothing in the repo reads IA's per-leaf OCR.
 *
 * ia-ocr-ingest — fill untranscribed pages of Internet Archive books with the
 * Archive's own OCR, when it agrees with the Gemini sample we already paid for.
 *
 * WHY (2026-09-11). 591,417 untranscribed English pages sit in the library; 578,655
 * of them (98%) are IA scans, and every IA item ships `<id>_djvu.xml`: one <OBJECT>
 * per leaf with word coordinates, from the same leaf sequence our `pages.photo`
 * URLs index (`/page/n<k>/`). Measured on the Shaker shelf against our Gemini OCR
 * of the same leaf: Lamson 1848 agrees 0.925 (word-sequence ratio); Brown 1812
 * agrees 0.753 — the long-s era, where ABBYY reads ſ as f. So the rule is a
 * per-book calibration, not a date: the 25-page preview every stub book already
 * carries is the free reference; ingest only where the book clears the bar.
 *
 * PROVENANCE. Written with `ocr.source: 'ia_djvu'` and `ocr.model:
 * 'ia-ocr/<ocr_module_version>'` — a distinctive label per data-provenance.md,
 * never `batch_api`/`ai`. Pages that already have `ocr.data` are never touched;
 * `saveRevisionsBeforeOverwrite` is still called (no-op on first write, doctrine).
 * The #4149 ink guard is not run: it exists for a model that writes prose on blank
 * leaves; ABBYY/Tesseract return no words there, and such leaves are skipped.
 *
 * RATE. ≤ 2 requests/s to archive.org with a contact UA; aborts the run after 4
 * consecutive 429/503 (repo lesson: a guard travels with the file).
 *
 * Usage (dry run by default; nothing is written without --apply):
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/ia-ocr-ingest.mjs --collection shakers            # score + plan
 *   node scripts/import/ia-ocr-ingest.mjs --book <id>                     # one book
 *   node scripts/import/ia-ocr-ingest.mjs --language english --limit 200  # a slice
 *   node scripts/import/ia-ocr-ingest.mjs --collection shakers --apply
 *   node scripts/import/ia-ocr-ingest.mjs --ids <file>                    # re-score these book ids
 * Options: --min-ref-pages 5  --cache <dir> (keeps the XML)  --max-offset 3  --min-offset-share 0.6
 *          --min-agreement X   OVERRIDE the per-language cutoff for every book in the run (dry-run
 *                              sweeps only; it also scores languages the policy excludes, e.g. Greek)
 *
 * CUTOFF IS PER LANGUAGE (#4790, 2026-09-13). The delivered text was measured (CER of the written
 * page against a fresh model read, one interior page per book) and the right cutoff differs by
 * language: English/French 0.80, Latin/German/Italian 0.85, Greek never, unmeasured languages 0.85.
 * The table lives in scripts/lib/ia-ocr-gate.mjs — ONE place; do not put a number at a call site.
 * The cutoff used is recorded on every written page (`ocr.agreement_ref.min_agreement`).
 *
 * "NO _djvu.xml" WAS MOSTLY A FILE NAME (2026-09-13). The English run skipped 257 items as having
 * no XML; a metadata survey found 165 of the first 166 DO carry one — named after the uploaded
 * file, not the identifier (`0327725.nlm.nih.gov` → `0327725_djvu.xml`). The metadata's file list
 * is now the authority (`iaOcrMeta().djvu_xml_files`); an item with several XMLs (several scans) is
 * refused as ambiguous, never guessed. Plain `_djvu.txt` is NOT used: it has no per-leaf structure
 * and per-leaf alignment is the whole safety property of this lane.
 * `--ids <file>` (one book id per line) skips the "still has untranscribed pages" filter, so an
 * already-filled book can be re-scored against its model pages (dry unless --apply).
 *
 * TEXT QUALITY (#4780, 2026-09-13). Three defects found by reading ingested pages against the scan:
 *  1. The XML keeps the typesetter's line-end hyphens (`am-\nmunition`; 84% of pages). Every leaf
 *     is run through `dehyphenateLineBreaks` (scripts/lib/dehyphenate.mjs) after loading — after,
 *     not inside `leafTexts`, so cached `.leaves.json` files get it too — before scoring and writing.
 *  4. (#4784, 2026-09-16) A leaf can be junk inside an ACCEPTED book — a Devanagari page read as
 *     Latin letters. Each fillable leaf is also scored against the book's model-read text by letter
 *     trigram share (scripts/lib/ocr-plausibility.mjs) and skipped below 0.4 (`implausible_leaves`).
 *  2. The agreement tokenizer was `[a-z0-9']`: Greek, Cyrillic and Hebrew were invisible to the
 *     score, so a bilingual edition was judged on its English apparatus alone (De Anima accepted at
 *     0.91 without a single Greek word counted). Now `\p{L}\p{N}'` with the `u` flag.
 *  3. No language guard: an item whose IA-detected OCR language is not the book's language is now
 *     LANG_MISMATCH (counted as rejected), unless the book's `languages[]` lists it — a facing-page
 *     edition is tagged that way (language-fields.md). Both values are logged.
 *
 * THE TOKEN IS THE SCRIPT'S UNIT (#4806, 2026-09-13). The word tokenizer above found ONE token in a
 * page of unspaced Chinese, so every Chinese book scored 0 and 1.59M pages were written off on the
 * instrument. Tokenization is now script-aware (scripts/lib/ia-ocr-agreement.mjs): characters for
 * space-less runs, words elsewhere. Editorial blocks (`<image-desc>` …) are still counted — a known
 * bias the cutoffs were calibrated on; see the lib header before "fixing" it.
 *
 * LEAF OFFSET — RETIRED AS A CALIBRATION (#4790, 2026-09-13). The offset search below survives as a
 * DETECTOR only: the XML OBJECT sequence and the IIIF `/page/n<k>` index skip the same scandata-excluded
 * leaves, so the right offset is always 0. A non-zero winning vote means the reference pages were read
 * from #3368 bulk-archived images (which do not skip them); the book is refused as REF_SHIFTED and
 * never filled at a compensating offset. The 2026-09-12 history that introduced the search follows.
 *
 * LEAF OFFSET (2026-09-12). The first English dry run rejected 292 books at agreement
 * 0.10–0.20 — the detector's biggest cluster, and an artifact: probed books scored 0.15
 * at offset 0 and 0.70–0.94 at offset −1 on 500 of 515 reference pages (the XML's
 * <OBJECT> sequence starts one leaf later than our `/page/n<k>` index on those items).
 * So each book is scored at every offset in ±MAX_OFFSET; the offset most reference
 * pages prefer is the book's, provided ≥ MIN_OFFSET_SHARE of them agree (UNSTABLE
 * otherwise — never fill a book whose alignment drifts). The chosen offset is applied
 * to the fillable leaves and recorded in `ocr.agreement_ref.offset`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { withMongo } from '../lib/mongo.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';
import { iaFetch, iaOcrMeta, iaProvenance } from '../lib/ia-ocr-meta.mjs';
import { dehyphenateLineBreaks } from '../lib/dehyphenate.mjs';
import { referenceTrigramSet, isImplausible, DEFAULT_MIN_PLAUSIBILITY } from '../lib/ocr-plausibility.mjs';
import { normalizeLanguageToken } from '../lib/language-normalize.mjs';
import { iaOcrMinAgreement } from '../lib/ia-ocr-gate.mjs';
import { tokens, ratio } from '../lib/ia-ocr-agreement.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const COLLECTION = arg('--collection', null);
const BOOK = arg('--book', null);
const LANGUAGE = arg('--language', null);
const LIMIT = +arg('--limit', 50);
// Per-language cutoff (scripts/lib/ia-ocr-gate.mjs) unless overridden for the whole run.
const MIN_AGREEMENT_OVERRIDE = arg('--min-agreement', null) === null ? null : +arg('--min-agreement');
if (MIN_AGREEMENT_OVERRIDE !== null && !(MIN_AGREEMENT_OVERRIDE > 0 && MIN_AGREEMENT_OVERRIDE <= 1)) { console.error(`--min-agreement must be in (0, 1], got ${arg('--min-agreement')}`); process.exit(2); }
/** The cutoff for one book: the run-wide override if given, else the language policy. */
function gateFor(book) {
  if (MIN_AGREEMENT_OVERRIDE !== null) return { cutoff: MIN_AGREEMENT_OVERRIDE, source: 'override', language: normalizeLanguageToken(book.language) || null };
  return iaOcrMinAgreement(book.language);
}
const MIN_REF_PAGES = +arg('--min-ref-pages', 5);
// SCRIPT-LOSS GUARD (2026-09-24). The Archive's engine transcribes inline non-Latin as nothing at
// all. Measured on 1,214 paired leaves (our model read vs the Archive's reading of the SAME leaf,
// books 1800+): ours 28,489 non-Latin characters, the Archive's 149. Then measured on the books
// this lane had already filled — every one of 220 filled pages carried ZERO, while our own pages
// of the same books carried up to 602 characters of Devanagari or Greek.
//
// The agreement gate half-catches this on its own, because losing a script drags the score down:
// it refused every book whose sampled pages were >= 12% non-Latin (Hatha Yoga Pradipika, two
// Samkhya texts, Yoga-mimansa). It does NOT catch the sparse case — ten books with script on
// 4-16% of pages were filled, and their Greek and Sanskrit is now silently gone. A few lines of
// Greek in an alchemical text is exactly the citation a reader came for, so the threshold here is
// PRESENCE, not proportion.
const NONLATIN_RE = /[\u0370-\u03FF\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0900-\u097F\u4E00-\u9FFF\u3040-\u30FF]/g;
/** Non-Latin characters on a page; >= this many means the page really carries script, not a stray glyph. */
const MIN_SCRIPT_CHARS = +arg('--min-script-chars', 5);
const ALLOW_SCRIPT_LOSS = process.argv.includes('--allow-script-loss');
const MAX_OFFSET = +arg('--max-offset', 3);
const MIN_OFFSET_SHARE = +arg('--min-offset-share', 0.6);
const CACHE = arg('--cache', null);
const IDS_FILE = arg('--ids', null);
const SOURCE = 'ia_djvu';

/**
 * Leaf texts for an item. The cache stores the PARSED leaves (`<id>.leaves.json`, ~1/10 the
 * size of the word-boxed XML): the 2,076-book English run filled 23 GB of XML on a 150 GB
 * disk, and the Latin shelf is four times larger. Legacy `<id>_djvu.xml` files are still read.
 */
async function iaLeaves(id, xmlFiles = []) {
  const cachedJson = CACHE ? path.join(CACHE, `${id}.leaves.json`) : null;
  const cachedXml = CACHE ? path.join(CACHE, `${id}_djvu.xml`) : null;
  if (cachedJson && fs.existsSync(cachedJson)) return { leaves: JSON.parse(fs.readFileSync(cachedJson, 'utf8')) };
  let xml;
  if (cachedXml && fs.existsSync(cachedXml)) xml = fs.readFileSync(cachedXml, 'utf8');
  else {
    // XML FILE NAME (2026-09-13). The derivative is named after the uploaded file, not the item:
    // `<id>_djvu.xml` is the common case, not the rule. The metadata's file list is the authority.
    // One XML → that is the scan the IIIF `/page/n<k>` index runs over, same alignment property as
    // ever (the gate still verifies it per book). Several XMLs → several scans in one item; which
    // one our page URLs index is not knowable here, so the item is refused rather than guessed.
    if (xmlFiles.length > 1) return { leaves: null, reason: `${xmlFiles.length} _djvu.xml files on the item (ambiguous): ${xmlFiles.slice(0, 3).join(' | ')}` };
    const name = xmlFiles[0] || `${id}_djvu.xml`;
    const res = await iaFetch(`https://archive.org/download/${id}/${encodeURIComponent(name)}`);
    if (!res.ok) return { leaves: null, reason: `HTTP ${res.status} for ${name}${xmlFiles.length ? '' : ' (metadata lists no _djvu.xml)'}` };
    xml = await res.text();
  }
  const leaves = leafTexts(xml);
  if (cachedJson) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(cachedJson, JSON.stringify(leaves)); }
  return { leaves };
}

/** OBJECT[k] → plain text: words joined by spaces, lines by \n, paragraphs by a blank line. */
function leafTexts(xml) {
  const out = [];
  const objs = xml.split(/<OBJECT\b/).slice(1);
  for (const o of objs) {
    const paras = [];
    for (const p of o.split(/<PARAGRAPH\b/).slice(1)) {
      const lines = [];
      for (const l of p.split(/<LINE\b/).slice(1)) {
        const words = [...l.matchAll(/<WORD[^>]*>([\s\S]*?)<\/WORD>/g)].map((m) => decode(m[1]).trim()).filter(Boolean);
        if (words.length) lines.push(words.join(' '));
      }
      if (lines.length) paras.push(lines.join('\n'));
    }
    out.push(paras.join('\n\n'));
  }
  return out;
}
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

// ---------- agreement: sequence ratio (difflib-style 2M/(|a|+|b|)) over script-aware tokens ----------
// `tokens` / `ratio` live in scripts/lib/ia-ocr-agreement.mjs (#4806): word tokens for spaced scripts,
// one token per CHARACTER for space-less runs (Han, kana, Thai …). The per-language cutoffs are
// calibrated on that score — never re-inline a tokenizer here.
/** Model OCR that carries an image description or a plate/illustration page-type: not a text page. */
const isPlatePage = (t) => /<image-desc\b|\[Image:|<page-type>\s*(plate|illustration|image|photograph|figure|map)\b/i.test(t);
const median = (xs) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** leaf index (0-based) for a page: from the IA photo URL, else page_number - 1 */
function leafIndex(page) {
  const m = String(page.photo || page.archived_photo || '').match(/\/page\/n(\d+)\//);
  return m ? +m[1] : (page.page_number || 1) - 1;
}

await withMongo(async (db) => {
  const B = db.collection('books'), P = db.collection('pages');
  const q = { pages_count: { $gt: 0 }, $expr: { $lt: [{ $ifNull: ['$pages_ocr', 0] }, '$pages_count'] }, hidden_reason: { $in: [null, ''] },
    $or: [{ ia_identifier: { $exists: true, $ne: null } }, { 'image_source.provider': 'internet_archive' }] };
  if (COLLECTION) q.collections = COLLECTION;
  if (LANGUAGE) q.language = new RegExp(`^${LANGUAGE}$`, 'i');
  if (BOOK) q.$and = [{ $or: [{ id: BOOK }, ...(ObjectId.isValid(BOOK) ? [{ _id: new ObjectId(BOOK) }] : [])] }];
  if (IDS_FILE) {
    // Re-score mode: the listed books, whether or not they still have untranscribed pages.
    const ids = fs.readFileSync(IDS_FILE, 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    delete q.$expr; delete q.hidden_reason;
    q.$and = [{ $or: [{ id: { $in: ids } }, { _id: { $in: ids.filter((x) => ObjectId.isValid(x)).map((x) => new ObjectId(x)) } }] }];
  }
  const projection = { id: 1, title: 1, language: 1, languages: 1, published: 1, ia_identifier: 1, image_source: 1, pages_count: 1, pages_ocr: 1, 'pipeline_auto.status': 1 };
  const books = await B.find(q, { projection }).sort({ processing_priority: -1, visible: -1 }).limit(IDS_FILE ? 100000 : LIMIT).toArray();
  console.log(`${books.length} candidate books (${APPLY ? 'APPLY' : 'dry run'}; min agreement ${MIN_AGREEMENT_OVERRIDE !== null ? `${MIN_AGREEMENT_OVERRIDE} (OVERRIDE for every language)` : 'per language (scripts/lib/ia-ocr-gate.mjs)'}, min ref pages ${MIN_REF_PAGES})`);

  const summary = { scored: 0, accepted: 0, rejected: 0, unstable: 0, lang_mismatch: 0, ref_shifted: 0, script_loss: 0, lang_excluded: 0, no_ref: 0, no_xml: 0, pages_written: 0, implausible_leaves: 0 };
  for (const b of books) {
    const bid = b.id || String(b._id);
    const iaId = b.ia_identifier || (b.image_source?.identifier) || null;
    if (!iaId) { console.log(`  ${bid} no IA identifier — skip`); continue; }
    // Policy first, before any archive.org call: a language the table says never to fill (Greek)
    // is refused without fetching its leaves. `--min-agreement` overrides this too (dry sweeps).
    const gate = gateFor(b);
    if (gate.cutoff === null) { summary.lang_excluded++; console.log(`  LANG_EXCLUDED ${bid} ${String(b.published || '').slice(0, 4)} ${(b.title || '').slice(0, 44)} | language ${gate.language} is never filled from IA OCR (#4790)`); continue; }
    // Metadata first: it names the item's `_djvu.xml` file(s), which is how the leaves are found.
    const meta = await iaOcrMeta(iaId);
    const { leaves: rawLeaves, reason: noXmlReason } = await iaLeaves(iaId, meta.djvu_xml_files || []);
    if (!rawLeaves) { summary.no_xml++; console.log(`  ${bid} ${iaId}: no _djvu.xml — ${noXmlReason}`); continue; }
    const leaves = rawLeaves.map(dehyphenateLineBreaks);
    // Language guard (#4780): the Archive's own detection of what its OCR read vs what the book is.
    const detectedLang = normalizeLanguageToken(Array.isArray(meta.detected_lang) ? meta.detected_lang[0] : meta.detected_lang);
    const bookLangs = [b.language, ...(Array.isArray(b.languages) ? b.languages : [])].map(normalizeLanguageToken).filter(Boolean);
    const langMismatch = !!(detectedLang && bookLangs.length && !bookLangs.includes(detectedLang));
    const pages = await P.find({ book_id: bid }, { projection: { id: 1, page_number: 1, photo: 1, archived_photo: 1, display_photo: 1, 'ocr.data': 1, 'ocr.source': 1, hidden: 1 } }).sort({ page_number: 1 }).toArray();

    // reference: pages that already carry model OCR, scored at every leaf offset in ±MAX_OFFSET.
    // The book's offset is the one most reference pages prefer; it must be shared by
    // ≥ MIN_OFFSET_SHARE of them (front matter and plates are allowed to disagree).
    const leafTok = leaves.map((l) => tokens(l));
    const refs = [];
    let plateRefs = 0;
    for (const p of pages) {
      // Reference = MODEL OCR only. Pages this script wrote earlier are the IA text itself and
      // would score 1.000 against it (the Shaker shelf re-scored at 1.000 on 2026-09-12).
      const t = p.ocr?.data; if (!t || p.ocr?.source === SOURCE) continue;
      // Reference = TEXT pages only (2026-09-14). A plate page is where the model DESCRIBES the
      // picture and the Archive's engine reads the caption (often rotated, so garbage): the
      // ratio there measures neither engine. Hassanein 1925 (6aa734a338e15c149514ce9b, 24 plates
      // among 67 reference pages) scored 0.649 overall and was REJECTED at the 0.80 English gate
      // while its 43 text pages agreed at 0.946. Pages the model tagged as pictures leave the
      // reference; they are never filled either (the leaf-token check below still applies to them).
      if (isPlatePage(t)) { plateRefs++; continue; }
      const k = leafIndex(p); const tt = tokens(t); if (tt.length < 20) continue;
      const byOffset = {};
      for (let d = -MAX_OFFSET; d <= MAX_OFFSET; d++) { const j = k + d; if (j < 0 || j >= leaves.length || leafTok[j].length < 20) continue; byOffset[d] = ratio(tt, leafTok[j]); }
      if (!Object.keys(byOffset).length) continue;
      refs.push(byOffset);
    }
    const title = (b.title || '').slice(0, 44);
    if (refs.length < MIN_REF_PAGES) { summary.no_ref++; console.log(`  ${bid} ${String(b.published || '').slice(0, 4)} ${title} | ref pages ${refs.length} < ${MIN_REF_PAGES} — cannot calibrate`); continue; }
    summary.scored++;
    const votes = {};
    for (const r of refs) { const best = Object.entries(r).sort((x, y) => y[1] - x[1])[0][0]; votes[best] = (votes[best] || 0) + 1; }
    const [offsetStr, nVotes] = Object.entries(votes).sort((x, y) => y[1] - x[1])[0];
    const offset = +offsetStr;
    // Score only the reference pages that HAVE an IA leaf at the chosen offset. Google-scanned items
    // carry `<HIDDENTEXT/>` (no words) on many leaves — 528 of 841 on Ante-Nicene Fathers vol. 8 — and
    // a reference page whose own leaf is empty but whose neighbour has text used to score 0 here
    // (`?? 0`), dragging a 0.86 book to 0.00 on re-score (#4780). An empty leaf is "IA has nothing
    // for this page", never "IA disagrees"; such leaves are never filled either (the ≥ 20-token check).
    const eligible = refs.filter((r) => r[offset] !== undefined);
    const offsetShare = eligible.filter((r) => Object.entries(r).sort((x, y) => y[1] - x[1])[0][0] === offsetStr).length / Math.max(1, eligible.length);
    const scores = eligible.map((r) => r[offset]);
    const med = median(scores);
    if (scores.length < MIN_REF_PAGES) { summary.no_ref++; console.log(`  ${bid} ${String(b.published || '').slice(0, 4)} ${title} | ref pages with an IA leaf at offset ${offset}: ${scores.length} < ${MIN_REF_PAGES} — cannot calibrate`); continue; }
    // OFFSET IS ALWAYS 0 (#4790, 2026-09-13). The XML OBJECT sequence and the IIIF page index skip the
    // same scandata-excluded leaves, so leaf k IS `/page/n<k>`. A winning vote ≠ 0 means the reference
    // pages were OCR'd from images that do not skip them — the #3368 bulk-archived set — and is a TELL
    // to refuse on, never a calibration: compensating for it wrote 51,851 pages of the neighbouring
    // leaf (repaired by scripts/maintenance/repair-ia-ocr-leaf-offset.mjs). The vote is still computed
    // and logged for diagnosis; the book is only ever filled at offset 0.
    const candidates = pages.filter((p) => !p.ocr?.data && !p.hidden).map((p) => ({ p, k: leafIndex(p) })).filter(({ k }) => k >= 0 && k < leaves.length && leafTok[k].length >= 20);
    // GARBAGE-LEAF GUARD (2026-09-14). A plate with a rotated caption, or a photograph the engine
    // reads as letters, passes the >= 20-token check and would be written as the page's text
    // (Hassanein 1925: pages 68, 95, 249, 280 — "AIJUNOD UMO IIOY} UI UBIOM"). Language-agnostic
    // test: the share of a leaf's tokens that occur anywhere in the book's OWN model-read text
    // pages. On Hassanein every real leaf scored >= 0.51 (median 0.81) and the four garbage leaves
    // <= 0.05. The cutoff is relative to the book's own median so a small-vocabulary book (few
    // reference pages, an inflected language) is judged against itself, not against English.
    // Measured 2026-09-14 on Hassanein: whole-book median 0.80 → cut 0.32; the four garbage leaves
    // were the only ones below it.
    const vocab = new Set();
    for (const p of pages) { const t = p.ocr?.data; if (t && p.ocr?.source !== SOURCE && !isPlatePage(t)) for (const w of tokens(t)) vocab.add(w); }
    const vocabShare = (k) => leafTok[k].filter((w) => vocab.has(w)).length / leafTok[k].length;
    // Baseline = every IA leaf of the book with >= 20 tokens, not just the unfilled ones: after a
    // first pass the unfilled remainder is exactly the garbage, and a median over it is garbage too.
    const allShares = leafTok.map((t, k) => (t.length >= 20 ? vocabShare(k) : null)).filter((x) => x !== null);
    const shareCut = 0.4 * median(allShares);
    const wordFillable = candidates.filter(({ k }) => vocabShare(k) >= shareCut);
    const garbageLeaves = candidates.length - wordFillable.length;
    // PAGE-LEVEL PLAUSIBILITY (#4784, 2026-09-16). The word-share guard above clears a Devanagari
    // leaf read as Latin junk (`kgg'7^ f<p^ I`) by 0.03 only, because a rare REAL word misses the
    // vocabulary as surely as junk does (readable floor 0.59 vs junk 0.23, cut 0.26). Sub-word units
    // separate them: the share of a leaf's in-word letter TRIGRAMS found in the book's model-read
    // text is ≥ 0.72 on every readable graded page at 5 reference pages and ≤ 0.13 on the junk one
    // (scripts/lib/ocr-plausibility.mjs carries the table). Cut 0.4, absolute; abstains (never
    // refuses) on a short leaf or a reference under ~3 pages of prose. Word-shaped blur junk (the
    // second #4784 instance) passes both tests — a known blind spot, not a claim of this guard.
    const refSet = referenceTrigramSet(pages.filter((p) => p.ocr?.data && p.ocr?.source !== SOURCE && !isPlatePage(p.ocr.data)).map((p) => p.ocr.data));
    const fillable = wordFillable.filter(({ k }) => !isImplausible(leaves[k], refSet, DEFAULT_MIN_PLAUSIBILITY));
    const implausibleLeaves = wordFillable.length - fillable.length;
    summary.implausible_leaves += implausibleLeaves;
    const refShifted = offset !== 0 && offsetShare >= MIN_OFFSET_SHARE;
    // Judge on OUR OWN pages, not the Archive's: the Archive's text is where the script is missing,
    // so asking IT whether the book has any would always answer no. This is the one signal that
    // cannot be read off the thing being judged.
    const scriptPages = pages.filter((p) => p.ocr?.data && p.ocr?.source !== SOURCE
      && (p.ocr.data.match(NONLATIN_RE) || []).length >= MIN_SCRIPT_CHARS).length;
    const scriptLoss = scriptPages > 0 && !ALLOW_SCRIPT_LOSS;
    const verdict = refShifted ? 'REF_SHIFTED' : med < gate.cutoff ? 'REJECT' : offsetShare < MIN_OFFSET_SHARE ? 'UNSTABLE' : langMismatch ? 'LANG_MISMATCH' : scriptLoss ? 'SCRIPT_LOSS' : 'ACCEPT';
    const langNote = detectedLang ? ` | lang ia=${detectedLang} book=${bookLangs.join('+') || '?'}` : '';
    const scriptNote = scriptPages > 0 ? ` | NON-LATIN on ${scriptPages} of our pages${ALLOW_SCRIPT_LOSS ? ' (override: filling anyway)' : ''}` : '';
    console.log(`  ${verdict} ${bid} ${String(b.published || '').slice(0, 4)} ${title} | agreement median ${med.toFixed(3)} over ${scores.length} pages | gate ${gate.cutoff.toFixed(2)} (${gate.source}) | offset ${offset} (${(offsetShare * 100).toFixed(0)}%) | IA leaves ${leaves.length}/${pages.length} | plates excluded ${plateRefs} | fillable ${fillable.length} (garbage leaves skipped ${garbageLeaves}, cut ${shareCut.toFixed(2)}; implausible skipped ${implausibleLeaves}, trigram cut ${DEFAULT_MIN_PLAUSIBILITY}) | engine ${meta.engine || '?'} ${meta.version || ''}${langNote}${scriptNote}`);
    if (verdict !== 'ACCEPT') { summary.rejected++; if (verdict === 'UNSTABLE') summary.unstable++; if (verdict === 'LANG_MISMATCH') summary.lang_mismatch++; if (verdict === 'REF_SHIFTED') summary.ref_shifted++; if (verdict === 'SCRIPT_LOSS') summary.script_loss++; continue; }
    summary.accepted++;
    if (!APPLY) { summary.pages_written += fillable.length; continue; }

    const now = new Date();
    await saveRevisionsBeforeOverwrite(db, fillable.map(({ p }) => p.id), 'ocr', { reason: 'ia_ocr_ingest' });
    let n = 0;
    for (const { p, k } of fillable) {
      // Pipeline update: `ocr` is literally null on many never-OCR'd pages, and a dotted
      // $set cannot create fields inside null (MongoServerError 28 — crashed the first
      // English apply run, 2026-09-12). $mergeObjects over $ifNull handles null, missing and {}.
      const ocrFields = {
        data: leaves[k], source: SOURCE, model: `ia-ocr/${meta.version || meta.engine || 'unknown'}`, language: b.language || null,
        source_url: `https://archive.org/download/${iaId}/${encodeURIComponent(meta.djvu_xml_files?.[0] || `${iaId}_djvu.xml`)}#leaf=${k}`, updated_at: now, has_warning: false,
        agreement_ref: { median: +med.toFixed(3), n: refs.length, min_agreement: gate.cutoff, offset: 0, offset_share: +offsetShare.toFixed(2) },
        ia: iaProvenance(iaId, meta),
      };
      const r = await P.updateOne({ _id: p._id, $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }] },
        [{ $set: { ocr: { $mergeObjects: [{ $ifNull: ['$ocr', {}] }, { $literal: ocrFields }] }, updated_at: now } }]);
      n += r.modifiedCount;
    }
    summary.pages_written += n;
    const [counts] = await P.aggregate(buildVisiblePageCountPipeline(bookId(b))).toArray();
    const set = { updated_at: now };
    if (counts) Object.assign(set, { pages_count: counts.total, pages_ocr: counts.with_ocr, pages_translated: counts.with_translation });
    const full = counts && counts.with_ocr >= counts.total;
    if (full && b.pipeline_auto?.status === 'archive_complete') set['pipeline_auto.status'] = 'ocr_complete', set['pipeline_auto.last_updated'] = now;
    await B.updateOne({ _id: b._id }, { $set: set });
    await db.collection('book_events').insertOne({ book_id: bid, type: 'ia_ocr_ingest', at: now, source: 'ia-ocr-ingest', details: { ia_identifier: iaId, pages_written: n, agreement_median: +med.toFixed(3), ref_pages: scores.length, engine: meta.engine, version: meta.version, pages_ocr_after: counts?.with_ocr ?? null, status_after: set['pipeline_auto.status'] || b.pipeline_auto?.status || null } });
    console.log(`     wrote ${n} pages → pages_ocr ${counts?.with_ocr}/${counts?.total}${full ? ' (complete)' : ''}`);
  }
  console.log(JSON.stringify(summary));
}, { timeoutMs: 6 * 60 * 60 * 1000 });

function bookId(b) { return b.id || String(b._id); }
