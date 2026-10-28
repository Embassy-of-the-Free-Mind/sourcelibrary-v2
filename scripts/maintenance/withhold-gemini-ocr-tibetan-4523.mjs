#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/withhold-paddle-table-pages-6388.mjs (the same withhold — `ocr.unreadable` + reason,
 * `data` taken off — for Paddle Chinese tables; it snapshots with saveRevisionsBeforeOverwrite, so revert-run.mjs
 * cannot undo it, and its candidate list is a detector's); scripts/maintenance/withhold-stale-translations.mjs
 * (`--unverified-script-arm --cohort-script=tibetan` withholds the ENGLISH made from a Gemini read of Tibetan, but
 * leaves the transcription served — 1,676 public pages still showed it on 2026-10-27).
 *
 * Withholds the Tibetan transcriptions that are still a Gemini read (Flash-Lite / Flash), and any English made from
 * them, from readers (#4523; Derek 2026-10-27 "hide the poor quality flash lite ocr"). On Tibetan, Flash-Lite scores
 * 0.41 syllable identity against 0.88 for the specialist reader and 0.10 for chance, and invents text
 * (src/lib/transcription-reliability.ts). The page keeps its scan; the reader shows "could not produce a reading we
 * trust" in place of both panes (ReaderV2Bits / PaneEmptyState on `ocr.unreadable`).
 *
 * Scope, per page of a book whose `language` starts "Tibetan":
 *   - `ocr.model` is a Gemini model, `ocr.data` is a string, and the transcription carries no human edit;
 *   - NOT `gemini-3.8-flash-low`: those are Flash corrections of a Yigdzin read under the #6740 rule, not raw reads;
 *   - NOT a page whose body (metadata tags removed) is mostly Latin script AND that the read declares English, French
 *     or German: front matter or a Western-language book inside a Tibetan-tagged record. Flash-Lite reads Latin print
 *     well; that is not the #4523 failure. A Latin-script body declared "Balinese" or "Icelandic" on a pecha is.
 * Per page in scope, through writePageText() (scripts/lib/page-text-writer.mjs), one run id:
 *   1. `ocr` → the same object without `data`, plus `unreadable: true`, `unreadable_reason` (kept if already set),
 *      `withheld_reason: REASON`, `withheld_chars`. The text lives only in the revision row (the reader serialises
 *      the page whole into its RSC payload, so text left on the page ships in the HTML).
 *   2. `translation` (if a string, not human-edited) → unset; `translation_withheld` gets the metadata only.
 * Per book: hold it (unless already held), recount, one `sweep_log` row. The Supabase mirror follows within 5 min
 * (sync-pages-content.mjs selects on `updated_at`, which the writer bumps).
 *
 * ACTUATION: lanes that select pages by missing `ocr.data` skip held books; the translate gate refuses
 * `ocr.unreadable`. The Yigdzin re-read (#6871) selects these pages by `ocr.withheld_reason` and lifts the withhold
 * page by page when its read passes the #4523 write rule.
 *
 * UNDO: node scripts/maintenance/revert-run.mjs --run-id <the run id this prints> --apply  (both fields; only pages
 * still holding what this run wrote). Holds are released with release-pipeline-books / releaseBook().
 *
 * Usage (dry run unless --apply):
 *   node --env-file=.env.production.local scripts/maintenance/withhold-gemini-ocr-tibetan-4523.mjs [--books=id,id] [--visibility=public|hidden] [--apply]
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { writePageText, isHumanEditedField, newRunId } from '../lib/page-text-writer.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { holdBook } from '../lib/pipeline-hold.mjs';

export const REASON = 'gemini-ocr-tibetan-4523';
const SWEEP = 'withhold-gemini-ocr-tibetan-4523';
const BY = 'scripts/maintenance/withhold-gemini-ocr-tibetan-4523.mjs';
const HOLD = {
  reason: 'gemini-ocr-tibetan-4523', issue: 4523, source: SWEEP,
  release: 'Release when every page of this book withheld as gemini-ocr-tibetan-4523 has a specialist (Yigdzin) read that passed the #4523 write rule, or is marked unreadable on its own evidence, and its English is re-made from that read.',
};
const PROTECTED_MODELS = new Set(['gemini-3.8-flash-low']);

const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=') ?? d;
const APPLY = process.argv.includes('--apply');
const ONLY = ARG('--books', '') ? ARG('--books', '').split(',') : null;
const VIS = ARG('--visibility', '');
const REPORT = ARG('--report', `${process.env.JOB_SCRATCH || '/tmp'}/withhold-gemini-ocr-tibetan-4523.jsonl`);

/** Tibetan-block characters vs Latin letters in a text. */
export function scriptCounts(text) {
  let tib = 0, lat = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c >= 0x0f00 && c <= 0x0fff) tib++;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f)) lat++;
  }
  return { tib, lat };
}

