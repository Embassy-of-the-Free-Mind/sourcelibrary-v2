/**
 * Canonical loci — addressing a passage the way scholarship does, not the way
 * one scan happens to be paginated.
 *
 * ## The problem (#3661, surfaced through MCP in #3653 item 2)
 *
 * Source Library addresses everything by scan page, which is a property of one
 * copy and shareable with nobody. Scholarship addresses Aristotle by Bekker
 * number and Plato by Stephanus number — agreed centuries ago precisely so a
 * citation survives re-typesetting. An agent verifying attributed Aristotle
 * quotes had to reconstruct the Bekker mapping by hand and then guess:
 * *"deriving page ≈ 310 + (Bekker − 1094), and guessing."*
 *
 * ## What this module does, and what it refuses to do
 *
 * It reads references that are **printed on the page** out of the OCR's
 * `<page-num>` tag, and pairs them with the scan page they were printed on.
 * There is no fitting, no interpolation and no external reference table in the
 * addressing path: a locus is published only where a number was read off the
 * leaf, or (in a root edition whose scan→printed offset is constant and
 * verified) where the two neighbouring leaves bracket it exactly.
 *
 * Two mechanisms put a canonical number on a page and they are NOT comparable —
 * `#3661` records that conflating them scored the more valuable one worst:
 *
 *   A. the book's own pagination IS the citation standard (Bekker 1831,
 *      Stephanus 1578 — the editions the systems are named after)
 *   B. the canonical reference is printed in the margin beside the text
 *      (the Oxford/OCT convention: Burnet, the Oxford translation)
 *
 * Both are handled by the same acceptance rule below, and every anchor records
 * which mechanism produced it, so no coverage number ever sums the two.
 *
 * ## Why work identity comes from the running head
 *
 * A Bekker number is unique across the whole Aristotelian corpus, so it needs no
 * work. A Stephanus number does not: it repeats between volumes, and citation
 * practice keys on the dialogue ("Rep. 328b"). Rather than assert a
 * dialogue→page table from memory — the exact failure #3661 corrects in its own
 * opening — the work comes from the running head the printer put on every leaf,
 * the same evidence `src/lib/contains-works.ts` uses for "what does this volume
 * contain" (#3652), whose doc comment names this issue as its next step. Head
 * normalisation is shared with that module; the work/division decision is not
 * (see `locusWorkKey`). The canonical range of each work is then DERIVED by
 * joining head runs to the references read inside them, and two editions agreeing
 * on a range is corroboration from two witnesses.
 *
 * The derived ranges were checked against the values a classicist would recognise
 * — Physics 184–267, Metaphysics 980–1093, NE 1094–1181, Politics 1252–1342,
 * Poetics 1447–1462, Republic 327–621, Laws 624–969 — and they agree. That
 * agreement is a CHECK on the derivation, never its source: nothing in the
 * addressing path consults a range table.
 */

import { normalizeHeader } from './contains-works';
import { nameFormsFor } from './classical-name-forms';

export type LocusSystem = 'bekker' | 'stephanus';

/** One canonical reference. `section` is a Bekker column (a|b) or a Stephanus section (a–e). */
export interface LocusRef {
  page: number;
  section: string | null;
  line: number | null;
}

/**
 * How an anchor's reference came to be.
 *
 * `printed` — read off that leaf. `frame` — the leaf's own number was unreadable
 * or misread, and the leaf sits between two `printed` neighbours whose values
 * bracket it exactly under a constant, verified offset. Nothing else is emitted.
 * These are counted separately everywhere; see the guard in #3661.
 */
export type AnchorBasis = 'printed' | 'frame';

export interface LocusAnchor {
  page_number: number;
  ref: LocusRef;
  basis: AnchorBasis;
  /** The running head this page sits under, normalised. Null when no head governs it. */
  work_header: string | null;
  /**
   * The work beginning within two leaves, when this leaf carries no head of its
   * own. A work's opening leaves can sit under the previous work's head, so both
   * candidates are recorded rather than one being guessed.
   */
  work_header_alt: string | null;
  /** The `<page-num>` payload exactly as OCR'd, so a reviewer can check the parse. */
  raw: string | null;
}

