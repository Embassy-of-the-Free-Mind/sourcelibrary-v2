#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate-lane.mjs and cli-ocr-lane.mjs — the runners this copies (count/run, per-day
// output folder, ledger of pages not to retry, exit-3 stop) and whose readers it drives unchanged; they take books the
// pipeline HELD for a CLI lane, not books a reader asked for. scripts/lib/translation-request-eligibility.mjs — the
// read-side gates, reused (#4482). scripts/audit/nearly-finished-translations.mjs — ranks requested books, acts on
// none. scripts/maintenance/notify-addressed-feedback.mjs — the backstop mailer for rows addressed by hand; it keeps
// its own copy of the email template, so this lane imports the canonical one instead. The 2026-10-28 hand run
// (scratchpad/_tmp-treq-notify.mts, _tmp-treq-ids.mjs on main) is the reference this productises (#7599).
/**
 * reader-request-lane — answer readers' "request translation" rows on the subscription CLIs, and email them (#7599).
 *
 * WHO RUNS IT: cron on a Hetzner box whose `agy` (and, for Opus rows, `claude`) is signed in, or a session by hand.
 * No paid API: OCR goes through `agy -p` (cli-ocr.mjs read --stop-on-quota), translation through the book's CLI row
 * (cli-translate.mjs / claude-translate.mjs), and both write through their own apply step with every guard.
 * The pool is the caller's: set AGY_HOME on the cron line.
 *
 *   node --env-file=.env.production.local scripts/batch/reader-request-lane.mjs count [--since=2026-10-01]
 *   node --env-file=.env.production.local scripts/batch/reader-request-lane.mjs run --out=DIR [--max-pages=200]
 *        [--max-book-pages=800] [--apply]
 *
 * WHICH REQUESTS. Open `feedback` rows whose message is the site's "Translation requested for …" prompt, with a
 * /book/<id>/page/<id> URL. Each is judged by requestVerdict (dark or unresolvable → refuse; repeats → one per page;
 * a tail over --max-book-pages → a person) with two lane options: a page with no OCR is not refused (this lane OCRs
 * first), and a hold in LANE_HOLDS — holds that mean "waiting for a lane", never a containment — does not refuse.
 * The book stays held either way: the lane translates, it never releases (Derek's held books stay held).
 * A book held for the Siku lane (SIKU_LANE_HOLDS) is judged the same way but not worked here: its verdict is `siku`, and
 * siku-translate-lane.mjs reads these verdicts and takes the book first, in its own reader with its own leaf lines and
 * pool (#7690). A page with no OCR is refused for such a book: that lane does not OCR. NOTIFY below answers the reader.
 * The pipeline pause and the spend dial govern paid Batch work; this lane spends subscription quota only, like
 * cli-translate-lane, so the brake is not read. Its gate is laneQuota('agy-flash-translate') and the readers' exit 3.
 *
 * WHAT IT DOES TO A BOOK. Requested pages first, then the rest of the book in page order, inside the run's page
 * budget:
 *   1. pages with no OCR → agy 3.8 Flash-low fresh read. #7517 measured a fresh Flash-low read on German below the
 *      lite>agy-flash-low route (16/30 accepted, 12 cut by Gemini's filter) but, with lite where it was cut, above
 *      lite alone (24/30 vs 21/30). Here a cut page is ledgered and stays unread, so the Batch lane reads it with lite
 *      later: the same composite. A spread book (cli-ocr-lane's spreadReason) waits for a person.
 *   2. untranslated pages → the book's cli row in translation-routing-table.json, else agy 3.8 Flash
 *      (CLI_TRANSLATE_LANES). The reader's OCR-first gate (exit 2: mostly flash-lite OCR, no ocr_checked on the row)
 *      is honoured, never overridden:
 *   3. on the gate, the book's Flash-Lite pages go to the re-read (#8395): `cli-ocr-lane.mjs correct --reread-per-call=4
 *      --book=ID --first=<requested>` (`--reread-languages=Latin` for Latin), in the day folder the gex45 latin-first cron
 *      uses (rereadOutDir under LATIN_FIRST_ROOT: one ledger, one set of claims, so no page is re-read twice on a box),
 *      on this run's pool (AGY_HOME) and behind the re-read's own quota floor. Pages it tried take the page budget. Then
 *      the pages that no longer rest on an unchecked Flash-Lite draft are translated, requested first. The rest wait,
 *      and the summary line names a book whose language the re-read does not serve (Latin, German and French print).
 *      Claims and the ledger are one box's: on another box the guard is the page's REREAD_LANE stamp and apply's
 *      "page rewritten since the read" check, which cost a duplicate read at worst, never a duplicate write.
 *
 * NOTIFY. With --apply, every open request whose page now has English (> 30 chars) is marked addressed exactly as
 * PATCH /api/feedback/[id] does (addressed_*, reply_message) and emailed through src/lib/feedback-reply-email.ts,
 * stamped reply_sent_at / reply_recipient. One email per reader per book; the reader's other rows on that book are
 * marked silently. The email says whether the whole book is now in English, whether the rest is underway (only when
 * this lane is working on it), and links up to two other editions of the work that are readable in English.
 * Reserved-domain addresses (RFC 2606/6761) are marked without an email.
 *
 * Writes DIR/summary.json and, when anything happened, one ntfy line to sourcelibrary-uptime.
 *
 * STALL (#8395). The lane emailed no one from 30 Oct to 8 Nov and nobody knew. When requests are open (Siku-lane rows
 * aside) and every run of the last STALL_DAYS (summary.json in DIR's siblings) emailed no one, it sends one high-priority
 * ntfy line naming each blocked book and its reason (blockers), at most once a day (DIR/../stall-paged.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';
import { requestVerdict, repeatReasons } from '../lib/translation-request-eligibility.mjs';
import { translateLaneForBook, isTranslatablePage, SKIP_TRANSLATION_PAGE_TYPES } from '../lib/translate-core.mjs';
import { CLI_TRANSLATE_LANES, CLI_TRANSLATE_HOLD } from '../lib/translation-routing.mjs';
import { CLI_FLASH_OCR_HOLD } from '../lib/ocr-routing.mjs';
import { SIKU_LANE_HOLDS } from '../lib/hold-reasons.mjs';
import { laneQuota } from '../lib/lane-quota.mjs';
import { isReadableInEnglish, VISIBLE_PAGE_MATCH } from '../lib/page-counts.mjs';
import { UNTRANSLATED, readerArgs } from './cli-translate-lane.mjs';
import { UNREAD, spreadReason, CORRECT_LANGUAGES, LATIN_FIRST_ROOT, rereadOutDir } from './cli-ocr-lane.mjs';
import { uncheckedLite } from '../lib/ocr-first-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The site's translation-request prompt (TranslationEditor), the only message shape this lane acts on. */
export const REQUEST_MESSAGE = /Translation requested for/;
/** OCR model for pages with none: agy's Flash, low thinking (#7517, the second pool). */
export const OCR_MODEL = 'gemini-3.8-flash-low';
/** Translation lane for a book with no cli row. */
export const DEFAULT_TRANSLATE_ENGINE = 'gemini-3.8-flash+agy-cli';
/** A tail over this many pages goes to a person (--max-book-pages). */
export const BOOK_CEILING = 800;
/** `translation.data` longer than this counts as English (translation-request-eligibility's own test). */
const TRANSLATED_MIN_CHARS = 30;
/**
 * Holds that mean "this book waits for a lane or for demand", which a reader's request is. Anything else — every
 * containment, wrong-leaf, invented-text or awaits-Derek hold, and the Paddle lanes that own their books — stays
 * refused (the Siku lane's own holds become a `siku` verdict, judgeRequest). An allowlist, so a new hold reason is
 * refused until someone adds it here (#6122).
 */
