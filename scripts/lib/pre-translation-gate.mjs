// PRIOR ART: scripts/lib/translate-core.mjs `isTranslatablePage` — the pre-flight door (no body,
// loop, blank, `page_number <= 0` as 'soft-hidden'); it reads the OCR text only and never the
// image's size or the page's place in its book. scripts/lib/illegible-source-gate.mjs — refuses a
// page the OCR itself reports unread; `legibleText` is reused here, and its header says what it
// cannot see: fluent misreadings the OCR marks nothing on. scripts/lib/ocr-garble-verdict.mjs /
// ocr-garble-score.mjs — the lexicon garble verdict; it needs a corpus lexicon that is not in the
// repo (AUC 0.61–0.74), so rule 2 here is a lexicon-free shape test; `scriptOfCodePoint` and
// `familyOf` are reused. scripts/lib/ocr-trust-gate.mjs — the BOOK-level trust gate by stratum
// (its `book_events` counter is the pattern for the book-level record here).
// scripts/lib/page-integrity.mjs — detectors over finished books, not a gate before the call.
// scripts/lib/dhash.mjs — perceptual hash; it needs the image bytes, which this gate never fetches.
/**
 * pre-translation-gate — do not translate what the pipeline could not read (#5915).
 *
 * The worst errors in the 2026-10-06 spot check were fluent English over pages nobody could read.
 * A model asked to translate, translates; so the decision not to is taken here, before the call,
 * from facts already on the page document. No image is fetched and no model is called.
 *
 * Three page rules, in the order they are checked, and one book rule:
 *
 *   3. STRUCTURAL   `page_number` not positive; a `page_number` another page of the book also
 *                   carries; an image identical to the previous page's (same stored byte length,
 *                   pixel size and crop, confirmed by the image host's hash when applied).
 *   1. TOO SMALL    the image is a strip (a whole scroll or a row of openings in one frame), or
 *                   holds fewer pixels per transcribed letter than a legible page of its script
 *                   family (the 2000×121 px scroll strip "read" as 1,400 characters).
 *   2. UNREADABLE   the transcription is word fragments: in a script written in long words, a
 *                   large share of tokens are a single syllable (the Strijataka manuscript).
 *   BOOK            under half of the book's pages were ever transcribed, so its translation
 *                   would be the front matter of an unread book (Samarāṅgaṇa Sūtradhāra II).
 *
 * Every threshold below was set on a one-page-per-book random draw (seed 20261006) and checked by
 * eye; the numbers are in scripts/eval/experiments/2026-10-06-pre-translation-gate-5915.md. A
 * script family with no calibrated row is NOT judged by that rule: the gate says nothing rather
 * than guess (`.claude/docs/invariants/non-latin-text-operations.md`).
 *
 * A refusal is recorded on the page (`translation.refusal_reason`, with the measurement and the
 * OCR it was judged on) and the page is not sent to the model. Nothing is deleted, and a
 * translation the page already has is left alone. A refused page is judged again every time its
 * book comes back to a lane, and released when it passes (`applyPreTranslationGate`).
 */

import { legibleText } from './illegible-source-gate.mjs';
import { scriptOfCodePoint, familyOf } from './ocr-garble-score.mjs';

/** Bump when a rule or threshold changes, so a stored refusal can be told from a current one. */
export const PRE_GATE_VERSION = 1;

/** Kill switch. The gate is ON unless the environment says `TRANSLATE_PRE_GATE=0`. */
export const PRE_GATE_ENV = 'TRANSLATE_PRE_GATE';
export const preGateEnabled = (env = process.env) => env?.[PRE_GATE_ENV] !== '0';

/** The value stamped on `translation.health_blocked` (the field every selector already excludes). */
export const PRE_GATE_BLOCK = 'pre_translation_gate';

/** `translation.refusal_reason` values. */
export const REFUSAL = Object.freeze({
  PAGE_NUMBER: 'page_number_not_positive',
  DUPLICATE_PAGE_NUMBER: 'duplicate_page_number',
  DUPLICATE_IMAGE: 'duplicate_image',
  IMAGE_TOO_SMALL: 'image_too_small',
  UNREADABLE: 'unreadable_source',
});
/** The book-level reason: recorded in `book_events`, never stamped on a page. */
export const BOOK_REFUSAL = 'book_mostly_unread';

