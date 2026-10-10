/**
 * Data and wording for /ideas (#6173): one page per idea, with passages from
 * several traditions, each quoted and linked to its page.
 *
 * The data file is BUILT, not edited:
 *   scripts/eval/embed-granularity/build-idea-pages.mjs
 * It keeps a passage only while its quote is a verbatim substring of the page
 * as stored today, and `--check` re-verifies the file against the stores. A
 * quote here is derived from page text; re-run the check after a re-OCR or
 * re-translation sweep.
 */
import data from '@/data/idea-pages.json';
import { READER_UI_STRINGS } from '@/lib/reader-strings';

export type QuoteSource = 'machine' | 'original' | 'published' | 'edited';

export interface IdeaPassage {
  tradition: string;
  quote: string;
  page_number: number;
  book_slug: string;
  book_title: string;
  book_author: string;
  book_year: number | null;
  book_language: string;
  source: string;
}

export interface Idea {
  id: string;
  slug: string;
  title: string;
  passages: IdeaPassage[];
}

export const IDEAS = data.ideas as Idea[];
export const VERIFIED_ON = data.verified_on as string;

/** The gold set's tradition labels, in the order the pages list them. */
export const TRADITION_LABELS: Record<string, string> = {
  'greek-roman': 'Greek and Roman',
  'jewish-kabbalistic': 'Jewish',
  christian: 'Christian',
  'islamic-sufi': 'Islamic',
  'hermetic-esoteric': 'Hermetic and alchemical',
  'hindu-indic': 'Hindu',
  buddhist: 'Buddhist',
  'chinese-daoist-confucian': 'Daoist and Confucian',
};
export const TRADITION_ORDER = Object.keys(TRADITION_LABELS);

export const traditionLabel = (t: string) => TRADITION_LABELS[t] ?? t;

/** "prima materia: the first matter…" → "Prima materia: the first matter…" */
export const ideaTitle = (idea: Idea) => idea.title.charAt(0).toUpperCase() + idea.title.slice(1);

/** Traditions an idea has passages from, in display order. */
export function traditionsOf(idea: Idea): string[] {
  const have = new Set(idea.passages.map((p) => p.tradition));
  return [...TRADITION_ORDER.filter((t) => have.has(t)), ...[...have].filter((t) => !TRADITION_LABELS[t])];
}

/** Whose words the quoted English is, said to the reader. Machine drafts use the reader's own line. */
export function sourceNote(p: IdeaPassage): string {
  if (p.source === 'machine') return READER_UI_STRINGS.en.info.machineDraftNotice;
  if (p.source === 'original') return 'The book’s own words.';
  if (p.source === 'edited') return 'AI translation, corrected by an editor.';
  return 'A published translation.';
}

/** The reader opened at the quoted page. Relative, so it stays on the host it is served from. */
export const passageHref = (p: IdeaPassage) => `/book/${p.book_slug}?page=${p.page_number}`;
