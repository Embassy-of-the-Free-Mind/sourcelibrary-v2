#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-restraint-ab.mjs — the #5305 restraint A/B: same house design (A1, A2 noise
// floor, B; one page per book from the #5274 audit; Batch API; blind Opus judge on the audit's rubric). Its Batch
// submit/collect is imported from it (submitBatchFile / fetchBatchOutput / mcnemar), not copied. What it cannot do:
// its arms are built on v15 (a row that was never flipped), it has no block door, no neighbour pages in the judge
// packet, no invention KIND, and no Tibetan leaf stratum. scripts/eval/translation-batch-continuity-ab.mjs judges
// block SEAMS pairwise; here the unit is a page (or a page group for the leaf stratum) judged on its own, so a tie
// is a possible answer. scripts/lib/translate-batch-chained.mjs buildRoundRequest is the door reproduced here
// (seed = the stored translation of the page before the unit, adjacent OCR, PAGE_BREAK_SCOPED); it reads Mongo per
// round and writes pages, so the prompt builders it calls are imported instead.
/**
 * translation-prompt-v14-ab — the v14 candidate translation prompt vs the live v13 (#5305, #4523).
 *
 * Arms (same units, same model, same production door):
 *   v13a   the live default (prompts type translation, version 13, is_default)
 *   v13b   v13 again — the A-vs-A NOISE FLOOR (sampler + judge)
 *   v14    v13 + #5305 items 1, 3–7 (+ the general misread line from the 2026-10-02 fold-in), and on Tibetan
 *          books the three leaf lines (a–c)
 *   v14ns  Tibetan stratum only: v14 with NO previous-page continuity seed
 *
 * Pre-registration: scripts/eval/PREREGISTRATION-translation-prompt-v14.md (committed before any arm output).
 *
 * Phases (only --submit costs money; Hetzner only):
 *   --draw      pin units + arm texts, print the estimate                           FREE (Mongo read)
 *   --submit    one Batch job per model                     PAID, needs --approved-usd
 *   --collect   poll (--wait-min N), parse blocks, write outputs.jsonl, meter     FREE
 *   --packets   blinded judge packets (#5305 strata) + the blinded Tibetan reading file   FREE
 *   --score     verdicts + mechanical signals → report.json                       FREE
 *
 * --study seam (#5305 seam confirm, 2026-10-03): arms v13a / v13b / seam, where seam = v13 + ONLY items 1 and 1b
 * (SEAM_EDITS, the v14 wording byte for byte), on ~100 NEW chained-lane page breaks + 25 NEW closed-end controls,
 * all sent through the block door. Pre-registration: scripts/eval/PREREGISTRATION-translation-seam-confirm.md.
 * Candidate text: prompts/translation/standard-translation-seam-candidate.md (the draw asserts its md5).
 *
 * NOTHING here writes to `pages` or `prompts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildTranslationPrompt, buildBlockTranslationPrompt, parseBlockTranslations, sanitizeTranslationTags,
  SAFETY_SETTINGS, PAGE_BREAK_SCOPED, MODEL_LITE, MODEL_FLASH, isTibetanBook,
} from '../lib/translate-core.mjs';
import { maxOutputTokensFor } from '../lib/translate-batch-seam.mjs';
import { priceFor } from '../lib/model-pricing.mjs';
import { sourceEndsOpen, openEnd } from '../audit/translation-bridging.mjs';
import { duplicatedAcrossBoundary, blockDriftBoundaries, sharedRun } from '../lib/block-drift.mjs';
import { splitLeafUnits, countLeafBreaks } from '../lib/leaf-break.mjs';
import { resetSeed, seededRand } from './lib/paired-stats.mjs';
import { submitBatchFile, fetchBatchOutput, mcnemar } from './translation-restraint-ab.mjs';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const HERE = path.dirname(new URL(import.meta.url).pathname);
const AUDIT = path.join(HERE, 'results/translation-corpus-audit-2026-09-30');
const CHAINED = path.join(HERE, 'results/translation-corpus-audit-chained-2026-10-01');
// Two studies share this runner; --study picks the arm config. v14 (default) is the 2026-10-02 run, unchanged.
const STUDIES = {
  v14: { dir: 'results/translation-prompt-v14-ab-2026-10-02', seed: 5305, cand: 'v14', endpoint: 'eval/translation-prompt-v14-ab', promptVersion: 'eval-5305-v14', batchName: 'prompt-v14-ab-5305', repeats: 16 },
  seam: { dir: 'results/translation-seam-confirm-2026-10-03', seed: 53055, cand: 'seam', endpoint: 'eval/translation-seam-confirm-5305', promptVersion: 'eval-5305-seam', batchName: 'seam-confirm-5305', repeats: 20 },
};
const STUDY_NAME = opt('study', 'v14');
const STUDY = STUDIES[STUDY_NAME];
if (!STUDY) throw new Error(`unknown --study ${STUDY_NAME}`);
const DIR = opt('dir', path.join(HERE, STUDY.dir));
const V13_HASH = '516510147237b6a79d9d3f6e797bba7f';
const SEED = Number(opt('seed', STUDY.seed));
const N = { flagged: 60, sanskrit: 12, pagebreak: 25, control: 25 };
const CAND = STUDY.cand;
const ARMS_5305 = ['v13a', 'v13b', CAND];
const ARMS_TIB = ['v13a', 'v13b', 'v14', 'v14ns'];

// ── the v14 edits, verbatim; the pre-registration quotes them ────────────────
// Each is [anchor in v13, replacement]; an anchor must occur exactly once or the build throws.
export const V14_EDITS = [
  // item 7 (housekeeping): the square-bracket ban names the label case seen in the audit ("[Marriage]").
  ['- Square brackets [] for ANY purpose — no [interpolations], no [...continuation], no [L]etter repairs. Use XML tags instead:',
    '- Square brackets [] for ANY purpose — no [interpolations], no [...continuation], no [L]etter repairs, no [Section labels]. Use XML tags instead:'],
  // item 1b (#5363/#5376): the continuity marker carries no payload.
  ['  - Context from previous page → <meta>continues from previous page: ...</meta>',
    '  - Context from previous page → <meta>continues from previous page</meta>, the marker alone. Write nothing after it inside the tag: every word of this page belongs in the translation itself.'],
  // #5137 (fold-in): a misread is flagged, not corrected into a plausible reading.
  ['- Every line you write must correspond to text actually present in the OCR input. Where the input has no readable text, your output has none either.',
    '- Every line you write must correspond to text actually present in the OCR input. Where the input has no readable text, your output has none either.\n- Where the source looks misread, translate what is written and flag it with <unclear>; do not silently correct it into a plausible reading.'],
  // item 1 (#5103 superset): one page-end rule for every lane.
  ['- A page whose OCR is mostly <unclear> yields a translation that is mostly <unclear>. That is correct, and far better than fluent invention.',
    `- A page whose OCR is mostly <unclear> yields a translation that is mostly <unclear>. That is correct, and far better than fluent invention.

**This page only (CRITICAL):**
- Render only this page's words. If a sentence continues onto the next page, stop where this page stops, mid-sentence if need be. If a sentence began on the previous page, start with this page's first word.
- The previous page's translation is given for names and terms only: never repeat, complete or borrow its words, the next page's words, or what you know of the work.
- A catchword (the next page's first word printed again at the foot of this page) is a printer's device: do not translate it. A word split by a hyphen at the page break is translated once, on the page where it begins.`],
  // item 6 (#5154): text already in English is kept, not condensed.
  ['- ANY non-English text → translate to English',
    `- ANY non-English text → translate to English
- Text already in English (the English half of a bilingual edition, an editor's commentary) → keep it verbatim and in full, in its place. Never summarise it or move it into a note.
- Rhyme tables, phonetic charts and sound-exemplar characters → keep the characters as characters (a romanised reading may follow); never translate them by meaning.`],
  // item 4: the image-desc example renders the description only.
  ['  Translation: <note>A woodcut depicts a pelican feeding her young from her own breast, a symbol of self-sacrifice in alchemical tradition.</note>',
    '  Translation: <note>A woodcut of a pelican feeding her young.</note>\nTranslate the description only: add no interpretation, symbolism or fact that it does not state.'],
  // item 5 (#5152, #5624): an identification only when standard and certain. Item 7: numbering fixed (8, 9 twice).
  ['7. Add <note>...</note> inline to explain historical references or difficult phrases.\n8. Style: warm museum label - explain rather than assume knowledge.\n9. Preserve the voice and spirit of the original.\n8. Wrap ALL image/illustration descriptions in <note>...</note> — readers can toggle these off.\n9. END with <summary>...</summary> and <keywords>...</keywords> for indexing.',
    `7. Add <note>...</note> inline to explain historical references or difficult phrases. In a note, identify a person, place, work, date or Sanskrit equivalent only when the identification is the standard one and you are certain of it; never offer alternatives ("X or Y") or guess a relationship ("probably X's father"). If unsure, translate the name and leave it unidentified.
8. Style: warm museum label - explain rather than assume knowledge.
9. Preserve the voice and spirit of the original.
10. Wrap ALL image/illustration descriptions in <note>...</note> — readers can toggle these off.
11. END with <summary>...</summary> and <keywords>...</keywords> for indexing, describing only what this page's text says. A page with no readable text (blank, or nothing but <unclear>) gets no summary and no keywords.`],
];

// The Tibetan leaf lines (a–c), brief 2026-10-02, kept as worded. Added on Tibetan books only, after the
// page-only section; in production they would ride with the leaf rule, which is code-side too.
export const TIBETAN_LINES = `**Tibetan leaves:**
- Leaves are not in reading order across pages: a leaf may continue a leaf on another page, before or after this one. Translate each leaf as a fragment that begins at its first syllable and ends at its last. Never complete, repeat or borrow a clause from another leaf or page.
- If a leaf begins or ends with an incomplete word, mark it with an ellipsis and transliterate the fragment in Wylie (…rdo / rje can…); do not guess its meaning.
- Never supply a proper name that is not spelled in the source. Give an uncertain name in Wylie inside <unclear>.`;
const TIB_ANCHOR = 'A word split by a hyphen at the page break is translated once, on the page where it begins.';

export function buildV14(v13, { tibetan = false } = {}) {
  let t = v13;
  for (const [a, b] of V14_EDITS) {
    if (t.split(a).length !== 2) throw new Error(`v14 anchor not found exactly once: ${a.slice(0, 60)}…`);
    t = t.replace(a, () => b);
  }
  if (tibetan) {
    if (t.split(TIB_ANCHOR).length !== 2) throw new Error('Tibetan anchor missing');
    t = t.replace(TIB_ANCHOR, () => `${TIB_ANCHOR}\n\n${TIBETAN_LINES}`);
  }
  return t;
}

// ── the Tibetan stratum: page groups read by eye on 2026-10-02 (#4523 QA comments) ──
export const TIBETAN_GROUPS = [
  ['69e7ab305f1a22ab19a945a3', [81, 82, 83]], ['69e7ab3c5f1a22ab19a9514b', [38]],
  ['69e7aaff5f1a22ab19a9115d', [118, 119, 120]], ['69e7aace5f1a22ab19a8db52', [49]],
  ['6a14e12f2f45ee330c273fac', [16, 17, 18]], ['69e7abf65f1a22ab19aa112a', [68]],
  ['69e7ab6d5f1a22ab19a98934', [62, 63, 64]], ['69e7abc15f1a22ab19a9d83b', [102]],
  ['69e7ab805f1a22ab19a9970f', [64, 65, 66]], ['69e7abca5f1a22ab19a9e1ec', [25]],
  ['69e77a190fc6fc955e35dc13', [7, 8]], ['69e782cfd93c1f6007504c15', [15, 16]],
  ['69e77ac80fc6fc955e362163', [8, 9]], ['69e77a530fc6fc955e35f4a2', [79, 80]],
  ['69e786ec6846fc56c49105c3', [16, 17]], ['69e786b34a6785cfd60c92c4', [9, 10]],
  // dropped-leaf pages (index ≥ DROPPED_FROM)
  ['69e7ab435f1a22ab19a958f8', [119]], ['69e7aaf25f1a22ab19a9026c', [111]], ['69e786b04a6785cfd60c8d27', [41]],
  ['69e7aac35f1a22ab19a8cf73', [68]], ['69e7ac415f1a22ab19aa5ed8', [13]],
];

export const DROPPED_FROM = 16;

// ── the seam candidate: v14's items 1b and 1 ONLY, taken from V14_EDITS so the wording is identical by construction ──
export const SEAM_EDITS = [V14_EDITS[1], V14_EDITS[3]];
export const SEAM_FILE = path.join(HERE, '../../prompts/translation/standard-translation-seam-candidate.md');
export function buildSeam(v13) {
  let t = v13;
  for (const [a, b] of SEAM_EDITS) {
    if (t.split(a).length !== 2) throw new Error(`seam anchor not found exactly once: ${a.slice(0, 60)}…`);
    t = t.replace(a, () => b);
  }
  return t;
}
/** The prompt body of the committed candidate file (frontmatter stripped). */
export const seamFileText = () => fs.readFileSync(SEAM_FILE, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
const md5 = (t) => createHash('md5').update(t).digest('hex');

const sha = (t) => createHash('sha256').update(t).digest('hex').slice(0, 12);
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const verdictsOf = (dir) => {
  const m = new Map();
  if (!fs.existsSync(dir)) return m;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) for (const v of readJsonl(path.join(dir, f))) m.set(v.id, v);
  return m;
};
/** Share of Latin-script words that are common English function words: the English half of a bilingual page. */
export function englishShare(ocr) {
  const w = String(ocr || '').replace(/<[^>]+>/g, ' ').toLowerCase().match(/\b[a-z]{2,}\b/g) || [];
  const fn = new Set(['the', 'and', 'of', 'to', 'in', 'is', 'that', 'which', 'with', 'for', 'by', 'this', 'as', 'are', 'be', 'from', 'it', 'his', 'or', 'not']);
  return { words: w.length, english: w.filter((x) => fn.has(x)).length };
}