// ── What was transcribed ────────────────────────────────────────────────────────────────────

const LETTER_RE = /\p{L}/u;

/**
 * The transcription as a reader's text (OCR metadata, markup and lacuna markers removed), with
 * its letter count and the script family most of its letters belong to.
 */
export function transcribed(ocr) {
  const text = legibleText(ocr);
  const counts = new Map();
  let letters = 0;
  for (const ch of text) {
    if (!LETTER_RE.test(ch)) continue;
    const script = scriptOfCodePoint(ch.codePointAt(0));
    if (!script) continue;
    letters++;
    const family = familyOf(script);
    counts.set(family, (counts.get(family) || 0) + 1);
  }
  let family = null, top = 0;
  for (const [k, v] of counts) if (v > top) { family = k; top = v; }
  return { text, letters, family, familyShare: letters ? top / letters : 0 };
}

// ── Rule 3: structure ───────────────────────────────────────────────────────────────────────

const cropKey = (page) => {
  const c = page?.crop;
  return c && Number.isFinite(c.xStart) && Number.isFinite(c.xEnd) ? `${c.xStart}-${c.xEnd}:${c.yStart ?? ''}-${c.yEnd ?? ''}` : '';
};

/**
 * What the page document says about its image without fetching it: stored byte length, pixel
 * size and crop. Two halves of one spread share a file and differ by crop, so the crop is part
 * of the identity. Null when the page carries no byte length or no size: an unjudgeable page is
 * never a duplicate.
 */
export function imageFingerprint(page) {
  const bytes = Number(page?.archive_metadata?.bytes);
  const w = Number(page?.image_width), h = Number(page?.image_height);
  if (!(bytes > 0) || !(w > 0) || !(h > 0)) return null;
  return `${bytes}:${w}x${h}:${cropKey(page)}`;
}

/** Skip types never reach the model, so they are not part of the book this gate measures. */
const NEVER_TRANSLATED = new Set(['blank', 'exlibris', 'bookplate', 'digitizer-notice', 'digitizer-insert']);

/** Pages a book must have before its read share is judged; a pamphlet is read whole or not at all. */
export const BOOK_MIN_PAGES = 20;
/** Share of a book's translatable pages that must carry a transcription before it is translated. */
export const BOOK_READ_FLOOR = 0.5;

/**
 * The book as the gate needs it, from a light read of every page (no text): which page numbers
 * repeat, each page's predecessor among the positive-numbered pages, and how much was read.
 *
 * @param {Array<object>} lightPages  { id, page_number, page_type, image_width, image_height,
 *   archive_metadata: { bytes }, crop, has_ocr } for EVERY page of the book
 */
export function bookStructure(lightPages) {
  const pages = [...(lightPages || [])];
  const numbers = new Map();
  for (const p of pages) numbers.set(p.page_number, (numbers.get(p.page_number) || 0) + 1);
  const duplicateNumbers = new Set([...numbers].filter(([n, c]) => c > 1 && n > 0).map(([n]) => n));
  const positive = pages.filter((p) => p.page_number > 0).sort((a, b) => a.page_number - b.page_number);
  const previous = new Map();
  const byId = new Map();
  positive.forEach((p, i) => { byId.set(p.id, p); if (i > 0) previous.set(p.id, positive[i - 1]); });
  for (const p of pages) if (!byId.has(p.id)) byId.set(p.id, p);
  const translatable = positive.filter((p) => !NEVER_TRANSLATED.has(p.page_type));
  return { duplicateNumbers, previous, byId, translatable: translatable.length, read: translatable.filter((p) => p.has_ocr).length };
}

/**
 * Book-level structural reject: most of the book was never transcribed, so whatever is translated
 * now is the front matter of a book nobody read (Samarāṅgaṇa Sūtradhāra II: 25 of 356 pages).
 * Returns null, or { reason, detail }.
 */
