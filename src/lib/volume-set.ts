// PRIOR ART: src/lib/dedup.ts extractVolume() — reused as the parser (not forked): it already reads
// "Vol. 2", "(vol 41)", "Tome IV", "Teil", "Part 1", "Tomus primus". It lacks "Bd." and is not touched
// here, because edition-key.ts stores its output inside `edition_key` and widening it would drift
// every stored key from a recomputed one. src/lib/embassy/librarian.ts has roman-numeral display
// logic for the Librarian's tags (a formatter, not a parser). scripts/lib/work-identity-util.mjs
// tokenizes roman numerals for matching, not for numbering.
import { extractVolume, editionYear } from './dedup';

/**
 * Multi-volume SETS on the book page (#7527).
 *
 * The reader on vol. 41 of a 64-volume set needs "Volume 41 of 64", the previous
 * and next volume, and the list. Books carry no volume field (#3708), so the
 * volume number is read from the title, and set membership is decided here from
 * the work_id siblings the editions rail already fetches.
 *
 * A set key is the OPPOSITE of `edition_key` (edition-identity.md: "edition_key
 * ≠ a multi-volume SET key") — edition_key keys volumes apart, this groups them
 * together. Nothing here is stored; it is computed per render from titles.
 *
 * Conservative by construction: when membership is unclear the function returns
 * null and the page keeps the old editions rail unchanged. Unclear means:
 *   - the current book's title gives no volume number, or title and display
 *     title disagree;
 *   - fewer than one OTHER volume qualifies;
 *   - two qualifying books claim the same volume number (two printings, or a
 *     re-scan, mixed into one work_id — we cannot tell which belongs).
 */

/** Extra marker extractVolume() does not read: German "Bd. 2" / "Bd. IV". */
const BD = /(?:^|[^\p{L}])bd\.?\s*(\d{1,3}|[ivxlcdm]{1,6})(?![\p{L}\p{N}])/iu;

function romanToInt(s: string): number | null {
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i]];
    const next = map[s[i + 1]];
    if (cur == null) return null;
    total += next != null && cur < next ? -cur : cur;
  }
  return total > 0 ? total : null;
}

function toRoman(n: number): string {
  const table: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, r] of table) while (n >= v) { out += r; n -= v; }
  return out;
}

const LATIN_ORDINAL_WORD = /(?:^|[^\p{L}])(?:prim|secund|terti|quart|quint|sext|septim|octav|non|decim)(?:us|a|um)(?![\p{L}])/iu;

/**
 * extractVolume() reads any run of roman-numeral LETTERS after a keyword, so
 * "Partim ex editione" parses as part "im" = 999. Accept its answer only when
 * the title actually spells that number: as digits, as the canonical roman
 * numeral, or as a Latin ordinal word.
 */
function spelled(t: string, n: number): boolean {
  if (new RegExp(`(?<![\\p{N}])0*${n}(?![\\p{N}])`, 'u').test(t)) return true;
  if (new RegExp(`(?<![\\p{L}])${toRoman(n)}(?![\\p{L}])`, 'iu').test(t)) return true;
  return LATIN_ORDINAL_WORD.test(t);
}

function fromOneTitle(t?: string | null): number | null {
  if (!t) return null;
  const v = extractVolume(t);
  if (v != null) return v > 0 && spelled(t, v) ? v : null;
  const m = t.match(BD);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : romanToInt(m[1].toLowerCase());
  return n && n > 0 && spelled(t, n) ? n : null;
}

/**
 * The part of a title that names the SET: everything before the first volume
 * marker or sub-title break, folded to letters and digits. "Aristotelis Opera,
 * Vol. I (Bekker 1831)" and "Aristotelis Opera, Vol. 2 (Bekker Edition, Reimer
 * 1831)" share "aristotelisopera"; "Seneca Epistulae Morales Vol. 3" and
 * "Seneca Moral Essays Vol. 1" do not — two series under one work_id.
 * The Chinese "·卷…" juan range is a break, so "庚子銷夏記·卷一 (vol 1)" and
 * "庚子銷夏記·卷二~卷四 (vol 2)" share "庚子銷夏記".
 */