/** The page's text without the reader-metadata tags (<language>, <warning>, …), whose English would count as Latin. */
export function bodyText(text) {
  return text
    .replace(/<(language|script|page-type|scan-quality|warning|image-desc|meta|note|page-num|sig)\b[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/** Why a page is out of scope, or null when it is in. */
export function skipReason(page) {
  const o = page.ocr;
  if (!o || typeof o.data !== 'string' || o.data === '') return 'no-text';
  if (typeof o.model !== 'string' || !/gemini/i.test(o.model)) return 'not-gemini';
  if (PROTECTED_MODELS.has(o.model)) return 'flash-correction';
  if (isHumanEditedField(o)) return 'human-edit';
  const { tib, lat } = scriptCounts(bodyText(o.data));
  const declared = (o.data.match(/<language>([^<]*)<\/language>/g) || []).join(' ');
  if (lat > tib && /English|French|German/i.test(declared)) return 'latin-dominant';
  return null;
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const runId = newRunId('withhold-gemini-ocr-tibetan-4523');
const out = fs.createWriteStream(REPORT, { flags: 'a' });
const T = { books: 0, booksChanged: 0, pages: 0, ocr: {}, tr: {}, skip: {}, held: {} };
try {
  const q = { language: /^Tibetan/ };
  if (ONLY) q.id = { $in: ONLY };
  if (VIS === 'public') q.visible = true;
  if (VIS === 'hidden') q.visible = { $ne: true };
  const books = await db.collection('books').find(q, { projection: { id: 1, title: 1, visible: 1 } }).toArray();
  console.log(`=== ${SWEEP} ${APPLY ? `APPLY run_id=${runId}` : '(dry run)'} — ${books.length} books ===`);
  for (const b of books) {
    T.books++;
    const pages = await db.collection('pages').find(
      { book_id: b.id, 'ocr.model': /gemini/i, 'ocr.data': { $type: 'string' } },
      { projection: { id: 1, page_number: 1, ocr: 1, translation: 1, translation_withheld: 1 } },
    ).toArray();
    const targets = [];
    for (const p of pages) {
      const why = skipReason(p);
      if (why) { T.skip[why] = (T.skip[why] || 0) + 1; continue; }
      targets.push(p);
    }
    if (!targets.length) continue;
    T.booksChanged++;
    T.pages += targets.length;
    if (!APPLY) {
      const withEn = targets.filter((p) => typeof p.translation?.data === 'string').length;
      out.write(JSON.stringify({ book: b.id, visible: !!b.visible, pages: targets.length, with_english: withEn }) + '\n');
      continue;
    }
    const h = await holdBook(db, b.id, HOLD);
    T.held[h.outcome] = (T.held[h.outcome] || 0) + 1;
    const pageNums = [];
    for (const p of targets) {
      const { data, content_hash: _h, ...rest } = p.ocr;
      const nextOcr = {
        ...rest, unreadable: true, unreadable_reason: rest.unreadable ? (rest.unreadable_reason || REASON) : REASON,
        withheld_reason: REASON, withheld_chars: data.length, withheld_at: new Date(),
      };
      const r = await writePageText(db, p.id, 'ocr', nextOcr, { by: BY, reason: REASON, run_id: runId, revision_source: SWEEP, verbatim: true });
      T.ocr[r.status] = (T.ocr[r.status] || 0) + 1;
      if (r.status !== 'written') continue;
      pageNums.push(p.page_number);
      const tr = p.translation;
      if (typeof tr?.data === 'string' && !isHumanEditedField(tr)) {
        const t = await writePageText(db, p.id, 'translation', null, { by: BY, reason: REASON, run_id: runId, revision_source: SWEEP });
        T.tr[t.status] = (T.tr[t.status] || 0) + 1;
        if (t.status === 'written') {
          const { data: tdata, ...tmeta } = tr;
          await db.collection('pages').updateOne({ id: p.id }, { $set: { translation_withheld: { ...tmeta, chars: tdata.length, reason: REASON, withheld_at: new Date(), revision_id: t.revision_id } } });
        }
      } else if (typeof tr?.data === 'string') T.tr.human_edit_kept = (T.tr.human_edit_kept || 0) + 1;
    }
    const rc = await recountBook(db, b.id, { reason: SWEEP });
    await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'gemini-ocr-withheld', detail: { run_id: runId, issue: 4523, pages: pageNums.length, page_numbers: pageNums.slice(0, 2000), hold: h.outcome } });
    out.write(JSON.stringify({ book: b.id, visible: !!b.visible, pages: pageNums.length, hold: h.outcome, ocr_after: rc.after?.pages_ocr }) + '\n');
    if (T.booksChanged % 20 === 0) console.log(`  ${T.booksChanged} books, ${T.pages} pages`);
  }
  console.log(JSON.stringify(T, null, 1));
  if (APPLY) console.log(`UNDO: node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id ${runId} --apply`);
  console.log(`report: ${REPORT}`);
} finally {
  out.end();
  await client.close();
}