// ── Reference parsing ──────────────────────────────────────────────

const SUPERSCRIPT_LETTERS: Record<string, string> = {
  'ᵃ': 'a', 'ᵇ': 'b', 'ᶜ': 'c', 'ᵈ': 'd', 'ᵉ': 'e',
  // U+00AA, the feminine ordinal — what OCR returns for a superscript a on
  // `339ª` in the Meteorologica volume.
  'ª': 'a',
};

/**
 * Flatten the many ways OCR renders a column letter onto a plain letter.
 *
 * Observed in the pilot set on a single book (`69ae6681…`, the Oxford Physics):
 * `184^a`, `185ᵃ`, `186<sup>a</sup>`, `339ª`. A parser that handles only one of
 * them silently drops two thirds of that book's anchors.
 */
export function normaliseRefText(raw: string): string {
  let s = String(raw);
  s = s.replace(/<sup>\s*([a-eA-E])\s*<\/sup>/g, '$1');
  s = s.replace(/[ᵃ-ᵉªᵇ]/g, (ch) => SUPERSCRIPT_LETTERS[ch] ?? ch);
  s = s.replace(/\^\s*([a-eA-E])/g, '$1');
  // Any other markup (<unclear>, <insert>…) becomes a separator rather than
  // being deleted, so `<unclear>553 a, b</unclear>` cannot fuse into one token.
  s = s.replace(/<[^>]*>/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Every reference candidate in a `<page-num>` payload, in printed order.
 *
 * A payload is not always one reference. Real examples from the OCT volumes:
 * `407 e - 408 c` (the span the leaf covers), `409 e, 410` (a section end and a
 * page start), `184b, 185a`. Both endpoints are anchors — the leaf genuinely
 * carries both — so both are returned and the caller decides.
 *
 * Returns [] when nothing numeric is present: roman front matter (`vii`), a
 * library shelfmark, an empty tag.
 */
export function parseRefCandidates(raw: string | null | undefined, system?: LocusSystem | null): LocusRef[] {
  if (!raw) return [];
  const s = normaliseRefText(raw);
  const out: LocusRef[] = [];
  // A number, optionally followed by a section letter. The letter must not be
  // glued to a longer word (`1900 v. 4` must not read as section "v").
  const re = /(\d{1,4})\s*([a-e])?(?![\p{L}\d])/giu;
  for (const m of s.matchAll(re)) {
    out.push({
      page: Number(m[1]),
      section: plausibleSection(m[2] ? m[2].toLowerCase() : null, system),
      line: null,
    });
  }
  return out;
}

/**
 * How many divisions a page has in each system: Bekker prints two columns, a
 * and b; Stephanus divides a page into five sections, a–e.
 *
 * Adopted from the parallel implementation in #3713, which spotted that the
 * section letter is checkable. It matters because OCR confuses `c` and `e` and
 * `b` and `d`: a Bekker anchor reading `1094e` is a misread, since no such
 * column exists.
 *
 * The response to an implausible letter is to keep the PAGE and drop the
 * SECTION, not to reject the anchor. The digits and the letter are separate
 * pieces of evidence — an unreadable column letter says nothing about the page
 * number printed beside it, and rejecting the whole anchor would lose a leaf we
 * can address correctly. #3713 rejects; this is the conservative half of the
 * same insight.
 */
const SECTIONS_PER_SYSTEM: Record<LocusSystem, string> = {
  bekker: 'ab',
  stephanus: 'abcde',
};

/** Null out a section letter the system cannot have. Keeps the page. */
export function plausibleSection(section: string | null, system?: LocusSystem | null): string | null {
  if (!section || !system) return section;
  return SECTIONS_PER_SYSTEM[system].includes(section) ? section : null;
}

/** Sortable key: page, then section, then line. */
export function refSortKey(ref: LocusRef): number {
  const sec = ref.section ? ref.section.charCodeAt(0) - 96 : 0;
  return ref.page * 10000 + sec * 100 + Math.min(ref.line ?? 0, 99);
}

export function formatRef(ref: LocusRef): string {
  return `${ref.page}${ref.section ?? ''}${ref.line ? `.${ref.line}` : ''}`;
}

// ── Query parsing ──────────────────────────────────────────────────

export interface LocusQuery {
  system: LocusSystem | null;
  /** Free text before the number — a work name or an abbreviation, unresolved. */
  work: string | null;
  ref: LocusRef;
}

/**
 * Parse what a caller actually types: `1094a8`, `1094 a 8`, `Bekker 1094a`,
 * `Rep. 328b`, `Republic 328 b`, `Nicomachean Ethics 1103b`.
 *
 * The system is named only when the caller says so or when the shape gives it
 * away; otherwise it stays null and resolution decides from the anchors. Do not
 * infer a system from the number's magnitude — Stephanus and Bekker ranges
 * overlap almost completely.
 */
export function parseLocusQuery(input: string): LocusQuery | null {
  const s = normaliseRefText(String(input || '')).trim();
  if (!s) return null;

  let system: LocusSystem | null = null;
  let rest = s;
  const sysMatch = rest.match(/^(bekker|stephanus|steph)\b[\s.:]*/i);
  if (sysMatch) {
    system = /^steph/i.test(sysMatch[1]) ? 'stephanus' : 'bekker';
    rest = rest.slice(sysMatch[0].length);
  }

  // page + optional section + optional line, at the END of the string
  const m = rest.match(/(\d{1,4})\s*([a-eA-E])?\s*[.,]?\s*(\d{1,3})?\s*$/);
  if (!m) return null;
  const work = rest.slice(0, m.index).replace(/[\s.,:]+$/, '').trim() || null;
  return {
    system,
    work,
    ref: {
      page: Number(m[1]),
      section: m[2] ? m[2].toLowerCase() : null,
      line: m[3] ? Number(m[3]) : null,
    },
  };
}

// ── Which running head names a work ────────────────────────────────

/**
 * Fold accents so a Greek head can be compared with a Greek name form.
 *
 * `normalizeHeader` strips Latin punctuation and uppercases, which turns
 * `Πλάτωνος` into `ΠΛΆΤΩΝΟΣ` — not equal to the `ΠΛΑΤΩΝΟΣ` printed on the leaf.
 * Without folding, the author's own name is accepted as a work and the Burnet
 * Republic reports 363 anchors under the head "ΠΛΑΤΩΝΟΣ", which is not a work.
 */
function foldDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
}

/**
 * A head that names a division of a work rather than a work.
 *
 * These matter more here than in `contains-works.ts`, because a division head
 * does not merely add a spurious row — it *cuts the work's reference run in two*,
 * and each fragment is then chained separately. Burnet's Republic heads its rectos
 * `ΠΟΛΙΤΕΙΑΣ Α I` … `ΠΟΛΙΤΕΙΑΣ Ι Χ`, and the Oxford translation heads
 * `BOOK IV 8`; left alone, one dialogue became eleven segments.
 */
const DIVISION_HEAD =
  /^(BOOK|CHAPTER|CHAP|PART|SECTION|LIBER|LIB|CAPUT|CAP|ΒΙΒΛΙΟΝ|ΤΜΗΜΑ)\b/i;

const NOT_A_WORK_HEAD =
  /^(INTRODUCTION|INTROD|PREFACE|PRAEFATIO|CONTENTS|INDEX|ERRATA|CORRIGENDA|ADVERTISEMENT|APPENDIX|NOTES?|ADNOTATIONES|ANNOT\b|DEDICATION|PROLEGOMENA|ΠΙΝΑΞ|ΠΡΟΛΟΓΟΣ|BIBLIOGRAPH)/i;

/**
 * The work a running head names, or null if it names none.
 *
 * Built on `normalizeHeader` (#3652 — letter-spacing collapse and trailing book
 * numerals) with three additions this use needs:
 *
 *   - a trailing numeral PAIR: a Greek book letter followed by its roman
 *     equivalent, `ΝΟΜΩΝ Θ IX` → `ΝΟΜΩΝ`. `normalizeHeader` cannot strip these
 *     because its guard refuses to strip a numeral preceded by a single letter —
 *     the guard that stops letter-spaced capitals from eating themselves.
 *   - division heads and front matter rejected outright (see DIVISION_HEAD).
 *   - the author's own name rejected, with accents folded first.
 */
export function locusWorkKey(raw: string | null | undefined, author?: string): string | null {
  if (!raw) return null;
  let s = normalizeHeader(String(raw).replace(/[[\]()]/g, ' '));
  // Greek book letter + roman numeral, e.g. "ΠΟΛΙΤΕΙΑΣ Α I" / "ΝΟΜΩΝ ΙΒ XII".
  s = s.replace(/\s+[ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩϚ]{1,3}\s+[IVXLCΧ]{1,6}$/u, '').trim();
  s = normalizeHeader(s);
  if (!s || s.length < 3) return null;
  if (!/\p{L}/u.test(s)) return null;
  if (DIVISION_HEAD.test(s) || NOT_A_WORK_HEAD.test(s)) return null;

  const folded = foldDiacritics(s);
  const authorForms = [
    ...String(author || '').split(/[;,|(]/),
    ...nameFormsFor(author),
  ]
    .map((a) => foldDiacritics(normalizeHeader(a.trim())))
    .filter((a) => a.length >= 4);

  // An inflected form of the author's name, not just an exact match. The verso
  // head of the 1578 Stephanus is `PLATONIS` — the Latin genitive — against an
  // `author` field of "Plato", and the Greek volumes head `ΠΛΑΤΩΝΟΣ` against
  // `Πλάτων`. Exact comparison accepted both as works, and `PLATONIS` then
  // "contained" 464 anchors spanning the entire volume.
  if (!/\s/.test(folded)) {
    for (const f of authorForms) {
      if (folded === f) return null;
      if (folded.startsWith(f) && folded.length - f.length <= 4) return null;
      if (f.startsWith(folded) && f.length - folded.length <= 4) return null;
    }
  }

  return s;
}

// ── Anchor extraction ──────────────────────────────────────────────

export interface LocusPageInput {
  page_number: number;
  /** The `<header>` payload, raw. */
  header: string | null;
  /** The `<page-num>` payload, raw. */
  page_num: string | null;
}

export interface WorkSegment {
  work_header: string | null;
  first_page: number;
  last_page: number;
  ref_min: number;
  ref_max: number;
  anchors: number;
}

export interface ExtractOptions {
  /** The book's author, so a head that is only the author's name names no work. */
  author?: string;
  /** Which system this edition is in, so an impossible section letter is dropped. */
  system?: LocusSystem;
  /**
   * Set for a root edition whose own pagination IS the citation standard. The
   * offset (printed − scan) is then measured, required to be constant across
   * `frameMinShare` of accepted anchors, and used to fill leaves whose own
   * number was misread but whose neighbours bracket them.
   */
  frame?: boolean;
  frameMinShare?: number;
}

export interface ExtractReport {
  pages: number;
  /** Pages carrying a `<page-num>` that parsed to at least one candidate. */
  candidate_pages: number;
  printed: number;
  frame: number;
  /** Printed numbers dropped because they sat off a frame edition's verified offset. */
  off_frame: number;
  /** Every dropped candidate, whatever the reason. */
  rejected: number;
  ref_min: number | null;
  ref_max: number | null;
  /** printed − scan, when constant enough to be a frame. Null otherwise. */
  frame_offset: number | null;
  frame_offset_share: number | null;
  segments: WorkSegment[];
}

export interface ExtractResult {
  anchors: LocusAnchor[];
  report: ExtractReport;
  /** Every dropped candidate, with the reason — the residual, reported not smoothed. */
  rejected: Array<{ page_number: number; raw: string | null; reason: string }>;
}

/**
 * How far a reference may advance between two anchored leaves.
 *
 * Bounded by the scan-page gap, because intervening unanchored leaves legitimately
 * carry the reference forward. Generous on purpose: the rule exists to reject a
 * value from a different numbering system that landed in `<page-num>` (a chapter
 * number, a shelfmark, the book's own folio), not to police typesetting.
 */
function maxStep(gap: number): number {
  return 3 * Math.max(1, gap) + 3;
}

/**
 * The longest monotone chain through per-page candidates.
 *
 * This is the whole acceptance rule, and it is deliberately local: a candidate is
 * kept iff it continues a non-decreasing run within its work at a bounded rate.
 * That is what separates a canonical marginal from the OCR having caught the
 * chapter number instead — in the Oxford Physics, `<page-num>` holds `186a` on
 * one leaf and `5` (a chapter) on another, and no range table is needed to tell
 * them apart because 5 does not continue the run.
 *
 * Dynamic programming rather than a greedy walk, because the run has to be able
 * to start at the right value: seeding from the first candidate would let one
 * piece of front-matter noise reject the entire book.
 */
function longestMonotoneChain(
  items: Array<{ pageIndex: number; page_number: number; candIndex: number; ref: LocusRef }>,
): Set<string> {
  const n = items.length;
  if (!n) return new Set();
  const best = new Array<number>(n).fill(1);
  const prev = new Array<number>(n).fill(-1);
  let bestEnd = 0;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (items[j].page_number > items[i].page_number) continue; // same leaf, later candidate
      const refGap = items[i].ref.page - items[j].ref.page;
      if (refGap < 0) continue;
      const scanGap = items[i].page_number - items[j].page_number;
      if (refGap > maxStep(scanGap)) continue;
      if (best[j] + 1 > best[i]) { best[i] = best[j] + 1; prev[i] = j; }
    }
    if (best[i] > best[bestEnd]) bestEnd = i;
  }

  const keep = new Set<string>();
  for (let i = bestEnd; i !== -1; i = prev[i]) keep.add(`${items[i].pageIndex}:${items[i].candIndex}`);
  return keep;
}

