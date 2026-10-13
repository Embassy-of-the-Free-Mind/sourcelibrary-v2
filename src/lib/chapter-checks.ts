/**
 * Mechanical checks on an extracted chapter list — the things a model's own
 * `confidence` never looked at (#3697).
 *
 * PRIOR ART: src/lib/chapter-text.ts (computeEndPages) — derives spans, checks
 * nothing; src/lib/front-matter.ts — per-page front/back-matter verdict, reused
 * below for the tail; src/lib/dedup.ts romanToInt — accepts any letter run
 * ("ivxlcdm" → a number), too loose for telling a numeral from a word here.
 *
 * ## Why
 *
 * Measured 2026-08-07: 303,009 of 315,356 chapter entries (96.1%) carried
 * `confidence: "high"`, and 10,926 of 15,763 books were high on every entry.
 * On the reported book (Taylor 1818, Nicomachean Ethics) all 125 entries were
 * high — including a Book IX that runs Chapter III → Chapter V, and a Book X
 * ch. IX spanning 16 pages (siblings: 2–7) because it had swallowed the
 * publisher's advertisements and the library stamp after the text ends.
 *
 * The field was the model's self-report passed through untouched. These checks
 * are cheap, need no model call, and run both at write time
 * (`chapter-extraction.ts`) and at read time (MCP `get_book`), so the corpus
 * already on disk is served honestly without a migration.
 *
 * ## What `confidence` means after this
 *
 * An entry any check flags is lowered — to `low` for a numbering gap, to at
 * most `medium` for a span outlier — with `flags` saying why, and the model's
 * own value kept as `model_confidence`. An unflagged entry keeps the
 * model's value — which now means "the model said so AND nothing checkable
 * contradicts it", not "validated". `CHECKS_RUN` names what was checked so a
 * caller can see the limit.
 */
import type { Chapter } from '@/lib/types';
import { frontMatterVerdict } from '@/lib/front-matter';

export type ChapterFlag = 'numbering-gap' | 'span-outlier';

/**
 * How far each flag lowers `confidence`. A gap is a near-certain error at that
 * spot (a heading missed or misassigned). A long span is only suspicious —
 * some treatises really have one long book — so it caps at medium.
 */
const CAP: Record<ChapterFlag, 'low' | 'medium'> = { 'numbering-gap': 'low', 'span-outlier': 'medium' };
const RANK = { low: 0, medium: 1, high: 2 } as const;

export const CHECKS_RUN = [
  'numbering-gap: a numbered sibling run (Chapter III → Chapter V) skips a number',
  'span-outlier: a leaf entry runs at least 3x (and 6+ pages over) the median length of its leaf siblings',
] as const;

/** Canonical roman numerals only, so a word like "civil" or "mild" never parses. */
const ROMAN = /^(m{0,3})(cm|cd|d?c{0,4})(xc|xl|l?x{0,4})(ix|iv|v?i{0,4})$/i;

function romanValue(s: string): number | null {
  if (!s || !ROMAN.test(s)) return null;
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const t = s.toLowerCase();
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const cur = map[t[i]];
    const next = map[t[i + 1]];
    total += next != null && cur < next ? -cur : cur;
  }
  return total > 0 ? total : null;
}

/**
 * Words that introduce a numbered division. The label is part of the sibling
 * key, so "Lecture 3" and "Chapter 4" under one parent are never compared.
 */
const LABEL =
  '(chapter|chap|chapitre|capitolo|capitulo|capítulo|kapitel|caput|capitulum|cap|book|liber|livre|libro|buch|part|pars|partie|teil|section|sectio|sect|tractatus|tract|treatise|lectio|lecture|lesson|distinctio|quaestio|question|articulus|article|letter|epistola|epistle|sermo|sermon|homily|canto|act|scene|discourse|dialogue|essay|proposition|prop|theorem|lemma|problem|ode|elegy|satire|hymn|oration|regula|rule|aphorism|§)';
const NUM = '([ivxlcdm]+|\\d{1,4})';
/** "Caput I & II", "Chapters 3–4": a heading that covers a range ends at the upper number. */
const RANGE_TAIL = new RegExp(`^\\.?\\s*(?:&|and|et|und|-|–|—)\\s*${NUM}\\b`, 'i');
const LABELLED = new RegExp(`^\\s*${LABEL}s?\\.?\\s+${NUM}\\b`, 'i');
/** A title that is nothing but a numeral: "IX.", "12", "XIV —". */
const BARE = /^\s*([ivxlcdm]+|\d{1,4})\s*[.:—–-]?\s*$/i;

