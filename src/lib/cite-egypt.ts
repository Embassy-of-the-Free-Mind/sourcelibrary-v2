/**
 * Egyptological citation resolver — `Urk. I, 124`, `ARE I §335`, `Wb 1, 81.8`
 * → the leaf in this library's copy of that edition.
 *
 * PRIOR ART: src/lib/locus.ts — parses Bekker/Stephanus references and pairs
 * them with leaves through `locus_anchors` in Mongo; it addresses a canonical
 * page+column shared across editions, not one edition's own pagination or
 * Breasted's § sections, and it answers with witnesses, not a redirect.
 * src/lib/page-number-resolve.ts resolves `pages.page_number`, which is the scan
 * sequence, not a printed number. This module is pure: it reads the static
 * concordances in `src/data/cite/` (built by
 * scripts/maintenance/build-cite-concordance.mjs from each leaf's `<page-num>`)
 * and never touches the database.
 *
 * ## Who uses it
 *
 * An Egyptologist on a TLA lemma page sees "Wb 1, 81.8" or "Urk. I, 124" with no
 * link. They paste it into /api/cite?ref=… and land in the reader on the scanned
 * page beside its transcription. The Yam packet cites Breasted by § and Sethe by
 * page and hand-computed reader page numbers until this existed.
 *
 * ## What a resolution is
 *
 * `basis: 'printed'` — the number was read off that leaf's OCR.
 * `basis: 'frame'`   — the leaf sits between two printed neighbours agreeing on
 *                      the scan→printed offset (canonical-loci.md's one fence).
 * `basis: 'nearest'` — no leaf carries the number (a plate gap, or a § whose
 *                      opening line the OCR lost); the reader lands on the
 *                      nearest leaf BEFORE it, which is at most a page-flip away.
 * A citation outside the edition's printed range is not resolved at all.
 */
import urkI from '@/data/cite/urk-i.json';
import areI from '@/data/cite/are-i.json';

export type CiteEdition = 'urk' | 'are' | 'wb';
export type CiteKind = 'page' | 'section';
export type CiteBasis = 'printed' | 'frame' | 'nearest';

export interface ParsedCite {
  edition: CiteEdition;
  volume: number;
  kind: CiteKind;
  /** Page number or § number; the start of a range. */
  value: number;
  /** End of a range (`120–131`, `§333–336`), else null. */
  end: number | null;
  /** Line (`Urk I 124,3`) or entry (`Wb 1, 81.8`), else null. Not resolved — the leaf is. */
  sub: number | null;
  /** The reference as normalised, for the response. */
  label: string;
}

export interface Concordance {
  edition: string;
  label: string;
  book_id: string;
  slug: string | null;
  page_range: [number, number] | null;
  pages: Record<string, number>;
  frame: Record<string, number>;
  sections?: Record<string, number>;
}

export type CiteResolution =
  | {
      status: 'ok';
      cite: ParsedCite;
      edition: string;
      edition_label: string;
      book_id: string;
      page: number;
      basis: CiteBasis;
      url: string;
    }
  | { status: 'not-held'; cite: ParsedCite; edition_label: string }
  | { status: 'not-found'; cite: ParsedCite; edition: string; edition_label: string; reason: string };

const EDITION_LABEL: Record<CiteEdition, string> = {
  urk: 'Sethe, Urkunden des ägyptischen Altertums (Urk.)',
  are: 'Breasted, Ancient Records of Egypt (ARE)',
  wb: 'Erman & Grapow, Wörterbuch der aegyptischen Sprache (Wb)',
};

/** The held volumes. A volume absent here parses fine and resolves to `not-held`. */
const HELD: Record<string, Concordance> = {
  'urk-1': urkI as unknown as Concordance,
  'are-1': areI as unknown as Concordance,
};

export function heldEditions(): Array<{ key: string; edition: string; label: string; book_id: string; page_range: [number, number] | null }> {
  return Object.entries(HELD).map(([key, c]) => ({
    key, edition: c.edition, label: c.label, book_id: c.book_id, page_range: c.page_range,
  }));
}

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10 };