export const LANE_HOLDS = Object.freeze([
  CLI_FLASH_OCR_HOLD.reason,       // waiting for the agy OCR lane
  CLI_TRANSLATE_HOLD.reason,       // waiting for the CLI translation lane
  'scans-only-publish-7176',       // published as scans, processing waits for demand
  'scans-only-publish-7270',
  'acquisition-wave-2026-10-images-only',
  'acquisition-wave-2026-10b',
  'preview-stub-first-read-8181',  // marked complete on a 25-page sample, waiting for the first-read lane
]);
// RFC 2606 / 6761 reserved names (notify-addressed-feedback.mjs): mail there cannot be delivered.
const RESERVED_DOMAIN = /(^|\.)(example\.(com|net|org)|test|invalid|localhost)$/i;

/** { bookRef, pageId } from a request's page URL, or null. */
export function parseRequestUrl(url) {
  const m = String(url || '').match(/\/book\/([^/?#]+)\/page\/([^/?#]+)/);
  if (!m) return null;
  // `page` is a public write and a bad escape throws: one such row must not stop this lane or the Siku lane.
  try { return { bookRef: decodeURIComponent(m[1]), pageId: decodeURIComponent(m[2]) }; } catch { return null; }
}

/** The title as the request message quotes it, shortened the way the hand run did. */
export function requestTitle(message) {
  const full = String(message || '').match(/for "(.+?)" \(/)?.[1] ?? 'the book';
  return full.length > 80 ? full.split('. ')[0].slice(0, 120) : full;
}

/**
 * The reply sentence(s). `bookDone`: no untranslated page left. `underway`: this lane is translating the rest.
 * `editions`: [{ year, url }] of other editions readable in English. `alsoPages`: other requested page numbers
 * answered in the same email.
 */
export function replyText({ title, pageNumber, alsoPages = [], bookDone, underway, editions = [] }) {
  const parts = [`The page you asked about in "${title}" (page ${pageNumber}) now has an English translation.`];
  if (alsoPages.length) parts.push(`${alsoPages.length === 1 ? `Page ${alsoPages[0]}, which you also asked about, is` : `Pages ${alsoPages.join(', ')}, which you also asked about, are`} translated too.`);
  if (bookDone) parts.push('The whole book now has an English translation.');
  else if (underway) parts.push('We are transcribing and translating the rest of the book now.');
  if (!bookDone && editions.length) {
    const list = editions.map((e) => `${e.year ?? 'another edition'} (${e.url})`).join(' and ');
    parts.push(editions.length === 1 ? `Another edition of the same work is already readable in English: ${list}.` : `Other editions of the same work are already readable in English: ${list}.`);
  }
  return parts.join(' ');
}

function run(args, env) {
  console.log(`$ node ${args.map((a) => path.relative(process.cwd(), a) || a).join(' ')}`);
  return spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, CLI_JOB_NAME: 'reader-request-lane-7599', AGY_JOB: 'reader-request-lane-7599', ...env } }).status;
}

const readLedger = (f) => new Set(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id) : []);
const byIdOr_id = (id) => ({ $or: [{ id }, ...(ObjectId.isValid(id) && String(id).length === 24 ? [{ _id: new ObjectId(id) }] : [])] });
const BOOK_PROJECTION = { id: 1, title: 1, language: 1, visible: 1, hidden_reason: 1, pages_count: 1, publication: 1, image_source: 1, publisher: 1, work_id: 1, year: 1, needs_splitting: 1, pipeline_auto: 1, translation_state: 1 };

