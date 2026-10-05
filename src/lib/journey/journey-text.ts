/**
 * Page text, shaped for the journey film (#5861): the film shows one page's
 * transcription and English as a reader pane would, and lifts a few lines of
 * each into the 3D scene.
 *
 * Every string that leaves here comes out of `stripEditorialWrappers` first,
 * so no `<summary>`/`<meta>`/`<keywords>` prose is ever shown as page text
 * (quote-and-snippet-integrity.md). The two describing blocks the film DOES
 * show — `<summary>` and `<keywords>` — are read separately by
 * `readPageDescription` and are always labelled machine-written where shown.
 *
 * PRIOR ART: src/lib/quote-text.ts (resolveQuoteText) — returns one flat
 * quotable string with inline gloss tags kept; the film needs line structure
 * (verse blockquotes) and a pane-ready text with the gloss tags removed, so it
 * starts from the same stripEditorialWrappers call and diverges after it.
 * src/lib/word-alignment.ts supplies the Trace pairs; nothing here generates them.
 */
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { stripMarkupTags } from '@/lib/strip-markup-tags';
import type { AlignmentPair } from '@/lib/word-alignment';

/** Longest line the 3D strip can set legibly (≈ 2048px canvas at the line font). */
export const FILM_LINE_MAX = 78;
/** The film shows at most this many lines of a page. */
export const FILM_LINES = 4;

/**
 * Inline apparatus the pane drops entirely: AI notes and glosses (the reader
 * shows these as asides, not as running text) and insertion markers.
 */
const DROP_INLINE = /<(note|gloss|insert)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi;

/**
 * Wrapper-stripped page text with inline tags removed but LINE STRUCTURE kept,
 * including the `> ` prefix of blockquoted verse. Margins keep their content.
 */