export function bookVerdict(structure) {
  const { translatable = 0, read = 0 } = structure || {};
  if (translatable < BOOK_MIN_PAGES) return null;
  const share = read / translatable;
  if (share >= BOOK_READ_FLOOR) return null;
  return { reason: BOOK_REFUSAL, detail: { read, translatable, share: +share.toFixed(3), floor: BOOK_READ_FLOOR } };
}

/** The book rule as a lane's refusal reason, and the test selectors and routers match it with. */
export const preGateBookReason = (book) => `pre-translation-gate (${book.reason}: ${book.detail.read} of ${book.detail.translatable} pages transcribed, #5915)`;
export const isPreGateBookRefusal = (reason) => /^pre-translation-gate\b/.test(String(reason ?? ''));

// ── Rule 1: the image is too small for its text ─────────────────────────────────────────────

/**
 * The stored image as the page shows it: width and height in pixels, cut to the page's own part
 * of a spread (`crop`, 0–1000 units of the parent image). Null when the page does not say.
 */
export function imageBox(page) {
  let w = Number(page?.image_width), h = Number(page?.image_height);
  if (!(w > 0) || !(h > 0)) return null;
  const c = page?.crop;
  if (c && Number.isFinite(c.xStart) && Number.isFinite(c.xEnd) && c.xEnd > c.xStart) w *= Math.min(1, (c.xEnd - c.xStart) / 1000);
  if (c && Number.isFinite(c.yStart) && Number.isFinite(c.yEnd) && c.yEnd > c.yStart) h *= Math.min(1, (c.yEnd - c.yStart) / 1000);
  return { width: w, height: h, area: w * h, shortEdge: Math.min(w, h), aspect: Math.max(w, h) / Math.min(w, h) };
}

/** Letters below which a page is too short for any size rule: a caption can sit on any image. */
export const MIN_LETTERS_FOR_SIZE = 200;

/**
 * A strip: a whole scroll, or a row of openings, in one frame. Both numbers are from the draw:
 * every strip seen is 2000 px by 121–220 px (aspect 9–16.5); the narrowest legible pages are
 * Tibetan pecha leaves, short edge ≥ 295 px, aspect ≤ 6.6.
 */
export const STRIP_MAX_SHORT_EDGE = 260;
export const STRIP_MIN_ASPECT = 8;

/**
 * Floor on pixel area per transcribed letter, by script family. Only families with at least 30
 * sized pages in the draw have a row; any other family is not judged by density.
 *
 * CJK is the one row with an unreadable case under it (the scroll strip, 333 px² per character,
 * against a legible minimum of 1,179). For the other rows no page of the draw is below the floor:
 * the smallest are legible by eye (Latin print at 166, Arabic at 320, Devanagari at 495), so 100 is
 * a backstop for a thumbnail stored as a page, not a cut through the corpus.
 */
export const PIXELS_PER_LETTER_FLOOR = Object.freeze({
  CJK: 500,
  Latin: 100,
  Tibetan: 100,
  Devanagari: 100,
  Greek: 100,
  Arabic: 100,
});

/** Rule 1 for one page. Returns null (fine, or not judgeable), or { reason, detail }. */
export function imageSizeVerdict(page, t = transcribed(page?.ocr?.data)) {
  const box = imageBox(page);
  if (!box || t.letters < MIN_LETTERS_FOR_SIZE) return null;
  const size = `${Math.round(box.width)}x${Math.round(box.height)}`;
  if (box.shortEdge < STRIP_MAX_SHORT_EDGE && box.aspect >= STRIP_MIN_ASPECT) {
    return { reason: REFUSAL.IMAGE_TOO_SMALL, detail: { kind: 'strip', image: size, letters: t.letters, aspect: +box.aspect.toFixed(1) } };
  }
  const floor = PIXELS_PER_LETTER_FLOOR[t.family];
  const perLetter = box.area / t.letters;
  if (floor && perLetter < floor) {
    return { reason: REFUSAL.IMAGE_TOO_SMALL, detail: { kind: 'density', image: size, letters: t.letters, family: t.family, pixels_per_letter: Math.round(perLetter), floor } };
  }
  return null;
}

// ── Rule 2: the transcription is word fragments ─────────────────────────────────────────────

