/**
 * The journey film's data contract (#5861). Built on the server by
 * `loadJourney` from the book and page records; rendered on the client by
 * `JourneyFilm` and, as plain prose, by `JourneyProse`. Client-safe: no
 * server imports here.
 *
 * PRIOR ART: none — searched src/lib for book/page "story"/"provenance"
 * view models (`git grep -n "pipeline story\|BookTimeline"`): BookTimeline
 * renders a book's admin event log, not one page's public journey.
 */
import { READER_UI_STRINGS } from '@/lib/reader-strings';

export interface JourneyImage {
  url: string;
  /** width / height, when known from the record. */
  ar?: number;
}

export interface JourneyTrace {
  /** Verbatim span in `paneOriginal`. */
  s: string;
  /** Verbatim span in `paneEnglish`. */
  t: string;
}

export interface JourneyCitation {
  locator: string;
  chicago: string;
  inline: string;
  url: string;
  short_url: string;
  doi_url?: string;
}

/** Curated, per-instance options. Every quoted string is verified against the page at load. */
export interface JourneyInstanceConfig {
  /** Short label for the film's corner, e.g. "Svātmārāma, Haṭhayogapradīpikā 1.10". */
  label?: string;
  /** Prologue card: eyebrow, title, body. */
  prologue?: { eyebrow: string; title: string; body: string };
  /** Replaces the Find caption (facts already checked by whoever curates). */
  findBody?: string;
  /** Sentence appended to the Read caption, about what is on this page. */
  readDetail?: string;
  /** Selects the verse (or the alignment pair) the film lifts off the page. */
  lineMatch?: string;
  /** Where the lifted lines sit on the scan, as fractions of the page image. */
  linePosition?: { x: number; y0: number; dy: number };
  /** A note on the transcription to show "read as text"; must occur verbatim in the OCR. */
  note?: { label: string; text: string; attribution?: string };
  /** The outro quotation; must occur in the English. */
  outroQuote?: string;
  /** Outro line under the quotation. */
  outroSource?: string;
  /** How many lines the film lifts off the page (default FILM_LINES). */
  lineCount?: number;
  /**
   * A search by meaning that finds this page. Run at load; if the page is no
   * longer among the results, the claim is dropped from the film.
   */
  search?: { query: string };
  /**
   * Checks run over this book's published pages, each with the results file
   * that shows it (facts already checked by whoever curates).
   */
  checks?: { text: string; href?: string }[];
  /** A plain sentence on what the last revision of this page changed. */
  revisionNote?: string;
}

/** What links this page to the rest of the library. Every list holds only what exists. */
export interface JourneyConnect {
  /** The search by meaning in `config.search`, as run at load, with this page among its results. */
  search?: {
    query: string;
    /** 1-based position of this page in the results. */
    rank: number;
    results: { title: string; page: number; href: string; here: boolean; sameWork: boolean }[];
  };
  /** Names the book's index ties to this exact page (page-precise entries only). */
  index: { name: string; type: string; href: string }[];
  /** Other editions of the same work that a reader can open. */
  editions: { title: string; language?: string; published?: string; href: string }[];
}

export interface JourneyRevisions {
  count: number;
  /** The most recent one. */
  latest?: { field: string; at?: string };
}

export interface JourneyData {
  bookId: string;
  pageId: string;
  pageNumber: number;
  /** /book/<slug> */
  bookPath: string;
  /** /book/<slug>/page/<pageId> */
  readerPath: string;
  title: string;
  displayTitle?: string;
  author?: string;
  published?: string;
  /** The language of the leaves (`books.language`). */
  language: string;
  pagesCount: number;
  /** Library the scan came from, e.g. "Internet Archive". */
  providerName?: string;
  sourceUrl?: string;
  /** Pages of this book held in our own storage. Absent: none were copied. */
  pagesArchived?: number;
  /** How the transcription was made, in a few words ("Gemini", "the Internet Archive's own OCR"). */
  readBy: string;
  readByModel: boolean;
  /** The translation is a model's and no person has reviewed it (reader's own rule). */
  machineDraft: boolean;
  /** Images */
  cover?: JourneyImage;
  scan: JourneyImage;
  /** A spread of other pages of the same book, for the copy stretch of "find". */
  vault: JourneyImage[];
  /** Covers of other books in the library on the same subject. */
  shelf: JourneyImage[];
  shelfLabel?: string;
  /** Texts */
  lines: { original: string[]; english: string[]; pairing: 'verse' | 'trace' | 'opening' };
  paneOriginal: string;
  paneEnglish: string;
  trace?: JourneyTrace;
  note?: { label: string; text: string; attribution?: string };
  outroQuote: string;
  outroSource: string;
  citation: JourneyCitation;
  connect: JourneyConnect;
  revisions: JourneyRevisions;
  /** Script of the transcription, for picking a face. */
  script: 'devanagari' | 'latin' | 'other';
  config: JourneyInstanceConfig;
}