function parseVolume(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (/^\d{1,2}$/.test(s)) return Number(s);
  if (!/^[ivx]{1,5}$/.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = ROMAN[s[i]];
    const next = ROMAN[s[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total > 0 ? total : null;
}

const DASH = '[-–—]';
const SEP = '\\s*[,:]?\\s*';
const VOL = '([ivx]{1,5}|\\d{1,2})';

// `Urk. I, 124` · `Urk. I 120–131` · `Urk I 124,3` · `Urk. I 124, 3` · `Urk I 124.3`
const URK = new RegExp(
  `^urk(?:unden)?\\.?\\s*${VOL}${SEP}(\\d{1,4})(?:\\s*${DASH}\\s*(\\d{1,4}))?(?:\\s*[,.]\\s*(\\d{1,3}))?$`,
  'i',
);

// `ARE I §335` · `Breasted I §333–336` · `ARE 1, 153` · `BAR I, § 335` · `ARE I, p. 153`
const ARE = new RegExp(
  `^(?:are|bar|breasted|ancient\\s+records)\\.?\\s*${VOL}${SEP}(?:(§§?|sect?\\.?|sections?)\\s*(\\d{1,4})(?:\\s*${DASH}\\s*§?\\s*(\\d{1,4}))?|(?:p{1,2}\\.?\\s*)?(\\d{1,4})(?:\\s*${DASH}\\s*(\\d{1,4}))?)$`,
  'i',
);

// `Wb 1, 81.8` · `Wb. I 81, 8` · `Wb 1 81`
const WB = new RegExp(
  `^wb\\.?\\s*${VOL}${SEP}(\\d{1,4})(?:\\s*[.,]\\s*(\\d{1,3}))?$`,
  'i',
);

function roman(n: number): string {
  const table: Array<[number, string]> = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out;
}

/**
 * Read one citation. Returns null for anything that is not one of the three
 * systems in one of the forms above — the route turns that into a 400.
 */
export function parseCite(input: string): ParsedCite | null {
  const s = input.replace(/\s+/g, ' ').trim();
  if (!s || s.length > 60) return null;

  let m = URK.exec(s);
  if (m) {
    const volume = parseVolume(m[1]);
    const value = Number(m[2]);
    const end = m[3] ? Number(m[3]) : null;
    if (volume == null || !value || (end != null && end < value)) return null;
    return {
      edition: 'urk', volume, kind: 'page', value, end, sub: m[4] ? Number(m[4]) : null,
      label: `Urk. ${roman(volume)}, ${value}${end ? `–${end}` : ''}${m[4] ? `,${Number(m[4])}` : ''}`,
    };
  }

  m = ARE.exec(s);
  if (m) {
    const volume = parseVolume(m[1]);
    if (volume == null) return null;
    if (m[3]) {
      const value = Number(m[3]);
      const end = m[4] ? Number(m[4]) : null;
      if (!value || (end != null && end < value)) return null;
      return {
        edition: 'are', volume, kind: 'section', value, end, sub: null,
        label: `ARE ${roman(volume)} §${end ? `§${value}–${end}` : value}`,
      };
    }
    const value = Number(m[5]);
    const end = m[6] ? Number(m[6]) : null;
    if (!value || (end != null && end < value)) return null;
    return {
      edition: 'are', volume, kind: 'page', value, end, sub: null,
      label: `ARE ${roman(volume)}, ${value}${end ? `–${end}` : ''}`,
    };
  }

  m = WB.exec(s);
  if (m) {
    const volume = parseVolume(m[1]);
    const value = Number(m[2]);
    if (volume == null || !value) return null;
    return {
      edition: 'wb', volume, kind: 'page', value, end: null, sub: m[3] ? Number(m[3]) : null,
      label: `Wb ${volume}, ${value}${m[3] ? `.${Number(m[3])}` : ''}`,
    };
  }

  return null;
}

function nearestBefore(table: Record<string, number>, n: number): { key: number; page: number } | null {
  let best: { key: number; page: number } | null = null;
  for (const [k, page] of Object.entries(table)) {
    const key = Number(k);
    if (key <= n && (!best || key > best.key)) best = { key, page };
  }
  return best;
}

export function readerUrl(bookId: string, page: number): string {
  return `https://sourcelibrary.org/book/${bookId}?page=${page}`;
}

/** Resolve a parsed citation against the held concordances. Pure; no I/O. */
export function resolveCite(cite: ParsedCite): CiteResolution {
  const editionLabel = EDITION_LABEL[cite.edition];
  const conc = HELD[`${cite.edition}-${cite.volume}`];
  if (!conc) return { status: 'not-held', cite, edition_label: editionLabel };

  const found = (page: number, basis: CiteBasis): CiteResolution => ({
    status: 'ok', cite, edition: conc.edition, edition_label: conc.label,
    book_id: conc.book_id, page, basis, url: readerUrl(conc.book_id, page),
  });

  if (cite.kind === 'section') {
    const sections = conc.sections;
    if (!sections) {
      return { status: 'not-found', cite, edition: conc.edition, edition_label: conc.label, reason: 'this edition is cited by page, not by section' };
    }
    const exact = sections[String(cite.value)];
    if (exact != null) return found(exact, 'printed');
    const near = nearestBefore(sections, cite.value);
    const keys = Object.keys(sections).map(Number);
    const max = Math.max(...keys);
    if (!near || cite.value > max + 1) {
      return { status: 'not-found', cite, edition: conc.edition, edition_label: conc.label, reason: `§${cite.value} is outside the sections read in this volume (§${Math.min(...keys)}–§${max})` };
    }
    return found(near.page, 'nearest');
  }

  const printed = conc.pages[String(cite.value)];
  if (printed != null) return found(printed, 'printed');
  const frame = conc.frame[String(cite.value)];
  if (frame != null) return found(frame, 'frame');
  const range = conc.page_range;
  if (!range || cite.value < range[0] || cite.value > range[1]) {
    return { status: 'not-found', cite, edition: conc.edition, edition_label: conc.label, reason: `page ${cite.value} is outside this volume's printed range (${range ? `${range[0]}–${range[1]}` : 'unknown'})` };
  }
  const near = nearestBefore({ ...conc.pages, ...conc.frame }, cite.value);
  if (!near) {
    return { status: 'not-found', cite, edition: conc.edition, edition_label: conc.label, reason: `no leaf read at or before page ${cite.value}` };
  }
  return found(near.page, 'nearest');
}

/** Parse and resolve in one step; `null` means unparseable. */
export function resolveCitation(input: string): CiteResolution | null {
  const cite = parseCite(input);
  return cite ? resolveCite(cite) : null;
}
