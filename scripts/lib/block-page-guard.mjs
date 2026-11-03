// PRIOR ART: scripts/lib/leaf-shift.mjs — the number vote (classifyBook) and the book-level absorption rule
// (absorptionsOf) this reuses; the book rule needs the book's whole run and translation.updated_at, a write-time
// guard has one call's pages and nothing else, so the per-call version lives here. scripts/lib/block-drift.mjs
// dropDriftedPages — the guard every block parser already calls; it calls blockPageRefusals below, so the lanes
// that never ask for an anchor still get the absorption and number checks. scripts/lib/folio-markers.mjs — places
// each page's span by a marker the model writes; it trusts the marker's position, never what follows it, which
// is exactly the gap here (a page's section that holds the next leaf's text).
/**
 * block-page-guard — is each page of a multi-page call carrying ITS OWN leaf? (#5021, Derek 2026-11-03:
 * "we definitely want to prevent this going forward").
 *
 * Any call that carries more than one page can put page n+1's text in page n's section, and the splitter only
 * checks that each page HAS a section. Three independent checks, one shared function, every multi-page path:
 *
 *  1. ANCHOR (prompted lanes only: claude-translate, which serves cli-translate-lane per_call and the siku lane,
 *     and translate-worker). The prompt (anchorRule) asks each page's section to open with
 *     <anchor-first>…</anchor-first><anchor-last>…</anchor-last>: the first and last ~12 non-space characters of
 *     THAT page's source, copied. takeAnchors strips them before anything is written; anchorVerdicts matches each
 *     half (normalised: NFKC, no marks, no punctuation or spacing, lower case; edit distance ≤ ANCHOR_MAX_EDIT of
 *     the half's length, within the head/tail window of the page) against the page's own source and against n±1.
 *     A page refuses when a neighbour matches MORE halves than its own source, or nothing matches at all. It reads
 *     characters, not numbers or letter case, so it works for Han and Tibetan, which the number vote cannot see
 *     (91% and 99% of their pages cast no vote, #5021).
 *  2. ABSORPTION (every lane). k = the call's median log(EN/SRC) over its text pages (3 or more), else the
 *     caller's k (claude-translate passes the book's stored median). Page n absorbs when its English fits
 *     SRC(n)+SRC(n+1) and not SRC(n) (the #5021 rule, leaf-shift.mjs absorptionsOf, same thresholds); a page whose
 *     English is under SWALLOW_SHARE of its expected length is the swallowed neighbour. Index and apparatus page
 *     types are skipped.
 *  3. NUMBER VOTE (every lane). leaf-shift.mjs classifyBook on the call's pages, with the pages either side of the
 *     call as context, so an edge page is judged too; a page whose English prints only the next or previous leaf's
 *     numbers refuses. (dropDriftedPages keeps its strict 2-page run, which drops the whole block.)
 *
 * A slide starts at one page and carries on to the block's end (Postel 178-184, Karl 16-20), so an absorption
 * refuses from the absorbing page to the end of the call, and a swallowed page from the page before it. A refused
 * page is NOT written from the call: the caller reads it again ALONE (one page per call cannot slide).
 * A false refusal costs one single-page call, never a wrong text.
 */
import { stripMarkupTags } from './strip-markup-tags.mjs';
import { classifyBook, foldDigits, tagBlock, META_TAGS, STRONG_MIN, ABSORB_OWN_MIN, ABSORB_TWO_MAX, ABSORB_SRC_MIN, ABSORB_SKIP_TYPES } from './leaf-shift.mjs';

export const ANCHOR_CHARS = 12;
/** A half matches when its edit distance to some stretch of the window is at most this share of its length. */
export const ANCHOR_MAX_EDIT = 0.34;
/** Halves shorter than this after normalisation say nothing (a page that opens on "1."). */
export const ANCHOR_MIN_CHARS = 5;
/** The head/tail window: this share of the page's normalised source, and never under ANCHOR_WINDOW_MIN chars. Half the page: an
 *  edition that closes each page on a variant apparatus has its last printed text far from its last characters. */
export const ANCHOR_WINDOW_SHARE = 0.5;
export const ANCHOR_WINDOW_MIN = 80;
/** A page whose English is under this share of what k predicts has been swallowed by its neighbour. */
export const SWALLOW_SHARE = 0.15;
/** …and only when a neighbour in the call is at least this much (log) longer than k predicts: it holds the text. */
export const SWALLOW_NEIGHBOUR_MIN = 0.35;
/** A single page's number vote counts with this many voting numbers, or with one of STRONG_MIN or more and an own
 *  number missing: one small shared number (a verse ॥10॥, a footnote 24) is chance on the clean controls. */