const DEVANAGARI_VIRAMA = 0x094D;
const isDevanagariBase = (cp) => (cp >= 0x0904 && cp <= 0x0939) || (cp >= 0x0958 && cp <= 0x0961) || (cp >= 0x0972 && cp <= 0x097F);

/** Aksharas in a Devanagari token: base letters that do not follow a virama. */
export function aksharaCount(token) {
  let n = 0, prev = 0;
  for (const ch of token) {
    const cp = ch.codePointAt(0);
    if (isDevanagariBase(cp) && prev !== DEVANAGARI_VIRAMA) n++;
    prev = cp;
  }
  return n;
}

// Letters and signs, not digits or dandas.
const DEVANAGARI_TOKEN_RE = /[ऀ-ॣॱ-ॿ]+/g;

/**
 * One-akshara words that are words: Sanskrit particles and pronouns, Hindi postpositions and
 * auxiliaries, and the seed syllables a mantra is made of. A closed list; anything else that is
 * one akshara long is counted as a fragment.
 */
export const DEVANAGARI_ONE_AKSHARA_WORDS = new Set((
  'च न वा हि तु स सा तं ते मे नो वै ह स्म किं यः यं ये या यो सः तां तौ तैः मां त्वं स्वं कः का नः वः मा खे द्वे द्वौ त्रि श्रीः स्त्री धीः भूः स्वः ज्ञः भो हे रे '
  + 'को के की से में ने भी ही तो जो है हैं था थी थे हो हूँ हूं व सो क्या वे जी ना जा दे ले दो दी ली पै कै श्री '
  + 'ॐ ओं श्रीं ह्रीं क्लीं ऐं हूं हुं क्रीं ह्लीं सौः गं दुं हौं ग्लौं स्त्रीं ब्लूं द्रां द्रीं फ्रें क्षं लं वं रं यं हं सं'
).split(/\s+/).filter(Boolean));

/**
 * Shape of a Devanagari transcription: the share of its tokens that are one akshara long and not
 * a word. Sanskrit is written in long words; a reader who cannot join the letters writes them
 * out a syllable at a time, and a translator turns that into confident sentences.
 */
export function devanagariShape(text) {
  const tokens = String(text || '').match(DEVANAGARI_TOKEN_RE) || [];
  let fragments = 0;
  for (const t of tokens) if (aksharaCount(t) <= 1 && !DEVANAGARI_ONE_AKSHARA_WORDS.has(t)) fragments++;
  return { tokens: tokens.length, fragments, fragmentShare: tokens.length ? fragments / tokens.length : 0 };
}

/** Tokens below which a page is too short for a share to mean anything. */
export const READABILITY_MIN_TOKENS = 60;

/**
 * Fragment-share ceiling by script family. Devanagari is the only row: it is the only family in
 * the draw where the shape separates unread pages from read ones. In Latin, Greek and Cyrillic the
 * pages with the most one-letter tokens are letter-spaced titles, figure labels and papyrus
 * fragments, all correctly read; Tibetan and CJK are not written in spaced words at all.
 */
export const FRAGMENT_SHARE_CEILING = Object.freeze({ Devanagari: 0.3 });

/** Rule 2 for one page. Returns null (fine, or no row for the script), or { reason, detail }. */
export function readabilityVerdict(page, t = transcribed(page?.ocr?.data)) {
  const ceiling = FRAGMENT_SHARE_CEILING[t.family];
  if (!ceiling) return null;
  const shape = devanagariShape(t.text);
  if (shape.tokens < READABILITY_MIN_TOKENS || shape.fragmentShare < ceiling) return null;
  return { reason: REFUSAL.UNREADABLE, detail: { family: t.family, tokens: shape.tokens, fragments: shape.fragments, fragment_share: +shape.fragmentShare.toFixed(3), ceiling } };
}

// ── The verdict ─────────────────────────────────────────────────────────────────────────────

/**
 * Should this page be kept from the translator?
 *
 * @param {object} page        the page: page_number, ocr.data, and the image fields (or pass them
 *                             through `structure`, whose light copy is used when the page lacks them)
 * @param {object} [structure] bookStructure() of the page's book; without it only the rules that
 *                             need no neighbour are checked
 * @param {object} [opts]
 * @param {Map<string,string>} [opts.imageHashes]  page id → image hash (an ETag), where a caller
 *        has fetched one; it overrides the stored-size comparison in both directions
 * @returns {{ refuse: boolean, reason: string|null, detail: object|null }}
 */