/**
 * A book's untranslated pages that can be translated today (translate-core's page test): a blank or no-body page has
 * no English to wait for, so it neither takes the page budget nor keeps a book from being "done".
 */
async function translatablePages(db, bookId) {
  const pages = await db.collection('pages').find({ book_id: bookId, ...UNTRANSLATED }, { projection: { id: 1, page_number: 1, page_type: 1, ocr: 1 } }).sort({ page_number: 1 }).toArray();
  return pages.filter((p) => isTranslatablePage(p).ok).map((p) => ({ id: p.id, page_number: p.page_number, lite: uncheckedLite(p) }));
}

/** Why the re-read cannot take this book's Flash-Lite pages, or null when it serves the book's language (#8395). */
export function rereadSkip(book) {
  const lang = String(book?.language || '');
  return /^Latin/.test(lang) || CORRECT_LANGUAGES.test(lang) ? null : `the re-read serves Latin, German and French print, not ${lang || 'a book with no language'}`;
}

/**
 * The re-read of one book's Flash-Lite pages (#8395), as the gex45 latin-first cron runs it (cli-ocr-lane.mjs RE-READ,
 * LATIN RE-READ): 4 pages a call, the same day folder under the same root (so its ledger and claims), the lane's pool
 * (AGY_HOME on the cron line) and its own quota floor. `first`: the requested page ids, read before the others.
 */
export function rereadArgs(book, { maxPages, first = [], date, apply, home = process.env.AGY_HOME, root = LATIN_FIRST_ROOT, deadlineMin = 60 }) {
  return [path.join(HERE, 'cli-ocr-lane.mjs'), 'correct', '--reread-per-call=4', ...(/^Latin/.test(String(book.language || '')) ? ['--reread-languages=Latin'] : []),
    `--book=${book.id}`, ...(first.length ? [`--first=${first.join(',')}`] : []), `--out=${rereadOutDir(root, date)}`, `--max-pages=${maxPages}`,
    '--concurrency=1', '--book-chunk=40', `--deadline-min=${deadlineMin}`, `--agy-home=${home || 'default'}`, ...(apply ? ['--apply'] : [])];
}

/** The re-read ledger's rows for one book since `since` (ISO): every page the re-read tried, with its outcome. */
export function rereadRows(file, bookId, since) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } })
    .filter((r) => r.book_id === bookId && String(r.at) >= since);
}