export const VOTE_MIN_NUMBERS = 2;
/** A source this many times the call's median is a looped or garbled transcription, not a page a neighbour swallowed. */
export const LOOP_SRC_SHARE = 4;

/** The prompt rule, appended to a block prompt of 2+ pages. Part of the prompt SENT, so part of what is hashed. */
export function anchorRule(pageNumbers) {
  const ex = pageNumbers[0];
  return `\n\nPAGE ANCHORS. Begin EACH page's <translation page="N"> with one anchor line, then that page's translation:\n<anchor-first>FIRST</anchor-first><anchor-last>LAST</anchor-last>\nFIRST is a copy of the first ${ANCHOR_CHARS} characters, and LAST a copy of the last ${ANCHOR_CHARS} characters, of the source text printed under "--- Page N ---" for THAT page (not counting spaces or tags), in the original script, untranslated. For example, page ${ex}'s section opens with the first and last characters of page ${ex}'s source. Copy them from the page itself before you translate it, and then translate that page and only that page: never carry text over from the page before or after. The anchor line is checked against the page and removed.\n`;
}

/** A page's source text: `ocr` as a string, or `ocr.data`. */
const srcOf = (p) => (typeof p?.ocr === 'string' ? p.ocr : String(p?.ocr?.data ?? ''));

const ANCHOR_RE = /<anchor-(first|last)>([\s\S]*?)<\/anchor-\1>/gi;

/** One section's text without its anchors, and the anchors. Unclosed or stray anchor tags are removed too. */
export function stripAnchor(text) {
  const anchor = { first: null, last: null };
  const s = String(text ?? '').replace(ANCHOR_RE, (_, k, v) => {
    if (anchor[k.toLowerCase()] == null) anchor[k.toLowerCase()] = v.trim();
    return '';
  }).replace(/<\/?anchor-(?:first|last)>/gi, '');
  return { text: s.replace(/^\s*\n/, '').trim(), anchor };
}

/** Strip the anchors from every section of a parsed block, in place. Returns Map<page_number, {first,last}>. */
export function takeAnchors(translations) {
  const anchors = new Map();
  for (const [n, t] of translations) {
    const { text, anchor } = stripAnchor(t);
    translations.set(n, text);
    anchors.set(n, anchor);
  }
  return anchors;
}

/** Fold a string for anchor matching: tags out, NFKC, no marks, letters and digits only, lower case. */
export function anchorFold(s, { meta = false } = {}) {
  // Metadata blocks (<scan-quality>, <language>, <vocab>, <image-desc> …) are not the page's text: their words would
  // stand in the head and tail windows. Running heads and page numbers stay (a copied anchor may start on them).
  // meta: true keeps them, for a page whose only text IS its metadata (an illegible leaf, a blank with a stamp).
  return stripMarkupTags(meta ? String(s || '') : String(s || '').replace(tagBlock(META_TAGS), ' '), ' ')
    .replace(/->|<-/g, ' ')
    .normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Smallest edit distance between `p` and any substring of `t` (Sellers). */
export function fuzzyFind(p, t) {
  const P = [...p], T = [...t];
  if (!P.length) return 0;
  let prev = Array.from({ length: P.length + 1 }, (_, i) => i);
  let best = prev[P.length];
  for (let j = 1; j <= T.length; j++) {
    const cur = [0];
    for (let i = 1; i <= P.length; i++) cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + (P[i - 1] === T[j - 1] ? 0 : 1));
    if (cur[P.length] < best) best = cur[P.length];
    prev = cur;
    if (best === 0) break;
  }
  return best;
}

const windowOf = (fold, where) => {
  const w = Math.max(ANCHOR_WINDOW_MIN, Math.ceil(fold.length * ANCHOR_WINDOW_SHARE));
  return where === 'first' ? fold.slice(0, w) : fold.slice(Math.max(0, fold.length - w));
};
const halfMatches = (half, fold, where) => {
  if (!fold) return false;
  return fuzzyFind(half, windowOf(fold, where)) <= Math.floor(half.length * ANCHOR_MAX_EDIT);
};

/**
 * Each page's anchor against its own source and its neighbours'. `pages` in call order (page_number, ocr.data);
 * `anchors` from takeAnchors; prevOcr / nextOcr the sources just outside the call (the first and last page's
 * other neighbour). Returns [{page_number, verdict: 'own'|'prev'|'next'|'none'|'missing', own, prev, next}],
 * where own/prev/next count the halves (0-2) that match that page's source.
 */