export function preTranslationVerdict(page, structure = null, { imageHashes = null } = {}) {
  const out = (v) => (v ? { refuse: true, reason: v.reason, detail: v.detail || null } : { refuse: false, reason: null, detail: null });
  if (!((page?.page_number ?? 0) > 0)) return out({ reason: REFUSAL.PAGE_NUMBER, detail: { page_number: page?.page_number ?? null } });
  const light = structure?.byId?.get(page.id);
  const full = light ? { ...light, ...page, archive_metadata: page.archive_metadata ?? light.archive_metadata, crop: page.crop ?? light.crop, image_width: page.image_width ?? light.image_width, image_height: page.image_height ?? light.image_height } : page;
  if (structure?.duplicateNumbers?.has(page.page_number)) return out({ reason: REFUSAL.DUPLICATE_PAGE_NUMBER, detail: { page_number: page.page_number } });
  const prev = structure?.previous?.get(page.id);
  if (prev) {
    const mine = imageHashes?.get(page.id), theirs = imageHashes?.get(prev.id);
    const hashed = mine && theirs;
    const fp = imageFingerprint(full);
    const same = hashed ? mine === theirs && cropKey(full) === cropKey(prev) : !!fp && fp === imageFingerprint(prev);
    if (same) return out({ reason: REFUSAL.DUPLICATE_IMAGE, detail: { same_as_page: prev.page_number, evidence: hashed ? 'image-hash' : 'stored-size', image: fp } });
  }
  const t = transcribed(full?.ocr?.data);
  return out(imageSizeVerdict(full, t) || readabilityVerdict(full, t));
}

// ── Applying it (the only part that touches the database) ───────────────────────────────────

/** `book_events.type` of the book-level refusal: one row per book, counted, never read by a job. */
export const BOOK_REFUSAL_EVENT = 'pre_translation_gate_refusal';

const LIGHT_PROJECTION = {
  _id: 0, id: 1, page_number: 1, page_type: 1, image_width: 1, image_height: 1, 'archive_metadata.bytes': 1, crop: 1, archived_photo: 1, photo: 1,
  has_ocr: { $and: [{ $gt: [{ $strLenCP: { $ifNull: [{ $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] }, ''] } }, 0] }, { $ne: ['$ocr.unreadable', true] }] },
};

/** Every page of the book, without its text. One indexed read (`book_id`). */
export async function loadBookStructure(db, bookId) {
  const light = await db.collection('pages').find({ book_id: bookId }, { projection: LIGHT_PROJECTION }).toArray();
  return bookStructure(light);
}

/**
 * The image's hash as its host states it (the R2 ETag is the file's MD5), by HEAD: no image bytes
 * are downloaded. Null on any failure; a page that cannot be checked keeps its stored-size verdict.
 */