// ── draw ──────────────────────────────────────────────────────────────────────
async function phaseDraw() {
  if (STUDY_NAME === 'seam') return phaseDrawSeam();
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const row = await db.collection('prompts').findOne({ type: 'translation', is_default: true }, { sort: { version: -1 } });
  if (!row || row.version !== 13) throw new Error(`default translation prompt is v${row?.version}, not 13 — re-read before drawing`);
  const h = row.content_hash || createHash('md5').update(row.content).digest('hex');
  if (h !== V13_HASH) throw new Error(`v13 hash ${h} != ${V13_HASH}`);
  const arms = { v13: row.content, v14: buildV14(row.content), v14t: buildV14(row.content, { tibetan: true }) };

  const bookCache = new Map();
  const bookOf = async (id) => {
    if (!bookCache.has(id)) bookCache.set(id, await db.collection('books').findOne({ $or: [{ id }, { _id: id }] }, { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1, image_source: 1 } }));
    return bookCache.get(id);
  };
  const pagesOf = async (bookId, nums) => {
    const rows = await db.collection('pages').find({ book_id: bookId, page_number: { $in: nums } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
    return new Map(rows.map((r) => [r.page_number, { id: r.id, ocr: r.ocr?.data || null, tr: r.translation?.data || null }]));
  };
  const bookMeta = (b, lang) => ({ id: b?.id, title: b?.display_title || b?.title, author: b?.author, language: lang || b?.language, published: b?.published || b?.year, image_source: b?.image_source ? { provider: b.image_source.provider } : undefined });

  resetSeed(SEED);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const units = [];

  // #5305 strata from the 2026-09-30 audit (one page per book; Opus verdicts on the served page)
  const man = readJsonl(path.join(AUDIT, 'manifest.jsonl')).filter((m) => m.kind === 'main');
  const items = new Map(readJsonl(path.join(AUDIT, 'items.jsonl')).map((x) => [x.id, x]));
  const verdict = verdictsOf(path.join(AUDIT, 'verdicts/opus'));
  const pool = { flagged: [], sanskrit: [], control: [] };
  let skipped = { english: 0, tibetan: 0 };
  for (const m of man) {
    if (m.modernization || /^english$/i.test(m.language)) { skipped.english++; continue; }
    if (/^tibetan/i.test(m.language)) { skipped.tibetan++; continue; }   // the Tibetan stratum is its own
    const v = verdict.get(m.id);
    const flagged = !!(v?.flags?.invention || v?.flags?.garble_passthrough);
    const s = /^sanskrit/i.test(m.language) ? 'sanskrit' : flagged ? 'flagged' : 'control';
    pool[s].push({ m, flagged, open: !!sourceEndsOpen(items.get(m.id).source) });
  }
  const picks = {
    flagged: pool.flagged.slice(0, N.flagged),
    sanskrit: pool.sanskrit.slice(0, N.sanskrit),
    control: shuffle(pool.control.filter((x) => !x.open)).slice(0, N.control),
  };
  for (const [stratum, list] of Object.entries(picks)) {
    for (const { m, flagged, open } of list) {
      const b = await bookOf(m.book_id);
      const nb = await pagesOf(m.book_id, [m.page_number - 1, m.page_number + 1]);
      const ocr = items.get(m.id).source;
      units.push({
        unit: m.id, stratum, door: 'single', model: MODEL_LITE, auditFlagged: flagged, sourceOpen: open,
        book: bookMeta(b, m.language), language: m.language,
        pages: [{ page_number: m.page_number, id: m.page_id, ocr }],
        seed: nb.get(m.page_number - 1)?.tr || null,
        prevOcr: nb.get(m.page_number - 1)?.ocr || null, nextOcr: nb.get(m.page_number + 1)?.ocr || null,
        english: stratum === 'sanskrit' ? englishShare(ocr) : undefined,
      });
    }
  }

  // Batch-lane page breaks: pages the chained lane wrote whose source ends mid-sentence, sent as the lane sends a
  // block — page N with page N+1 in one request, seeded with the stored translation of N−1.
  const cman = readJsonl(path.join(CHAINED, 'manifest.jsonl')).filter((m) => m.kind === 'main' && !/english/i.test(m.language));
  const citems = new Map(readJsonl(path.join(CHAINED, 'items.jsonl')).map((x) => [x.id, x]));
  const seenBooks = new Set(units.map((u) => u.book.id));
  const pb = [];
  for (const m of shuffle(cman)) {
    if (seenBooks.has(m.book_id) || !sourceEndsOpen(citems.get(m.id).source)) continue;
    const nb = await pagesOf(m.book_id, [m.page_number - 1, m.page_number + 1, m.page_number + 2]);
    if (!nb.get(m.page_number + 1)?.ocr) continue;
    const b = await bookOf(m.book_id);
    pb.push({
      unit: m.id, stratum: 'pagebreak', door: 'block', model: MODEL_LITE, sourceOpen: true,
      book: bookMeta(b, m.language), language: m.language,
      pages: [{ page_number: m.page_number, id: m.page_id, ocr: citems.get(m.id).source }, { page_number: m.page_number + 1, id: nb.get(m.page_number + 1).id, ocr: nb.get(m.page_number + 1).ocr }],
      seed: nb.get(m.page_number - 1)?.tr || null,
      prevOcr: nb.get(m.page_number - 1)?.ocr || null, nextOcr: nb.get(m.page_number + 2)?.ocr || null,
    });
    seenBooks.add(m.book_id);
    if (pb.length >= N.pagebreak) break;
  }
  units.push(...pb);

  // Tibetan stratum: each group as the chained lane would send it (block if > 1 page), on Flash.
  for (const [gi, [bookId, nums]] of TIBETAN_GROUPS.entries()) {
    const b = await bookOf(bookId);
    if (!isTibetanBook(b)) throw new Error(`${bookId} is not a Tibetan book`);
    const nb = await pagesOf(bookId, [nums[0] - 1, ...nums, nums.at(-1) + 1]);
    const pages = nums.map((n) => ({ page_number: n, id: nb.get(n)?.id, ocr: nb.get(n)?.ocr }));
    if (pages.some((p) => !p.ocr)) throw new Error(`${bookId} missing OCR on ${nums}`);
    units.push({
      unit: `${bookId}:${nums.join('-')}`, stratum: gi >= DROPPED_FROM ? 'tibetan-dropped' : 'tibetan',
      door: nums.length > 1 ? 'block' : 'single', model: MODEL_FLASH, book: bookMeta(b), language: b.language,
      pages, seed: nb.get(nums[0] - 1)?.tr || null, prevOcr: nb.get(nums[0] - 1)?.ocr || null, nextOcr: nb.get(nums.at(-1) + 1)?.ocr || null,
      stored: Object.fromEntries(nums.map((n) => [n, nb.get(n)?.tr || null])),
    });
  }
  await c.close();

  fs.mkdirSync(DIR, { recursive: true });
  writeJsonl(path.join(DIR, 'sample.jsonl'), units);
  fs.writeFileSync(path.join(DIR, 'arms.json'), JSON.stringify({
    base: { version: 13, hash: h, id: String(row._id) }, edits: V14_EDITS, tibetan_lines: TIBETAN_LINES,
    arms: Object.fromEntries(Object.entries(arms).map(([k, t]) => [k, { sha: sha(t), chars: t.length }])), text: arms,
  }, null, 2));
  const by = {}; for (const u of units) by[u.stratum] = (by[u.stratum] || 0) + 1;
  const est = estimate(units, arms);
  console.log(`units by stratum ${JSON.stringify(by)}; skipped ${JSON.stringify(skipped)}; pools ${JSON.stringify(Object.fromEntries(Object.entries(pool).map(([k, v]) => [k, v.length])))}`);
  console.log(`arms: ${Object.entries(arms).map(([k, t]) => `${k}=${sha(t)}`).join(' ')}`);
  console.log(`requests ${est.calls}; in ~${est.inTok.toLocaleString()} tok, out ~${est.outTok.toLocaleString()} tok; by model ${JSON.stringify(est.models)}`);
  console.log(`ESTIMATE (Batch API, 50%): $${est.usd.toFixed(3)}`);
}

// ── draw (study seam): NEW chained-lane pages, one per book, none from a book the v14 run used ──
// Frame = draw-chained.mjs's: books with a chained translate_batch_runs record, pages the lane wrote
// (translation.engine.call_site) with a continuity seed. Visit books in seeded order; pick ONE random seeded lane
// page per book; it is a page break if its source ends open (sourceEndsOpen), else a control. Both are sent as the
// lane sends a block (N + N+1, seed = stored translation of N−1); page N is judged.
const CHAINED_CALL_SITE = 'scripts/lib/translate-batch-chained.mjs';
const EXCLUDED_TYPES = ['archived-spread', 'blank', 'title-page', 'toc', 'index', 'illustration', 'digitizer-insert', 'colophon', 'errata', 'cover', 'map', 'plate'];
async function phaseDrawSeam() {
  const NS = { pagebreak: Number(opt('n-pagebreak', 100)), control: Number(opt('n-control', 25)) };
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const row = await db.collection('prompts').findOne({ type: 'translation', is_default: true }, { sort: { version: -1 } });
  if (!row || row.version !== 13) throw new Error(`default translation prompt is v${row?.version}, not 13 — re-read before drawing`);
  const h = row.content_hash || md5(row.content);
  if (h !== V13_HASH || md5(row.content) !== V13_HASH) throw new Error(`v13 hash ${h} != ${V13_HASH}`);
  const seam = buildSeam(row.content);
  if (md5(seam) !== md5(seamFileText())) throw new Error(`built seam candidate ${md5(seam)} != committed file ${md5(seamFileText())}`);
  const arms = { v13: row.content, seam };

  // every book the v14 run touched is out
  const v14Books = new Set(readJsonl(path.join(HERE, STUDIES.v14.dir, 'sample.jsonl')).map((u) => u.book.id));
  const bookIds = (await db.collection('translate_batch_runs').distinct('book_id', { mode: 'chained' })).sort();
  const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }, { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1, image_source: 1 } }).toArray()).map((b) => [b.id, b]));
  resetSeed(SEED);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const order = shuffle(bookIds.filter((id) => books.has(id)));
  const log = { seed: SEED, frame: { call_site: CHAINED_CALL_SITE, runs_mode: 'chained', books: order.length }, skipped: {}, visited: 0 };
  const skip = (k) => { log.skipped[k] = (log.skipped[k] || 0) + 1; };
  const units = [];
  const need = (s) => units.filter((u) => u.stratum === s).length < NS[s];
  for (const id of order) {
    if (!need('pagebreak') && !need('control')) break;
    const b = books.get(id);
    if (v14Books.has(id)) { skip('v14_book'); continue; }
    if (/english/i.test(b.language || '') || /^tibetan/i.test(b.language || '')) { skip('english_or_tibetan'); continue; }
    log.visited++;
    const cands = await db.collection('pages').find(
      { book_id: id, 'translation.engine.call_site': CHAINED_CALL_SITE, 'translation.engine.input.context.previous_translation': true, 'translation.edited_by': { $exists: false }, page_type: { $nin: EXCLUDED_TYPES } },
      { projection: { page_number: 1, 'translation.model': 1 } },
    ).toArray();
    const ok = cands.filter((p) => /^gemini-3(\.1)?-flash/.test(p.translation?.model || ''));
    if (!ok.length) { skip('no_seeded_lane_page'); continue; }
    const pick = ok[Math.floor(seededRand() * ok.length)].page_number;
    const nb = new Map((await db.collection('pages').find({ book_id: id, page_number: { $in: [pick - 1, pick, pick + 1, pick + 2] } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray()).map((r) => [r.page_number, r]));
    const pg = nb.get(pick), nx = nb.get(pick + 1);
    if (!pg?.ocr?.data || pg.ocr.data.length < 200) { skip('short_ocr'); continue; }
    if (!nx?.ocr?.data) { skip('no_next_ocr'); continue; }
    if (!nb.get(pick - 1)?.translation?.data) { skip('no_seed_now'); continue; }
    const stratum = sourceEndsOpen(pg.ocr.data) ? 'pagebreak' : 'control';
    if (!need(stratum)) { skip(`${stratum}_full`); continue; }
    units.push({
      unit: `${id}:${pick}`, stratum, door: 'block', model: MODEL_LITE, sourceOpen: stratum === 'pagebreak',
      book: { id: b.id, title: b.display_title || b.title, author: b.author, language: b.language, published: b.published || b.year, image_source: b.image_source ? { provider: b.image_source.provider } : undefined },
      language: b.language,
      pages: [{ page_number: pick, id: pg.id, ocr: pg.ocr.data }, { page_number: pick + 1, id: nx.id, ocr: nx.ocr.data }],
      seed: nb.get(pick - 1).translation.data,
      prevOcr: nb.get(pick - 1)?.ocr?.data || null, nextOcr: nb.get(pick + 2)?.ocr?.data || null,
    });
  }
  await c.close();
  fs.mkdirSync(DIR, { recursive: true });
  writeJsonl(path.join(DIR, 'sample.jsonl'), units);
  fs.writeFileSync(path.join(DIR, 'arms.json'), JSON.stringify({
    base: { version: 13, hash: h, id: String(row._id) }, edits: SEAM_EDITS, candidate_file: path.relative(path.join(HERE, '../..'), SEAM_FILE), candidate_md5: md5(seam),
    arms: Object.fromEntries(Object.entries(arms).map(([k, t]) => [k, { sha: sha(t), md5: md5(t), chars: t.length }])), text: arms,
  }, null, 2));
  const by = {}, langs = {}; for (const u of units) { by[u.stratum] = (by[u.stratum] || 0) + 1; langs[u.language] = (langs[u.language] || 0) + 1; }
  log.by = by; log.languages = langs;
  const est = estimate(units, arms);
  log.estimate = est;
  fs.writeFileSync(path.join(DIR, 'draw-log.json'), JSON.stringify(log, null, 2));
  console.log(`units by stratum ${JSON.stringify(by)}; languages ${JSON.stringify(langs)}; visited ${log.visited}; skipped ${JSON.stringify(log.skipped)}`);
  console.log(`arms: ${Object.entries(arms).map(([k, t]) => `${k}=${md5(t)}`).join(' ')}`);
  console.log(`requests ${est.calls}; in ~${est.inTok.toLocaleString()} tok, out ~${est.outTok.toLocaleString()} tok; by model ${JSON.stringify(est.models)}`);
  console.log(`ESTIMATE (Batch API, 50%): $${est.usd.toFixed(3)}`);
}

/** Exact one-sided sign test: P(X ≤ x) for X ~ Bin(x + y, ½) — H1: the x arm is flagged on fewer pages. */
export function signOneSided(x, y) {
  const n = x + y; if (!n) return 1;
  const lf = (k) => { let s = 0; for (let i = 2; i <= k; i++) s += Math.log(i); return s; };
  let p = 0; for (let i = 0; i <= x; i++) p += Math.exp(lf(n) - lf(i) - lf(n - i) - n * Math.log(2));
  return Math.min(1, p);
}

/** The pre-registered rule (PREREGISTRATION-translation-seam-confirm.md), in pages. */
function seamDecision(report) {
  const pages = (st, a, f) => Math.round(st[a][f] * st.n);
  const pb = report.strata.pagebreak, ctl = report.strata.control, all = report.strata.all;
  const pbCount = (a) => pb[a].kinds['page-boundary'];
  const A = pbCount('v13a'), A2 = pbCount('v13b'), S = pbCount('seam');
  const e = pb.pageBoundary.effect_seam_v13a;
  const primary = { v13a: A, v13b: A2, seam: S, noise: Math.abs(A2 - A), discordant: `${e.seam_only} seam-only vs ${e.v13a_only} v13a-only`, p_one_sided: e.p_one_sided_x_lower,
    pass: S < A && (A - S) > Math.abs(A2 - A) && e.p_one_sided_x_lower < 0.10 };
  const g1 = { v13a: pages(ctl, 'v13a', 'inv'), v13b: pages(ctl, 'v13b', 'inv'), seam: pages(ctl, 'seam', 'inv') };
  g1.noise = Math.abs(g1.v13b - g1.v13a); g1.hold = g1.seam - g1.v13a <= g1.noise;
  const g2 = { v13a: pages(all, 'v13a', 'om'), v13b: pages(all, 'v13b', 'om'), seam: pages(all, 'seam', 'om') };
  g2.noise = Math.abs(g2.v13b - g2.v13a); g2.hold = g2.seam - g2.v13a <= g2.noise;
  const secondary = { metaPayload: Object.fromEntries(ARMS_5305.map((a) => [a, pages(all, a, 'metaPayload')])), paired: all.effect_seam_v13a.metaPayload };
  return { primary, guard1_control_invention: g1, guard2_omission_pooled: g2, secondary, verdict: primary.pass && g1.hold && g2.hold ? 'PASS' : 'FAIL' };
}

// ── requests ────────────────────────────────────────────────────────────────
const armsFor = (u) => (/^tibetan/.test(u.stratum) ? ARMS_TIB : ARMS_5305);
function textFor(arm, u, arms) {
  if (arm === 'v13a' || arm === 'v13b') return arms.v13;
  if (arm === 'seam') return arms.seam;
  return /^tibetan/.test(u.stratum) ? arms.v14t : arms.v14;
}
export function promptFor(u, arm, arms) {
  const text = textFor(arm, u, arms);
  const prompts = { translation: { text, ref: {} }, english: { text, ref: {} } };
  const previousTranslation = arm === 'v14ns' ? null : u.seed;
  return u.door === 'block'
    ? buildBlockTranslationPrompt({ prompts, book: u.book, pages: u.pages, previousTranslation, prevOcrText: u.prevOcr || undefined, nextOcrText: u.nextOcr || undefined, pageBreak: PAGE_BREAK_SCOPED }).prompt
    : buildTranslationPrompt({ prompts, book: u.book, ocrText: u.pages[0].ocr, previousTranslation, prevOcrText: u.prevOcr || undefined, nextOcrText: u.nextOcr || undefined, pageBreak: PAGE_BREAK_SCOPED }).prompt;
}
const maxOut = (u) => maxOutputTokensFor(u.pages.map((p) => ({ ocr: { data: p.ocr } })));
function estimate(units, arms) {
  let inTok = 0, outTok = 0, usd = 0, calls = 0; const models = {};
  for (const u of units) for (const a of armsFor(u)) {
    const p = priceFor(u.model);
    const i = Math.ceil(promptFor(u, a, arms).length / 3.5);
    const o = u.pages.reduce((n, pg) => n + Math.ceil(pg.ocr.length * (/^tibetan/.test(u.stratum) ? 0.6 : 0.45)) + 400, 0);
    inTok += i; outTok += o; calls++; models[u.model] = (models[u.model] || 0) + 1;
    usd += 0.5 * ((i / 1e6) * p.input + (o / 1e6) * p.output);
  }
  return { calls, inTok, outTok, usd, models };
}

async function phaseSubmit() {
  const units = readJsonl(path.join(DIR, 'sample.jsonl'));
  const { text: arms } = JSON.parse(fs.readFileSync(path.join(DIR, 'arms.json'), 'utf8'));
  const est = estimate(units, arms);
  const approved = Number(opt('approved-usd', 0));
  if (!(approved >= est.usd)) { console.error(`REFUSING TO SPEND: estimate $${est.usd.toFixed(3)}, --approved-usd ${approved || 'absent'}`); process.exit(2); }
  if (fs.existsSync(path.join(DIR, 'batch.json'))) { console.error('batch.json exists — already submitted'); process.exit(2); }
  const byModel = {};
  for (const u of units) for (const a of armsFor(u)) {
    // generation settings recorded per arm (#4613): production's, from translate-batch-seam batchRequest
    (byModel[u.model] ||= []).push(JSON.stringify({
      key: `${u.unit}|${a}`,
      request: { contents: [{ parts: [{ text: promptFor(u, a, arms) }] }], safetySettings: SAFETY_SETTINGS, generationConfig: { maxOutputTokens: maxOut(u), thinkingConfig: { thinkingBudget: 0 } } },
    }));
  }
  const envName = process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY';
  const key = process.env[envName];
  if (!key) throw new Error(`no ${envName}`);
  const jobs = [];
  for (const [model, lines] of Object.entries(byModel)) jobs.push(await submitBatchFile({ model, lines, displayName: `${STUDY.batchName}-${model}`, key }));
  fs.writeFileSync(path.join(DIR, 'batch.json'), JSON.stringify({ key_env: envName, estimate_usd: est.usd, generation: { thinkingBudget: 0, maxOutputTokens: 'maxOutputTokensFor(pages)', temperature: 'default', safety: 'BLOCK_NONE' }, jobs }, null, 2));
}

async function phaseCollect() {
  const rec = JSON.parse(fs.readFileSync(path.join(DIR, 'batch.json'), 'utf8'));
  const key = process.env[rec.key_env];
  const units = new Map(readJsonl(path.join(DIR, 'sample.jsonl')).map((u) => [u.unit, u]));
  const waitMax = Number(opt('wait-min', 0)) * 60e3, t0 = Date.now();
  const out = path.join(DIR, 'outputs.jsonl');
  for (;;) {
    let pending = 0;
    for (const j of rec.jobs) {
      if (j.collected_at) continue;
      const text = await fetchBatchOutput(j, key);
      if (text == null) { pending++; continue; }
      let inTok = 0, outTok = 0, n = 0, errors = 0;
      const p = priceFor(j.model);
      for (const line of text.split('\n').filter(Boolean)) {
        const r = JSON.parse(line); const [unit, arm] = (r.key || r.metadata?.key).split('|');
        const u = units.get(unit), resp = r.response, um = resp?.usageMetadata || {};
        const it = { unit, arm, model: j.model };
        if (r.error || !resp) { it.error = JSON.stringify(r.error || 'no response').slice(0, 300); errors++; }
        else {
          const raw = (resp.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
          it.finish = resp.candidates?.[0]?.finishReason || null;
          it.inTok = um.promptTokenCount || 0; it.outTok = (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0);
          inTok += it.inTok; outTok += it.outTok;
          if (u.door === 'block') {
            const parsed = parseBlockTranslations(raw, u.pages.map((pg) => ({ page_number: pg.page_number, ocr: pg.ocr })));
            it.discarded = parsed.discarded; it.raw = raw;
            it.pages = Object.fromEntries(u.pages.map((pg) => [pg.page_number, parsed.translations.get(pg.page_number) ?? null]));
          } else it.pages = { [u.pages[0].page_number]: sanitizeTranslationTags(raw) };
        }
        fs.appendFileSync(out, JSON.stringify(it) + '\n'); n++;
      }
      j.collected_at = new Date().toISOString(); j.responses = n; j.errors = errors; j.in_tokens = inTok; j.out_tokens = outTok;
      j.cost_usd = 0.5 * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output);
      console.log(`collected ${n} (${errors} errors) $${j.cost_usd.toFixed(4)}`);
      try {
        const { logUsage } = await import('../workers/lib/supabase-usage-logger.mjs');
        await logUsage({ type: 'eval', mode: 'batch', model: j.model, page_count: n - errors, input_tokens: inTok, output_tokens: outTok, batch_job_id: j.job_name, endpoint: STUDY.endpoint, triggered_by: 'manual', prompt_version: STUDY.promptVersion });
      } catch (e) { console.warn(`logUsage failed: ${e.message}`); }
    }
    fs.writeFileSync(path.join(DIR, 'batch.json'), JSON.stringify(rec, null, 2));
    if (!pending) { console.log(`all collected; actual $${rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0).toFixed(4)} → ${out}`); return; }
    if (Date.now() - t0 > waitMax) { console.log(`${pending} job(s) pending; re-run --collect later`); return; }
    await new Promise((r) => setTimeout(r, 120e3));
  }
}

// ── packets ──────────────────────────────────────────────────────────────────
const tail = (s, n = 700) => (s ? (s.length > n ? `…${s.slice(-n)}` : s) : '(none)');
const head = (s, n = 700) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : '(none)');
/** The judged page of a unit: the single page, or page N of a page-break block. */
const judgedPage = (u) => u.pages[0];