export function titleStem(t?: string | null): string {
  if (!t) return '';
  const cut = t.search(/(?:^|[^\p{L}])(?:vol(?:ume)?|tom(?:us|o|e)?|band|bd|part|pt|liber|deel|teil)(?:[^\p{L}]|$)|[·:(\[（]/iu);
  const head = cut >= 0 ? t.slice(0, cut) : t;
  return head.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * The volume number a book's titles state, or null. Reads `title` and
 * `display_title`; if both state a number and they DIFFER, returns null
 * (a curator's display title and the import title disagreeing is not a fact).
 */
export function volumeNumber(book: { title?: string | null; display_title?: string | null }): number | null {
  const a = fromOneTitle(book.title);
  const b = fromOneTitle(book.display_title);
  if (a != null && b != null && a !== b) return null;
  return a ?? b;
}

export interface VolumeCandidate {
  id?: string;
  title?: string | null;
  display_title?: string | null;
  language?: string | null;
  year?: number | null;
  published?: string | null;
  edition_key?: string | null;
  image_source?: { provider_name?: string | null } | null;
}

export interface VolumeSet<T> {
  /** The current book's volume number. */
  current: number;
  /** Every volume of the set INCLUDING the current book, in volume order. */
  volumes: Array<{ volume: number; book: T; isCurrent: boolean }>;
  prev: { volume: number; book: T } | null;
  next: { volume: number; book: T } | null;
  /** Highest volume number held — "of N" means "of the N we know", see `count`. */
  highest: number;
  /** The held volumes run 1..highest with no gap — only then may a reader be
   *  told "of N". With gaps we know how many we HOLD, not how many exist. */
  complete: boolean;
  /** Ids of siblings that belong to the set (excludes the current book). */
  memberIds: Set<string>;
}

const norm = (s?: string | null) => (s || '').trim().toLowerCase();

/** Author segment of an edition_key (`title|author|year|vN`), '' when absent. */
function keyAuthor(k?: string | null): string {
  if (!k) return '';
  const parts = k.split('|');
  return parts.length >= 4 ? parts[parts.length - 3] : '';
}

/** Two values are compatible if equal, or if either side is unknown. */
const compatible = (a: string, b: string) => !a || !b || a === b;

/** The two books name the same set in `title` or in `display_title`. */
function sameStem(a: VolumeCandidate, b: VolumeCandidate): boolean {
  const eq = (x?: string | null, y?: string | null) => {
    const sx = titleStem(x); const sy = titleStem(y);
    return sx.length >= 2 && sx === sy;
  };
  return eq(a.title, b.title) || eq(a.display_title, b.display_title);
}

/**
 * Same-set evidence between the current book and a sibling (both already share
 * a work_id). Same language, same contributing library, same author slot in the
 * edition key, and the same set name at the head of the title (titleStem).
 * Year is NOT required to match — volumes of one set are routinely
 * printed years apart — but two volumes whose years both parse and lie more
 * than 25 years apart are treated as different printings.
 */
function sameSet(cur: VolumeCandidate, sib: VolumeCandidate): boolean {
  if (!sameStem(cur, sib)) return false;
  if (norm(cur.language) !== norm(sib.language)) return false;
  if (!compatible(norm(cur.image_source?.provider_name), norm(sib.image_source?.provider_name))) return false;
  if (!compatible(keyAuthor(cur.edition_key), keyAuthor(sib.edition_key))) return false;
  const ya = editionYear(cur);
  const yb = editionYear(sib);
  if (ya != null && yb != null && Math.abs(ya - yb) > 25) return false;
  return true;
}

/**
 * Decide whether `current` is one volume of a set among its work_id `siblings`
 * (siblings must already be the reader-safe set: visible, pages_count > 0, no
 * duplicate_of, excluding the current book). Returns null when unsure.
 */
export function buildVolumeSet<T extends VolumeCandidate>(current: T, siblings: T[]): VolumeSet<T> | null {
  const curVol = volumeNumber(current);
  if (curVol == null) return null;

  const members: Array<{ volume: number; book: T }> = [];
  for (const s of siblings) {
    if (!sameSet(current, s)) continue;
    const v = volumeNumber(s);
    if (v == null) continue;
    members.push({ volume: v, book: s });
  }
  if (members.length === 0) return null;

  // Two books claiming one volume number: two printings or a re-scan share the
  // work_id, and we cannot tell which belongs to this set. Keep the old rail.
  const seen = new Set<number>([curVol]);
  for (const m of members) {
    if (seen.has(m.volume)) return null;
    seen.add(m.volume);
  }

  const volumes = [...members.map((m) => ({ ...m, isCurrent: false })), { volume: curVol, book: current, isCurrent: true }]
    .sort((a, b) => a.volume - b.volume);
  const at = volumes.findIndex((v) => v.isCurrent);
  const prev = at > 0 ? volumes[at - 1] : null;
  const next = at < volumes.length - 1 ? volumes[at + 1] : null;

  return {
    current: curVol,
    volumes,
    prev: prev ? { volume: prev.volume, book: prev.book } : null,
    next: next ? { volume: next.volume, book: next.book } : null,
    highest: volumes[volumes.length - 1].volume,
    complete: volumes[0].volume === 1 && volumes.length === volumes[volumes.length - 1].volume,
    memberIds: new Set(members.map((m) => m.book.id).filter((x): x is string => !!x)),
  };
}

const MARKER_AND_NUMBER = /(?:^|[^\p{L}])(?:vol(?:ume)?|tom(?:us|o|e)?|band|bd|part|pt|liber|deel|teil)\.?\s*\(?\s*(?:\d{1,3}|[ivxlcdm]{1,6}|(?:prim|secund|terti|quart|quint|sext|septim|octav|non|decim)(?:us|a|um))(?![\p{L}\p{N}])/iu;

/**
 * What this volume holds, as its title says after the volume marker, for the
 * row label: "vol. 41: chapters 81–82" → "chapters 81–82"; "Vol. 3 (Bekker
 * Edition, 1831): Aristoteles Latine" → "Aristoteles Latine". For a Kanseki
 * title with no display tail, the juan range after "·": "卷八十一~卷八十二".
 * '' when the title says nothing more.
 */
export function volumeTail(book: { title?: string | null; display_title?: string | null }): string {
  const clean = (rest: string) => rest
    .replace(/^\s*of\s+\d{1,4}/i, '')
    .replace(/^[\s)\]]*\([^)]*\)/, '')
    .replace(/^[\s:;,.\-–—)\]]+/, '')
    .trim();
  for (const t of [book.display_title, book.title]) {
    if (!t) continue;
    const m = t.match(MARKER_AND_NUMBER);
    if (!m || m.index == null) continue;
    const tail = clean(t.slice(m.index + m[0].length));
    if (tail) return tail.length > 70 ? `${tail.slice(0, 69).trimEnd()}…` : tail;
  }
  const dot = book.title?.indexOf('·') ?? -1;
  if (book.title && dot >= 0) {
    const seg = book.title.slice(dot + 1).replace(/\s*[(（].*$/, '').trim();
    if (seg) return seg;
  }
  return '';
}