/**
 * Extract canonical anchors from one book's pages.
 *
 * Pure: takes `[page, header, page-num]` triples and returns anchors plus the
 * residual. Nothing here touches the database, so the acceptance rule is testable
 * against fixtures — and it is, in `tests/unit/locus-anchors.test.ts`.
 */
export function extractAnchors(pages: LocusPageInput[], opts: ExtractOptions = {}): ExtractResult {
  const sorted = [...pages].sort((a, b) => a.page_number - b.page_number);

  // 1. Which running heads name a work at all. Reuses the reviewed derivation
  //    from #3652 rather than re-deciding it here: same author-name rejection,
  //    same letter-spacing collapse, same density floor.
  const rawKeyAt = sorted.map((p) => locusWorkKey(p.header, opts.author));

  // Fuse a book numeral back onto its work. Once letter-spacing is collapsed, a
  // numeral glued to the end of a display-capital head cannot be told from the
  // word's own last letter: Bekker vol. II heads `Π Ο Λ Ι Τ Ι Κ Ω Ν  Β`, which
  // collapses to `ΠΟΛΙΤΙΚΩΝΒ`. `contains-works.ts` resolves this by merging a
  // key that is a prefix of another; the rule here is tighter — the extra
  // characters must themselves BE numerals — because a wrong merge here does not
  // add a row, it moves anchors under the wrong work.
  const NUMERAL_TAIL = /^[ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩϚIVX]{1,2}$/u;
  const rawCounts = new Map<string, number>();
  for (const k of rawKeyAt) if (k) rawCounts.set(k, (rawCounts.get(k) ?? 0) + 1);
  const canonical = new Map<string, string>();
  const byLength = [...rawCounts.keys()].sort((a, b) => a.length - b.length);
  for (const long of byLength) {
    for (const short of byLength) {
      if (short.length >= long.length || short.length < 5) continue;
      if (!long.startsWith(short)) continue;
      if (!NUMERAL_TAIL.test(long.slice(short.length))) continue;
      canonical.set(long, canonical.get(short) ?? short);
      break;
    }
  }

  const keyAt = rawKeyAt.map((k) => (k ? canonical.get(k) ?? k : null));
  const headCounts = new Map<string, number>();
  for (const k of keyAt) if (k) headCounts.set(k, (headCounts.get(k) ?? 0) + 1);

  // 2. Segment the leaves by work: each leaf inherits the last work-naming head
  //    seen at or before it. A verso head that is only the author's name
  //    ("ΠΛΑΤΩΝΟΣ" on 254 leaves of the Burnet Republic) names no work and
  //    correctly carries the previous one forward.
  const isWorkHead = (i: number) => {
    const k = keyAt[i];
    return !!k && (headCounts.get(k) ?? 0) >= 2;
  };

  const segmentOf: Array<string | null> = [];
  const segmentIdOf: number[] = [];
  let current: string | null = null;
  let segmentId = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (isWorkHead(i) && keyAt[i] !== current) { current = keyAt[i]; segmentId++; }
    segmentOf.push(current);
    segmentIdOf.push(segmentId);
  }

  // A work's opening leaves can sit under its predecessor's head.
  //
  // In these editions the recto names the work and the verso names only the
  // author, so a leaf carrying no head of its own inherits the previous work —
  // correct in the middle of a work, wrong for the first leaf or two of the next
  // one. Stephanus vol. 2 prints the Republic from page 327, and leaf 340
  // (printed 328) came back filed under MINOS, so `Republic 328b` reported the
  // 1902 OCT and NOT the 1578 edition the number is named after.
  //
  // Rather than guess which side such a leaf belongs to, record BOTH: the
  // inherited work and the one starting within two leaves. Resolution accepts
  // either and says which leaves were matched that way.
  const altOf: Array<string | null> = new Array(sorted.length).fill(null);
  for (let i = 0; i < sorted.length; i++) {
    if (isWorkHead(i)) continue;
    for (let j = i + 1; j <= i + 2 && j < sorted.length; j++) {
      if (!isWorkHead(j)) continue;
      if (keyAt[j] !== segmentOf[i]) altOf[i] = keyAt[j];
      break;
    }
  }

  // 3. Accept candidates by monotone run WITHIN each work. Across works the
  //    reference legitimately resets — Burnet's vol. 4 runs Clitopho 406–410,
  //    then Republic 327–621, then Timaeus 17–92 — so a single global run would
  //    throw away two thirds of the book.
  const bySegment = new Map<number, Array<{ pageIndex: number; page_number: number; candIndex: number; ref: LocusRef; raw: string }>>();
  let candidatePages = 0;
  sorted.forEach((p, pageIndex) => {
    const cands = parseRefCandidates(p.page_num, opts.system);
    if (!cands.length) return;
    candidatePages++;
    const seg = segmentIdOf[pageIndex];
    const arr = bySegment.get(seg) ?? [];
    cands.forEach((ref, candIndex) => arr.push({ pageIndex, page_number: p.page_number, candIndex, ref, raw: p.page_num as string }));
    bySegment.set(seg, arr);
  });

  const kept = new Set<string>();
  for (const [, items] of bySegment) {
    for (const k of longestMonotoneChain(items)) kept.add(k);
  }

  const anchors: LocusAnchor[] = [];
  const rejected: ExtractResult['rejected'] = [];
  for (const [, items] of bySegment) {
    for (const it of items) {
      const key = `${it.pageIndex}:${it.candIndex}`;
      if (kept.has(key)) {
        anchors.push({
          page_number: it.page_number,
          ref: it.ref,
          basis: 'printed',
          work_header: segmentOf[it.pageIndex],
          work_header_alt: altOf[it.pageIndex],
          raw: it.raw,
        });
      } else {
        rejected.push({ page_number: it.page_number, raw: it.raw, reason: 'breaks the monotone run within its work' });
      }
    }
  }
  anchors.sort((a, b) => a.page_number - b.page_number || refSortKey(a.ref) - refSortKey(b.ref));

  // 4. Root editions only: measure the scan→printed offset and, if it is
  //    genuinely constant, fill the leaves whose own number was misread.
  //
  //    This is the one place a reference is not read off its own leaf, and it is
  //    fenced accordingly: the offset must hold on `frameMinShare` of accepted
  //    anchors, and a leaf is filled only when BOTH neighbours are printed
  //    anchors agreeing with the offset — i.e. they bracket the missing value
  //    exactly. That is corroboration by adjacency, not interpolation across a
  //    gap, and #3661's guard ("never interpolate a locus that isn't
  //    corroborated") is the reason for the distinction.
  let frameOffset: number | null = null;
  let frameShare: number | null = null;
  let frameCount = 0;
  let offFrame = 0;
  let published = anchors;

  if (opts.frame && anchors.length) {
    const counts = new Map<number, number>();
    for (const a of anchors) {
      const off = a.ref.page - a.page_number;
      counts.set(off, (counts.get(off) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    frameShare = ranked[0][1] / anchors.length;

    if (frameShare >= (opts.frameMinShare ?? 0.75)) {
      frameOffset = ranked[0][0];

      // Anchors OFF the frame are not published, even though their number was
      // printed. In a mechanism-A edition the published claim is "this leaf's
      // printed number IS the canonical reference", and that claim holds only
      // where the frame holds. Stephanus vols. 1 and 3 each append Estienne's or
      // Serranus's annotations, separately paginated from 1 — publishing those
      // would answer "Stephanus 100" with a page of a 16th-century commentary.
      const onFrame: LocusAnchor[] = [];
      for (const a of anchors) {
        if (a.ref.page - a.page_number === frameOffset) onFrame.push(a);
        else {
          offFrame++;
          rejected.push({
            page_number: a.page_number,
            raw: a.raw,
            reason: `printed number ${a.ref.page} is off the verified frame (offset ${frameOffset}) — a second pagination sequence, not a canonical reference`,
          });
        }
      }

      const printedAt = new Set(onFrame.map((a) => a.page_number));
      for (let i = 0; i < sorted.length; i++) {
        const pn = sorted[i].page_number;
        if (printedAt.has(pn)) continue;
        if (!printedAt.has(pn - 1) || !printedAt.has(pn + 1)) continue;
        onFrame.push({
          page_number: pn,
          ref: { page: pn + frameOffset, section: null, line: null },
          basis: 'frame',
          work_header: segmentOf[i],
          work_header_alt: altOf[i],
          raw: sorted[i].page_num ?? null,
        });
        frameCount++;
      }
      onFrame.sort((a, b) => a.page_number - b.page_number || refSortKey(a.ref) - refSortKey(b.ref));
      published = onFrame;
    } else {
      // The edition was declared a reference frame and is not one. Publish
      // nothing rather than publish a number whose meaning is unestablished.
      for (const a of anchors) {
        rejected.push({
          page_number: a.page_number,
          raw: a.raw,
          reason: `edition declared a reference frame but no constant offset holds (best ${ranked[0][0]} on ${(frameShare * 100).toFixed(1)}%)`,
        });
      }
      published = [];
    }
  }
  const anchorsOut = published;

  // 5. Per-work reference ranges — derived, not declared. This is the table that
  //    lets a bare Bekker number name its work, and lets two editions corroborate
  //    each other by agreeing on a range.
  const segMap = new Map<string | null, WorkSegment>();
  for (const a of anchorsOut) {
    const key = a.work_header;
    const e = segMap.get(key) ?? {
      work_header: key, first_page: a.page_number, last_page: a.page_number,
      ref_min: a.ref.page, ref_max: a.ref.page, anchors: 0,
    };
    e.first_page = Math.min(e.first_page, a.page_number);
    e.last_page = Math.max(e.last_page, a.page_number);
    e.ref_min = Math.min(e.ref_min, a.ref.page);
    e.ref_max = Math.max(e.ref_max, a.ref.page);
    e.anchors++;
    segMap.set(key, e);
  }

  return {
    anchors: anchorsOut,
    rejected,
    report: {
      pages: sorted.length,
      candidate_pages: candidatePages,
      printed: anchorsOut.filter((a) => a.basis === 'printed').length,
      frame: frameCount,
      off_frame: offFrame,
      rejected: rejected.length,
      frame_offset: frameOffset,
      frame_offset_share: frameShare === null ? null : Number(frameShare.toFixed(4)),
      ref_min: anchorsOut.length ? Math.min(...anchorsOut.map((a) => a.ref.page)) : null,
      ref_max: anchorsOut.length ? Math.max(...anchorsOut.map((a) => a.ref.page)) : null,
      segments: [...segMap.values()].sort((a, b) => a.ref_min - b.ref_min),
    },
  };
}