function phasePackets() {
  const units = new Map(readJsonl(path.join(DIR, 'sample.jsonl')).map((u) => [u.unit, u]));
  const outs = readJsonl(path.join(DIR, 'outputs.jsonl'));
  resetSeed(SEED + 1);
  const opaque = () => Math.floor(seededRand() * 0xffffffffff).toString(16).padStart(10, '0');
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // #5305 strata: one item per (unit, arm), page N only, with the neighbours' SOURCE for context.
  const items = [], key = {};
  for (const o of outs) {
    const u = units.get(o.unit);
    if (/^tibetan/.test(u.stratum)) continue;
    const pg = judgedPage(u), tr = o.pages?.[pg.page_number];
    const pid = opaque();
    key[pid] = { unit: o.unit, arm: o.arm, missing: !tr };
    if (!tr) continue;   // scored as a failure, not judged
    const next = u.door === 'block' ? u.pages[1].ocr : u.nextOcr;
    items.push({ id: pid, language: u.language, prev_source_tail: tail(u.prevOcr), source: pg.ocr, next_source_head: head(next), translation: tr });
  }
  shuffle(items);
  const NP = Number(opt('n-packets', 24));
  const packets = Array.from({ length: NP }, (_, p) => items.filter((_, i) => i % NP === p));
  const REPEATS = Number(opt('repeats', STUDY.repeats));
  for (let i = 0; i < REPEATS; i++) {
    const at = Math.floor(seededRand() * items.length), src = items[at], pid = opaque();
    key[pid] = { ...key[src.id], repeat_of: src.id };
    const p = packets[(at % NP + 1 + (i % (NP - 1))) % NP];
    p.splice(Math.floor(seededRand() * (p.length + 1)), 0, { ...src, id: pid });
  }
  const pdir = path.join(DIR, 'packets'); fs.mkdirSync(pdir, { recursive: true });
  packets.forEach((chunk, p) => {
    const base = path.join(pdir, `packet-${String(p + 1).padStart(2, '0')}`);
    writeJsonl(`${base}.jsonl`, chunk);
    fs.writeFileSync(`${base}.md`, chunk.map((x, i) => `\n\n######## ITEM ${i + 1}/${chunk.length}  id=${x.id}  language=${x.language}\n\n==== PREVIOUS PAGE SOURCE (end; context only) ====\n${x.prev_source_tail}\n\n==== SOURCE (this page) ====\n${x.source}\n\n==== NEXT PAGE SOURCE (start; context only) ====\n${x.next_source_head}\n\n==== TRANSLATION (this page) ====\n${x.translation}\n`).join(''));
  });
  fs.writeFileSync(path.join(DIR, 'packet-key.json'), JSON.stringify(key));
  console.log(`${items.length + REPEATS} items (${REPEATS} repeats) in ${NP} packets → ${pdir}`);

  // Tibetan: one blinded reading file per group, arms shuffled under letters, leaf by leaf beside the source.
  const tdir = path.join(DIR, 'tibetan-read'); fs.mkdirSync(tdir, { recursive: true });
  const tkey = {};
  for (const u of [...units.values()].filter((x) => /^tibetan/.test(x.stratum))) {
    const rows = shuffle(outs.filter((o) => o.unit === u.unit));
    const letters = rows.map((_, i) => 'WXYZ'[i]);
    tkey[u.unit] = Object.fromEntries(rows.map((o, i) => [letters[i], o.arm]));
    let md = `# ${u.book.title} — ${u.unit}\nhttps://sourcelibrary.org/book/${u.book.id}?page=${u.pages[0].page_number}\n\nSEED (stored translation of p${u.pages[0].page_number - 1}, given to some arms), end:\n${tail(u.seed, 900)}\n`;
    for (const pg of u.pages) {
      const src = splitLeafUnits(pg.ocr);
      md += `\n\n================ PAGE ${pg.page_number} (${src.length} leaves) ================\n`;
      src.forEach((s, li) => {
        md += `\n---- p${pg.page_number} L${li} SOURCE ----\n${s}\n`;
        rows.forEach((o, i) => { const tr = o.pages?.[pg.page_number]; const l = tr ? splitLeafUnits(tr) : []; md += `\n[${letters[i]}] ${tr == null ? '(NO TRANSLATION — block discarded/failed)' : (l.length === src.length ? l[li] : `(leaf count ${l.length} ≠ ${src.length}; whole page:)\n${li === 0 ? tr : '(see L0)'}`)}\n`; });
      });
      md += `\n---- p${pg.page_number} PRODUCTION (stored v13) for reference ----\n${u.stored?.[pg.page_number] || '(none)'}\n`;
    }
    fs.writeFileSync(path.join(tdir, `${u.unit.replace(/[:]/g, '_')}.md`), md);
  }
  fs.writeFileSync(path.join(DIR, 'tibetan-key.json'), JSON.stringify(tkey, null, 2));
  console.log(`Tibetan reading files → ${tdir}`);
}

