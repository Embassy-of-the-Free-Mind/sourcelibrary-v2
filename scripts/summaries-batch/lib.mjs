/**
 * Shared pieces for the missing-summaries trial (scripts/summaries-batch/).
 *
 * PRIOR ART, read first: scripts/workers/lib/enrich-batch-lane.mjs is the production lane that
 * already writes summaries through the Batch API (enrich-worker --batch), and enrich-worker --agy
 * the one-call lane (#7628). This trial reuses their eligibility gate and helpers rather than
 * copying them; see README.md for why it exists at all and when to use the real lane instead.
 *
 * Nothing in this file writes anywhere.
 */
import { READABLE_ENOUGH_TO_ENRICH } from '../workers/lib/enrich-batch-lane.mjs';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';
import { pagesForEnrichment } from '../lib/english-original-text.mjs';
import { spreadAcrossBook } from '../lib/spread-across-book.mjs';

export const MODEL = 'gemini-3.1-flash-lite'; // the enrich lanes' model for every phase (.claude/docs/invariants/ai-models.md)
export const SOURCE = 'batch-2026-11';
export const PROMPT_VERSION = '2026-11-13-book-summary-rules-draft';
export const DEFAULT_MAX_CHARS = 60000; // ~15K input tokens at ~4 chars a token

const str = (f) => ({ [f]: { $type: 'string', $ne: '' } });

/** Live books with no summary in any field the book page reads (book_indexes is checked per book, see hasIndexSummary). */
export const NO_SUMMARY = {
  visible: true,
  pages_count: { $gt: 0 },
  $nor: [{ $or: [str('index.bookSummary.brief'), str('reading_summary.overview'), str('summary'), str('summary.data'), str('summary_candidate.brief')] }],
};

/** book_indexes is merged over books.index on read (derived-metadata-lane.md), so a summary there counts. */
export async function hasIndexSummary(db, bookId) {
  const ix = await db.collection('book_indexes').findOne({ book_id: bookId }, { projection: { 'bookSummary.brief': 1 } });
  return typeof ix?.bookSummary?.brief === 'string' && ix.bookSummary.brief.trim() !== '';
}

/**
 * Who is eligible. Default: the production gate, READABLE_ENOUGH_TO_ENRICH (English at the
 * `readable`/`complete` rung, or an English original from `transcribed`). That gate exists because
 * a summary written from a twentieth of a book "is not thin, it is a different book" (#2141, 2026-11-02).
 * `partial` widens it to books with enough transcription (minPages OR minShare of the book) and is
 * for the trial only: those summaries would be written from untranslated text.
 */
export function eligibleFilter({ partial = false, minPages = 20, minShare = 0.5 } = {}) {
  if (!partial) return { ...NO_SUMMARY, $and: [READABLE_ENOUGH_TO_ENRICH] };
  return {
    ...NO_SUMMARY,
    $and: [{ $or: [READABLE_ENOUGH_TO_ENRICH, { pages_ocr: { $gte: minPages } },
      { $expr: { $gte: [{ $divide: [{ $ifNull: ['$pages_ocr', 0] }, { $max: [{ $ifNull: ['$pages_count', 0] }, 1] }] }, minShare] } }] }],
  };
}

/** The catalogue record fields the model may use besides the text. */
export const RECORD_FIELDS = { id: 1, title: 1, display_title: 1, author: 1, published: 1, language: 1, place_published: 1, published_place: 1, place_of_publication: 1, publisher: 1,
  pages_count: 1, pages_ocr: 1, pages_translated: 1, translation_state: 1, tenant_slug: 1 };

export function recordText(b) {
  const lines = [
    ['Title', b.title], ['English title', b.display_title], ['Author', b.author], ['Date', b.published],
    ['Language', b.language], ['Place', b.place_published || b.published_place || b.place_of_publication], ['Publisher', b.publisher], ['Pages', b.pages_count],
  ].filter(([, v]) => v != null && String(v).trim() !== '');
  return lines.map(([k, v]) => `${k}: ${v}`).join('\n');
}

/**
 * The book's text: English where it exists (an English original's own transcription counts, via
 * pagesForEnrichment), else the transcription; editorial wrapper blocks stripped content-and-all
 * (quote-and-snippet-integrity.md); spread across the whole book, not its opening; capped.
 */
