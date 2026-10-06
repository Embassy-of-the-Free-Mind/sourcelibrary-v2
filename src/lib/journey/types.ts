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
  /** Short label for the film's corner, e.g. "Śāntideva, Bodhicaryāvatāra 1.4". */
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
  /** A spread of other pages of the same book, for the "copy" stretch. */
  vault: JourneyImage[];
  /** Covers of other books in the library on the same subject. */
  shelf: JourneyImage[];
  shelfLabel?: string;
  /** Texts */
  lines: { original: string[]; english: string[]; pairing: 'verse' | 'trace' | 'opening' };
  paneOriginal: string;
  paneEnglish: string;
  trace?: JourneyTrace;
  summary?: string;
  keywords: string[];
  terms: string[];
  note?: { label: string; text: string; attribution?: string };
  outroQuote: string;
  outroSource: string;
  citation: JourneyCitation;
  /** Script of the transcription, for picking a face. */
  script: 'devanagari' | 'latin' | 'other';
  config: JourneyInstanceConfig;
}

export interface JourneyStep {
  key: 'find' | 'copy' | 'read' | 'translate' | 'check' | 'describe' | 'publish';
  short: string;
  title: string;
  body: string;
}

export interface JourneyPart {
  key: 'p1' | 'p2' | 'p3' | 'p4';
  eyebrow: string;
  title: string;
  body: string;
  steps: JourneyStep['key'][];
}

const ROMAN = ['I', 'II', 'III', 'IV'];

/** Plain-language name of the work for captions. */
export function workName(d: JourneyData): string {
  return d.displayTitle || d.title;
}

/**
 * The film's captions and the page's prose, from one place, so the two can
 * never say different things. Only steps that actually happened to this page
 * are returned.
 */
export function buildJourneyCopy(d: JourneyData): { steps: JourneyStep[]; parts: JourneyPart[] } {
  const c = d.config;
  const year = d.published && /\d{3,4}/.test(d.published) ? d.published.match(/\d{3,4}/)![0] : undefined;
  const steps: JourneyStep[] = [];

  steps.push({
    key: 'find', short: 'Find', title: 'Finding the book',
    body: c.findBody || [
      `This is ${workName(d)}${d.author ? `, by ${d.author}` : ''}${year ? `, in an edition of ${year}` : ''}.`,
      d.providerName ? `The scan comes from ${/^(Internet Archive|Wellcome|Bodleian|British|Library of|Biodiversity|Digital Library|National|Smithsonian|Royal)/.test(d.providerName) ? 'the ' : ''}${d.providerName}.` : '',
    ].filter(Boolean).join(' '),
  });

  if (d.pagesArchived) {
    const all = d.pagesArchived >= d.pagesCount;
    steps.push({
      key: 'copy', short: 'Copy', title: 'Copying every page',
      body: all
        ? `First, all ${d.pagesCount.toLocaleString('en-US')} page images are copied into our own storage, so the book stays readable if the original scan moves.`
        : `First, ${d.pagesArchived.toLocaleString('en-US')} of its ${d.pagesCount.toLocaleString('en-US')} page images are copied into our own storage, so the book stays readable if the original scan moves.`,
    });
  }

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

  steps.push({
    key: 'check', short: 'Check', title: 'Checking it',
    body: [
      d.trace ? 'With Trace on, clicking a phrase in the English shows the words it came from, and the other way round.' : '',
      d.machineDraft
        ? `Until a scholar has reviewed it, every translated page carries the label “${READER_UI_STRINGS.en.info.machineDraftNotice}” Readers can report a problem on any page.`
        : 'A person has edited this page’s English since the first AI translation. Readers can report a problem on any page.',
    ].filter(Boolean).join(' '),
  });

  const described = [d.summary ? 'a short summary' : '', d.keywords.length ? 'a list of its key terms' : ''].filter(Boolean);
  if (described.length) {
    steps.push({
      key: 'describe', short: 'Describe', title: 'Describing the page',
      body: `The page also gets ${described.join(' and ')}. These are written by the model too, and are marked as such.`,
    });
  }

  steps.push({
    key: 'publish', short: 'Publish', title: 'Publishing it',
    body: `The edition, its ${d.pagesCount.toLocaleString('en-US')} scans, the ${d.language} text and the English are at one address, free to read. The Cite button gives a reference to this exact page, with a link that will keep working.`,
  });

  const have = (k: JourneyStep['key']) => steps.some(s => s.key === k);
  const parts: JourneyPart[] = [
    { key: 'p1', eyebrow: '', title: 'Getting the book', body: have('copy') ? 'Find a scan, and keep our own copy of it.' : 'Find a scan.', steps: ['find', 'copy'] },
    { key: 'p2', eyebrow: '', title: 'Reading it', body: `Turn the page image into text, then the ${d.language} into English.`, steps: ['read', 'translate'] },
    { key: 'p3', eyebrow: '', title: 'Checking it', body: d.trace ? 'Show where every English sentence came from, and say plainly what a person has and has not checked.' : 'Say plainly what a person has and has not checked.', steps: ['check'] },
    { key: 'p4', eyebrow: '', title: 'Publishing it', body: have('describe') ? 'Describe the page and put it online, ready to read and cite.' : 'Put it online, ready to read and cite.', steps: ['describe', 'publish'] },
  ];
  parts.forEach((p, i) => {
    p.eyebrow = `Part ${ROMAN[i]}`;
    p.steps = p.steps.filter(have);
  });
  return { steps, parts };
}