// ── score ────────────────────────────────────────────────────────────────────
const strip = (t) => String(t || '').replace(/<(summary|keywords|meta|note)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function mechanical(u, o) {
  const pg = judgedPage(u), tr = o.pages?.[pg.page_number] || '';
  const r = {
    missing: !o.pages?.[pg.page_number], discarded: o.discarded || null,
    openEndUnmarked: !!openEnd(pg.ocr, tr),
    bracket: /\[[^\]<>]{1,60}\]/.test(strip(tr)),
    metaPayload: /<meta>\s*continues? from (?:the )?previous page\s*[:,-]\s*\S/i.test(tr),
    summary: /<summary>/i.test(tr),
    dupWithSeed: !!(u.seed && tr && duplicatedAcrossBoundary(u.seed, tr)),
  };
  if (u.door === 'block' && !/^tibetan/.test(u.stratum)) {
    const map = new Map(Object.entries(o.pages || {}).filter(([, v]) => v).map(([k, v]) => [Number(k), v]));
    r.drift = blockDriftBoundaries(u.pages.map((p) => ({ page_number: p.page_number, ocr: { data: p.ocr } })), map).length > 0;
  }
  if (u.stratum === 'sanskrit') r.trChars = strip(tr).length;
  return r;
}

function tibetanMechanical(u, o) {
  let leaves = 0, short = 0, empty = 0, seamFail = 0, dupAcrossPages = 0, missingPages = 0, leadIn = 0;
  const trs = u.pages.map((pg) => o.pages?.[pg.page_number] || null);
  u.pages.forEach((pg, i) => {
    const tr = trs[i];
    if (!tr) { missingPages++; return; }
    const s = splitLeafUnits(pg.ocr), t = splitLeafUnits(tr);
    if (countLeafBreaks(pg.ocr) !== countLeafBreaks(tr)) seamFail++;
    s.forEach((src, li) => { leaves++; const x = strip(t[li] || ''); if (!x) empty++; else if (x.length < 0.35 * src.length) short++; });
    if (/continu\w+ from the previous (?:leaf|page)/i.test(strip(tr))) leadIn++;
  });
  // a shared run between ANY two leaves of the unit (or the seed's last leaf) that the source does not share
  const leafTr = []; u.pages.forEach((pg, i) => { if (trs[i]) splitLeafUnits(trs[i]).forEach((t) => leafTr.push(strip(t))); });
  if (u.seed && o.arm !== 'v14ns') leafTr.unshift(strip(splitLeafUnits(u.seed).at(-1)));
  for (let a = 0; a < leafTr.length; a++) for (let b = a + 1; b < leafTr.length; b++) if (sharedRun(leafTr[a], leafTr[b]).len >= 60) dupAcrossPages++;
  return { leaves, short, empty, seamFail, missingPages, dupRuns: dupAcrossPages, leadIn };
}