/** One request's verdict with this lane's options. A Siku-held book the gates would pass becomes `siku`, never `auto`. */
export function judgeRequest({ book, page, tail, repeat, ceiling }) {
  const hold = book?.pipeline_auto?.hold?.reason;
  const siku = SIKU_LANE_HOLDS.includes(hold);
  const verdict = requestVerdict({ book, page, tail, repeat, ceiling, holdAllowed: siku || LANE_HOLDS.includes(hold), ocrPending: !siku });
  return siku && verdict.verdict === 'auto' ? { ...verdict, verdict: 'siku', reason: 'waits at the front of the Siku lane (#7690)' } : verdict;
}

/** Every open request, resolved and judged. */
export async function judgeRequests(db, { ceiling = BOOK_CEILING, since = null } = {}) {
  const filter = since ? { message: REQUEST_MESSAGE, created_at: { $gte: since } } : { addressed: { $ne: true }, message: REQUEST_MESSAGE };
  const rows = await db.collection('feedback').find(filter).sort({ created_at: 1 }).toArray();
  const reqs = rows.map((row) => ({ row, ...(parseRequestUrl(row.page) ?? {}), at: row.created_at, email: row.email, ip_hash: row.ip_hash }));
  const repeats = repeatReasons(reqs.map((r) => ({ bookRef: r.bookRef, pageId: r.pageId, at: r.at, email: r.email, ip_hash: r.ip_hash })));
  const books = new Map(), tails = new Map();
  for (const [i, r] of reqs.entries()) {
    r.repeat = repeats.get(i);
    if (!r.bookRef) { r.verdict = { verdict: 'refuse', reason: 'no /book/…/page/… URL', pages: 0 }; continue; }
    if (!books.has(r.bookRef)) books.set(r.bookRef, await db.collection('books').findOne(byIdOr_id(r.bookRef), { projection: BOOK_PROJECTION }));
    r.book = books.get(r.bookRef);
    r.page = r.book ? await db.collection('pages').findOne({ book_id: r.book.id, ...byIdOr_id(r.pageId) }, { projection: { id: 1, page_number: 1, page_type: 1, ocr: 1, 'translation.data': 1 } }) : null;
    if (r.book && !tails.has(r.book.id)) {
      tails.set(r.book.id, await db.collection('pages').countDocuments({ book_id: r.book.id, ...VISIBLE_PAGE_MATCH, page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, $or: [{ 'translation.data': { $exists: false } }, { 'translation.data': null }, { 'translation.data': '' }] }));
    }
    r.verdict = judgeRequest({ book: r.book, page: r.page, tail: r.book ? tails.get(r.book.id) : 0, repeat: r.repeat, ceiling });
  }
  return reqs;
}

/** Other editions of the work that a reader can already read in English (at most two, earliest first). */
async function englishEditions(db, book) {
  if (!book.work_id) return [];
  const others = await db.collection('books').find({ work_id: book.work_id, id: { $ne: book.id }, visible: true, pages_count: { $gt: 0 } }, { projection: { id: 1, year: 1, translation_state: 1 } }).toArray();
  return others.filter((b) => isReadableInEnglish(b.translation_state)).sort((a, b) => String(a.year ?? '').localeCompare(String(b.year ?? '')))
    .slice(0, 2).map((b) => ({ year: b.year ?? null, url: `https://sourcelibrary.org/book/${b.id}` }));
}

/** Requested pages first, then the rest in page order. */
export const requestedFirst = (pages, wanted) => [...pages.filter((p) => wanted.has(p.id)), ...pages.filter((p) => !wanted.has(p.id))];