export function anchorVerdicts(pages, anchors, { prevOcr = null, nextOcr = null } = {}) {
  // Each source folded twice, without and with its metadata: a half matches when it matches either. Copied from the
  // metadata of an illegible page, it matches that page (and ties a neighbour with the same metadata, which keeps it).
  const both = (t) => [anchorFold(t), anchorFold(t, { meta: true })];
  const src = pages.map((p) => both(srcOf(p)));
  const before = prevOcr != null ? both(prevOcr) : null, after = nextOcr != null ? both(nextOcr) : null;
  return pages.map((p, i) => {
    const a = anchors?.get(p.page_number) || {};
    const halves = ['first', 'last'].map((k) => [k, anchorFold(a[k] || '')]).filter(([, v]) => v.length >= ANCHOR_MIN_CHARS);
    // A page with no text of its own (a decorated border, a stamp) has nothing to anchor: an empty anchor is right.
    if (!halves.length) return { page_number: p.page_number, verdict: src[i][0].length < 2 * ANCHOR_MIN_CHARS ? 'own' : 'missing', own: 0, prev: 0, next: 0 };
    const count = (folds) => (folds ? halves.filter(([k, v]) => folds.some((f) => halfMatches(v, f, k))).length : 0);
    const own = count(src[i]), prev = count(i > 0 ? src[i - 1] : before), next = count(i + 1 < src.length ? src[i + 1] : after);
    // A tie keeps the page: running heads repeat leaf to leaf, so a head anchor can match a neighbour too.
    const verdict = own === 0 && prev === 0 && next === 0 ? 'none' : next > own && next >= prev ? 'next' : prev > own ? 'prev' : 'own';
    return { page_number: p.page_number, verdict, own, prev, next };
  });
}

/** The median log(EN chars / SRC chars) of text pages, or null with fewer than `min`. Raw lengths, as absorptionsOf. */
export function lengthRatioK(pairs, { min = 3 } = {}) {
  // src / en: the texts, or their lengths.
  const len = (v) => (typeof v === 'number' ? v : String(v || '').length);
  const r = pairs
    .filter(({ src, en, type }) => !ABSORB_SKIP_TYPES.has(type) && len(src) >= ABSORB_SRC_MIN && len(en) > 0)
    .map(({ src, en }) => Math.log(len(en) / len(src)))
    .sort((a, b) => a - b);
  if (r.length < min) return null;
  return r.length % 2 ? r[(r.length - 1) / 2] : (r[r.length / 2 - 1] + r[r.length / 2]) / 2;
}

/**
 * The per-call absorption check. Returns [{page_number, kind: 'absorbs'|'swallowed', own, two?}], the page that
 * holds two leaves' English and the page whose English is (nearly) gone. `k` is used when the call has fewer
 * than 3 text pages.
 */
export function blockAbsorptions(pages, translations, { k = null } = {}) {
  const rows = pages.map((p) => ({ page_number: p.page_number, src: srcOf(p), en: String(translations.get(p.page_number) ?? ''), type: p.page_type ?? null }));
  const K = lengthRatioK(rows) ?? k;
  if (K == null) return [];
  const textLike = (r) => r && !ABSORB_SKIP_TYPES.has(r.type) && r.src.length >= ABSORB_SRC_MIN && r.en.length > 0;
  const out = [];
  const srcs = rows.map((r) => r.src.length).sort((a, b) => a - b);
  const medSrc = srcs[Math.floor(srcs.length / 2)];
  const ownOf = (r) => (textLike(r) ? Math.log(r.en.length) - K - Math.log(r.src.length) : null);
  rows.forEach((r, i) => {
    if (!textLike(r)) return;
    const own = ownOf(r);
    // Swallowed only beside a neighbour of the call that ran long: a page whose English is short on its own is a
    // collapse or a looped transcription (19K chars of [illegible]), which a single-page read does not fix either.
    const adj = [rows[i - 1], rows[i + 1]].filter((q) => q && Math.abs(q.page_number - r.page_number) === 1).map(ownOf);
    if (own < Math.log(SWALLOW_SHARE)) { if (r.src.length <= LOOP_SRC_SHARE * medSrc && adj.some((o) => o != null && o > SWALLOW_NEIGHBOUR_MIN)) out.push({ page_number: r.page_number, kind: 'swallowed', own: Math.round(own * 100) / 100 }); return; }
    const N = rows[i + 1];
    if (!N || N.page_number !== r.page_number + 1 || !N.en.length) return;
    const two = Math.log(r.en.length) - K - Math.log(r.src.length + N.src.length);
    if (Math.abs(own) > ABSORB_OWN_MIN && Math.abs(two) < ABSORB_TWO_MAX) out.push({ page_number: r.page_number, kind: 'absorbs', own: Math.round(own * 100) / 100, two: Math.round(two * 100) / 100 });
  });
  return out;
}