export async function bookText(db, book, maxChars = DEFAULT_MAX_CHARS) {
  const raw = await db.collection('pages').find({ book_id: book.id }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } })
    .sort({ page_number: 1 }).toArray();
  const pages = pagesForEnrichment(raw, book).map((p) => {
    const en = stripEditorialWrappers(p.translation?.data || '')?.trim();
    const src = en || stripEditorialWrappers(p.ocr?.data || '')?.trim() || '';
    return { n: p.page_number, text: src, english: !!en };
  }).filter((p) => p.text.length > 40);
  if (!pages.length) return { text: '', pagesUsed: 0, english: false };
  const per = Math.max(800, Math.floor(maxChars / Math.min(pages.length, 60)));
  const picked = spreadAcrossBook(pages, Math.max(1, Math.floor(maxChars / per)));
  const text = picked.map((p) => `[p. ${p.n}]\n${p.text.slice(0, per)}`).join('\n\n').slice(0, maxChars);
  return { text, pagesUsed: picked.length, english: picked.some((p) => p.english) };
}

export const SYSTEM_RULES = `You write the short "About this book" note for a digital library of historical primary sources.
Rules:
1. Describe this book: what it is, what it argues or shows, and the one specific thing that makes it worth opening.
2. BRIEF: two or three sentences, about 60 words. ABSTRACT: one paragraph, same rules.
3. Do not open with the label ("X is a treatise by Y"): the page already shows title, author and date. Start with substance, but name the author naturally in the first sentence.
4. Include one concrete detail from the book itself: an argument, an image, a number, a claim.
5. Use facts from the BOOK TEXT, the CATALOGUE RECORD, or well-established knowledge (such as who the author was). Nothing guessed: if unsure, leave it out.
6. Never use: "serves as", "a primary source for the study of", "functions as", "testament", "synthesizes", "synthesises", "rich", "unique", "not just ... but", "delves", "sheds light", "seminal", "fascinating", "remarkable", "profound", "readers". No lists of three for rhythm. No em dashes. Do not address the reader.
7. Plain British English.
8. Say what this copy is when it matters: a translation, a later edition, a manuscript copy, one volume of several.
9. Describe only what you were given. If the text covers part of the book, say so ("The first volume...") instead of describing the whole work.
10. Keep doubt visible: keep "attributed to" or "probably" where the text or record has it.
11. Stay neutral on religious, magical and erotic content: describe what it says and does, without endorsing or mocking.
EVIDENCE: for every person, place, date and number you name, give a short quote from the text or "record: <field>" that supports it.`;

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    brief: { type: 'STRING' },
    abstract: { type: 'STRING' },
    evidence: { type: 'ARRAY', items: { type: 'OBJECT', properties: { claim: { type: 'STRING' }, support: { type: 'STRING' } }, required: ['claim', 'support'] } },
  },
  required: ['brief', 'abstract', 'evidence'],
};

/** One Gemini Batch API JSONL line. thinkingBudget 0, as every enrich call (ai-models.md). */
export function batchLine(book, text) {
  return {
    key: book.id,
    request: {
      systemInstruction: { parts: [{ text: SYSTEM_RULES }] },
      contents: [{ role: 'user', parts: [{ text: `CATALOGUE RECORD\n${recordText(book)}\n\nBOOK TEXT (pages spread across the book)\n${text}` }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
    },
  };
}

export const tokensOf = (s) => Math.ceil((s || '').length / 4);
export const OUT_TOKENS_PER_BOOK = 450; // brief + abstract + evidence; the production summary round measures 1,335 for a longer brief/abstract/detailed

export const BANNED = [/serves as/i, /primary source for the study of/i, /functions as/i, /testament/i, /synthesi[sz]e/i, /\brich\b/i, /\bunique\b/i,
  /not just\b.*\bbut\b/i, /delves?/i, /sheds? light/i, /seminal/i, /fascinating/i, /remarkable/i, /profound/i, /\breaders?\b/i, /\byou(r)?\b/i, /—/];

export function arg(name, dflt) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
}
export const flag = (name) => process.argv.includes(`--${name}`);