/** `{ label, n }` for a numbered title, or null. Exported for tests. */
export function parseNumbering(title: string | undefined): { label: string; n: number } | null {
  if (!title) return null;
  const clean = title.replace(/[*_#]/g, '').trim();
  let label = '';
  let token: string | undefined;
  const m = clean.match(LABELLED);
  if (m) {
    label = m[1].toLowerCase().replace(/^(chap|cap|capitulum)$/, 'caput').replace(/^chapter$/, 'caput');
    token = m[2];
    const range = clean.slice(m[0].length).match(RANGE_TAIL);
    if (range) token = range[1];
  } else {
    const b = clean.match(BARE);
    if (b) token = b[1];
  }
  if (!token) return null;
  const n = /^\d+$/.test(token) ? parseInt(token, 10) : romanValue(token);
  return n ? { label, n } : null;
}

export interface NumberingGap {
  /** Index into the chapter list of the entry BEFORE the gap. */
  afterIndex: number;
  /** Index of the entry AFTER the gap. */
  beforeIndex: number;
  /** The numbers that should have appeared between them. */
  missing: number[];
}

/** Index of each entry's parent (nearest earlier entry at a shallower level), or -1. */
function parentIndexes(chapters: Chapter[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const level = chapters[i].level ?? 1;
    let p = -1;
    for (let j = i - 1; j >= 0; j--) {
      if ((chapters[j].level ?? 1) < level) { p = j; break; }
    }
    out.push(p);
  }
  return out;
}

/**
 * A numbered sibling run that skips one to three numbers. Bigger jumps are left
 * alone: they are far more often two interleaved series or a misread numeral
 * than three-plus lost headings, and a false gap is noise on every call.
 * A run that does not start at 1 is also left alone — front matter, prefaces
 * and continued volumes make that the normal case, not evidence.
 */
export function findNumberingGaps(chapters: Chapter[]): NumberingGap[] {
  const parents = parentIndexes(chapters);
  const lastInGroup = new Map<string, { index: number; n: number }>();
  const gaps: NumberingGap[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const num = parseNumbering(chapters[i].title) ?? parseNumbering(chapters[i].titleEn);
    if (!num) continue;
    const key = `${parents[i]}|${chapters[i].level ?? 1}|${num.label}`;
    const prev = lastInGroup.get(key);
    if (prev) {
      const step = num.n - prev.n;
      if (step >= 2 && step <= 4) {
        const missing: number[] = [];
        for (let k = prev.n + 1; k < num.n; k++) missing.push(k);
        gaps.push({ afterIndex: prev.index, beforeIndex: i, missing });
      }
    }
    lastInGroup.set(key, { index: i, n: num.n });
  }
  return gaps;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Entries whose span is out of all proportion to their siblings'. Needs four or
 * more siblings with spans, and the excess must be real pages (median + 6), so
 * a 3-page chapter among 1-page siblings is not flagged.
 *
 * The case this exists for is the LAST chapter of a book: nothing bounds it
 * but the page count, so it absorbs indexes, advertisements and endpapers.
 */
export function findSpanOutliers(chapters: Chapter[]): number[] {
  const parents = parentIndexes(chapters);
  const groups = new Map<string, number[]>();
  chapters.forEach((c, i) => {
    if (c.endPage == null) return;
    // A container ("Book I" followed by its chapters) is as long as its
    // children make it; comparing it with leaf siblings (a preface) is noise.
    // Its children are checked in their own group.
    const next = chapters[i + 1];
    if (next && (next.level ?? 1) > (c.level ?? 1)) return;
    const key = `${parents[i]}|${c.level ?? 1}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const out: number[] = [];
  for (const members of groups.values()) {
    if (members.length < 4) continue;
    for (const i of members) {
      const span = (chapters[i].endPage as number) - chapters[i].pageNumber + 1;
      const others = members.filter(j => j !== i)
        .map(j => (chapters[j].endPage as number) - chapters[j].pageNumber + 1);
      const m = median(others);
      if (span >= Math.max(3 * m, m + 6)) out.push(i);
    }
  }
  return out.sort((a, b) => a - b);
}

export interface CheckedChapter extends Chapter {
  /** The extraction model's own value, before any check could lower it. */
  model_confidence?: Chapter['confidence'];
  flags?: ChapterFlag[];
}

export interface ChapterCheckReport {
  chapters: CheckedChapter[];
  gaps: Array<{ after: string; before: string; missing: number[]; pages: [number, number] }>;
  flagged: number;
}

/**
 * Run every check and return a copy of the list with `confidence` calibrated:
 * a flagged entry is lowered per CAP, an unflagged one keeps the model's value. Expects
 * `endPage` already computed (stored lists have it; extraction computes it
 * before calling this). Does not mutate the input.
 */
export function checkChapters(chapters: Chapter[]): ChapterCheckReport {
  const flags = new Map<number, Set<ChapterFlag>>();
  const add = (i: number, f: ChapterFlag) => {
    if (!flags.has(i)) flags.set(i, new Set());
    flags.get(i)!.add(f);
  };
  const gaps = findNumberingGaps(chapters);
  // Both neighbours: the earlier one's span probably holds the missing
  // chapter's pages, and the later one may be mislabelled.
  for (const g of gaps) { add(g.afterIndex, 'numbering-gap'); add(g.beforeIndex, 'numbering-gap'); }
  for (const i of findSpanOutliers(chapters)) add(i, 'span-outlier');

  // Idempotent: a list saved by chapter-extraction.ts is already checked, and
  // MCP get_book checks it again. Always start from the MODEL's value and drop
  // stale flags, so a second pass neither compounds nor loses anything.
  const out: CheckedChapter[] = chapters.map((c, i) => {
    const rest: CheckedChapter = { ...c };
    const base = rest.model_confidence ?? rest.confidence;
    delete rest.confidence;
    delete rest.model_confidence;
    delete rest.flags;
    const f = flags.get(i);
    if (!f) return { ...rest, ...(base ? { confidence: base } : {}) };
    const cap = [...f].map(x => CAP[x]).sort((a, b) => RANK[a] - RANK[b])[0];
    const lowered = base && RANK[base] < RANK[cap] ? base : cap;
    return {
      ...rest,
      confidence: lowered,
      ...(base ? { model_confidence: base } : {}),
      flags: [...f],
    };
  });
  return {
    chapters: out,
    gaps: gaps.map(g => ({
      after: chapters[g.afterIndex].title,
      before: chapters[g.beforeIndex].title,
      missing: g.missing,
      pages: [chapters[g.afterIndex].pageNumber, chapters[g.beforeIndex].pageNumber],
    })),
    flagged: flags.size,
  };
}

/**
 * First page of the book's END MATTER — the run of leaves after the last
 * printed body page — or null when it cannot be told.
 *
 * Two kinds of tail leaf:
 *
 *   structural — `frontMatterVerdict` says index, blank, colophon, errata, …
 *                Reliable on its own (see STRUCTURAL_PAGE_TYPES there),
 *                except `illustration`: closing plates belong to the work.
 *   unnumbered — no printed page number. Only evidence when the body IS
 *                numbered: on Taylor's Ethics the publisher's advertisements
 *                and the library stamp are typed `text`, and what gives them
 *                away is that pp.392–400 print 401–409 and they print nothing.
 *
 * The second rule is used only when the 10 leaves before the last numbered
 * body page are at least 70% numbered. Without that guard, sampled 2026-10-12,
 * it trimmed 33 pages of a Tibetan manuscript and 35 of a signature-foliated
 * 1690s print, whose last stray page number sat far from the end. In those
 * books only the trailing structural run counts.
 *
 * Returns null when no tail is found; the default must be "this is text", for
 * the same reason as in front-matter.ts.
 *
 * On the Taylor Ethics this puts end matter at p.401 (blank, James Black's
 * advertisements, endpapers, the Stanford stamp), where the last body page is
 * p.400, printed 409.
 */
export function endMatterStart(
  pages: Array<{ page_number: number; ocr?: string | null }>,
  maxTail = 40,
): number | null {
  const sorted = [...pages].sort((a, b) => a.page_number - b.page_number);
  const info = sorted.map(p => {
    const ocr = p.ocr || '';
    const printed = ocr.match(/<page-num>\s*([^<]{1,12}?)\s*<\/page-num>/)?.[1]?.trim();
    return {
      page: p.page_number,
      numbered: !!printed && /^\d{1,4}\.?$/.test(printed),
      // Plates are structural to front-matter.ts (binding photographs) but at
      // the END of a book they are usually the work's own plates: never tail.
      structural: frontMatterVerdict(ocr).is_front_matter
        && !/<page-type>\s*illustration\s*</i.test(ocr),
    };
  });
  const floor = Math.max(0, info.length - maxTail);

  // Trailing run of structural leaves — always safe to cut.
  let structuralStart: number | null = null;
  for (let i = info.length - 1; i >= floor && info[i].structural; i--) structuralStart = info[i].page;

  // Last numbered, non-structural leaf = last body page, if the body is numbered.
  let anchor = -1;
  for (let i = info.length - 1; i >= floor; i--) {
    if (info[i].numbered && !info[i].structural) { anchor = i; break; }
  }
  if (anchor >= 0 && anchor < info.length - 1) {
    const window = info.slice(Math.max(0, anchor - 9), anchor + 1);
    const share = window.filter(x => x.numbered).length / window.length;
    if (window.length >= 5 && share >= 0.7) return info[anchor + 1].page;
  }
  return structuralStart;
}