/**
 * The single-page number vote: pages of the call whose English prints only the next or the previous leaf's
 * numbers. The pages just outside the call are context rows (their source only), so an edge page has both
 * neighbours. Returns [{page_number, dir, n}].
 */
export function blockNumberVotes(pages, translations, { prevOcr = null, nextOcr = null } = {}) {
  const first = pages[0]?.page_number, last = pages[pages.length - 1]?.page_number;
  const rows = [
    ...(prevOcr != null ? [{ page_number: first - 1, ocr: prevOcr, tr: '' }] : []),
    ...pages.map((p) => ({ page_number: p.page_number, ocr: srcOf(p), tr: String(translations.get(p.page_number) ?? '') })),
    ...(nextOcr != null ? [{ page_number: last + 1, ocr: nextOcr, tr: '' }] : []),
  ];
  const inCall = new Set(pages.map((p) => p.page_number));
  const counts = (r) => r.votes[r.cls].length >= VOTE_MIN_NUMBERS || (Math.max(...r.votes[r.cls]) >= STRONG_MIN && r.ownMissing >= 1);
  return classifyBook(rows).rows.filter((r) => inCall.has(r.page_number) && (r.cls === 'next' || r.cls === 'prev') && counts(r)).map((r) => ({ page_number: r.page_number, dir: r.cls, n: r.votes[r.cls] }));
}

/**
 * All three checks on one parsed call. Returns [{page_number, reason, detail}] for the pages that must not be
 * written from this call (read them again alone). Pure: deletes nothing. `anchors` null = the call asked for no
 * anchor (an unprompted lane), so check 1 is skipped. A one-page call is never refused here.
 */
export function blockPageRefusals(pages, translations, { anchors = null, prevOcr = null, nextOcr = null, k = null } = {}) {
  if (!pages || pages.length < 2) return [];
  const order = pages.map((p) => p.page_number);
  const out = new Map();
  const add = (n, reason, detail) => { if (translations.has(n) && !out.has(n)) out.set(n, { page_number: n, reason, detail }); };
  if (anchors) {
    for (const v of anchorVerdicts(pages, anchors, { prevOcr, nextOcr })) if (v.verdict !== 'own') add(v.page_number, `anchor-${v.verdict}`, `halves own ${v.own} prev ${v.prev} next ${v.next}`);
  }
  for (const a of blockAbsorptions(pages, translations, { k })) {
    const from = a.kind === 'absorbs' ? a.page_number : a.page_number - 1;
    for (const n of order) if (n >= from) add(n, a.kind === 'absorbs' ? 'absorbed' : 'swallowed', `p.${a.page_number} ${a.kind} (log own ${a.own}${a.two != null ? `, two ${a.two}` : ''})`);
  }
  for (const v of blockNumberVotes(pages, translations, { prevOcr, nextOcr })) add(v.page_number, `number-${v.dir}`, `prints the ${v.dir} leaf's ${v.n.join('/')}`);
  return order.filter((n) => out.has(n)).map((n) => out.get(n));
}

/** The printed page number a transcription tags (<page-num>), as an integer, or null. */
export function printedPageNumber(text) {
  const m = String(text || '').match(/<page-num\b[^>]*>([\s\S]*?)<\/page-num>/i);
  if (!m) return null;
  const d = foldDigits(m[1]).match(/\d{1,5}/);
  return d && Number(d[0]) > 0 ? Number(d[0]) : null;
}

/**
 * The multi-image OCR version (#5021 Part A.4): one call read `reads[i]` for `pages[i]`. Where a page has a stored
 * transcription (`stored`: Map<page id, text>; the draft a correction corrects, or the text a re-read replaces), the
 * absorption check (k = the call's median, else 0: two transcriptions of one leaf are the same length) and the number
 * vote, on the body AND on the running head, are run against it. With or without one, two reads of the call that tag
 * the SAME printed page number are refused (a slid read repeats its neighbour's head). Returns [{page_number, reason,
 * detail}] for the pages to read again one per call.
 */