export function cleanPageLines(raw: string): string {
  if (!raw) return '';
  const base = stripEditorialWrappers(raw, { keepTables: false })
    .replace(DROP_INLINE, '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
  // A margin note sits beside its paragraph in the reader; here it follows the
  // paragraph, so it never splits a sentence in two.
  const paragraphs = base.split(/\n{2,}/).map(par => {
    const margins: string[] = [];
    const body = par.replace(/<margin(?:\s[^>]*)?>([\s\S]*?)<\/margin>/gi, (_, m: string) => {
      margins.push(stripMarkupTags(m, '').replace(/\s+/g, ' ').trim());
      return '';
    });
    return [body, ...margins.filter(Boolean)].join('\n');
  });
  return stripMarkupTags(paragraphs.join('\n\n'), '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/ *\n */g, '\n')
    .replace(/^> *$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The pane text: `cleanPageLines` without blockquote markers. */
export function paneText(cleaned: string): string {
  return cleaned.replace(/^> ?/gm, '');
}

/** Runs of consecutive blockquoted lines, in order, markers removed. */
export function blockquoteRuns(cleaned: string): string[][] {
  const runs: string[][] = [];
  let cur: string[] = [];
  for (const line of cleaned.split('\n')) {
    if (/^>/.test(line)) {
      const body = line.replace(/^> ?/, '').trim();
      if (body) cur.push(body);
    } else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

export function clip(s: string, max = FILM_LINE_MAX): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '') + '…';
}

export interface FilmLines {
  original: string[];
  english: string[];
  /**
   * Where the line pairing came from. `verse`: the same blockquoted verse on
   * both sides, line for line. `trace`: consecutive Trace alignment pairs.
   * `opening`: the first lines of each side, which are NOT a line-by-line
   * correspondence — the film then shows them side by side without flipping
   * one into the other.
   */
  pairing: 'verse' | 'trace' | 'opening';
}

/**
 * Pick the lines the film lifts off the page.
 *
 * `match` (curated instances) selects the verse run whose text contains it.
 */
export function pickFilmLines(
  ocrCleaned: string,
  enCleaned: string,
  pairs: AlignmentPair[] | null,
  match?: string,
): FilmLines | null {
  const oRuns = blockquoteRuns(ocrCleaned);
  const eRuns = blockquoteRuns(enCleaned);
  if (oRuns.length && oRuns.length === eRuns.length) {
    let k = match ? oRuns.findIndex(r => r.join(' ').includes(match)) : -1;
    if (k < 0) k = oRuns.findIndex((r, i) => r.length >= 2 && r.length === eRuns[i].length);
    if (k >= 0 && oRuns[k].length === eRuns[k].length) {
      const n = Math.min(FILM_LINES, oRuns[k].length);
      return {
        original: oRuns[k].slice(0, n).map(l => clip(l)),
        english: eRuns[k].slice(0, n).map(l => clip(l)),
        pairing: 'verse',
      };
    }
  }

  if (pairs && pairs.length) {
    // Whole phrases only: a span that starts mid-word reads as a fragment on screen.
    const usable = pairs.filter(p => p.s.trim().length >= 8 && p.t.trim().length >= 4 && !/^\p{Ll}/u.test(p.s.trim()));
    let start = 0;
    if (match) {
      const i = usable.findIndex(p => p.s.includes(match));
      if (i >= 0) start = i;
    }
    const take = usable.slice(start, start + FILM_LINES);
    if (take.length >= 2) {
      return {
        original: take.map(p => clip(p.s)),
        english: take.map(p => clip(p.t)),
        pairing: 'trace',
      };
    }
  }

  const bodyLines = (s: string) => paneText(s).split('\n').map(l => l.trim()).filter(l => l.length >= 12);
  const o = bodyLines(ocrCleaned).slice(0, FILM_LINES).map(l => clip(l));
  const e = bodyLines(enCleaned).slice(0, FILM_LINES).map(l => clip(l));
  if (!o.length || !e.length) return null;
  return { original: o, english: e, pairing: 'opening' };
}

/** `<summary>` and `<keywords>` from the translation — AI-written description. */
export function readPageDescription(rawTranslation: string): { summary?: string; keywords: string[] } {
  const grab = (tag: string) => {
    const m = rawTranslation.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? stripMarkupTags(m[1], '').replace(/\s+/g, ' ').trim() : '';
  };
  const summary = grab('summary') || undefined;
  const keywords = grab('keywords').split(/[,;]/).map(s => s.trim()).filter(Boolean).slice(0, 6);
  return { summary, keywords };
}

/** `<term>` spans in the translation: the original-language words it keeps. */
export function readTerms(rawTranslation: string, max = 4): string[] {
  const out: string[] = [];
  for (const m of rawTranslation.matchAll(/<term(?:\s[^>]*)?>([\s\S]*?)<\/term>/gi)) {
    const t = stripMarkupTags(m[1], '').trim();
    if (t && t.length <= 40 && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** First margin/footnote on the transcription long enough to be worth showing. */
export function firstMarginNote(rawOcr: string, minChars = 40): string | undefined {
  const s = stripEditorialWrappers(rawOcr);
  for (const m of s.matchAll(/<margin(?:\s[^>]*)?>([\s\S]*?)<\/margin>/gi)) {
    const t = stripMarkupTags(m[1].replace(DROP_INLINE, ''), '').replace(/\s+/g, ' ').trim();
    if (t.length >= minChars) return t;
  }
  return undefined;
}

/** Whitespace-insensitive containment, for verifying curated strings against the page. */
export function containsLoose(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(haystack).includes(norm(needle));
}

/**
 * A sentence from the English to close the film on: verbatim, 40–160
 * characters, not set in capitals. Leading list numbering is dropped.
 */
export function pickOutroSentence(paneEnglish: string, prefer: string[] = []): string | undefined {
  const caps = (x: string) => (x.match(/\p{Lu}/gu) || []).length / Math.max(1, (x.match(/\p{L}/gu) || []).length);
  const ok = (x: string) => x.length >= 40 && x.length <= 160 && caps(x) < 0.3;
  for (const p of prefer) {
    const t = p.replace(/…$/, '').replace(/\s*\(\d+\)\s*$/, '').trim();
    if (!p.endsWith('…') && ok(t)) return t;
  }
  const sentences = paneEnglish.replace(/\n+/g, ' ').match(/[^.!?]+[.!?]/g) || [];
  for (const raw of sentences) {
    const t = raw.trim().replace(/^\d+\.\s*/, '');
    if (ok(t)) return t;
  }
  return undefined;
}