function phaseScore() {
  const units = new Map(readJsonl(path.join(DIR, 'sample.jsonl')).map((u) => [u.unit, u]));
  const outs = readJsonl(path.join(DIR, 'outputs.jsonl'));
  const outBy = new Map(outs.map((o) => [`${o.unit}|${o.arm}`, o]));
  const key = JSON.parse(fs.readFileSync(path.join(DIR, 'packet-key.json'), 'utf8'));
  const verdicts = verdictsOf(path.join(DIR, 'verdicts'));
  const reps = Object.entries(key).filter(([, k]) => k.repeat_of).map(([pid, k]) => [verdicts.get(pid), verdicts.get(k.repeat_of)]).filter(([a, b]) => a && b);
  const judgeNoise = { pairs: reps.length, sameFidelity: reps.filter(([a, b]) => a.fidelity === b.fidelity).length, sameInvention: reps.filter(([a, b]) => a.flags.invention === b.flags.invention).length, sameOmission: reps.filter(([a, b]) => a.flags.omission === b.flags.omission).length };

  const KINDS = ['page-boundary', 'unreadable-fill', 'wrong-added-fact', 'gloss', 'summary-meta', 'other'];
  const cell = new Map();
  for (const [pid, k] of Object.entries(key)) {
    if (k.repeat_of) continue;
    const u = units.get(k.unit), o = outBy.get(`${k.unit}|${k.arm}`), v = verdicts.get(pid);
    const mech = mechanical(u, o);
    let c;
    if (k.missing) c = { judged: false, inv: false, invBody: false, om: true, fid: 1, kinds: {}, apparatus: false, englishCondensed: false, ...mech };
    else if (!v) continue;
    else {
      const invD = (v.defects || []).filter((d) => d.type === 'invention' || d.type === 'garble_passthrough');
      const kinds = {}; for (const d of invD) { const kk = KINDS.includes(d.kind) ? d.kind : 'other'; kinds[kk] = true; }
      const omD = (v.defects || []).filter((d) => d.type === 'omission');
      c = {
        judged: true, inv: !!v.flags.invention, invBody: invD.some((d) => d.kind !== 'summary-meta') && !!v.flags.invention,
        invMajor: invD.some((d) => d.severity === 'major'), om: !!v.flags.omission, fid: v.fidelity, kinds,
        apparatus: omD.some((d) => d.kind === 'apparatus'), englishCondensed: omD.some((d) => d.kind === 'english-condensed'), ...mech,
      };
    }
    (cell.get(k.unit) || cell.set(k.unit, {}).get(k.unit))[k.arm] = c;
  }
  const complete = [...cell.entries()].filter(([, c]) => ARMS_5305.every((a) => c[a]));
  const report = { at: new Date().toISOString(), units: complete.length, judgeNoise, strata: {}, tibetan: {} };
  const FIELDS = ['inv', 'invBody', 'invMajor', 'om', 'apparatus', 'englishCondensed', 'openEndUnmarked', 'bracket', 'metaPayload', 'summary', 'dupWithSeed', 'drift', 'missing'];
  for (const stratum of ['flagged', 'sanskrit', 'pagebreak', 'control', 'all']) {
    const rows = complete.filter(([id]) => stratum === 'all' || units.get(id).stratum === stratum).map(([, c]) => c);
    if (!rows.length) continue;
    const out = { n: rows.length };
    const rate = (a, f) => +(rows.filter((c) => c[a][f]).length / rows.length).toFixed(3);
    const paired = (x, y, f) => { const b = rows.filter((c) => c[x][f] && !c[y][f]).length, cc = rows.filter((c) => !c[x][f] && c[y][f]).length; return { [`${x}_only`]: b, [`${y}_only`]: cc, p: +mcnemar(b, cc).toFixed(4) }; };
    for (const a of ARMS_5305) {
      out[a] = Object.fromEntries(FIELDS.map((f) => [f, rate(a, f)]));
      out[a].fid4 = +(rows.filter((c) => c[a].fid >= 4).length / rows.length).toFixed(3);
      out[a].meanFid = +(rows.reduce((s, c) => s + c[a].fid, 0) / rows.length).toFixed(3);
      out[a].kinds = Object.fromEntries(KINDS.map((kk) => [kk, rows.filter((c) => c[a].kinds?.[kk]).length]));
      if (stratum === 'sanskrit') out[a].meanTrChars = Math.round(rows.reduce((s, c) => s + (c[a].trChars || 0), 0) / rows.length);
    }
    out.noise_v13b_v13a = Object.fromEntries(['inv', 'invBody', 'om'].map((f) => [f, paired('v13b', 'v13a', f)]));
    out[`effect_${CAND}_v13a`] = Object.fromEntries(['inv', 'invBody', 'om', 'openEndUnmarked', 'summary', 'drift', 'dupWithSeed', 'metaPayload'].map((f) => [f, paired(CAND, 'v13a', f)]));
    // page-boundary invention as a per-page flag (judged defect kind), paired
    const pbFlag = (c, a) => !!c[a].kinds?.['page-boundary'];
    const pbPair = (x, y) => { const b = rows.filter((c) => pbFlag(c, x) && !pbFlag(c, y)).length, cc = rows.filter((c) => !pbFlag(c, x) && pbFlag(c, y)).length; return { [`${x}_only`]: b, [`${y}_only`]: cc, p_two_sided: +mcnemar(b, cc).toFixed(4), p_one_sided_x_lower: +signOneSided(b, cc).toFixed(4) }; };
    out.pageBoundary = { noise_v13b_v13a: pbPair('v13b', 'v13a'), [`effect_${CAND}_v13a`]: pbPair(CAND, 'v13a') };
    report.strata[stratum] = out;
  }
  if (STUDY_NAME === 'seam') report.decision = seamDecision(report);
  // Tibetan mechanical (the by-eye read is in tibetan-reading.json, written by hand from tibetan-read/)
  for (const s of ['tibetan', 'tibetan-dropped']) {
    const us = [...units.values()].filter((u) => u.stratum === s);
    report.tibetan[s] = Object.fromEntries(ARMS_TIB.map((a) => {
      const agg = { units: 0 };
      for (const u of us) { const o = outBy.get(`${u.unit}|${a}`); if (!o) continue; agg.units++; for (const [k, v] of Object.entries(tibetanMechanical(u, o))) agg[k] = (agg[k] || 0) + v; }
      return [a, agg];
    }));
  }
  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const phase = ['draw', 'submit', 'collect', 'packets', 'score'].find(has);
  if (!phase) { console.error('pass one of --draw --submit --collect --packets --score'); process.exit(1); }
  await ({ draw: phaseDraw, submit: phaseSubmit, collect: phaseCollect, packets: phasePackets, score: phaseScore })[phase]();
}