export function ocrBlockRefusals(pages, reads, { stored = new Map() } = {}) {
  if (!pages || pages.length < 2) return [];
  const out = new Map();
  const add = (n, reason, detail) => { if (!out.has(n)) out.set(n, { page_number: n, reason, detail }); };
  const pn = pages.map((p, i) => printedPageNumber(reads[i]));
  pn.forEach((v, i) => { if (v != null && pn.some((w, j) => j !== i && w === v)) add(pages[i].page_number, 'ocr-same-page-num', `two reads of the call print page ${v}`); });
  const withStored = pages.map((p, i) => ({ p, i, src: stored.get(p.id) })).filter((x) => x.src && x.src.trim());
  if (withStored.length >= 2) {
    const sp = withStored.map(({ p, src }) => ({ page_number: p.page_number, ocr: { data: src }, page_type: p.page_type ?? null }));
    const tr = new Map(withStored.map(({ p, i }) => [p.page_number, String(reads[i] || '')]));
    for (const a of blockAbsorptions(sp, tr, { k: 0 })) add(a.page_number, a.kind === 'absorbs' ? 'ocr-absorbed' : 'ocr-swallowed', `log own ${a.own} against the stored text`);
    const rows = classifyBook(sp.map((p) => ({ page_number: p.page_number, ocr: p.ocr.data, tr: tr.get(p.page_number) }))).rows;
    for (const r of rows) {
      if (r.cls === 'next' || r.cls === 'prev') add(r.page_number, `ocr-number-${r.cls}`, `prints the ${r.cls} leaf's ${r.votes[r.cls].join('/')}`);
      else if (r.hdr === 'next' || r.hdr === 'prev') add(r.page_number, `ocr-head-${r.hdr}`, `its running head is the ${r.hdr} leaf's`);
    }
  }
  return pages.map((p) => p.page_number).filter((n) => out.has(n)).map((n) => out.get(n));
}

/**
 * Structured output for a block call on the paid Gemini API (#5021, Derek 2026-11-03: "where the model API supports it,
 * Gemini responseSchema"). Plain-string types are the SDK's SchemaType values (image-extraction-request.mjs does the
 * same). One object per page: its number, its two anchors, its translation.
 */
export const BLOCK_RESPONSE_SCHEMA = Object.freeze({
  type: 'array',
  items: {
    type: 'object',
    properties: {
      page: { type: 'integer' },
      anchor_first: { type: 'string' },
      anchor_last: { type: 'string' },
      translation: { type: 'string' },
    },
    required: ['page', 'anchor_first', 'anchor_last', 'translation'],
  },
});

/** The prompt rule for a schema-bound block call (the schema carries the shape; this says what the fields mean). */
export function structuredBlockRule(pageNumbers) {
  return `\n\nTHE REPLY FORMAT. The reply is a JSON array (the response schema), not <translation> tags: exactly ${pageNumbers.length} objects, one per page, in the order ${pageNumbers.join(', ')}. "page" is the page number. "anchor_first" is a copy of the first ${ANCHOR_CHARS} characters and "anchor_last" a copy of the last ${ANCHOR_CHARS} characters of THAT page's source text as printed under its "--- Page N ---" heading (not counting spaces or tags), in the original script, untranslated: copy them from the page before you translate it. "translation" is that page's translation and only that page's, in the format the instructions above ask for (its own <summary> and <keywords> included). Never carry text over from the page before or after.\n`;
}

/**
 * A schema-bound reply as the tag text every block parser reads, anchors included, or null when it is not exactly one
 * object per page in the order sent (a count or page mismatch refuses the whole call: no positional guess).
 */
export function structuredReplyToTags(responseText, pageNumbers) {
  let arr;
  try { arr = JSON.parse(String(responseText || '').trim().replace(/^```[a-z]*\s*\n/i, '').replace(/\n\s*```\s*$/, '')); } catch { return null; }
  if (!Array.isArray(arr) || arr.length !== pageNumbers.length) return null;
  const esc = (v) => String(v ?? '').replace(/</g, '‹');
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    if (!o || Number(o.page) !== Number(pageNumbers[i]) || typeof o.translation !== 'string' || !o.translation.trim()) return null;
    // A translation tag inside a field would cut the tag text the parser reads: it is never English, so it goes.
    const t = o.translation.replace(/<\/?translation\b[^>]*>/gi, '').trim();
    out.push(`<translation page="${Number(o.page)}"><anchor-first>${esc(o.anchor_first)}</anchor-first><anchor-last>${esc(o.anchor_last)}</anchor-last>\n${t}</translation>`);
  }
  return out.join('\n');
}
