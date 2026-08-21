/**
 * SEO / AI-discoverability rules for the individual book-page <title> and
 * <meta description>. (schema.org JSON-LD is handled separately by
 * src/components/seo/SchemaOrgMetadata.tsx and is intentionally NOT duplicated here.)
 *
 * Rules, optimised for search + AI-search and respectable bibliographically:
 *  - Lead the <title> with the ORIGINAL-language title (book.title) — the
 *    catalogue/citation standard and the form scholars and AI actually query —
 *    plus the byline and year, degrading gracefully by length so long historical
 *    titles never mid-word-truncate. Fields separated by a vertical bar " | "
 *    (no em-dashes / middle dots).
 *  - Build the description from the real per-book summary (unique per page), and
 *    state translation status HONESTLY: "First English translation" only when it
 *    truly is, plain "English translation" for later translations, and NOTHING on
 *    English-language originals (the old blanket template mislabelled those).
 *
 * Pure functions: callers pass already-resolved primitives (the page's byline,
 * etc.) so this module stays decoupled from the Book type.
 */

const TITLE_MAX = 62;
const DESC_MAX = 155;

const isEnglish = (language?: string | null) => (language || '').trim().toLowerCase().startsWith('english');

/** Strip a trailing life-date / floruit parenthetical from a byline so the
 *  display name reads cleanly ("Anna Maria Hussey (1805-1853)" -> "Anna Maria
 *  Hussey"). Only removes a final paren that contains a digit, so "(ed.)" and
 *  "(attributed)" are kept. */
const cleanByline = (name?: string | null) => (name || '').replace(/\s*\([^)]*\d[^)]*\)\s*$/, '').trim();

/** Collapse an over-long historical title to its recognisable head without
 *  cutting a word — prefers a natural break (colon, then first clause) so e.g.
 *  "Les champignons de la France : histoire, description…" -> "Les champignons de la France". */
function headOfTitle(title: string, max = 56): string {
  const t = (title || '').trim();
  if (t.length <= max) return t;
  const colon = t.indexOf(' : ');
  if (colon > 12 && colon <= max) return t.slice(0, colon).trim();
  const comma = t.indexOf(', ');
  if (comma > 20 && comma <= max) return t.slice(0, comma).trim();
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
}

export interface TitleInput {
  originalTitle: string;
  authorLabel?: string | null;
  year?: string | null;
}

/** "{head of original title} · {author} ({year})", dropping year then author as
 *  length demands. The " - Source Library" brand is intentionally omitted so long
 *  titles keep their distinctive words; Google appends the site name itself. */
export function buildSeoTitle({ originalTitle, authorLabel, year }: TitleInput): string {
  const head = headOfTitle(originalTitle || 'Untitled');
  const yr = year ? ` (${year})` : '';
  const author = authorLabel ? ` | ${cleanByline(authorLabel)}` : '';
  const full = `${head}${author}${yr}`;
  if (full.length <= TITLE_MAX) return full;
  const noYear = `${head}${author}`;
  if (noYear.length <= TITLE_MAX) return noYear;
  return head;
}

export interface DescriptionInput {
  originalTitle: string;
  authorLabel?: string | null;
  year?: string | null;
  language?: string | null;
  summary?: string | null;
  /**
   * The claim's register, not the badge flag (#3459). Only `confirmed` — a
   * first-family verdict backed by strong or moderate evidence — earns the
   * "First English translation" prefix here.
   *
   * A `candidate` gets the plain "English translation" prefix rather than a
   * search statement. 155 characters is not room to state a search AND its
   * limits, and a truncated caveat is worse than none: it would put the
   * assertion in front of search engines and AI crawlers with the qualifier
   * cut off. Saying less is the honest option at this length.
   */
  firstTranslationClaim?: string;
  pagesTranslated?: number | null;
}

function clamp(s: string, max = DESC_MAX): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:\s]+$/, '') + '…';
}

/** Unique, accurate meta description from the real summary, with an honest
 *  translation claim (never on English-language originals). */
export function buildSeoDescription(input: DescriptionInput): string {
  const { originalTitle, authorLabel, year, language, summary, firstTranslationClaim, pagesTranslated } = input;
  const translated = (pagesTranslated ?? 0) > 0 && !isEnglish(language);

  const core = (summary && summary.trim())
    ? summary.trim()
    : `${originalTitle}${authorLabel ? ` by ${cleanByline(authorLabel)}` : ''}${year ? ` (${year})` : ''}.`;

  const alreadySaysTranslation = /translat/i.test(core.slice(0, 60));
  let prefix = '';
  if (translated && !alreadySaysTranslation) {
    prefix = firstTranslationClaim === 'confirmed' ? 'First English translation. ' : 'English translation. ';
  }
  return clamp(prefix + core);
}
