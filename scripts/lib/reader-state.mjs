/**
 * What a reader gets from a book: ONE definition of finished, readable and complete (v3#461).
 *
 * PRIOR ART: scripts/lib/page-counts.mjs (translation_state rungs, isReadableInEnglish) — the page ladder this builds
 * on, but it says nothing about the summary, chapters or a failed check, so "complete" there is a page count, not what
 * a reader meets. scripts/lib/pipeline-next-step.mjs (pipeline_next "done") — requires the picture stamp, which no
 * working lane writes, so it stops at 1,543 books. scripts/workers/daily-health-snapshot.mjs ("fully done" = canon
 * readable_books; "Fully complete" = pipeline_auto.status complete in 24 h, which the CLI lanes never set). Neither is a
 * reader-side definition; this replaces them as the one used by the mail (#460), /admin/pipeline and the queue.
 *
 * States, by what a reader sees on /book/<id>:
 *   no_pages        nothing to show (a record with no pages).
 *   scans           page images only; no text yet.
 *   original        images and a transcription of the original (some or all pages); English only in places.
 *   readable        English on >= 90% of the pages that carry text (translation_state readable_in_english).
 *   complete        English on EVERY page that carries text (rung complete, or an English original fully transcribed),
 *                   AND a summary AND a chapter list, AND the latest book check is not 'fix'.
 *
 * Pages that owe nothing (the rung already leaves them out): blank leaves, bookplates, ex-libris, digitizer sheets,
 * plates with no text, pages with no body. Pages that DO keep a book from complete (repair items, listed to the
 * reader as untranslated): OCR that loops or cannot be read, English the translator refused (translation.health_blocked).
 * Pictures are NOT required: no working lane extracts them yet; a book check is not required (2,667 books ever checked).
 * A hold does not change the state: it is what the pipeline does next, not what a reader sees. `held` is reported
 * beside the state.
 */
import { isReadableInEnglish, ENGLISH_ORIGINAL_READABLE_RUNGS } from './page-counts.mjs';

export const READER_STATES = Object.freeze(['no_pages', 'scans', 'original', 'readable', 'complete']);
export const READER_STATE_LABELS = Object.freeze({
  no_pages: 'No pages', scans: 'Scans only', original: 'Original text', readable: 'Readable in English', complete: 'Complete',
});

/** The book fields readerState reads (a Mongo projection). */
export const READER_STATE_PROJECTION = Object.freeze({
  id: 1, translation_state: 1, summary: 1, chapters: 1, 'pipeline_auto.status': 1,
});

const hasSummary = (s) => (typeof s === 'string' ? s.trim() !== '' : !!s && typeof s === 'object' && Object.keys(s).length > 0);

/**
 * The reader state of one book. `verdict`: the latest book_checks verdict for it (show | caveat | fix), if any.
 * Returns { state, held, missing }: `missing` lists what keeps a readable book from complete.
 */
export function readerState(book, { verdict = null } = {}) {
  const ts = book?.translation_state ?? {};
  const rung = ts.rung ?? null;
  const held = book?.pipeline_auto?.status === 'held';
  if (!rung || rung === 'no_pages') return { state: 'no_pages', held, missing: [] };
  if (!isReadableInEnglish(ts)) return { state: rung === 'no_text' ? 'scans' : 'original', held, missing: [] };
  const missing = [];
  const whole = rung === 'complete' || (ts.english_original === true && ENGLISH_ORIGINAL_READABLE_RUNGS.includes(rung));
  if (!whole) missing.push('pages');
  if (!hasSummary(book.summary)) missing.push('summary');
  if (!(Array.isArray(book.chapters) && book.chapters.length > 0)) missing.push('chapters');
  if (verdict === 'fix') missing.push('check');
  return { state: missing.length ? 'readable' : 'complete', held, missing };
}

/** Latest book_checks verdict per book id (Map). */
export async function latestVerdicts(db) {
  const rows = await db.collection('book_checks').aggregate(
    [{ $sort: { checked_at: 1 } }, { $group: { _id: '$book_id', v: { $last: '$verdict' } } }],
    { allowDiskUse: true, maxTimeMS: 300000 },
  ).toArray();
  return new Map(rows.map((r) => [r._id, r.v]));
}

/**
 * Counts of live books (visible, pages_count > 0) by reader state, split held/free, plus what readable books miss.
 * One scan of the live books (~71K); a minute or two. For the mail and reports, not a request path.
 */
export async function countReaderStates(db) {
  const verdicts = await latestVerdicts(db);
  const out = { states: {}, missing: {}, total: 0 };
  for (const s of READER_STATES) out.states[s] = { books: 0, held: 0, free: 0 };
  const cur = db.collection('books').find({ visible: true, pages_count: { $gt: 0 } }, { projection: { ...READER_STATE_PROJECTION, _id: 0 } }).batchSize(5000);
  for await (const b of cur) {
    const r = readerState(b, { verdict: verdicts.get(b.id) });
    const row = out.states[r.state];
    row.books++; row[r.held ? 'held' : 'free']++; out.total++;
    if (r.state === 'readable') for (const m of r.missing) out.missing[m] = (out.missing[m] ?? 0) + 1;
  }
  return out;
}