export interface JourneyStep {
  key: 'find' | 'read' | 'translate' | 'connect' | 'publish' | 'check';
  short: string;
  title: string;
  body: string;
}

export interface JourneyPart {
  key: 'p1' | 'p2' | 'p3' | 'p4' | 'p5';
  eyebrow: string;
  title: string;
  body: string;
  steps: JourneyStep['key'][];
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/** Plain-language name of the work for captions. */
export function workName(d: JourneyData): string {
  return d.displayTitle || d.title;
}

const DAY = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "A", "A and B", "A, B and C". */
export function listOf(xs: string[]): string {
  return xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** One edition, as a reader would name it: "the 1867 Sanskrit edition". */
export function editionName(e: JourneyConnect['editions'][number]): string {
  const year = e.published && /\d{4}/.test(e.published) ? e.published.match(/\d{4}/)![0] : '';
  const lang = e.language && e.language !== 'original' ? e.language : '';
  return [year, lang].filter(Boolean).length ? `the ${[year, lang].filter(Boolean).join(' ')} edition` : `“${e.title}”`;
}

/** Captions for the Connect chapter, shared by the film's screens and the prose. */
export function connectSentences(d: JourneyData): { search?: string; index?: string; editions?: string } {
  const { search, index, editions } = d.connect;
  const people = index.filter(x => x.type === 'person').map(x => x.name);
  const named = (people.length ? people : index.map(x => x.name)).slice(0, 3);
  return {
    search: search
      ? `Translated pages are also indexed by meaning, so a page can be found by what it says, not only by its exact words. A search of the whole library for “${search.query}” brings up this page ${search.rank === 1 ? 'first' : `at number ${search.rank}`}.`
      : undefined,
    index: index.length
      ? `The book’s index ties ${index.length > named.length
        ? `${named.join(', ')} and ${index.length - named.length} other ${index.length - named.length === 1 ? 'entry' : 'entries'}`
        : listOf(named)} to this page. Each name leads to the other books in the library where it appears.`
      : undefined,
    editions: editions.length
      ? `The library also holds ${editions.length === 1 ? 'another edition' : `${editions.length} other editions`} of the same work: ${listOf(editions.map(editionName))}. The book’s page links to ${editions.length === 1 ? 'it' : 'them'}.`
      : undefined,
  };
}

/** Captions for the Check chapter, shared by the film's screens and the prose. */
export function checkSentences(d: JourneyData): { checks?: string; revisions: string; queue: string; label: string } {
  const r = d.revisions;
  const field = r.latest?.field === 'ocr' ? 'transcription' : 'English';
  return {
    checks: d.config.checks?.length ? d.config.checks.map(c => c.text).join(' ') : undefined,
    revisions: r.count
      ? `This page has been corrected ${r.count === 1 ? 'once' : `${r.count} times`}${r.latest?.at ? `${r.count === 1 ? ',' : ', most recently'} on ${DAY(r.latest.at)}, when its ${field} was changed` : ''}.${d.config.revisionNote ? ` ${d.config.revisionNote}` : ''} The earlier version is kept beside the new one, with the reason.`
      : 'A correction is saved as a revision of the page, with its reason; the earlier version is never overwritten.',
    queue: 'Readers who know the language can check pages in a review queue, and any reader can report a problem on any page.',
    label: d.machineDraft
      ? `Until a scholar has reviewed it, every translated page carries the label “${READER_UI_STRINGS.en.info.machineDraftNotice}”`
      : 'A person has edited this page’s English since the first AI translation.',
  };
}

/**
 * The film's captions and the page's prose, from one place, so the two can
 * never say different things. Only steps that actually happened to this page
 * are returned. The order is the order of Figure 1 on /how-it-works: a page is
 * published first, then checked and corrected where it stands.
 */
export function buildJourneyCopy(d: JourneyData): { steps: JourneyStep[]; parts: JourneyPart[] } {
  const c = d.config;
  const year = d.published && /\d{3,4}/.test(d.published) ? d.published.match(/\d{3,4}/)![0] : undefined;
  const steps: JourneyStep[] = [];

  const copied = d.pagesArchived
    ? d.pagesArchived >= d.pagesCount
      ? `All ${d.pagesCount.toLocaleString('en-US')} page images are copied into our own storage, so the book stays readable if the original scan moves.`
      : `${d.pagesArchived.toLocaleString('en-US')} of its ${d.pagesCount.toLocaleString('en-US')} page images are copied into our own storage, so the book stays readable if the original scan moves.`
    : '';
  steps.push({
    key: 'find', short: 'Find', title: 'Finding the book',
    body: [
      c.findBody || [
        `This is ${workName(d)}${d.author ? `, by ${d.author}` : ''}${year ? `, in an edition of ${year}` : ''}.`,
        d.providerName ? `The scan comes from ${/^(Internet Archive|Wellcome|Bodleian|British|Library of|Biodiversity|Digital Library|National|Smithsonian|Royal)/.test(d.providerName) ? 'the ' : ''}${d.providerName}.` : '',
      ].filter(Boolean).join(' '),
      copied,
    ].filter(Boolean).join(' '),
  });

  steps.push({
    key: 'read', short: 'Read', title: 'Reading the page',
    body: [
      d.readByModel ? `Next, ${d.readBy} reads each page image.` : `Next, the text of each page is taken from ${d.readBy}.`,
      c.readDetail || '',
    ].filter(Boolean).join(' '),
  });

  steps.push({
    key: 'translate', short: 'Translate', title: 'Translating it',
    body: `Then the ${d.language} is translated into English, page by page.`,
  });

  const cs = connectSentences(d);
  const connectBody = [cs.search, cs.index, cs.editions].filter(Boolean).join(' ');
  if (connectBody) {
    steps.push({ key: 'connect', short: 'Connect', title: 'Connecting it', body: connectBody });
  }

  steps.push({
    key: 'publish', short: 'Publish', title: 'Publishing it',
    body: `The edition, its ${d.pagesCount.toLocaleString('en-US')} scans, the ${d.language} text and the English are at one address, free to read. The Cite button gives a reference to this exact page, with a link that will keep working.`,
  });

  const ks = checkSentences(d);
  steps.push({
    key: 'check', short: 'Check', title: 'Checking and correcting it',
    body: [
      'Checks run on pages that are already published, and a page is corrected where it stands.',
      d.trace ? 'With Trace on, clicking a phrase in the English shows the words it came from, and the other way round.' : '',
      ks.checks || '',
      ks.revisions,
      ks.queue,
      ks.label,
    ].filter(Boolean).join(' '),
  });

  const have = (k: JourneyStep['key']) => steps.some(s => s.key === k);
  const parts: JourneyPart[] = [
    { key: 'p1', eyebrow: '', title: 'Getting the book', body: d.pagesArchived ? 'Find a scan, and keep our own copy of it.' : 'Find a scan.', steps: ['find'] },
    { key: 'p2', eyebrow: '', title: 'Reading it', body: `Turn the page image into text, then the ${d.language} into English.`, steps: ['read', 'translate'] },
    { key: 'p3', eyebrow: '', title: 'Connecting it', body: 'Tie the page to the rest of the library: by meaning, by name, and by edition.', steps: ['connect'] },
    { key: 'p4', eyebrow: '', title: 'Publishing it', body: 'Put it online, ready to read and cite.', steps: ['publish'] },
    { key: 'p5', eyebrow: '', title: 'Checking and correcting it', body: 'Keep checking the published page, correct it where it is wrong, and say plainly what a person has and has not read.', steps: ['check'] },
  ];
  const shown = parts.filter(p => p.steps.some(have));
  shown.forEach((p, i) => {
    p.eyebrow = `Part ${ROMAN[i]}`;
    p.steps = p.steps.filter(have);
  });
  return { steps, parts: shown };
}