export async function fetchImageHash(url, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!/^https?:\/\//.test(String(url || ''))) return null;
  try {
    const res = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const tag = res.headers.get('etag');
    return tag ? tag.replace(/^W\//, '').replace(/"/g, '') : null;
  } catch {
    return null;
  }
}

const stampOf = (verdict, page, now) => ({
  'translation.health_blocked': PRE_GATE_BLOCK,
  'translation.health_blocked_at': now,
  'translation.refusal_reason': verdict.reason,
  'translation.refusal': { reason: verdict.reason, detail: verdict.detail, gate_version: PRE_GATE_VERSION, ocr_updated_at: page?.ocr?.updated_at ?? null, at: now },
  updated_at: now,
});

/** The fields a release removes. `translation.data`, if the page has any, is never touched. */
export const PRE_GATE_UNSET = Object.freeze({ 'translation.health_blocked': '', 'translation.health_blocked_at': '', 'translation.refusal_reason': '', 'translation.refusal': '' });

/**
 * Judge the pages a lane is about to translate, and record what is refused.
 *
 * Reads the whole book's light structure once, checks suspected duplicate images by HEAD, and
 * returns the pages that may go to the model. With `record` (the default) each refused page is
 * stamped: `translation.health_blocked` (so no selector picks it again), `translation.refusal_reason`
 * and `translation.refusal` (the measurement, and the OCR it was judged on). Pages this gate
 * refused earlier are judged again first, and released if they now pass: a re-read, a re-archived
 * image or a renumbering is the exit. A book-level refusal stamps no page (the condition belongs to
 * the book and lifts when the book is read); it is counted in `book_events`.
 *
 * Never throws: a gate that cannot run lets the pages through and says so in `error`.
 *
 * @returns {Promise<{ pages: object[], refused: Array<{page, reason, detail}>, counts: object,
 *   book: {reason, detail}|null, released: number, error?: string }>}
 */
export async function applyPreTranslationGate(db, bookId, pages, { record = true, lane = 'unknown', enabled = preGateEnabled(), now = new Date(), hashOf = fetchImageHash, log = console.log } = {}) {
  const pass = { pages, refused: [], counts: {}, book: null, released: 0 };
  if (!enabled || !bookId) return pass;
  try {
    const structure = await loadBookStructure(db, bookId);
    const judge = async (page) => {
      let v = preTranslationVerdict(page, structure);
      if (v.reason === REFUSAL.DUPLICATE_IMAGE) {
        const prev = structure.previous.get(page.id), me = structure.byId.get(page.id);
        const [mine, theirs] = await Promise.all([hashOf(me?.archived_photo || me?.photo), hashOf(prev?.archived_photo || prev?.photo)]);
        if (mine && theirs) v = preTranslationVerdict(page, structure, { imageHashes: new Map([[page.id, mine], [prev.id, theirs]]) });
      }
      return v;
    };

    // The exit: what this gate refused before is judged again on what the page holds now.
    let released = 0;
    if (record) {
      const blocked = await db.collection('pages').find(
        { book_id: bookId, 'translation.health_blocked': PRE_GATE_BLOCK },
        { projection: { _id: 0, id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.updated_at': 1 } },
      ).toArray();
      const free = [];
      for (const p of blocked) if (!(await judge(p)).refuse) free.push(p.id);
      if (free.length) {
        await db.collection('pages').updateMany({ id: { $in: free }, 'translation.health_blocked': PRE_GATE_BLOCK }, { $unset: PRE_GATE_UNSET, $set: { updated_at: now } });
        released = free.length;
        log(`  [pre-translation-gate] ${bookId}: released ${released} page(s) that now pass (#5915)`);
      }
    }

    const book = bookVerdict(structure);
    if (book) {
      if (record && pages.length) {
        await db.collection('book_events').updateOne(
          { book_id: bookId, type: BOOK_REFUSAL_EVENT, 'details.reason': book.reason },
          {
            $setOnInsert: { book_id: bookId, type: BOOK_REFUSAL_EVENT, at: now, source: 'pre-translation-gate', 'details.reason': book.reason, 'details.issue': 5915 },
            $set: { 'details.measure': book.detail, 'details.last_at': now, 'details.last_lane': lane },
            $addToSet: { 'details.lanes': lane },
            $inc: { 'details.refusals': 1 },
          },
          { upsert: true },
        );
      }
      return { pages: [], refused: pages.map((page) => ({ page, reason: book.reason, detail: book.detail })), counts: pages.length ? { [book.reason]: pages.length } : {}, book, released };
    }

    const kept = [], refused = [], counts = {};
    for (const page of pages) {
      const v = await judge(page);
      if (!v.refuse) { kept.push(page); continue; }
      refused.push({ page, reason: v.reason, detail: v.detail });
      counts[v.reason] = (counts[v.reason] || 0) + 1;
    }
    if (record && refused.length) {
      await db.collection('pages').bulkWrite(refused.map((r) => ({
        updateOne: { filter: { id: r.page.id }, update: { $set: stampOf(r, r.page, now) } },
      })), { ordered: false });
    }
    return { pages: kept, refused, counts, book: null, released };
  } catch (e) {
    log(`  [pre-translation-gate] ${bookId}: gate could not run (${e?.message}); pages pass unjudged`);
    return { ...pass, error: String(e?.message || e) };
  }
}