export async function workBook(db, w, { OUT, LEDGER, APPLY, budget, job }) {
  const { book } = w;
  const label = `${book.id} ${String(book.title || '').slice(0, 40)}`;
  const dir = path.join(OUT, book.id);
  const ledger = readLedger(LEDGER);
  const out = { book: book.id, ocr: 0, translated: 0, stopped: null, note: null };
  const ledgerLeft = async (take, filter, stage) => {
    const left = new Set((await db.collection('pages').find({ id: { $in: take.map((p) => p.id) }, ...filter }, { projection: { id: 1 } }).toArray()).map((p) => p.id));
    for (const p of take.filter((x) => left.has(x.id))) {
      let meta = null;
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, stage, `${p.id}.meta.json`), 'utf8')); } catch { /* not read */ }
      fs.appendFileSync(LEDGER, JSON.stringify({ page_id: p.id, book_id: book.id, page_number: p.page_number, stage, exit: meta?.exit ?? null, error_class: meta?.error_class ?? (meta ? 'not_written' : 'not_read'), at: new Date().toISOString() }) + '\n');
    }
    if (left.size) console.log(`  ${left.size} ${stage} page(s) not written: ledgered, not retried`);
    return take.length - left.size;
  };

  // 1. OCR what has none.
  const unread = (await db.collection('pages').find({ book_id: book.id, ...UNREAD }, { projection: { id: 1, page_number: 1, crop: 1, cropped_photo: 1 } }).sort({ page_number: 1 }).toArray()).filter((p) => !ledger.has(p.id));
  if (unread.length) {
    const spread = spreadReason(book, unread);
    if (spread) { out.note = `OCR waits for a person: ${spread}`; console.log(`\n${label}: ${out.note}`); return out; }
    const take = requestedFirst(unread, w.wanted).slice(0, budget.left);
    if (!take.length) { out.stopped = 'page budget spent'; return out; }
    budget.left -= take.length;
    const sub = path.join(dir, 'ocr');
    fs.mkdirSync(sub, { recursive: true });
    const ids = path.join(sub, 'page-ids.json');
    fs.writeFileSync(ids, JSON.stringify(take.map((p) => p.id)));
    console.log(`\n${label}: OCR ${take.length} of ${unread.length} unread page(s) on ${OCR_MODEL}`);
    const read = run([path.join(HERE, 'cli-ocr.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${sub}`, `--model=${OCR_MODEL}`, `--job=${job}`, '--stop-on-quota']);
    if (read === 3) { out.stopped = 'quota'; return out; }
    if (read !== 0) { out.note = `OCR reader exited ${read}`; return out; }
    const applied = run([path.join(HERE, 'cli-ocr.mjs'), 'apply', `--out=${sub}`, `--reason=#7599 reader-request lane: a reader asked for this book; fresh ${OCR_MODEL} read through agy (#7517)`, ...(APPLY ? ['--apply'] : [])]);
    if (!APPLY || applied !== 0) { out.note = APPLY ? `OCR apply exited ${applied}` : 'dry run: OCR not written, so nothing to translate yet'; return out; }
    out.ocr = await ledgerLeft(take, UNREAD, 'ocr');
  }

  // 2. Translate what has no English.
  const untranslated = (await translatablePages(db, book.id)).filter((p) => !ledger.has(p.id));
  if (!untranslated.length) return out;
  const routed = translateLaneForBook(book);
  const lane = routed.channel === 'cli' ? routed : { engine: DEFAULT_TRANSLATE_ENGINE, ...CLI_TRANSLATE_LANES[DEFAULT_TRANSLATE_ENGINE], row: null };
  // One translation pass over `pages`: 'gate' when the reader's OCR-first gate refused it (the budget is given back),
  // 'done' when it was written, 'stop' otherwise (out says why).
  const translate = async (pages, sub) => {
    const take = requestedFirst(pages, w.wanted).slice(0, budget.left);
    if (!take.length) { out.stopped = 'page budget spent'; return 'stop'; }
    budget.left -= take.length;
    fs.mkdirSync(sub, { recursive: true });
    const ids = path.join(sub, 'page-ids.json');
    fs.writeFileSync(ids, JSON.stringify(take.map((p) => p.id)));
    console.log(`\n${label}: translate ${take.length} of ${pages.length} page(s) on ${lane.engine}${lane.row ? ` (row ${lane.row.id})` : ' (no cli row: default)'}`);
    const read = run(readerArgs(lane, { ids, dir: sub, job, ocrChecked: lane.row?.adoption?.ocr_checked }));
    if (read === 3) { out.stopped = 'quota'; return 'stop'; }
    if (read === 2) { budget.left += take.length; return 'gate'; }
    if (read !== 0) { out.note = `translation reader exited ${read}`; return 'stop'; }
    const reason = `#7599 reader-request lane: a reader asked for this book; ${lane.engine}${lane.row ? ` (row ${lane.row.id})` : ' (no cli row)'}`;
    const applied = run([path.join(HERE, 'cli-translate.mjs'), 'apply', `--out=${sub}`, `--reason=${reason}`, ...(APPLY ? ['--apply'] : [])]);
    if (!APPLY || applied !== 0) { out.note = APPLY ? `translation apply exited ${applied}` : 'dry run: nothing written'; return 'stop'; }
    out.translated += await ledgerLeft(take, UNTRANSLATED, 'tr');
    return 'done';
  };
  if (await translate(untranslated, path.join(dir, 'tr')) !== 'gate') return out;

  // 3. The OCR-first gate (#8395): re-read the book's Flash-Lite pages, the requested ones first, on the re-read lane
  // (cli-ocr-lane.mjs correct --reread-per-call=4), then translate the pages that no longer rest on a Flash-Lite draft.
  // A page the re-read does not take (front or back matter, short, manuscript, a language it does not serve) keeps its
  // draft and waits; it is never translated over the gate.
  out.reread = 0;
  out.reread_skip = rereadSkip(book);
  const lite = untranslated.filter((p) => p.lite);
  if (!out.reread_skip && lite.length && budget.left > 0) {
    const n = Math.min(budget.left, lite.length);
    const date = new Date().toISOString().slice(0, 10);
    const since = new Date().toISOString();
    console.log(`\n${label}: OCR-first gate: re-read up to ${n} of ${lite.length} Flash-Lite page(s), requested first`);
    const code = run(rereadArgs(book, { maxPages: n, first: lite.filter((p) => w.wanted.has(p.id)).map((p) => p.id), date, apply: APPLY }));
    const rows = rereadRows(path.join(path.dirname(rereadOutDir(LATIN_FIRST_ROOT, date)), 'reread-ledger.jsonl'), book.id, since);
    out.reread = rows.filter((r) => r.outcome === 'written').length;
    // The re-read ledgers every page it tried, written or not; a dry run ledgers nothing, so count what it was allowed.
    budget.left -= APPLY ? rows.length : n;
    if (code !== 0) out.reread_note = `re-read exited ${code}`;
  }
  const after = (await translatablePages(db, book.id)).filter((p) => !ledger.has(p.id));
  const waiting = after.filter((p) => p.lite);
  const waitingAsked = waiting.filter((p) => w.wanted.has(p.id)).map((p) => p.page_number);
  if (waiting.length) {
    out.lite_waiting = `${waiting.length} page(s) still on Flash-Lite OCR${waitingAsked.length ? ` (requested p${waitingAsked.join(', p')})` : ''}: ${out.reread_skip ?? 'outside the re-read\'s frame or not reached this run'}`;
  }
  const ready = after.filter((p) => !p.lite);
  if (!ready.length) { out.note = `OCR-first gate: ${out.lite_waiting ?? 'nothing left to translate'}`; return out; }
  if (await translate(ready, path.join(dir, 'tr-after-reread')) === 'gate') out.note = 'OCR-first gate held after the re-read';
  else if (waitingAsked.length && !out.note) out.note = `OCR-first gate: ${out.lite_waiting}`;
  return out;
}

/** Days of runs that emailed no one, with requests open, before the lane pages (#8395). */
export const STALL_DAYS = 3;
const DAY_MS = 86_400_000;

/**
 * Should this run page that the lane is stuck (#8395)? `summaries`: earlier runs' summary.json ({ at, notify }) plus this
 * one. Pages when requests are open, the lane has run for STALL_DAYS (a run at least that old is on disk), every run since
 * then emailed no one, and it has not paged in the last day (`lastPagedAt`).
 */
export function stalled({ summaries, open, now = Date.now(), lastPagedAt = null }) {
  if (!open) return false;
  if (lastPagedAt && now - Date.parse(lastPagedAt) < DAY_MS) return false;
  const since = now - STALL_DAYS * DAY_MS;
  const at = (s) => Date.parse(s?.at);
  if (!summaries.some((s) => at(s) <= since)) return false;
  return summaries.filter((s) => at(s) > since).every((s) => !(s.notify?.emailed > 0));
}

/** Each blocked book once, with its reason: a book this run stopped on, and a request the gates sent to a person. */
export function blockers(summary, reqs) {
  const out = new Map();
  for (const b of summary.books) {
    const why = b.note ?? b.lite_waiting ?? (b.stopped && b.stopped !== 'page budget spent' ? `stopped: ${b.stopped}` : null);
    if (why) out.set(b.book, `${b.title.slice(0, 50)} — ${why}${b.reread_skip && !why.includes(b.reread_skip) ? ` (${b.reread_skip})` : ''}`);
  }
  for (const r of reqs) {
    const id = r.book?.id ?? r.bookRef ?? String(r.row._id);
    if (['human', 'refuse'].includes(r.verdict.verdict) && !out.has(id)) out.set(id, `${String(r.book?.title || r.row.page || '').slice(0, 50)} — ${r.verdict.verdict}: ${r.verdict.reason}`);
  }
  return [...out.values()];
}

/** Earlier runs' summaries in the lane's folder (one subfolder a run), the last few days only. */
function readSummaries(parent, now = Date.now()) {
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => {
    const f = path.join(parent, d.name, 'summary.json');
    try { return fs.statSync(f).mtimeMs > now - (STALL_DAYS + 2) * DAY_MS ? [JSON.parse(fs.readFileSync(f, 'utf8'))] : []; } catch { return []; }
  });
}

/** Mark and email every open request whose page now has English. */
async function notify(db, { underwayBooks, APPLY }) {
  const { sendFeedbackReplyEmail } = await import('../../src/lib/feedback-reply-email.ts');
  const rows = await db.collection('feedback').find({ addressed: { $ne: true }, message: REQUEST_MESSAGE }).sort({ created_at: 1 }).toArray();
  const ready = [];
  for (const row of rows) {
    const ref = parseRequestUrl(row.page);
    if (!ref) continue;
    const book = await db.collection('books').findOne(byIdOr_id(ref.bookRef), { projection: { id: 1, work_id: 1, title: 1 } });
    const page = book && await db.collection('pages').findOne({ book_id: book.id, ...byIdOr_id(ref.pageId) }, { projection: { id: 1, page_number: 1, 'translation.data': 1 } });
    if (!page || (page.translation?.data || '').trim().length <= TRANSLATED_MIN_CHARS) continue;
    ready.push({ row, ref, book, page });
  }
  // One email per reader per book: the earliest row carries it, the rest are marked silently.
  const groups = new Map();
  for (const r of ready) {
    const key = `${String(r.row.email || r.row.ip_hash || r.row._id).toLowerCase()}|${r.book.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const tally = { emailed: 0, silent: 0, failed: 0, ready: ready.length };
  for (const group of groups.values()) {
    const [first, ...rest] = group;
    const left = await db.collection('pages').countDocuments({ book_id: first.book.id, ...UNREAD }) + (await translatablePages(db, first.book.id)).length;
    const reply = replyText({
      title: requestTitle(first.row.message), pageNumber: first.page.page_number,
      alsoPages: [...new Set(rest.map((r) => r.page.page_number).filter((n) => n !== first.page.page_number))],
      bookDone: left === 0, underway: underwayBooks.has(first.book.id), editions: await englishEditions(db, first.book),
    });
    const link = `https://sourcelibrary.org/book/${first.ref.bookRef}/page/${first.ref.pageId}`;
    const email = String(first.row.email || '').trim();
    const deliverable = email.includes('@') && !RESERVED_DOMAIN.test(email.split('@')[1]);
    console.log(`${first.row._id} ${deliverable ? `→ ${email}` : '(no deliverable address)'}  p${first.page.page_number} ${requestTitle(first.row.message).slice(0, 50)}${rest.length ? ` (+${rest.length} silent)` : ''}\n   ${reply}`);
    if (!APPLY) continue;
    const base = { addressed: true, read: true, addressed_at: new Date(), addressed_by: 'reader-request-lane-7599', addressed_link: link };
    await db.collection('feedback').updateOne({ _id: first.row._id }, { $set: { ...base, addressed_action: `Translated by the reader-request lane (#7599). ${reply}`.slice(0, 1000), reply_message: reply.slice(0, 1000) } });
    for (const r of rest) {
      await db.collection('feedback').updateOne({ _id: r.row._id }, { $set: { ...base, addressed_link: `https://sourcelibrary.org/book/${r.ref.bookRef}/page/${r.ref.pageId}`, addressed_action: 'Translated (answered in the email for this reader\'s other request on the same book).' } });
      tally.silent++;
    }
    if (!deliverable || first.row.reply_sent_at) { tally.silent++; continue; }
    const ok = await sendFeedbackReplyEmail({ to: email, name: first.row.name, originalMessage: first.row.message, replyBody: reply, link });
    if (ok) { await db.collection('feedback').updateOne({ _id: first.row._id }, { $set: { reply_sent_at: new Date(), reply_recipient: email } }); tally.emailed++; } else tally.failed++;
  }
  return tally;
}

async function main() {
  const mode = process.argv[2];
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  if (!['count', 'run'].includes(mode)) { console.error('usage: reader-request-lane.mjs count | run --out=DIR [--max-pages=200] [--max-book-pages=800] [--apply]'); process.exit(2); }
  const APPLY = process.argv.includes('--apply');
  const OUT = arg('out') && path.resolve(arg('out'));
  const CEILING = Number(arg('max-book-pages') || BOOK_CEILING);
  if (mode === 'run' && !OUT) { console.error('run needs --out=DIR'); process.exit(2); }
  const LEDGER = OUT ? path.join(path.dirname(OUT), 'reader-request-ledger.jsonl') : null;

  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  // count --since=ISO judges every request since then, answered or not: a positive control for the gates, read only.
  const SINCE = mode === 'count' && arg('since') ? new Date(arg('since')) : null;
  const reqs = await judgeRequests(db, { ceiling: CEILING, since: SINCE });
  const by = {};
  for (const r of reqs) (by[r.verdict.verdict] ??= []).push(r);
  console.log(`open translation requests: ${reqs.length} — ${Object.entries(by).map(([k, v]) => `${k} ${v.length}`).join(' · ') || 'none'}`);
  for (const r of reqs.filter((x) => x.verdict.verdict !== 'auto')) {
    console.log(`  ${r.verdict.verdict.padEnd(6)} ${r.row._id} ${String(r.book?.title || r.row.page || '').slice(0, 50)} p${r.page?.page_number ?? '?'} — ${r.verdict.reason ?? ''}`);
  }
  // Books to work: one entry per book, visible first, then the oldest request.
  const work = new Map();
  for (const r of by.auto ?? []) {
    if (!work.has(r.book.id)) work.set(r.book.id, { book: r.book, wanted: new Set(), first: r.at, pages: r.verdict.pages });
    work.get(r.book.id).wanted.add(r.page.id);
  }
  const queue = [...work.values()].sort((a, b) => (b.book.visible ? 1 : 0) - (a.book.visible ? 1 : 0) || new Date(a.first) - new Date(b.first));
  for (const w of queue) console.log(`  work   ${w.book.id} ${String(w.book.title || '').slice(0, 50)} — ${w.pages} page(s) without English, ${w.wanted.size} requested`);
  if (mode === 'count') { await client.close(); return; }

  const summary = { at: new Date().toISOString(), apply: APPLY, requests: reqs.length, verdicts: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length])), books: [], notify: null, stopped: null };
  fs.mkdirSync(OUT, { recursive: true });
  if (queue.length) {
    const q = laneQuota('agy-flash-translate', { model: OCR_MODEL });
    if (!q.open) { summary.stopped = `quota: ${q.why}`; console.log(`skip work: lane ${q.lane} idles (${q.state}): ${q.why}`); }
    const budget = { left: Number(arg('max-pages') || 200) };
    const job = `reader-req-${new Date().toISOString().slice(0, 10)}`;
    for (const w of q.open ? queue : []) {
      const res = await workBook(db, w, { OUT, LEDGER, APPLY, budget, job });
      summary.books.push({ ...res, title: String(w.book.title || '').slice(0, 80), requested: w.wanted.size });
      if (res.stopped) { summary.stopped = res.stopped; break; }
    }
  }
  // "Underway" only for books this lane is still working on: it did something this run, and no gate stopped it.
  const underwayBooks = new Set(summary.books.filter((b) => !b.note && (b.ocr || b.translated || b.stopped)).map((b) => b.book));
  summary.notify = await notify(db, { underwayBooks, APPLY });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  const pages = summary.books.reduce((s, b) => s + b.ocr + b.translated, 0);
  const reread = summary.books.reduce((s, b) => s + (b.reread ?? 0), 0);
  const unserved = summary.books.filter((b) => b.reread_skip).map((b) => `${b.title.slice(0, 40)}: ${b.reread_skip}`);
  const line = `reader requests: ${reqs.length} open (${Object.entries(summary.verdicts).map(([k, v]) => `${k} ${v}`).join(', ')}); ${summary.books.length} book(s) worked, ${pages} page(s) written${reread ? `, ${reread} re-read past the OCR-first gate` : ''}; ${summary.notify.emailed} emailed${summary.notify.failed ? `, ${summary.notify.failed} email FAILED` : ''}${summary.stopped ? `; stopped: ${summary.stopped}` : ''}${unserved.length ? `; not re-read: ${unserved.join('; ')}` : ''}`;
  console.log(`\n${line}`);
  if (APPLY && (pages || reread || summary.notify.ready || summary.notify.failed)) {
    spawnSync('curl', ['-s', '-m', '20', '-H', 'Title: Reader-request lane', '-d', `${line} — ${OUT}/summary.json`, 'https://ntfy.sh/sourcelibrary-uptime'], { stdio: 'ignore' });
  }
  // A lane that answers no one for days pages once a day, naming what blocks each book (#8395). Siku-lane rows are that lane's.
  const PAGED = path.join(path.dirname(OUT), 'stall-paged.json');
  let lastPagedAt = null;
  try { lastPagedAt = JSON.parse(fs.readFileSync(PAGED, 'utf8')).at; } catch { /* never paged */ }
  const open = reqs.filter((r) => r.verdict.verdict !== 'siku').length;
  if (APPLY && stalled({ summaries: readSummaries(path.dirname(OUT)), open, lastPagedAt })) {
    const stall = `reader-request lane: ${open} open request(s), nobody emailed in ${STALL_DAYS} days. Blocked: ${blockers(summary, reqs).join(' | ') || 'no book named a reason'} — ${OUT}/summary.json`;
    console.log(stall);
    spawnSync('curl', ['-s', '-m', '20', '-H', 'Title: Reader-request lane stalled', '-H', 'Priority: high', '-H', 'Tags: hourglass', '-d', stall, 'https://ntfy.sh/sourcelibrary-uptime'], { stdio: 'ignore' });
    fs.writeFileSync(PAGED, JSON.stringify({ at: new Date().toISOString(), line: stall }));
  }
  await client.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
