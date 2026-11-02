#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate-lane.mjs — the translation twin of this runner (#7442): same shape (count/run,
// per-day output folder, a ledger of pages not to retry, release when nothing is left), for CLI_TRANSLATE_HOLD.
// scripts/batch/cli-ocr.mjs (read + apply) — the reader and writer this drives, unchanged but for --stop-on-quota.
// Nothing drained CLI_FLASH_OCR_HOLD (ocr-flash-cli-7075) before this: the orchestrator has held books there since
// #7087 (2026-10-21) and only hand-run jobs read them (#7089).
/**
 * cli-ocr-lane — OCR the books the pipeline held for the agy CLI Flash lane (#7075, #7089).
 *
 * WHO RUNS IT: cron on a Hetzner box whose `agy` is signed in, or a session by hand. No paid API: every read goes
 * through `agy -p` on the subscription (cli-ocr.mjs read --stop-on-quota), and cli-ocr.mjs apply writes it with its
 * usual guards and provenance. It never falls back to the API (2026-10-08 rule): out of quota, the book waits.
 *
 *   node --env-file=.env.production.local scripts/batch/cli-ocr-lane.mjs count
 *   node --env-file=.env.production.local scripts/batch/cli-ocr-lane.mjs run --out=DIR [--max-pages=120] [--book=ID] [--apply]
 *        [--per-call=N] [--per-call-arabic=N] [--prompt-variant=V] [--concurrency=N] [--deadline-min=M]
 *
 * PACE (#7558). `--per-call=N` (1-4, default 1) reads N consecutive pages a call (cli-ocr.mjs --per-call, #7522:
 * 4/call held quality on German and Latin print); an Arabic-script book uses `--per-call-arabic` (default 1: not in
 * the #7522 test), and a book in any other script reads 1 a call. `--prompt-variant` is passed to the reader.
 * `--concurrency=N` (1-4, default 1) reads N BOOKS at once, each its own reader, sharing the page budget (a held book averages ~5 unread pages, so parallel calls inside
 * one book do little at 4 a call). `--deadline-min=M` starts no new book after M minutes, so a cron run inside
 * `timeout 110m` finishes the books it started instead of being killed mid-apply.
 *
 * WHICH BOOKS. Those held with reason CLI_FLASH_OCR_HOLD.reason, highest processing_priority first, then visible
 * books, then the oldest hold. The lane is recomputed from ocrLaneForBook: a book now routed to the API channel
 * (flash-lite) is released at once, back to the Batch lanes.
 *
 * WHICH MODEL. The router names `gemini-3-flash-preview`, which agy does not offer (its Gemini models are 3.8 Flash
 * and 4 Argon, checked 2026-10-26 on the laptop and on hetzner). CLI_MODEL_FOR maps the routed model to the CLI model
 * that reads in its place; a book routed to a model with no entry stays held and `count` names it. The mapping is a
 * routing choice, recorded in every write's --reason: on Arabic print, 3.8 Flash low read 23/25 Kraus pages usable
 * against Flash-Lite's 20/25 and does not clear the router's CER bar, where only Opus does
 * (scripts/eval/experiments/2026-10-26-kraus-print-route-7341.md).
 *
 * WHICH PAGES. The orchestrator's Phase 2 selection: page_number > 0, no OCR text, not recitation-blocked, with an
 * image. Re-reading a page that has text is not this lane's work.
 *
 * SPREADS. cli-ocr.mjs sends the plain page prompt, so a book whose frames are two-leaf spreads is not read here: a book
 * with `needs_splitting` (Phase 2 reads those with its spread prompt and its post-OCR split) and, as Phase 2 does
 * (#523), a book whose unread pages all lack crop data and that Phase 1.25 has not split_checked. Both stay held and
 * `count` names them. On 2026-10-26 a first run wrote plain reads to a needs_splitting book; they were reverted.
 * Such a book is split first (scripts/maintenance/split-spreads-agy.mjs → split-book.mjs, #7454), and its leaves
 * (split_from_spread) are read here.
 *
 * RELEASE. When a book has no unread page left it is released to the status it was held at; Phase 2 then finds
 * nothing to read and advances it to ocr_complete. A page the reader failed or the writer refused is written to the
 * ledger (DIR/../cli-ocr-ledger.jsonl) and not tried again; a book with ledgered pages stays held and `count` names it.
 *
 * HOW IT FAILS. A quota reply or a locked model makes the reader exit 3; the run stops and the next resumes from the
 * reads already on disk. Without --apply it reads and dry-runs the writer, and releases and ledgers nothing.
 *
 * CORRECT (#7558): the route that passed #7520's router test, lite>agy-flash-low (German 28/30, French 27/29 accepted,
 * against the Flash-Lite draft's 21/30 and 22/30). It spends the main pool's spare quota; it is not the held-book lane.
 *
 *   ... cli-ocr-lane.mjs correct-count
 *   ... cli-ocr-lane.mjs correct --out=DIR [--max-pages=N] [--concurrency=N] [--book-chunk=40] [--deadline-min=M]
 *        [--floor-5h=0.25] [--agy-home=default|auto|DIR] [--weekly-end=0] [--shard=K/N] [--reread-per-call=4] [--apply | --dry-run]
 *
 * Pages: the router test's frame (scripts/eval/route-judge-6740/judge.mjs, de-lite / fr-lite): a visible German or
 * French book, idle in the pipeline and not held (or held for the CLI translation lane, whose OCR-first gate waits on this
 * lane, #7263); a page whose stored OCR is a Flash-Lite draft of 300+ characters,
 * not handwritten, not human-edited, not withheld, not a skipped page type, inside the book (15%-95% of its pages,
 * where the test drew). Each is read once by `cli-ocr.mjs read --correct-prompt` (the #5924 one-page template,
 * fc-prompt.mjs, exactly as judged) and written by `cli-ocr.mjs apply` with every guard, stamped `ocr.pipeline =
 * agy-correct-lite-7558`, and `--mark-stale` flags its English (a flag only: no cron re-translates on it). An UNCHANGED
 * answer leaves the page; a CONTAIN answer leaves it and goes to DIR/../correct-contain-claims.jsonl for a by-eye check.
 * Every page tried goes to DIR/../correct-ledger.jsonl with its outcome and is not tried again; once a chunk is
 * ledgered its page images are deleted (only an applied run deletes them).
 *
 * RE-READ (#7853, Derek 2026-11-01: re-read the stored Flash-Lite text, do not correct it). `correct --reread-per-call=4`
 * (and `correct-count --reread-per-call=4`) takes the SAME books and pages as above, but each chunk is read fresh by
 * `cli-ocr.mjs read --per-call=4` (the live first-read prompt, 4 consecutive pages a call, no draft sent) and written by
 * the plain `cli-ocr.mjs apply` over the stored text, with every guard the read path has: refusal and summary, empty and
 * over-long reads, chatter, repetition loops, the truncation guard, the 40% shared-words floor against the stored text
 * (a neighbouring leaf or an invention), a page rewritten since the read, and `--print-only` (the route's cell is print).
 * Kept reads are reused before calling (#7469). The write stamps `ocr.pipeline = agy-reread-lite-7853` (REREAD_LANE)
 * and its run id, the --reason names the route (agy-flash-low@4-read) and the lane run, and `--mark-stale` flags the
 * English. Idempotent: the page selector refuses a page already stamped REREAD_LANE (and a re-read page is no longer a
 * Flash-Lite page), and every page tried goes to DIR/../reread-ledger.jsonl, not the correction ledger, so a page the
 * correction left (UNCHANGED, CONTAIN, the 25% cap) is re-read once. Claims DIR/../claims-reread/. The quota floor and
 * pools are the correction lane's; there is no Claude fallback (the fallback serves Latin, which this mode does not).
 * Router: the cells german-lite/print and french-lite/print, route agy-flash-low@4-read (servedByReread).
 *
 * QUOTA FLOOR. Before each book chunk the lane reads `agy -p /quota` and stops when the Gemini weekly remaining
 * fraction is below the straight line to its reset (remaining time / 7 days), or the 5-hour bucket is below
 * --floor-5h (default 0.25, so the other lanes on the pool keep their window). An unreadable /quota stops it too.
 * `--pace-off-until=ISO` drops the weekly pace line until that time (the 5-hour floor still holds), so a pool can be
 * spent out before its reset instead of paced to it; after that time the line is back with no edit (Derek 2026-10-29).
 * `--weekly-end=F` bends the line to end at F instead of 0 (line = F + (1 - F) × remaining time / 7 days), so a pool
 * the lane has to itself can be spent down to F by its reset and no further (#7263: the second pool, F = 0.10).
 *
 * POOL (#7263). `--agy-home` picks the agy login every call of the run uses, its reads and its /quota floor alike:
 * `default` (the box's own login; also what no flag means, as before), a DIR (a second login, scripts/workers/
 * agy-guard.sh AGY_HOME, e.g. /root/.agy-james), or `auto`: the pool with the most Gemini weekly left whose floor is
 * open, chosen once at the start by the Siku lane's picker (scripts/lib/agy-pools.mjs). The lane's processes are
 * marked AGY_POOL_SHARED=1, so the Siku lane does not count a pool this lane shares as busy.
 *
 * TWO RUNS AT ONCE (#7263). One run a pool, each from its own cron line and flock, sharing one --out folder (so one
 * ledger). Before a book chunk the run CLAIMS the book: an exclusive-create file <ledger dir>/claims/<book>.json,
 * removed when the chunk is ledgered. A run skips a book another live run has claimed (a claim whose pid is gone, or
 * older than 3 h, is stale and taken over), and after claiming re-reads the ledger lines other runs appended, so it
 * never takes a page another run has tried. A book a correction reader is reading right now (/proc) is skipped too.
 * Claims, the ledger and /proc are one box's. Runs on DIFFERENT boxes split the books with `--shard=K/N` instead: a run
 * takes only the books whose id hashes to K mod N (bookShard), so no book is in two boxes' queues (#7263: main's
 * main-pool line 0/2, gex45's second-pool line 1/2).
 *
 * GPU-DRAFT CORRECT (#7263, route C, Derek 2026-10-28 "defaults"): Latin PRINT pages with no OCR yet get a PERO-OCR
 * draft on the box (scripts/batch/pero-draft.py, the #7567 c-pick for Latin, its CPU config as in the TEST) and then one
 * agy gemini-3.8-flash-low correction with the page image, on the #7263 TEST's template byte for byte
 * (scripts/eval/euro-gpu-correct-7567/prompts/agy-0601ef30e816f7a7.txt, hash checked at start). Latin TEST, 108 print
 * pages one a book, Opus judging blind against the image: 105 usable (92-99%), 3 misleading
 * (scripts/eval/experiments/2026-10-28-gpu-flash-vs-opus-7263.md).
 *
 *   ... cli-ocr-lane.mjs gpu-count [--book=ID]
 *   ... cli-ocr-lane.mjs gpu-correct --out=DIR [--max-pages=N] [--max-books=N] [--book-chunk=40] [--concurrency=N]
 *        [--deadline-min=M] [--floor-5h=0.25] [--agy-home=default|auto|DIR] [--weekly-end=0] [--book=ID[,ID]] [--apply]
 *
 * Books: visible Latin books HELD for demand with a reason in GPU_LANE_HOLDS (published as scans, OCR waiting for a
 * decision; Derek's 2026-10-28 decision is that one for Latin print), never pipeline_auto.held, never an unsplit spread
 * book or a possible one (spreadReason), most-read first (human_read_count, then processing_priority). The book STAYS
 * HELD: this lane never releases it, so no pipeline phase (Phase 2's paid OCR, Phase 4's paid translation) selects it;
 * the hold is what keeps its new OCR from queueing paid work. Pages: the Phase 2 filter (UNREAD).
 * Per chunk: images to DIR/<book>/img, PERO, `cli-ocr.mjs read --gpu-draft` (the read refuses a page with OCR, a draft
 * under 30 word characters, or a draft made from other image bytes), `cli-ocr.mjs apply` (writes only while the page has
 * no OCR, stamps ocr.pipeline = GPU_LANE, records the change share on every page and sets the check flag at >= 27%;
 * a page the corrector tags handwritten or mixed is not written). Every agy read is kept (candidate-reads, cli-ocr.mjs).
 * The ledger is DIR/../gpu-correct-ledger.jsonl (one row a page tried; never tried again), claims DIR/../claims-gpu/;
 * a book whose first chunk the corrector tags mostly handwritten goes to DIR/../gpu-correct-books-skipped.jsonl.
 * The quota floor and pools are the correction lane's (QUOTA FLOOR, POOL above), but `--agy-home=auto` takes the open
 * pool with the most weekly left; `--wait-quota` (hand-run pilots) waits for a floor instead of stopping.
 * NOT SCHEDULED: the 2026-10-28 pilot (20 books, the first 15 unread pages each) was accepted 53/60, under the 0.92 bar
 * fixed before judging (scripts/eval/experiments/2026-10-28-gpu-latin-route-pilot-7263.md). No cron line runs this mode.
 *
 * FIRST READS (#7701, Derek 2026-10-29 "focus on books that haven't been OCRd yet"): visible books published as scans
 * whose pages have no OCR get a first read on the subscription instead of the correction lane spending it.
 *
 *   ... cli-ocr-lane.mjs count --cohort=visible-unread [--languages=la,de,fr]
 *   ... cli-ocr-lane.mjs run --cohort=visible-unread --out=DIR [--languages=la,de,fr] [--max-pages=N] [--max-books=N]
 *        [--book-chunk=40] [--per-call=4] [--concurrency=N] [--deadline-min=M] [--floor-5h=0.25] [--weekly-end=0]
 *        [--pace-off-until=ISO] [--agy-home=default|auto|DIR] [--book=ID[,ID]] [--apply]
 *
 * Books (firstReadSkip): visible, held with a reason in FIRST_READ_HOLDS (published as scans, OCR not read), never
 * pipeline_auto.held, not an unsplit spread nor a possible one (spreadReason on its unread pages), not a manuscript by
 * library, title or date (manuscriptReason), routed to a print model (flash-lite or Flash), in --languages. Order: books
 * with no OCR first, then Latin and German, then processing_priority, then fewest pages read. Pages: UNREAD.
 * Each chunk is read by `cli-ocr.mjs read` on gemini-3.8-flash-low (--per-call for Latin, German and French: #7522,
 * #7701 cheap routes; every other language 1 a call) and written by `cli-ocr.mjs apply --lane=agy-first-read-7701 --first-read-only
 * --print-only`: only while the page has no OCR, only when the reader tags it printed, stamped ocr.pipeline with the
 * lane. A book whose chunk the reader tags mostly not printed goes to DIR/../first-read-books-skipped.jsonl.
 * `--correct=deu` (#7701 arm B, the router's pick for German): the pages just written get the correction lane's second
 * pass (cli-ocr.mjs read --correct-prompt, the #5924 template, the image; apply's correct-mode guards), stamped
 * agy-first-read-correct-7701; an UNCHANGED, CONTAIN or refused correction leaves the first read. Never flash-lite.
 * THE HOLD STAYS: this lane never releases a book, so no pipeline phase (Phase 2's paid OCR, Phase 4's paid
 * translation, the chained Batch enrolment, which refuses a held book) selects it because it now has text.
 * Ledger DIR/../first-read-ledger.jsonl (every page tried, never tried again), claims DIR/../claims-first-read/, quota
 * floor and pools as the correction lane's (QUOTA FLOOR, POOL above).
 *
 * ARMC (#7567 arm c, Derek 2026-10-29): the CORRECT frame (a stored Flash-Lite draft of 300+ characters, visible idle
 * unheld book, interior page, not handwritten, edited or withheld; plus E5's: `year` 1450-1800, no manuscript tag, and
 * no page the stored read calls an illustration, plate, map or blank) for Latin and Italian, where E5 passed arm c:
 * the language's GPU draft (la PERO-OCR, it LightOnOCR-3-1B) corrected by agy Flash-low with the image on the #7263
 * template, written OVER the stored draft (cli-ocr.mjs read --over-stored) with the E3 diff guard putting every flagged
 * number, negation and expansion back to the stored reading. Lane dir L (/root/jobs/euro-armc-7567):
 *
 *   ... cli-ocr-lane.mjs armc-plan --lane-dir=L [--ahead=N] [--langs=la,it] [--per-book=N --books-per-lang=M] [--book=ID]
 *        L/plan/<book>.json; tops up to N pages planned and not ledgered (default: what the lane ledgered in 48 h, at
 *        least 600), most-read books first, so the GPU drafts at most ~2 days ahead of the correction
 *   ... armc-fetch --lane-dir=L / armc-collect ...   (scripts/gpu/euro-draft-task.sh, an ocr-filler `euro-draft` chunk)
 *        images to L/drafts/<book>/img/<page>.jpg, one draft a page in L/drafts/<book>/<page>.json
 *   ... armc-left --lane-dir=L                       "<pages> <books>" planned with no draft (the filler's pages left)
 *   ... armc-count --lane-dir=L
 *   ... armc --lane-dir=L --out=DIR [--max-pages=N] [--book-chunk=40] [--concurrency=N] [--deadline-min=M]
 *        [--floor-5h=0.25] [--agy-home=default|auto|DIR] [--weekly-end=0] [--wait-quota] [--weekly-floor=F] [--book=ID] [--apply]
 *        (--weekly-floor: a hand-run pilot's fixed weekly floor in place of the pace line, as E2/E5 ran; never on cron)
 *        drafted pages, re-checked against the frame, read and applied a book chunk at a time (claims L/claims-armc/),
 *        stamped ocr.pipeline = ARMC_LANE, --mark-stale (a flag; nothing re-translates on it). Every page tried goes to
 *        L/armc-ledger.jsonl and is not tried again; its image is deleted once ledgered. CONTAIN claims go to
 *        L/armc-contain-claims.jsonl for a by-eye check. Undo: scripts/maintenance/revert-run.mjs --run-id <run>.
 *
 * CLAUDE FALLBACK (#7545). When the run's pool (--agy-home; `auto` never picks an empty pool, so name it) has an EMPTY Gemini weekly bucket, the lane does not
 * stop on the floor: if agyClaudeGate opens (the Claude group's weekly and 5-hour buckets both at 10% or more, the
 * account not held to one model by allowed-model), the run corrects the cells whose router route is Opus and where
 * Opus through agy passed its test (rules.json `fallback_routes` with passes: true): Latin Flash-Lite pages, on
 * claude-opus-5-5-low, stamped `ocr.pipeline = agy-opus-correct-lite-7545`. Same frame rules, template, writer and
 * ledger. The mode is chosen once per run; before each chunk the gate is read again (cached 10 min), and the run
 * stops when it closes: a Claude bucket under 10%, or a Gemini reset, after which the next run is the Gemini lane.
 * German translation failed the test (4/30 marker failures) and Tibetan translation was not tested: neither is here.
 */
import { VISIBLE_PAGE_MATCH } from '../lib/page-counts.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { ocrLaneForBook, CLI_FLASH_OCR_HOLD, OCR_MODEL_LITE, OCR_MODEL_FLASH } from '../lib/ocr-routing.mjs';
import { releaseBook, HOLD_STATUS, NOT_UNSPLIT_SPREAD, isUnsplitSpread } from '../lib/pipeline-hold.mjs';
import { CLI_TRANSLATE_HOLD } from '../lib/translation-routing.mjs';
import { toLanguageCodes } from '../lib/language-normalize.mjs';
import { scriptFamily } from '../lib/quality-gate-screens.mjs';
import { agyClaudeGate, AGY_GEMINI_EMPTY } from '../lib/agy-cli.mjs';
import { agyEnv, quotaBuckets, readQuotaStdout, readPools, choosePool, poolName } from '../lib/agy-pools.mjs';
import { laneRouteCheck, servedByFirstRead, servedByCorrect, servedByReread, servedByArmcFirstRead } from '../lib/router-binding.mjs';
import { ntfyPost } from '../lib/ntfy-send.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Why this lane must not read the book with the plain page prompt (see SPREADS above), or null. */
export function spreadReason(book, pages) {
  if (book.needs_splitting) return 'needs_splitting: wants the spread prompt and post-OCR split';
  // A leaf written by split-book.mjs carries split_from_spread and no crop (#7454): it is a split page, not a suspect.
  if (pages.length && !book.pipeline_auto?.split_checked && pages.every((p) => !p.crop && !p.cropped_photo && !p.split_from_spread)) return 'no page has crop data and the book is not split_checked: possible unsplit spreads (#523)';
  return null;
}

/** The CLI model that reads in place of each routed model agy does not offer (see WHICH MODEL above). */
export const CLI_MODEL_FOR = Object.freeze({ 'gemini-3-flash-preview': 'gemini-3.8-flash-low' });

/** The pages this lane reads: the orchestrator's Phase 2 filter (submitOcrForBook), without the per-model block. */
export const UNREAD = Object.freeze({
  ...VISIBLE_PAGE_MATCH,
  'ocr.recitation_blocked': { $ne: true },
  $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }],
  $and: [{
    $or: [
      { archived_photo: { $exists: true, $regex: /^https?:\/\// } },
      { cropped_photo: { $exists: true, $nin: [null, ''] } },
      { photo: { $exists: true, $ne: null } },
      { photo_original: { $exists: true, $ne: null } },
    ],
  }],
});

/** Highest processing_priority first, then visible, then the oldest hold. */
export const byQueueOrder = (a, b) => (b.processing_priority ?? 0) - (a.processing_priority ?? 0)
  || (b.visible ? 1 : 0) - (a.visible ? 1 : 0)
  || String(a.pipeline_auto?.hold?.held_at ?? '').localeCompare(String(b.pipeline_auto?.hold?.held_at ?? ''));

function run(args, tag = '', env = process.env) {
  console.log(`${tag}$ node ${args.map((a) => path.relative(process.cwd(), a) || a).join(' ')}`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, AGY_JOB: env.AGY_JOB || 'cli-ocr-lane-7089' } });
    // Books read in parallel (--concurrency): each line carries its book's tag so the log stays readable.
    const pipe = (src, dst) => { let buf = ''; src.on('data', (d) => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) dst.write(`${tag}${l}\n`); }); src.on('end', () => { if (buf) dst.write(`${tag}${buf}\n`); }); };
    pipe(child.stdout, process.stdout); pipe(child.stderr, process.stderr);
    child.on('close', (code) => resolve(code));
  });
}

/**
 * Pages a call for a book (#7558): `perCall` for Latin-script books (the #7522 cell), `perCallArabic` for Arabic
 * script (its own 20-page check), and 1 for every other script, which no block test has covered.
 */
export function perCallFor(book, { perCall = 1, perCallArabic = 1 } = {}) {
  const family = scriptFamily(book.language);
  return family === 'latin' ? perCall : family === 'arabic' ? perCallArabic : 1;
}

const readLedger = (f) => new Set(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id) : []);

async function heldBooks(db) {
  const books = await db.collection('books').find(
    // The status first: it is indexed, and a held book carries both (pipeline-hold.mjs).
    { 'pipeline_auto.status': HOLD_STATUS, 'pipeline_auto.hold.reason': CLI_FLASH_OCR_HOLD.reason },
    { projection: { id: 1, title: 1, language: 1, visible: 1, image_source: 1, processing_priority: 1, created_at: 1, needs_splitting: 1, 'pipeline_auto.hold': 1, 'pipeline_auto.split_checked': 1 } },
  ).toArray();
  return books.sort(byQueueOrder);
}

// ── correct (#7558) ──
export const CORRECT_LANE = 'agy-correct-lite-7558';
export const CORRECT_MODEL = 'gemini-3.8-flash-low';
/** The cells the route passed (#7520): German and French. Latin was not measured. */
export const CORRECT_LANGUAGES = /^(German|French)/;
/** The Claude fallback (#7545, header): Latin lite>opus, where lite>agy-opus accepted 15/15 against claude -p's 15/15. */
export const FALLBACK = Object.freeze({ model: 'claude-opus-5-5-low', languages: /^(Latin)/, lane: 'agy-opus-correct-lite-7545',
  why: "lite>agy-opus passed #7545's test against lite>opus (Latin 15/15 each, 0 wrong text)" });
/**
 * Which correction this run makes: the Gemini lane, the Claude fallback, or none. `quota` is readQuota()'s Gemini
 * buckets (undefined = read them); `gate` is agyClaudeGate.
 */
export function correctMode({ buckets, gate = () => agyClaudeGate(process.env.AGY_HOME || ''), floor5h = 0.25, weeklyEnd = 0, paceOffUntil = null, now = Date.now() } = {}) {
  const weekly = buckets?.find((b) => b.id === 'gemini-weekly');
  // Empty as agyClaudeGate counts it: a spent pool keeps a residue (0.00028 on 2026-10-30) and never reads exactly 0.
  if (weekly && typeof weekly.remaining_fraction === 'number' && weekly.remaining_fraction < AGY_GEMINI_EMPTY) {
    const g = gate();
    return g.ok ? { mode: 'fallback', model: FALLBACK.model, lane: FALLBACK.lane, languages: FALLBACK.languages, why: g.reason }
      : { mode: null, why: `Gemini weekly empty and the Claude fallback is closed: ${g.reason}` };
  }
  const q = quotaFloor(buckets, { now, floor5h, weeklyEnd, paceOffUntil });
  return q.ok ? { mode: 'gemini', model: CORRECT_MODEL, lane: CORRECT_LANE, languages: CORRECT_LANGUAGES, q } : { mode: null, why: `quota floor: ${q.why}` };
}
// ── re-read (#7853, header: RE-READ) ──
/** The re-read's ocr.pipeline stamp: the provenance marker the page selector refuses, so a page is re-read once. */
export const REREAD_LANE = 'agy-reread-lite-7853';
/** `--reread-per-call` value → pages a call (1-4, the lanes' cap), or null when the flag is absent. Throws on a bad value. */
export function parseRereadPerCall(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!(Number.isInteger(n) && n >= 1 && n <= 4)) throw new Error(`--reread-per-call must be 1 to 4, got ${v}`);
  return n;
}
/** The router's id for the route a re-read run serves: agy-flash-low@4-read at 4 a call, agy-flash-low-read at 1. */
export const rereadRoute = (perCall) => (perCall > 1 ? `agy-flash-low@${perCall}-read` : 'agy-flash-low-read');
/** Which run this is: the re-read when the Gemini floor is open, else none (no Claude fallback: it serves Latin only). */
export function rereadMode({ buckets, floor5h = 0.25, weeklyEnd = 0, paceOffUntil = null, now = Date.now() } = {}) {
  const q = quotaFloor(buckets, { now, floor5h, weeklyEnd, paceOffUntil });
  return q.ok ? { mode: 'reread', model: CORRECT_MODEL, lane: REREAD_LANE, languages: CORRECT_LANGUAGES, q } : { mode: null, why: `quota floor: ${q.why}` };
}
/** The re-read's reader: the plain read (live first-read prompt, no draft), N pages a call, kept reads reused (no --fresh). */
export function rereadReadArgs({ cli, ids, dir, model = CORRECT_MODEL, job, perCall }) {
  return [cli, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${model}`, `--lane=${REREAD_LANE}`, `--job=${job}`, '--stop-on-quota', ...(perCall > 1 ? [`--per-call=${perCall}`] : [])];
}
/** The re-read's writer: the plain apply over the stored text, this chunk only, stamped and flagged with REREAD_LANE. */
export function rereadApplyArgs({ cli, ids, dir, reason, apply }) {
  return [cli, 'apply', `--out=${dir}`, `--only=${ids}`, `--reason=${reason}`, `--lane=${REREAD_LANE}`, '--print-only', `--mark-stale=${REREAD_LANE}`, ...(apply ? ['--apply'] : [])];
}
export const LITE_MODELS = Object.freeze(['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview']);
export const IDLE_STATUSES = Object.freeze(['complete', 'archive_complete', 'failed', 'parked', 'ocr_complete']);
/**
 * The router test drew interior pages only (scripts/eval/ground-truth-5935/lib.mjs isInterior). The second argument is
 * the book's LAST page_number, not `pages_count`: a hidden repeat capture (#5056) keeps its number but leaves the count,
 * so a window cut from `pages_count` slides toward the front and drops the tail of the book (PR #7777 review S2).
 */
export const isInterior = (pn, lastPage) => pn > Math.floor(lastPage * 0.15) && pn <= Math.ceil(lastPage * 0.95);
/** The highest page_number a book lists (repeats included: they sit inside the span). Index-covered, one key. */
export async function lastPageNumber(db, bookId) {
  const p = await db.collection('pages').findOne({ book_id: bookId, page_number: { $gt: 0 } }, { sort: { page_number: -1 }, projection: { _id: 0, page_number: 1 } });
  return p?.page_number ?? 0;
}
const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * The quota floor. `buckets`: agy /quota's Gemini buckets {id, remaining_fraction, reset_time}. Returns
 * { ok, why, weekly, line, five_h }: not ok when the weekly bucket is under the straight line to its reset, the 5-hour
 * bucket is under `floor5h`, or either bucket is missing.
 */
export function quotaFloor(buckets, { now = Date.now(), floor5h = 0.25, weeklyEnd = 0, paceOffUntil = null, weeklyFloor = null } = {}) {
  const weekly = buckets?.find((b) => b.id === 'gemini-weekly'), five = buckets?.find((b) => b.id === 'gemini-5h');
  if (!weekly || typeof weekly.remaining_fraction !== 'number' || !weekly.reset_time) return { ok: false, why: 'no Gemini weekly bucket in /quota' };
  // weeklyFloor (a hand-run pilot, armc --weekly-floor=F, #7567): a fixed floor in place of the pace line, as E2/E5 ran (0.40)
  const line = weeklyFloor != null ? weeklyFloor : weeklyEnd + (1 - weeklyEnd) * Math.min(1, Math.max(0, (Date.parse(weekly.reset_time) - now) / WEEK_MS));
  // --pace-off-until: spend the pool out before its reset (Derek 2026-10-29 "spend it out"); the 5-hour floor still holds
  const paceOff = paceOffUntil != null && now < paceOffUntil;
  const r = { weekly: weekly.remaining_fraction, line, five_h: five?.remaining_fraction ?? null };
  if (!paceOff && weekly.remaining_fraction < line) return { ok: false, why: `weekly ${(100 * weekly.remaining_fraction).toFixed(1)}% is under the pace line ${(100 * line).toFixed(1)}%`, ...r };
  if (typeof five?.remaining_fraction !== 'number') return { ok: false, why: 'no Gemini 5-hour bucket in /quota', ...r };
  if (five.remaining_fraction < floor5h) return { ok: false, why: `5-hour bucket ${(100 * five.remaining_fraction).toFixed(1)}% is under ${100 * floor5h}%`, ...r };
  return { ok: true, why: null, ...r };
}
const readQuota = (home) => quotaBuckets(readQuotaStdout(home));

/** `--agy-home` value → { home } for a fixed pool (null = the default login), or { auto: true }. */
export function parseAgyHome(v, env = process.env) {
  if (v === 'auto') return { auto: true };
  if (v === 'default') return { home: null };
  if (v) return { home: path.resolve(v) };
  return { home: env.AGY_HOME || null };
}

const CLAIM_STALE_MS = 3 * 3600 * 1000;
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** Is this claim still held by a live run? claim = parsed claim file. */
export function claimLive(claim, { now = Date.now(), alive = pidAlive } = {}) {
  if (!claim || !Number.isInteger(claim.pid)) return false;
  if (!(now - Date.parse(claim.at) < CLAIM_STALE_MS)) return false;
  return alive(claim.pid);
}
/** Claim a book for this run (see TWO RUNS AT ONCE). Returns true when this run holds it. */
export function claimBook(dir, bookId, me) {
  const f = path.join(dir, `${bookId}.json`);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 3; i++) {
    try { fs.writeFileSync(f, JSON.stringify({ ...me, at: new Date().toISOString() }), { flag: 'wx' }); return true; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    let held = null;
    try { held = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* half-written or gone: treat as stale */ }
    if (claimLive(held)) return false;
    // Stale: move it aside, then try again. A rename succeeds for one run only, so two runs taking over the same stale
    // claim cannot both remove it and both write their own (the loser's rename fails, and its next write finds the winner's).
    try { fs.renameSync(f, `${f}.stale-${process.pid}-${i}`); fs.rmSync(`${f}.stale-${process.pid}-${i}`, { force: true }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return false;
}
/**
 * Books a correction reader is reading right now on this box, from /proc (cli-ocr.mjs read --lane=<CORRECT_LANE>; the
 * book is the folder of its --page-ids-file). Covers a run that does not claim (code from before the claims).
 */
export function liveReaderBooks(procDir = '/proc', lanes = [CORRECT_LANE, REREAD_LANE]) {
  const out = new Set();
  for (const pid of fs.readdirSync(procDir).filter((d) => /^\d+$/.test(d))) {
    let argv;
    try { argv = fs.readFileSync(path.join(procDir, pid, 'cmdline'), 'utf8').split('\0'); } catch { continue; }
    if (!argv.some((a) => a.endsWith('cli-ocr.mjs')) || !argv.includes('read') || !lanes.some((l) => argv.includes(`--lane=${l}`))) continue;
    const f = argv.find((a) => a.startsWith('--page-ids-file='));
    if (f) out.add(path.basename(path.dirname(f.slice('--page-ids-file='.length))));
  }
  return out;
}
/** The shard (0..n-1) a book belongs to: the first 8 hex digits of sha1(book id), mod n. Stable across boxes and runs. */
export const bookShard = (bookId, n) => parseInt(createHash('sha1').update(String(bookId)).digest('hex').slice(0, 8), 16) % n;
/** `--shard=K/N` → { k, n }, or null for no flag; throws on a malformed value. */
export function parseShard(v) {
  if (!v) return null;
  const m = /^(\d+)\/(\d+)$/.exec(v);
  if (!m || +m[2] < 1 || +m[1] >= +m[2]) throw new Error(`--shard must be K/N with 0 <= K < N, got ${v}`);
  return { k: +m[1], n: +m[2] };
}
export const releaseBookClaim = (dir, bookId) => fs.rmSync(path.join(dir, `${bookId}.json`), { force: true });
/** Ledger lines appended since the last call (other runs write the same file): adds their page ids to `set`. */
function ledgerTail(file, set, state) {
  if (!file || !fs.existsSync(file)) return;
  const size = fs.statSync(file).size;
  if (size <= state.offset) return;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(size - state.offset);
  fs.readSync(fd, buf, 0, buf.length, state.offset);
  fs.closeSync(fd);
  const text = buf.toString('utf8');
  const cut = text.lastIndexOf('\n') + 1;      // a line still being written waits for the next call
  state.offset += Buffer.byteLength(text.slice(0, cut));
  for (const l of text.slice(0, cut).split('\n').filter(Boolean)) { try { set.add(JSON.parse(l).page_id); } catch { /* skip */ } }
}

/**
 * The Mongo match of the correctable pages of one book (see CORRECT in the header), shared by correct and the re-read.
 * A page the re-read wrote carries ocr.pipeline = REREAD_LANE (and a Flash model): never selected again.
 */
export const correctablePageMatch = (bookId, skipPageTypes) => ({
  book_id: bookId, ...VISIBLE_PAGE_MATCH, 'ocr.model': { $in: LITE_MODELS }, 'ocr.pipeline': { $ne: REREAD_LANE }, 'ocr.edited_by': { $exists: false },
  'ocr.source': { $ne: 'manual' }, translation_withheld: { $ne: true }, page_type: { $nin: skipPageTypes }, 'ocr.data': { $type: 'string' },
});
/** The correctable pages of one book (see CORRECT in the header), filtered in Mongo; ids and page numbers only. */
async function correctablePages(db, book, { SKIP_TRANSLATION_PAGE_TYPES }) {
  const rows = await db.collection('pages').aggregate([
    // strlen-safe: correctablePageMatch carries 'ocr.data': { $type: 'string' }, the stage before
    { $match: correctablePageMatch(book.id, SKIP_TRANSLATION_PAGE_TYPES) },
    { $project: { _id: 0, id: 1, page_number: 1, n: { $strLenCP: '$ocr.data' }, hw: { $regexMatch: { input: '$ocr.data', regex: '<script>\\s*handwritten', options: 'i' } } } },
    { $match: { n: { $gte: 300 }, hw: false } },
    { $sort: { page_number: 1 } },
  ]).toArray();
  const last = await lastPageNumber(db, book.id);
  return rows.filter((p) => isInterior(p.page_number, last));
}

/**
 * #7809: at start, compare the routes this run serves with the current router table's decisions
 * (scripts/lib/router-binding.mjs). --route-check=warn (default) prints and pages once a day per cell;
 * refuse also exits 9 on a mismatch; off skips it.
 */
function routeCheck(served, arg) {
  const mode = arg('route-check') || 'warn';
  if (!['off', 'warn', 'refuse'].includes(mode)) { console.error('--route-check: off | warn | refuse'); process.exit(2); }
  return laneRouteCheck(served, {
    mode,
    page: (title, body) => ntfyPost('https://ntfy.sh/sourcelibrary-uptime', { method: 'POST', headers: { Title: title, Priority: 'high', Tags: 'twisted_rightwards_arrows' }, body }),
  });
}

async function correctMain(mode, arg) {
  const APPLY = process.argv.includes('--apply');
  // --dry-run says so out loud (no --apply is already a dry run); both together is a mistake, not a choice.
  if (APPLY && process.argv.includes('--dry-run')) { console.error('--apply and --dry-run together'); process.exit(2); }
  const OUT = arg('out') && path.resolve(arg('out'));
  if (mode === 'correct' && !OUT) { console.error('correct needs --out=DIR'); process.exit(2); }
  // --reread-per-call=N (#7853, header: RE-READ): the same frame, re-read N a call instead of corrected
  let REREAD;
  try { REREAD = parseRereadPerCall(arg('reread-per-call')); } catch (e) { console.error(e.message); process.exit(2); }
  const LEDGER = arg('ledger') || (OUT ? path.join(path.dirname(OUT), REREAD ? 'reread-ledger.jsonl' : 'correct-ledger.jsonl') : null);
  const CLAIMS = OUT ? path.join(path.dirname(OUT), 'correct-contain-claims.jsonl') : null;
  const LANGUAGE_NAMES = CORRECT_LANGUAGES.source.match(/\(([^)]*)\)/)[1].split('|');
  if (mode === 'correct') await routeCheck(REREAD ? servedByReread({ languages: LANGUAGE_NAMES, perCall: REREAD }) : servedByCorrect({ languages: LANGUAGE_NAMES }), arg);
  const { SKIP_TRANSLATION_PAGE_TYPES } = await import('../lib/translate-core.mjs');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const ledger = new Set(), tailState = { offset: 0 };
  ledgerTail(LEDGER, ledger, tailState);
  let SHARD;
  try { SHARD = parseShard(arg('shard')); } catch (e) { console.error(e.message); process.exit(2); }
  const FLOOR5H = Number(arg('floor-5h') ?? 0.25);
  const WEEKLY_END = Number(arg('weekly-end') ?? 0);
  if (!(WEEKLY_END >= 0 && WEEKLY_END < 1)) { console.error('--weekly-end must be in [0, 1)'); process.exit(2); }
  const PACE_OFF_UNTIL = arg('pace-off-until') ? Date.parse(arg('pace-off-until')) : null;
  if (PACE_OFF_UNTIL !== null && !Number.isFinite(PACE_OFF_UNTIL)) { console.error('--pace-off-until must be an ISO time'); process.exit(2); }
  const want = parseAgyHome(arg('agy-home'));
  let HOME = want.home ?? null;
  if (want.auto) {
    const pools = readPools();
    for (const p of pools) console.log(`pool ${poolName(p)}: ${p.reading ? `weekly ${(100 * p.reading.weekly).toFixed(1)}%, 5h ${p.reading.fiveHour == null ? '-' : (100 * p.reading.fiveHour).toFixed(1) + '%'}` : 'NO READING'}${p.busy ? `, busy (pid ${p.busy})` : ''}`);
    const toBuckets = (r) => [{ id: 'gemini-weekly', remaining_fraction: r.weekly, reset_time: r.weeklyReset }, { id: 'gemini-5h', remaining_fraction: r.fiveHour }];
    const pick = choosePool(pools, (r) => { const q = quotaFloor(toBuckets(r), { floor5h: FLOOR5H, weeklyEnd: WEEKLY_END, paceOffUntil: PACE_OFF_UNTIL }); return { open: q.ok, why: q.why }; });
    if (!pick) { console.log('correct: no pool has its floor open; nothing read'); await client.close(); return; }
    HOME = pick.home;
  } else if (HOME && !fs.existsSync(HOME)) { console.error(`--agy-home: ${HOME} does not exist`); await client.close(); process.exit(2); }
  const POOL = poolName({ home: HOME });
  const CHILD_ENV = agyEnv(HOME);
  const CLAIMS_DIR = path.join(path.dirname(LEDGER), REREAD ? 'claims-reread' : 'claims');
  const ME = { pid: process.pid, pool: POOL };
  const held = new Set();
  process.on('exit', () => { for (const id of held) releaseBookClaim(CLAIMS_DIR, id); });
  // The run's mode (header: CLAUDE FALLBACK; RE-READ has none). correct-count counts the Gemini lane's frame unless --fallback.
  const gate = () => (REREAD ? rereadMode : correctMode)({ buckets: readQuota(HOME), gate: () => agyClaudeGate(HOME || ''), floor5h: FLOOR5H, weeklyEnd: WEEKLY_END, paceOffUntil: PACE_OFF_UNTIL });
  const M = mode === 'correct-count' ? (REREAD ? { mode: 'reread', languages: CORRECT_LANGUAGES, lane: REREAD_LANE } : process.argv.includes('--fallback') ? { mode: 'fallback', ...FALLBACK } : { mode: 'gemini', languages: CORRECT_LANGUAGES, lane: CORRECT_LANE })
    : gate();
  if (!M.mode) { console.log(`correct: not run: ${M.why}`); await client.close(); return; }
  // A book held for the CLI translation lane (CLI_TRANSLATE_HOLD, #7263) is in the frame too: that lane's OCR-first gate
  // skips a book whose OCR is mostly a Flash-Lite draft, so this lane is the one that can unblock it. Without this, the
  // German and French cli rows of translation-routing-table.json would take those books out of the correction frame.
  const books = (await db.collection('books').find(
    { visible: true, pages_count: { $gt: 0 }, language: { $regex: M.languages }, 'pipeline_auto.held': { $ne: true },
      $or: [{ 'pipeline_auto.status': { $in: IDLE_STATUSES }, 'pipeline_auto.hold': { $exists: false } }, { 'pipeline_auto.status': HOLD_STATUS, 'pipeline_auto.hold.reason': CLI_TRANSLATE_HOLD.reason }] },
    { projection: { id: 1, title: 1, language: 1, pages_count: 1, processing_priority: 1 } },
  ).toArray()).filter((b) => (!arg('book') || b.id === arg('book')) && (!SHARD || bookShard(b.id, SHARD.n) === SHARD.k))
    .sort((a, b) => (b.processing_priority ?? 0) - (a.processing_priority ?? 0) || a.id.localeCompare(b.id));
  if (mode === 'correct-count') {
    const t = {};
    for (const b of books) {
      const ps = (await correctablePages(db, b, { SKIP_TRANSLATION_PAGE_TYPES })).filter((p) => !ledger.has(p.id));
      const k = String(b.language).match(M.languages)[1];
      t[k] ??= { books: 0, books_with_pages: 0, pages: 0 };
      t[k].books++; t[k].pages += ps.length; if (ps.length) t[k].books_with_pages++;
    }
    console.log(`${REREAD ? 're-read' : 'correction'} queue (${M.lane}): ${JSON.stringify(t)}`);
    await client.close(); return;
  }
  const MAX = Number(arg('max-pages') || 200), CHUNK = Number(arg('book-chunk') || 40);
  const CONCURRENCY = Number(arg('concurrency') || 1);
  // Up to 8 (#7263): each book is one agy process (~0.8 of a core); main is CPU-bound at 3, gex45 has 20 threads.
  if (!(Number.isInteger(CONCURRENCY) && CONCURRENCY >= 1 && CONCURRENCY <= 8)) { console.error('--concurrency must be 1 to 8'); process.exit(2); }
  const DEADLINE = arg('deadline-min') ? Date.now() + Number(arg('deadline-min')) * 60_000 : Infinity;
  const job = `cli-ocr-${REREAD ? 'reread' : 'correct'}-${new Date().toISOString().slice(0, 10)}`;
  // The re-read's lane run id, named in every write's --reason and ledger row (each write's own run id is cli-ocr.mjs's).
  const LANE_RUN = `cli-ocr-reread-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}`;
  const ROUTE = REREAD ? rereadRoute(REREAD) : null;
  fs.mkdirSync(OUT, { recursive: true });
  // The template, built once per day folder by the #5924 builder, which refuses if the live OCR prompt has moved.
  const TPL = path.join(OUT, 'fc-correct-prompt.txt');
  if (!REREAD && !fs.existsSync(TPL)) {
    const r = spawnSync(process.execPath, [path.join(HERE, '../eval/flash-reread-5924/fc-prompt.mjs'), TPL], { stdio: 'inherit', env: process.env });
    if (r.status !== 0) { console.error('fc-prompt.mjs refused: the correction template could not be built; nothing read'); await client.close(); process.exit(1); }
  }
  console.log(`correct (${M.mode}: ${M.model}, ${M.lane}${M.mode === 'fallback' ? `; ${M.why}` : ''}${REREAD ? `; route ${ROUTE}, run ${LANE_RUN}${APPLY ? '' : ', DRY RUN'}` : ''}): pool ${POOL}${WEEKLY_END ? ` (pace line ends at ${100 * WEEKLY_END}%)` : ''}; ${books.length} books in frame${SHARD ? ` (shard ${SHARD.k}/${SHARD.n})` : ''}, up to ${MAX} pages, ${CONCURRENCY} book(s) at a time, ${CHUNK} pages a book chunk${Number.isFinite(DEADLINE) ? `, no new chunk after ${new Date(DEADLINE).toISOString()}` : ''}`);
  let budget = MAX, stop = null, bi = 0;
  const tally = { written: 0, unchanged: 0, contain: 0, other: 0 };
  const dryWhy = {};   // a dry run's would-write / skip reasons (nothing is ledgered)
  const nextChunk = async () => {
    while (bi < books.length) {
      const b = books[bi++];
      if (liveReaderBooks().has(b.id)) continue;       // a reader (of any run) is on this book now
      if (!claimBook(CLAIMS_DIR, b.id, ME)) continue;  // another live run is on this book
      held.add(b.id);
      ledgerTail(LEDGER, ledger, tailState);
      const open = (await correctablePages(db, b, { SKIP_TRANSLATION_PAGE_TYPES })).filter((p) => !ledger.has(p.id));
      if (open.length) return { book: b, open };
      releaseBookClaim(CLAIMS_DIR, b.id); held.delete(b.id);
    }
    return null;
  };
  const worker = async () => {
    while (!stop) {
      if (budget <= 0) { stop ??= 'page budget spent'; break; }
      if (Date.now() >= DEADLINE) { stop ??= 'deadline'; break; }
      // The mode's own gate, read again before every chunk: a reset or a spent Claude group ends the run.
      const now = gate();
      if (now.mode !== M.mode) { stop ??= now.mode ? `mode changed to ${now.mode}: the next run takes it` : now.why; break; }
      const q = now.q;
      const c = await nextChunk();
      if (!c) { stop ??= 'queue empty'; break; }
      // Sized after the await, so two workers never both spend the same budget.
      const { book } = c;
      const release = () => { releaseBookClaim(CLAIMS_DIR, book.id); held.delete(book.id); };
      if (budget <= 0) { release(); stop ??= 'page budget spent'; break; }
      const take = c.open.slice(0, Math.min(CHUNK, budget));
      budget -= take.length;
      const tag = CONCURRENCY > 1 ? `[${book.id.slice(-6)}] ` : '';
      const dir = path.join(OUT, book.id);
      fs.mkdirSync(dir, { recursive: true });
      const ids = path.join(dir, `page-ids-${Date.now()}.json`);
      fs.writeFileSync(ids, JSON.stringify(take.map((p) => p.id)));
      console.log(`\n${tag}${book.id} ${String(book.title || '').slice(0, 40)} (${book.language}): ${take.length} of ${c.open.length} pages; pool ${POOL} ${q ? `weekly ${(100 * q.weekly).toFixed(1)}% (line ${(100 * q.line).toFixed(1)}%), 5h ${(100 * q.five_h).toFixed(1)}%` : now.why}`);
      const CLI = path.join(HERE, 'cli-ocr.mjs');
      const read = await run(REREAD ? rereadReadArgs({ cli: CLI, ids, dir, model: M.model, job, perCall: REREAD })
        : [CLI, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${M.model}`, `--correct-prompt=${TPL}`, `--lane=${M.lane}`, `--job=${job}`, '--stop-on-quota'], tag, CHILD_ENV);
      if (read === 3) { release(); stop ??= 'quota'; console.log(`${tag}quota reached: stopping; the next run resumes`); break; }
      if (read !== 0) { release(); console.log(`${tag}  reader exited ${read}: chunk skipped this run`); continue; }
      const reason = REREAD ? `#7853 re-read lane, route ${ROUTE}: the stored Flash-Lite text replaced by a fresh ${M.model} read of the image through agy, ${REREAD} page(s) a call (Derek 2026-11-01: re-read, not correct; read@4 accepted 0.82 German / 0.91 French against the correction's 0.72 / 0.78); lane run ${LANE_RUN}`
        : M.mode === 'fallback' ? `#7545 Claude fallback of the correction lane: Flash-Lite draft corrected by ${M.model} through agy on an account whose Gemini pool is empty (${FALLBACK.why})`
        : `#7558 correction lane: Flash-Lite draft corrected by ${CORRECT_MODEL} through agy (lite>agy-flash-low passed #7520's router test on German and French)`;
      const t0 = Date.now();
      const applied = await run(REREAD ? rereadApplyArgs({ cli: CLI, ids, dir, reason, apply: APPLY })
        : [CLI, 'apply', `--out=${dir}`, `--reason=${reason}`, `--mark-stale=${M.lane}`, ...(APPLY ? ['--apply'] : [])], tag, CHILD_ENV);
      if (!APPLY && applied === 0) {
        // Dry run: say what the writer would do with each page of the chunk; ledger nothing, delete nothing.
        let dry = {};
        try { dry = JSON.parse(fs.readFileSync(path.join(dir, 'apply-summary-dry.json'), 'utf8')); } catch { /* none */ }
        // a dry apply lists only its skips: a page it read and did not skip is one it would write
        for (const p of take) { const why = dry.skipped_pages?.[p.id] ?? (fs.existsSync(path.join(dir, `${p.id}.meta.json`)) ? 'would write' : 'not_read'); dryWhy[why] = (dryWhy[why] || 0) + 1; }
        console.log(`${tag}  dry: ${JSON.stringify(dryWhy)}`);
      }
      if (!APPLY || applied !== 0) { release(); continue; }
      const summaryFile = fs.readdirSync(dir).filter((f) => /^apply-summary-(?!dry|refused).*\.json$/.test(f)).map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).mtimeMs >= t0).sort().pop();
      const sum = summaryFile ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : {};
      const written = new Set(sum.written_page_ids || []);
      for (const cl of sum.contain_claims || []) if (take.some((p) => p.id === cl.page_id)) fs.appendFileSync(CLAIMS, JSON.stringify({ ...cl, at: new Date().toISOString(), lane: M.lane }) + '\n');
      for (const p of take) {
        const why = written.has(p.id) ? 'written' : sum.skipped_pages?.[p.id] ?? 'not_read';
        const k = why === 'written' ? 'written' : /UNCHANGED/.test(why) ? 'unchanged' : /CONTAIN/.test(why) ? 'contain' : 'other';
        tally[k]++;
        fs.appendFileSync(LEDGER, JSON.stringify({ page_id: p.id, book_id: book.id, page_number: p.page_number, outcome: k, why, at: new Date().toISOString(), ...(REREAD && { lane: REREAD_LANE, route: ROUTE, lane_run: LANE_RUN, run: sum.run ?? null }) }) + '\n');
        ledger.add(p.id);
      }
      // The chunk is written and ledgered: its page images (~420 KB a page, ~1.3 GB a full run) are not needed again
      // (apply checks the recorded image hash; the prompt sent is in each write's provenance). The root disk is #6223.
      for (const p of take) fs.rmSync(path.join(dir, `ws-${p.id}`), { recursive: true, force: true });
      // A block read keeps its images in one ws-call-<id> folder a call; this run holds the book's claim, so all are this chunk's.
      if (REREAD) for (const w of fs.readdirSync(dir).filter((f) => f.startsWith('ws-call-'))) fs.rmSync(path.join(dir, w), { recursive: true, force: true });
      release();
      console.log(`${tag}  ${JSON.stringify(tally)}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n${REREAD ? 're-read' : 'correct'} run ended (pool ${POOL}): ${stop ?? 'done'}; ${MAX - budget} page(s) taken; ${APPLY ? JSON.stringify(tally) : `dry run: ${JSON.stringify(dryWhy)}`}`);
  await client.close();
}

// ── gpu-correct (#7263, route C) ──
export const GPU_LANE = 'pero-agy-flash-low-7263';
export const GPU_ROUTE = 'pero>agy-flash-low';
export const GPU_LANE_REASON = '#7263 GPU-draft lane';
/** The #7263 TEST template (arm C), byte for byte; its sha256 prefix is checked before any call. */
export const GPU_TEMPLATE = Object.freeze({ file: 'scripts/eval/euro-gpu-correct-7567/prompts/agy-0601ef30e816f7a7.txt', hash: '0601ef30e816f7a7' });
/** Holds that mean "published as scans, OCR waits for a decision" (reader-request-lane.mjs LANE_HOLDS, demand side). */
export const GPU_LANE_HOLDS = Object.freeze(['scans-only-publish-7176', 'scans-only-publish-7270', 'acquisition-wave-2026-10-images-only', 'acquisition-wave-2026-10b']);
export const GPU_LANGUAGES = /^Latin/;
/** Most-read first, then processing_priority, then id (stable). */
export const byReaders = (a, b) => (b.human_read_count ?? 0) - (a.human_read_count ?? 0) || (b.processing_priority ?? 0) - (a.processing_priority ?? 0) || String(a.id).localeCompare(String(b.id));
const GPU_PAGE_PROJECTION = { id: 1, book_id: 1, page_number: 1, crop: 1, cropped_photo: 1, split_from_spread: 1, split_from_pecha: 1, archived_photo: 1, photo: 1, enhanced_photo: 1, photo_original: 1 };

async function gpuMain(mode, arg) {
  const APPLY = process.argv.includes('--apply');
  const OUT = arg('out') && path.resolve(arg('out'));
  if (mode === 'gpu-correct' && !OUT) { console.error('gpu-correct needs --out=DIR'); process.exit(2); }
  const LEDGER = arg('ledger') || (OUT ? path.join(path.dirname(OUT), 'gpu-correct-ledger.jsonl') : null);
  const BOOKS_SKIPPED = LEDGER ? path.join(path.dirname(LEDGER), 'gpu-correct-books-skipped.jsonl') : null;
  const CLAIMS = LEDGER ? path.join(path.dirname(LEDGER), 'gpu-contain-claims.jsonl') : null;
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const ledger = new Set(), tailState = { offset: 0 };
  ledgerTail(LEDGER, ledger, tailState);
  const skippedBooks = readLedger(BOOKS_SKIPPED);   // rows carry page_id = the book id
  const ONLY = arg('book') ? new Set(arg('book').split(',')) : null;
  const books = (await db.collection('books').find(
    { language: { $regex: GPU_LANGUAGES }, visible: true, pages_count: { $gt: 0 }, 'pipeline_auto.status': HOLD_STATUS, 'pipeline_auto.hold.reason': { $in: GPU_LANE_HOLDS }, 'pipeline_auto.held': { $ne: true }, ...NOT_UNSPLIT_SPREAD },
    { projection: { id: 1, title: 1, language: 1, pages_count: 1, pages_ocr: 1, human_read_count: 1, processing_priority: 1, needs_splitting: 1, 'pipeline_auto.hold.reason': 1, 'pipeline_auto.split_checked': 1 } },
  ).toArray()).filter((b) => (!ONLY || ONLY.has(b.id)) && !skippedBooks.has(b.id)).sort(byReaders);
  const openPages = async (b) => {
    const pages = await db.collection('pages').find({ book_id: b.id, ...UNREAD }, { projection: GPU_PAGE_PROJECTION }).sort({ page_number: 1 }).toArray();
    return { pages, spread: spreadReason(b, pages), open: pages.filter((p) => !ledger.has(p.id)) };
  };
  if (mode === 'gpu-count') {
    // Sized from the book counters (pages_count - pages_ocr), so the count is one query; the run reads the pages.
    const t = { books: books.length, pages_est: 0, by_hold: {}, read_by_humans: 0, split_checked: 0 };
    for (const b of books) {
      const u = Math.max(0, (b.pages_count ?? 0) - (b.pages_ocr ?? 0)); t.pages_est += u;
      const r = b.pipeline_auto?.hold?.reason; (t.by_hold[r] ??= { books: 0, pages_est: 0 }); t.by_hold[r].books++; t.by_hold[r].pages_est += u;
      if ((b.human_read_count ?? 0) > 0) t.read_by_humans++;
      if (b.pipeline_auto?.split_checked) t.split_checked++;
    }
    console.log(`GPU-draft queue (${GPU_LANE}): ${JSON.stringify(t)}`);
    // --list=N: the first N books in queue order that the run would take (open pages, no spread wait), as ids.
    const LIST = Number(arg('list') || 0);
    const shown = [];
    for (const b of ONLY || LIST ? books : []) {
      if (LIST && shown.length >= LIST) break;
      const o = await openPages(b);
      if (LIST && (!o.open.length || o.spread)) continue;
      shown.push(b.id);
      console.log(`  ${b.id} ${String(b.title || '').slice(0, 50)} (${b.human_read_count ?? 0} readers): ${o.open.length} open pages${o.spread ? `; waits: ${o.spread}` : ''}`);
    }
    if (LIST) console.log(`--book=${shown.join(',')}`);
    await client.close(); return;
  }
  const tplText = fs.readFileSync(path.join(HERE, '../..', GPU_TEMPLATE.file), 'utf8');
  if (createHash('sha256').update(tplText).digest('hex').slice(0, 16) !== GPU_TEMPLATE.hash) { console.error(`${GPU_TEMPLATE.file} is not template ${GPU_TEMPLATE.hash}: nothing read`); await client.close(); process.exit(1); }
  const MAX = Number(arg('max-pages') || 400), MAX_BOOKS = Number(arg('max-books') || Infinity), CHUNK = Number(arg('book-chunk') || 40), FLOOR5H = Number(arg('floor-5h') ?? 0.25);
  const WEEKLY_END = Number(arg('weekly-end') ?? 0);
  if (!(WEEKLY_END >= 0 && WEEKLY_END < 1)) { console.error('--weekly-end must be in [0, 1)'); process.exit(2); }
  const PACE_OFF_UNTIL = arg('pace-off-until') ? Date.parse(arg('pace-off-until')) : null;
  if (PACE_OFF_UNTIL !== null && !Number.isFinite(PACE_OFF_UNTIL)) { console.error('--pace-off-until must be an ISO time'); process.exit(2); }
  const want = parseAgyHome(arg('agy-home'));
  let HOME = want.home ?? null;
  // --wait-quota (a hand-run pilot): when every floor is shut, wait for one to open (re-picking the pool) until the
  // deadline, instead of stopping. Never reads below a floor either way.
  const WAIT = process.argv.includes('--wait-quota');
  if (want.auto) {
    const pools = readPools();
    for (const p of pools) console.log(`pool ${poolName(p)}: ${p.reading ? `weekly ${(100 * p.reading.weekly).toFixed(1)}%, 5h ${p.reading.fiveHour == null ? '-' : (100 * p.reading.fiveHour).toFixed(1) + '%'}` : 'NO READING'}${p.busy ? `, busy (pid ${p.busy})` : ''}`);
    const toBuckets = (r) => [{ id: 'gemini-weekly', remaining_fraction: r.weekly, reset_time: r.weeklyReset }, { id: 'gemini-5h', remaining_fraction: r.fiveHour }];
    // The open pool with the most weekly left.
    const gate = (r) => { const q = quotaFloor(toBuckets(r), { floor5h: FLOOR5H, weeklyEnd: WEEKLY_END, paceOffUntil: PACE_OFF_UNTIL }); return { open: q.ok, why: q.why }; };
    const pick = pools.filter((p) => p.reading && !p.busy && gate(p.reading).open).sort((x, y) => y.reading.weekly - x.reading.weekly)[0];
    if (!pick && !WAIT) { console.log('gpu-correct: no pool has its floor open; nothing read'); await client.close(); return; }
    HOME = pick?.home ?? null;
  } else if (HOME && !fs.existsSync(HOME)) { console.error(`--agy-home: ${HOME} does not exist`); await client.close(); process.exit(2); }
  let POOL = poolName({ home: HOME });
  let CHILD_ENV = agyEnv(HOME);
  const repick = () => {
    if (!want.auto) return quotaFloor(readQuota(HOME), { floor5h: FLOOR5H, weeklyEnd: WEEKLY_END, paceOffUntil: PACE_OFF_UNTIL }).ok;
    const toBuckets = (r) => [{ id: 'gemini-weekly', remaining_fraction: r.weekly, reset_time: r.weeklyReset }, { id: 'gemini-5h', remaining_fraction: r.fiveHour }];
    const p = readPools().filter((x) => x.reading && !x.busy && quotaFloor(toBuckets(x.reading), { floor5h: FLOOR5H, weeklyEnd: WEEKLY_END, paceOffUntil: PACE_OFF_UNTIL }).ok).sort((x, y) => y.reading.weekly - x.reading.weekly)[0];
    if (!p) return false;
    HOME = p.home; POOL = poolName({ home: HOME }); CHILD_ENV = agyEnv(HOME); return true;
  };
  const CLAIMS_DIR = path.join(path.dirname(LEDGER), 'claims-gpu');
  const ME = { pid: process.pid, pool: POOL, lane: GPU_LANE };
  const held = new Set();
  process.on('exit', () => { for (const id of held) releaseBookClaim(CLAIMS_DIR, id); });
  const CONCURRENCY = Number(arg('concurrency') || 1);
  if (!(Number.isInteger(CONCURRENCY) && CONCURRENCY >= 1 && CONCURRENCY <= 8)) { console.error('--concurrency must be 1 to 8'); process.exit(2); }
  const DEADLINE = arg('deadline-min') ? Date.now() + Number(arg('deadline-min')) * 60_000 : Infinity;
  const job = `cli-ocr-gpu-${new Date().toISOString().slice(0, 10)}`;
  fs.mkdirSync(OUT, { recursive: true });
  const TPL = path.join(OUT, `gpu-correct-prompt-${GPU_TEMPLATE.hash}.txt`);
  fs.writeFileSync(TPL, tplText);
  const { getPageSource } = await import('../lib/page-image-url.mjs');
  console.log(`gpu-correct: pool ${POOL}${WEEKLY_END ? ` (pace line ends at ${100 * WEEKLY_END}%)` : ''}; ${books.length} books in frame, up to ${MAX} pages${Number.isFinite(MAX_BOOKS) ? ` in ${MAX_BOOKS} books` : ''}, ${CONCURRENCY} book(s) at a time, ${CHUNK} pages a chunk; template ${GPU_TEMPLATE.hash}`);
  let budget = MAX, stop = null, bi = 0, booksTaken = 0;
  const tally = { written: 0, check_flagged: 0, unchanged: 0, contain: 0, manuscript: 0, blank: 0, other: 0, agy_calls: 0, pero_secs: 0, books: 0 };
  const nextChunk = async () => {
    while (bi < books.length) {
      const b = books[bi++];
      if (!claimBook(CLAIMS_DIR, b.id, ME)) continue;
      held.add(b.id);
      ledgerTail(LEDGER, ledger, tailState);
      const o = await openPages(b);
      if (o.open.length && !o.spread && booksTaken < MAX_BOOKS) { booksTaken++; return { book: b, open: o.open }; }
      if (o.spread) console.log(`  ${b.id}: waits for a split (${o.spread})`);
      releaseBookClaim(CLAIMS_DIR, b.id); held.delete(b.id);
      if (booksTaken >= MAX_BOOKS) return null;
    }
    return null;
  };
  const worker = async () => {
    while (!stop) {
      if (budget <= 0) { stop ??= 'page budget spent'; break; }
      if (Date.now() >= DEADLINE) { stop ??= 'deadline'; break; }
      let q = quotaFloor(readQuota(HOME), { floor5h: FLOOR5H, weeklyEnd: WEEKLY_END, paceOffUntil: PACE_OFF_UNTIL });
      if (!q.ok && WAIT) {
        console.log(`  pool ${POOL}: ${q.why}; waiting for a floor to open (--wait-quota)`);
        while (!repick() && Date.now() < DEADLINE) await new Promise((r) => setTimeout(r, 300_000));
        q = quotaFloor(readQuota(HOME), { floor5h: FLOOR5H, weeklyEnd: WEEKLY_END, paceOffUntil: PACE_OFF_UNTIL });
      }
      if (!q.ok) { stop ??= `quota floor: ${q.why}`; break; }
      const c = await nextChunk();
      if (!c) { stop ??= 'queue empty'; break; }
      const { book } = c;
      const env = CHILD_ENV, pool = POOL;
      const release = () => { releaseBookClaim(CLAIMS_DIR, book.id); held.delete(book.id); };
      if (budget <= 0) { release(); stop ??= 'page budget spent'; break; }
      const take = c.open.slice(0, Math.min(CHUNK, budget));
      budget -= take.length;
      tally.books++;
      const tag = CONCURRENCY > 1 ? `[${book.id.slice(-6)}] ` : '';
      const dir = path.join(OUT, book.id), imgDir = path.join(dir, `img-${Date.now()}`);
      fs.mkdirSync(imgDir, { recursive: true });
      console.log(`\n${tag}${book.id} ${String(book.title || '').slice(0, 40)} (${book.language}, ${book.human_read_count ?? 0} readers): ${take.length} of ${c.open.length} pages; pool ${pool} weekly ${(100 * q.weekly).toFixed(1)}% (line ${(100 * q.line).toFixed(1)}%), 5h ${(100 * q.five_h).toFixed(1)}%`);
      // 1. The images PERO reads: the same resolver, the same bytes the reader fetches (the read checks the hash).
      for (const p of take) {
        const src = getPageSource(p);
        try { const r = src && await fetch(src); if (r?.ok) fs.writeFileSync(path.join(imgDir, `${p.id}.jpg`), Buffer.from(await r.arrayBuffer())); } catch { /* no draft: the read skips it */ }
      }
      // 2. PERO drafts (CPU, as in the TEST).
      const peroOut = path.join(dir, `pero-${path.basename(imgDir)}.json`);
      const pr = spawnSync('python3', [path.join(HERE, 'pero-draft.py'), imgDir, peroOut, `--threads=${arg('pero-threads') || 8}`], { encoding: 'utf8', env: process.env, timeout: 3600_000 });
      console.log(`${tag}  ${(pr.stdout || '').trim() || `pero exited ${pr.status}: ${(pr.stderr || '').slice(-300)}`}`);
      if (pr.status !== 0 || !fs.existsSync(peroOut)) { release(); fs.rmSync(imgDir, { recursive: true, force: true }); console.log(`${tag}  PERO failed: chunk skipped this run`); continue; }
      const pero = JSON.parse(fs.readFileSync(peroOut, 'utf8'));
      tally.pero_secs += pero._engine?.wall_secs ?? 0;
      // Why a page the reader never sent was not sent (cli-ocr.mjs read applies the same 30-character floor).
      const unsent = (p) => (!fs.existsSync(path.join(imgDir, `${p.id}.jpg`)) ? 'no image fetched' : !pero[p.id] ? 'PERO wrote no draft' : pero[p.id].text.replace(/\W/g, '').length < 30 ? 'GPU draft under 30 word characters (blank or near-blank page)' : null);
      const unsentWhy = new Map(take.map((p) => [p.id, unsent(p)]));
      // 3. The agy correction with the image, 4. the write.
      const ids = path.join(dir, `page-ids-${Date.now()}.json`);
      fs.writeFileSync(ids, JSON.stringify(take.map((p) => p.id)));
      const read = await run([path.join(HERE, 'cli-ocr.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${CORRECT_MODEL}`, `--correct-prompt=${TPL}`, `--lane=${GPU_LANE}`, `--gpu-draft=${peroOut}`, `--image-dir=${imgDir}`, `--job=${job}`, '--stop-on-quota', `--concurrency=${arg('read-concurrency') || 2}`], tag, env);
      if (read !== 0) fs.rmSync(imgDir, { recursive: true, force: true });
      if (read === 3) { release(); stop ??= 'quota'; console.log(`${tag}quota reached: stopping; the next run resumes`); break; }
      if (read !== 0) { release(); console.log(`${tag}  reader exited ${read}: chunk skipped this run`); continue; }
      const reason = `${GPU_LANE_REASON}: PERO-OCR draft (${book.language} print, no OCR before) corrected by ${CORRECT_MODEL} through agy with the page image, template ${GPU_TEMPLATE.hash} (route ${GPU_ROUTE}: #7263 Latin TEST 105/108 usable, Derek 2026-10-28)`;
      const t0 = Date.now();
      const applied = await run([path.join(HERE, 'cli-ocr.mjs'), 'apply', `--out=${dir}`, `--only=${ids}`, `--reason=${reason}`, ...(APPLY ? ['--apply'] : [])], tag, env);
      for (const p of take) { try { tally.agy_calls += JSON.parse(fs.readFileSync(path.join(dir, `${p.id}.meta.json`), 'utf8')).calls ?? 0; } catch { /* not read */ } }
      if (!APPLY || applied !== 0) { fs.rmSync(imgDir, { recursive: true, force: true }); release(); continue; }
      const summaryFile = fs.readdirSync(dir).filter((f) => /^apply-summary-(?!dry|refused).*\.json$/.test(f)).map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).mtimeMs >= t0).sort().pop();
      const sum = summaryFile ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : {};
      const written = new Set(sum.written_page_ids || []);
      for (const cl of sum.contain_claims || []) if (take.some((p) => p.id === cl.page_id)) fs.appendFileSync(CLAIMS, JSON.stringify({ ...cl, at: new Date().toISOString(), lane: GPU_LANE }) + '\n');
      let hand = 0;
      for (const p of take) {
        const why = written.has(p.id) ? 'written' : sum.skipped_pages?.[p.id] ?? unsentWhy.get(p.id) ?? 'not_read';
        const k = why === 'written' ? 'written' : /UNCHANGED/.test(why) ? 'unchanged' : /CONTAIN/.test(why) ? 'contain' : /print only/.test(why) ? 'manuscript' : /under 30 word/.test(why) ? 'blank' : 'other';
        if (k === 'manuscript') hand++;
        tally[k]++;
        const share = sum.change_shares?.[p.id];
        if (k === 'written' && share >= 0.27) tally.check_flagged++;
        fs.appendFileSync(LEDGER, JSON.stringify({ page_id: p.id, book_id: book.id, page_number: p.page_number, outcome: k, why, change_share: share ?? null, run: sum.run ?? null, at: new Date().toISOString() }) + '\n');
        ledger.add(p.id);
      }
      // A book the corrector reads as mostly handwritten is not this route's: its other pages are not drafted again.
      if (hand * 2 >= take.length && take.length >= 4) { fs.appendFileSync(BOOKS_SKIPPED, JSON.stringify({ page_id: book.id, why: `corrector tagged ${hand}/${take.length} pages handwritten or mixed`, at: new Date().toISOString() }) + '\n'); console.log(`${tag}  book skipped from now on: ${hand}/${take.length} pages handwritten or mixed`); }
      for (const p of take) fs.rmSync(path.join(dir, `ws-${p.id}`), { recursive: true, force: true });
      fs.rmSync(imgDir, { recursive: true, force: true });
      release();
      console.log(`${tag}  ${JSON.stringify(tally)}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\ngpu-correct run ended (pool ${POOL}): ${stop ?? 'done'}; ${MAX - budget} page(s) taken; ${JSON.stringify(tally)}`);
  if (OUT) fs.appendFileSync(path.join(path.dirname(LEDGER), 'gpu-correct-runs.jsonl'), JSON.stringify({ at: new Date().toISOString(), pool: POOL, apply: APPLY, stop: stop ?? 'done', taken: MAX - budget, ...tally }) + '\n');
  await client.close();
}

// ── armc (#7567 arm c over the correct frame) ──
export const ARMC_LANE = 'gpu-agy-correct-lite-7567';
export const ARMC_REASON = '#7567 arm-c lane';
/** The languages arm c passed in E5 (la 23→4, it 8→2 misleading against lite→Flash), each one's GPU draft engine and router cell/route. */
export const ARMC_ENGINES = Object.freeze({
  la: { language: /^Latin/, engine: 'pero', cell: 'latin-lite', route: 'pero>agy-flash-low' },
  it: { language: /^Italian/, engine: 'lightonocr', cell: 'italian-lite', route: 'lighton>agy-flash-low' },
});
export const ARMC_YEARS = Object.freeze([1450, 1800]);
/** E2's draftText (scripts/eval/euro-gpu-correct-7567/e2-correct.mjs), unchanged: the GPU read as E5's arm c sent it. */
export function armcDraftText(t) {
  t = String(t || '').replace(/^\s*```[a-zA-Z]*\s*$/gm, '');
  if (/<HistoricalDocument|<Metadata>/.test(t)) {
    t = t.replace(/<Metadata>[\s\S]*?<\/Metadata>/g, '').replace(/<\/(Line|Paragraph|Heading|PageNumber|Header|Footer)>/g, '\n')
      .replace(/<[^>\n]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n\s*\n\s*\n+/g, '\n\n')
      .split('\n').map((l) => l.trim()).join('\n');
  }
  return t.trim();
}
/** The lane dir's files (see ARMC in the header). */
export const armcPaths = (L) => ({ plan: path.join(L, 'plan'), drafts: path.join(L, 'drafts'), stage: path.join(L, 'stage'), ledger: path.join(L, 'armc-ledger.jsonl'), claims: path.join(L, 'claims-armc'), contain: path.join(L, 'armc-contain-claims.jsonl'), runs: path.join(L, 'armc-runs.jsonl') });
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
/** Planned pages with no draft file yet (what the GPU chunk drafts; what ocr-filler.sh counts as pages left). */
export function armcUndrafted(L) {
  const P = armcPaths(L), out = [];
  if (!fs.existsSync(P.plan)) return out;
  for (const f of fs.readdirSync(P.plan).filter((x) => x.endsWith('.json'))) {
    const pl = readJson(path.join(P.plan, f)); if (!pl) continue;
    for (const pg of pl.pages) if (!fs.existsSync(path.join(P.drafts, pl.bid, `${pg.id}.json`))) out.push({ ...pg, bid: pl.bid, lang: pl.lang });
  }
  return out;
}
/**
 * The correct frame for one book (correctablePages) plus E5's two extra filters (not withheld, no manuscript tag) and one
 * of this lane's: a page whose stored read calls it an illustration, a plate, a map or a blank, or names no script, is
 * not a text page (the pilot's planner drew a tarot deck whose 300+ characters were an image description).
 */
async function armcPages(db, bookId, SKIP, ids = null) {
  const rows = await db.collection('pages').aggregate([
    { $match: { book_id: bookId, ...(ids && { id: { $in: ids } }), ...VISIBLE_PAGE_MATCH, 'ocr.model': { $in: LITE_MODELS }, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' }, translation_withheld: { $ne: true }, withheld: { $ne: true }, page_type: { $nin: SKIP }, 'ocr.data': { $type: 'string' } } },
    { $project: { _id: 0, id: 1, page_number: 1, n: { $strLenCP: '$ocr.data' }, hw: { $regexMatch: { input: '$ocr.data', regex: '<script>\\s*(handwrit|manuscript|mixed|none)|<page-type>\\s*(illustration|plate|map|blank)', options: 'i' } } } },
    { $match: { n: { $gte: 300 }, hw: false } },
    { $sort: { page_number: 1 } },
  ]).toArray();
  const last = await lastPageNumber(db, bookId);
  return rows.filter((p) => isInterior(p.page_number, last));
}
const armcBookFilter = (langs) => ({ visible: true, pages_count: { $gt: 0 }, year: { $gte: ARMC_YEARS[0], $lte: ARMC_YEARS[1] }, $or: langs.map((l) => ({ language: { $regex: ARMC_ENGINES[l].language } })), 'pipeline_auto.status': { $in: IDLE_STATUSES }, 'pipeline_auto.hold': { $exists: false }, 'pipeline_auto.held': { $ne: true }, needs_splitting: { $ne: true } });
export const armcLang = (language) => Object.entries(ARMC_ENGINES).find(([, v]) => v.language.test(String(language || '')))?.[0] ?? null;
/**
 * `--frame=first-read` (#7701, the router's pick for Latin pages with NO stored text, 2026-10-29 cheap-routes cell
 * test: pero>agy-flash-low 18/18 written, 0 wrong text): the same plan / GPU draft / agy correction, over the first-read
 * lane's frame (FIRST_READ_BOOKS + firstReadSkip, Latin; a possible unsplit spread waits) and its UNREAD pages. The read
 * is the unread GPU-draft path (no --over-stored), one page a call; apply writes only while the page is still unread,
 * printed by the corrector's tag, after #7695's put-back rule run against the PERO draft (--diff-guard=gpu-draft);
 * stamped ARMC_FIRST_READ_LANE; no --mark-stale (the page has no translation). The book keeps its scans-only hold.
 */
export const ARMC_FIRST_READ_LANE = 'pero-agy-first-read-7701';
export const ARMC_FIRST_READ_REASON = '#7701 first-read arm-c lane';
export const ARMC_FIRST_READ_LANGS = Object.freeze(['la']);
const ARMC_FRAMES = ['correct', 'first-read'];
/** The unread pages of a first-read book, in page order (the frame's own page rule), or [] when it may be an unsplit spread. */
async function armcFirstReadPages(db, book, ids = null) {
  const pages = await db.collection('pages').find({ book_id: book.id, ...UNREAD, ...(ids && { id: { $in: ids } }) }, { projection: { _id: 0, id: 1, page_number: 1, crop: 1, cropped_photo: 1, split_from_spread: 1 } }).sort({ page_number: 1 }).toArray();
  return ids || !spreadReason(book, pages) ? pages : [];
}

async function armcMain(mode, arg) {
  const L = arg('lane-dir') && path.resolve(arg('lane-dir'));
  if (!L) { console.error(`${mode} needs --lane-dir=DIR`); process.exit(2); }
  const P = armcPaths(L);
  for (const d of [P.plan, P.drafts, P.stage]) fs.mkdirSync(d, { recursive: true });
  const FRAME = arg('frame') || 'correct';
  if (!ARMC_FRAMES.includes(FRAME)) { console.error(`--frame must be ${ARMC_FRAMES.join(' or ')}`); process.exit(2); }
  // first-read: only the languages the router picked arm c for on unread pages (Latin, #7701)
  const LANGS = (arg('langs') || 'la,it').split(',').filter((l) => ARMC_ENGINES[l] && (FRAME !== 'first-read' || ARMC_FIRST_READ_LANGS.includes(l)));
  if (mode === 'armc' && FRAME === 'first-read') await routeCheck(servedByArmcFirstRead({ langs: LANGS }), arg);
  const ledger = new Set(), tailState = { offset: 0 };
  ledgerTail(P.ledger, ledger, tailState);
  if (mode === 'armc-left') { const u = armcUndrafted(L).filter((p) => !ledger.has(p.id)); console.log(`${u.length} ${new Set(u.map((p) => p.bid)).size}`); return; }
  if (mode === 'armc-collect') {
    // --engine-out=FILE --engine=pero|lightonocr: the engine's output over a stage folder, split into one draft file a page.
    const eng = arg('engine'), file = arg('engine-out'), stageDir = arg('stage-dir');
    const where = new Map();   // page id → book id, from the plan
    for (const f of fs.readdirSync(P.plan)) { const pl = readJson(path.join(P.plan, f)); for (const pg of pl?.pages ?? []) where.set(pg.id, pl.bid); }
    const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    let rows, engine;
    if (eng === 'pero') { const j = readJson(file, {}); engine = j._engine; if (engine?.exit !== 0) { console.error(`armc-collect: PERO exited ${engine?.exit}; nothing collected`); process.exit(1); } rows = Object.entries(j).filter(([k]) => k !== '_engine').map(([id, r]) => ({ id, text: r.text, sha: r.image_sha256 })); }
    else if (eng === 'lightonocr') {
      engine = { name: 'lightonocr', model: 'lightonai/LightOnOCR-3-1B', ...readJson(`${file}.engine.json`, {}), ...(readJson(`${file}.run.json`) && { run: readJson(`${file}.run.json`) }) };
      rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error).map((r) => ({ id: r.page_id, text: r.text, sha: sha(path.join(stageDir, `${r.page_id}.jpg`)), finish: r.finish }));
    } else { console.error('--engine must be pero or lightonocr'); process.exit(2); }
    let n = 0;
    for (const r of rows) {
      const bid = where.get(r.id); if (!bid) continue;
      const text = armcDraftText(r.text);
      fs.writeFileSync(path.join(P.drafts, bid, `${r.id}.json`), JSON.stringify({ text, image_sha256: r.sha, engine, ...(r.finish && { finish: r.finish }), at: new Date().toISOString() }));
      n++;
    }
    // a staged page the engine wrote nothing for gets an empty draft, so it is not drafted again (the run ledgers it)
    let empty = 0;
    if (stageDir) for (const f of fs.readdirSync(stageDir).filter((x) => x.endsWith('.jpg'))) {
      const id = f.slice(0, -4), bid = where.get(id);
      if (bid && !fs.existsSync(path.join(P.drafts, bid, `${id}.json`))) { fs.writeFileSync(path.join(P.drafts, bid, `${id}.json`), JSON.stringify({ text: '', error: `${eng} wrote no draft`, engine, at: new Date().toISOString() })); empty++; }
    }
    if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
    console.log(`armc-collect ${eng}: ${n} drafts, ${empty} pages with none`);
    return;
  }
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const { SKIP_TRANSLATION_PAGE_TYPES: SKIP } = await import('../lib/translate-core.mjs');
  try {
    if (mode === 'armc-plan') return await armcPlan(db, P, arg, LANGS, ledger, SKIP, FRAME);
    if (mode === 'armc-fetch') return await armcFetch(db, P, arg, LANGS, ledger);
    if (mode === 'armc-count') {
      const u = armcUndrafted(L).filter((p) => !ledger.has(p.id));
      const planned = fs.readdirSync(P.plan).map((f) => readJson(path.join(P.plan, f))).filter(Boolean);
      const drafted = planned.flatMap((pl) => pl.pages.filter((pg) => !ledger.has(pg.id) && fs.existsSync(path.join(P.drafts, pl.bid, `${pg.id}.json`))));
      const t = {};
      for (const pl of planned) { const k = pl.lang; t[k] ??= { books: 0, planned: 0, ledgered: 0 }; t[k].books++; t[k].planned += pl.pages.length; t[k].ledgered += pl.pages.filter((pg) => ledger.has(pg.id)).length; }
      console.log(`arm-c lane (${ARMC_LANE}): ${JSON.stringify(t)}; drafted, waiting for a correction: ${drafted.length}; planned, no draft yet: ${u.length}`);
      return;
    }
    return await armcRun(db, P, arg, ledger, tailState, SKIP, FRAME);
  } finally { await client.close(); }
}

/**
 * armc-plan: tops the plan up to the drafting horizon (--ahead=N pages planned and not yet ledgered; default the pages the
 * lane ledgered in the last 48 h, at least --ahead-min=600), so the GPU never drafts more than ~2 days ahead of the
 * correction. Books most-read first; a book is planned whole (every page in frame), unless --per-book=N (a pilot: N
 * pages spread evenly) with --books-per-lang=M.
 */
async function armcPlan(db, P, arg, LANGS, ledger, SKIP, FRAME = 'correct') {
  const planned = new Map(fs.readdirSync(P.plan).filter((f) => f.endsWith('.json')).map((f) => { const pl = readJson(path.join(P.plan, f)); return [pl.bid, pl]; }));
  const open = [...planned.values()].reduce((n, pl) => n + pl.pages.filter((pg) => !ledger.has(pg.id)).length, 0);
  const since = Date.now() - 48 * 3600_000;
  const recent = fs.existsSync(P.ledger) ? fs.readFileSync(P.ledger, 'utf8').split('\n').filter(Boolean).filter((l) => { try { return Date.parse(JSON.parse(l).at) >= since; } catch { return false; } }).length : 0;
  const AHEAD = Number(arg('ahead') || Math.max(Number(arg('ahead-min') || 600), recent));
  const PER_BOOK = Number(arg('per-book') || 0), PER_LANG = Number(arg('books-per-lang') || Infinity);
  const ONLY = arg('book') ? new Set(arg('book').split(',')) : null;
  let room = AHEAD - open;
  console.log(`armc-plan: ${open} pages planned and not ledgered, horizon ${AHEAD} (${recent} ledgered in 48 h): room for ${Math.max(0, room)}`);
  if (room <= 0) return;
  const FR = FRAME === 'first-read', frLangs = LANGS.map((l) => toLanguageCodes(l).codes[0] ?? l);
  const books = (FR
    ? (await db.collection('books').find(FIRST_READ_BOOKS, { projection: { ...FIRST_READ_PROJECTION, year: 1, human_read_count: 1 } }).toArray()).filter((b) => !firstReadSkip(b, { languages: frLangs }))
    : await db.collection('books').find(armcBookFilter(LANGS), { projection: { id: 1, title: 1, language: 1, year: 1, pages_count: 1, human_read_count: 1, processing_priority: 1 } }).toArray())
    .filter((b) => (!ONLY || ONLY.has(b.id)) && !planned.get(b.id)?.whole && !(PER_BOOK && planned.has(b.id))).sort(FR ? byFirstReadOrder : byReaders);
  const perLang = {};
  let added = 0;
  for (const b of books) {
    if (room <= 0) break;
    const lang = armcLang(b.language);
    if (!lang || (perLang[lang] ?? 0) >= PER_LANG) continue;
    const prev = planned.get(b.id);
    const have = new Set(prev?.pages.map((pg) => pg.id) ?? []);
    let rows = (FR ? await armcFirstReadPages(db, b) : await armcPages(db, b.id, SKIP)).filter((p) => !ledger.has(p.id) && !have.has(p.id));
    if (PER_BOOK) { if (rows.length < PER_BOOK) continue; rows = Array.from({ length: PER_BOOK }, (_, i) => rows[Math.floor((i + 0.5) * rows.length / PER_BOOK)]); }
    const whole = !PER_BOOK && rows.length <= room;
    rows = rows.slice(0, room);
    if (!rows.length) { if (!PER_BOOK) fs.writeFileSync(path.join(P.plan, `${b.id}.json`), JSON.stringify({ ...(prev ?? { bid: b.id, lang, title: b.title, year: b.year, pages: [] }), whole: true })); continue; }
    fs.mkdirSync(path.join(P.drafts, b.id), { recursive: true });
    fs.writeFileSync(path.join(P.plan, `${b.id}.json`), JSON.stringify({ bid: b.id, lang, title: b.title, year: b.year, language: b.language, whole, planned_at: new Date().toISOString(), pages: [...(prev?.pages ?? []), ...rows.map((p) => ({ id: p.id, pn: p.page_number }))] }));
    perLang[lang] = (perLang[lang] ?? 0) + 1;
    room -= rows.length; added += rows.length;
    console.log(`  ${b.id} ${String(b.title || '').slice(0, 50)} (${lang}, ${b.year}, ${b.human_read_count ?? 0} readers): ${rows.length} pages${whole ? '' : ' (part)'}`);
  }
  console.log(`armc-plan: ${added} pages added (${JSON.stringify(perLang)} books)`);
}

/** armc-fetch: the page images of undrafted planned pages, to drafts/<book>/img, and a stage folder per language for the engines. */
async function armcFetch(db, P, arg, LANGS, ledger) {
  const { getPageSource } = await import('../lib/page-image-url.mjs');
  const MAX = Number(arg('max-pages') || 2000);
  const todo = armcUndrafted(path.dirname(P.plan)).filter((p) => !ledger.has(p.id) && LANGS.includes(p.lang)).slice(0, MAX);
  const docs = new Map();
  for (let i = 0; i < todo.length; i += 500) for (const d of await db.collection('pages').find({ id: { $in: todo.slice(i, i + 500).map((p) => p.id) } }, { projection: GPU_PAGE_PROJECTION }).toArray()) docs.set(d.id, d);
  const t = {}; let failed = 0;
  const one = async (p) => {
    const img = path.join(P.drafts, p.bid, 'img', `${p.id}.jpg`);
    fs.mkdirSync(path.dirname(img), { recursive: true });
    if (!fs.existsSync(img)) {
      const src = docs.get(p.id) && getPageSource(docs.get(p.id));
      let ok = false;
      for (let a = 0; a < 2 && !ok; a++) { try { const r = src && await fetch(src); if (r?.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > 2000) { fs.writeFileSync(img, b); ok = true; } } } catch { /* retry once */ } }
      if (!ok) { failed++; fs.writeFileSync(path.join(P.drafts, p.bid, `${p.id}.json`), JSON.stringify({ text: '', error: 'no image fetched', at: new Date().toISOString() })); return; }
    }
    const st = path.join(P.stage, p.lang); fs.mkdirSync(st, { recursive: true });
    try { fs.linkSync(img, path.join(st, `${p.id}.jpg`)); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    t[p.lang] = (t[p.lang] ?? 0) + 1;
  };
  const q = [...todo];
  await Promise.all(Array.from({ length: 8 }, async () => { while (q.length) await one(q.shift()); }));
  console.log(`armc-fetch: ${JSON.stringify(t)} staged, ${failed} with no image`);
}

/** armc: the agy correction of drafted pages, guarded, written; every page tried ledgered. */
async function armcRun(db, P, arg, ledger, tailState, SKIP, FRAME = 'correct') {
  const FR = FRAME === 'first-read', LANE_ID = FR ? ARMC_FIRST_READ_LANE : ARMC_LANE;
  const APPLY = process.argv.includes('--apply');
  const OUT = arg('out') && path.resolve(arg('out'));
  if (!OUT) { console.error('armc needs --out=DIR'); process.exit(2); }
  const tplText = fs.readFileSync(path.join(HERE, '../..', GPU_TEMPLATE.file), 'utf8');
  if (createHash('sha256').update(tplText).digest('hex').slice(0, 16) !== GPU_TEMPLATE.hash) { console.error(`${GPU_TEMPLATE.file} is not template ${GPU_TEMPLATE.hash}: nothing read`); process.exit(1); }
  const MAX = Number(arg('max-pages') || 400), CHUNK = Number(arg('book-chunk') || 40), FLOOR5H = Number(arg('floor-5h') ?? 0.25);
  const WEEKLY_END = Number(arg('weekly-end') ?? 0);
  if (!(WEEKLY_END >= 0 && WEEKLY_END < 1)) { console.error('--weekly-end must be in [0, 1)'); process.exit(2); }
  const CONCURRENCY = Number(arg('concurrency') || 1);
  if (!(Number.isInteger(CONCURRENCY) && CONCURRENCY >= 1 && CONCURRENCY <= 8)) { console.error('--concurrency must be 1 to 8'); process.exit(2); }
  const DEADLINE = arg('deadline-min') ? Date.now() + Number(arg('deadline-min')) * 60_000 : Infinity;
  const WAIT = process.argv.includes('--wait-quota');
  // --weekly-floor=F: a hand-run pilot's fixed floor instead of the pace line (never on the cron line)
  const WEEKLY_FLOOR = arg('weekly-floor') != null ? Number(arg('weekly-floor')) : null;
  if (WEEKLY_FLOOR != null && !(WEEKLY_FLOOR >= 0.2 && WEEKLY_FLOOR < 1)) { console.error('--weekly-floor must be in [0.2, 1)'); process.exit(2); }
  // --pace-off-until=ISO (#7701): spend the pool out before that time, as the first-read lines do; the 5-hour floor holds
  const PACE_OFF_UNTIL = arg('pace-off-until') ? Date.parse(arg('pace-off-until')) : null;
  if (PACE_OFF_UNTIL !== null && !Number.isFinite(PACE_OFF_UNTIL)) { console.error('--pace-off-until must be an ISO time'); process.exit(2); }
  const floorOpts = { floor5h: FLOOR5H, weeklyEnd: WEEKLY_END, weeklyFloor: WEEKLY_FLOOR, paceOffUntil: PACE_OFF_UNTIL };
  const want = parseAgyHome(arg('agy-home'));
  const toBuckets = (r) => [{ id: 'gemini-weekly', remaining_fraction: r.weekly, reset_time: r.weeklyReset }, { id: 'gemini-5h', remaining_fraction: r.fiveHour }];
  const openPool = () => readPools().filter((x) => x.reading && !x.busy && quotaFloor(toBuckets(x.reading), floorOpts).ok).sort((x, y) => y.reading.weekly - x.reading.weekly)[0];
  let HOME = want.home ?? null;
  if (want.auto) {
    const pick = openPool();
    if (!pick && !WAIT) { console.log('armc: no pool has its floor open; nothing read'); fs.appendFileSync(P.runs, JSON.stringify({ at: new Date().toISOString(), apply: APPLY, stop: 'no pool open', taken: 0 }) + '\n'); return; }
    HOME = pick?.home ?? null;
  } else if (HOME && !fs.existsSync(HOME)) { console.error(`--agy-home: ${HOME} does not exist`); process.exit(2); }
  let POOL = poolName({ home: HOME }), CHILD_ENV = agyEnv(HOME);
  const repick = () => {
    if (!want.auto) return quotaFloor(readQuota(HOME), floorOpts).ok;
    const p = openPool(); if (!p) return false;
    HOME = p.home; POOL = poolName({ home: HOME }); CHILD_ENV = agyEnv(HOME); return true;
  };
  const ONLY = arg('book') ? new Set(arg('book').split(',')) : null;
  const plans = fs.readdirSync(P.plan).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(P.plan, f))).filter((pl) => pl && (!ONLY || ONLY.has(pl.bid)));
  const books = new Map((await db.collection('books').find({ id: { $in: plans.map((pl) => pl.bid) } }, { projection: { ...(FR && FIRST_READ_PROJECTION), id: 1, title: 1, language: 1, pages_count: 1, human_read_count: 1, processing_priority: 1, visible: 1, needs_splitting: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, 'pipeline_auto.held': 1 } }).toArray()).map((b) => [b.id, b]));
  const order = plans.filter((pl) => books.has(pl.bid)).sort((a, b) => byReaders(books.get(a.bid), books.get(b.bid)));
  const job = `cli-ocr-armc-${new Date().toISOString().slice(0, 10)}`;
  fs.mkdirSync(OUT, { recursive: true });
  const TPL = path.join(OUT, `gpu-correct-prompt-${GPU_TEMPLATE.hash}.txt`);
  fs.writeFileSync(TPL, tplText);
  const ME = { pid: process.pid, pool: POOL, lane: LANE_ID };
  const held = new Set();
  process.on('exit', () => { for (const id of held) releaseBookClaim(P.claims, id); });
  console.log(`armc: pool ${POOL}; ${order.length} planned books, up to ${MAX} pages, ${CONCURRENCY} book(s) at a time, ${CHUNK} pages a chunk; template ${GPU_TEMPLATE.hash}`);
  let budget = MAX, stop = null, bi = 0;
  const tally = { written: 0, unchanged: 0, contain: 0, put_back_all: 0, put_back_unsafe: 0, no_draft: 0, out_of_frame: 0, other: 0, agy_calls: 0, pages_flagged: 0, put_back: 0, books: 0 };
  const ledgerRow = (r) => { fs.appendFileSync(P.ledger, JSON.stringify({ ...r, at: new Date().toISOString() }) + '\n'); ledger.add(r.page_id); };
  const nextChunk = async () => {
    while (bi < order.length) {
      const pl = order[bi++], b = books.get(pl.bid);
      if (!claimBook(P.claims, b.id, ME)) continue;
      held.add(b.id);
      ledgerTail(P.ledger, ledger, tailState);
      const drafted = pl.pages.filter((pg) => !ledger.has(pg.id) && fs.existsSync(path.join(P.drafts, b.id, `${pg.id}.json`)));
      if (drafted.length) return { book: b, plan: pl, drafted };
      releaseBookClaim(P.claims, b.id); held.delete(b.id);
    }
    return null;
  };
  const worker = async () => {
    while (!stop) {
      if (budget <= 0) { stop ??= 'page budget spent'; break; }
      if (Date.now() >= DEADLINE) { stop ??= 'deadline'; break; }
      let q = quotaFloor(readQuota(HOME), floorOpts);
      if (!q.ok && WAIT) {
        console.log(`  pool ${POOL}: ${q.why}; waiting for a floor to open (--wait-quota)`);
        while (!repick() && Date.now() < DEADLINE) await new Promise((r) => setTimeout(r, 300_000));
        q = quotaFloor(readQuota(HOME), floorOpts);
      }
      if (!q.ok) { stop ??= `quota floor: ${q.why}`; break; }
      const c = await nextChunk();
      if (!c) { stop ??= 'queue empty'; break; }
      const { book, plan } = c;
      const env = CHILD_ENV, pool = POOL;
      const release = () => { releaseBookClaim(P.claims, book.id); held.delete(book.id); };
      if (budget <= 0) { release(); stop ??= 'page budget spent'; break; }
      const take = c.drafted.slice(0, Math.min(CHUNK, budget));
      budget -= take.length;
      tally.books++;
      const tag = CONCURRENCY > 1 ? `[${book.id.slice(-6)}] ` : '';
      const dir = path.join(OUT, book.id), imgDir = path.join(P.drafts, book.id, 'img');
      fs.mkdirSync(dir, { recursive: true });
      console.log(`\n${tag}${book.id} ${String(book.title || '').slice(0, 40)} (${book.language}, ${plan.lang}): ${take.length} of ${c.drafted.length} drafted pages; pool ${pool} weekly ${(100 * q.weekly).toFixed(1)}% (line ${(100 * q.line).toFixed(1)}%), 5h ${(100 * q.five_h).toFixed(1)}%`);
      // The book and the page must still be in frame now: a page re-read, edited or withheld since the plan is not this lane's.
      const bookOk = FR ? !firstReadSkip(book, { languages: ARMC_FIRST_READ_LANGS.map((l) => toLanguageCodes(l).codes[0]) })
        : book.visible && !book.needs_splitting && IDLE_STATUSES.includes(book.pipeline_auto?.status) && !book.pipeline_auto?.hold && !book.pipeline_auto?.held;
      const inFrame = new Set(bookOk ? (FR ? await armcFirstReadPages(db, book, take.map((p) => p.id)) : await armcPages(db, book.id, SKIP, take.map((p) => p.id))).map((p) => p.id) : []);
      const drafts = { _engine: null };
      const unsent = new Map();
      for (const p of take) {
        const d = readJson(path.join(P.drafts, book.id, `${p.id}.json`), {});
        if (!inFrame.has(p.id)) { unsent.set(p.id, ['out_of_frame', bookOk ? 'the page left the frame since the plan (re-read, edited, withheld)' : 'the book left the frame since the plan (held, busy, hidden)']); continue; }
        if (!d.text || d.text.replace(/\W/g, '').length < 30) { unsent.set(p.id, ['no_draft', d.error || 'GPU draft under 30 word characters']); continue; }
        drafts._engine ??= d.engine;
        if (d.engine?.name !== drafts._engine?.name) { unsent.set(p.id, ['other', 'draft from another engine than the chunk\'s']); continue; }
        drafts[p.id] = { text: d.text, image_sha256: d.image_sha256 };
      }
      const send = take.filter((p) => drafts[p.id]);
      const t0 = Date.now();
      let sum = {};
      if (send.length) {
        const draftFile = path.join(dir, `drafts-${t0}.json`), ids = path.join(dir, `page-ids-${t0}.json`);
        fs.writeFileSync(draftFile, JSON.stringify(drafts));
        fs.writeFileSync(ids, JSON.stringify(send.map((p) => p.id)));
        const read = await run([path.join(HERE, 'cli-ocr.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${CORRECT_MODEL}`, `--correct-prompt=${TPL}`, `--lane=${LANE_ID}`, `--gpu-draft=${draftFile}`, `--image-dir=${imgDir}`, ...(FR ? [] : ['--over-stored']), `--job=${job}`, '--stop-on-quota', `--concurrency=${arg('read-concurrency') || 2}`], tag, env);
        if (read === 3) { release(); budget += take.length; stop ??= 'quota'; console.log(`${tag}quota reached: stopping; the next run resumes`); break; }
        if (read !== 0) { release(); console.log(`${tag}  reader exited ${read}: chunk skipped this run`); continue; }
        const reason = FR ? `${ARMC_FIRST_READ_REASON}: ${drafts._engine?.name ?? 'GPU'} draft (${book.language} print, a page with no OCR in a book published as scans; the hold stays) corrected by ${CORRECT_MODEL} through agy with the page image, template ${GPU_TEMPLATE.hash}; #7695 put-back against the draft (route pero>agy-flash-low: #7701 cheap-routes cell test 18/18 written, 0 wrong text)`
          : `${ARMC_REASON}: ${drafts._engine?.name ?? 'GPU'} draft (${book.language} print) corrected by ${CORRECT_MODEL} through agy with the page image, template ${GPU_TEMPLATE.hash}, replacing the stored Flash-Lite draft; E3 diff guard put back every flagged number, negation and expansion (route ${ARMC_ENGINES[plan.lang].route}: #7567 E5 misleading la 23→4, it 8→2 against lite→Flash; Derek 2026-10-29)`;
        const applied = await run([path.join(HERE, 'cli-ocr.mjs'), 'apply', `--out=${dir}`, `--only=${ids}`, `--reason=${reason}`, ...(FR ? ['--diff-guard=gpu-draft', '--print-only'] : [`--mark-stale=${ARMC_LANE}`]), ...(APPLY ? ['--apply'] : [])], tag, env);
        for (const p of send) { try { tally.agy_calls += JSON.parse(fs.readFileSync(path.join(dir, `${p.id}.meta.json`), 'utf8')).calls ?? 0; } catch { /* not read */ } }
        if (!APPLY || applied !== 0) { release(); continue; }
        const summaryFile = fs.readdirSync(dir).filter((f) => /^apply-summary-(?!dry|refused).*\.json$/.test(f)).map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).mtimeMs >= t0).sort().pop();
        sum = summaryFile ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : {};
        for (const cl of sum.contain_claims || []) if (send.some((p) => p.id === cl.page_id)) fs.appendFileSync(P.contain, JSON.stringify({ ...cl, at: new Date().toISOString(), lane: LANE_ID }) + '\n');
        tally.pages_flagged += sum.diff_guard?.pages_flagged ?? 0; tally.put_back += sum.diff_guard?.put_back ?? 0;
      } else if (!APPLY) { release(); continue; }
      const written = new Set(sum.written_page_ids || []);
      for (const p of take) {
        const pre = unsent.get(p.id);
        const why = pre ? pre[1] : written.has(p.id) ? 'written' : sum.skipped_pages?.[p.id] ?? 'not_read';
        const k = pre ? pre[0] : why === 'written' ? 'written' : /UNCHANGED/.test(why) ? 'unchanged' : /CONTAIN/.test(why) ? 'contain' : /put back by the diff guard/.test(why) ? 'put_back_all' : /put-back cannot be spliced|put-back changed/.test(why) ? 'put_back_unsafe' : 'other';
        tally[k]++;
        ledgerRow({ page_id: p.id, book_id: book.id, page_number: p.pn, lang: plan.lang, outcome: k, why, run: sum.run ?? null });
      }
      // ledgered: the images and the read workspaces are not needed again (the draft json stays, a few KB a page)
      for (const p of take) { fs.rmSync(path.join(dir, `ws-${p.id}`), { recursive: true, force: true }); fs.rmSync(path.join(imgDir, `${p.id}.jpg`), { force: true }); }
      release();
      console.log(`${tag}  ${JSON.stringify(tally)}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\narmc run ended (pool ${POOL}): ${stop ?? 'done'}; ${MAX - budget} page(s) taken; ${JSON.stringify(tally)}`);
  fs.appendFileSync(P.runs, JSON.stringify({ at: new Date().toISOString(), pool: POOL, apply: APPLY, stop: stop ?? 'done', taken: MAX - budget, ...tally }) + '\n');
}

// ── run --cohort=visible-unread (#7701) ──
export const FIRST_READ_COHORT = 'visible-unread';
export const FIRST_READ_LANE = 'agy-first-read-7701';
export const FIRST_READ_MODEL = 'gemini-3.8-flash-low';
/** The second pass (#7701 arm B, `--correct=deu`): the #7558 correction of the first read, its own ocr.pipeline stamp. */
export const FIRST_READ_CORRECT_LANE = 'agy-first-read-correct-7701';
export const FIRST_READ_REASON = '#7701 first-read lane';
export const FIRST_READ_CORRECT_REASON = '#7701 first-read lane correction';
/** The holds that mean "published as scans, OCR not read yet" (the brief's four; GPU_LANE_HOLDS less the wave-b hold). */
export const FIRST_READ_HOLDS = Object.freeze(['scans-only-publish-7176', 'acquisition-wave-2026-10-images-only', 'warehouse-promotion-5470', 'scans-only-publish-7270']);
/** The routed models that mean a print route: flash-lite (Latin-script print) and Flash (print in the flash families). */
export const PRINT_ROUTE_MODELS = Object.freeze([OCR_MODEL_LITE, OCR_MODEL_FLASH]);
/** Languages read 4 pages a call (#7522 held quality on German and Latin print; French by the #7701 cheap-routes cell test,
 * 2026-10-29: read@4 24/24 written, 0 wrong text, against read@1's 20/21, 1 wrong text); every other language reads 1. */
export const FIRST_READ_PER_CALL_LANGUAGES = Object.freeze(['lat', 'deu', 'fra']);
/** Languages read MORE pages a call than --per-call, when --per-call > 1 (so --per-call=1 still reads one). German 8
 * (#6740 read-surface, Derek 2026-11-01): on 78 German queue books 8 a call beat 4 paired 8-1 at about half the quota a
 * accepted page; neither preregistered rule passed, so it runs as a decision under a router waiver (current.json), and the
 * lane's acceptance k/n is the stop: back to 4 if it falls below live's. Latin stays 4 (8 reads long s as f). */
export const FIRST_READ_PER_CALL_BY_LANGUAGE = Object.freeze({ deu: 8 });
/** Pages a call for a first read in `lang` under `--per-call=perCall`. */
export function firstReadPerCall(lang, perCall) {
  if (!(perCall > 1) || !FIRST_READ_PER_CALL_LANGUAGES.includes(lang)) return 1;
  return Math.max(perCall, FIRST_READ_PER_CALL_BY_LANGUAGE[lang] ?? perCall);
}
/** The languages read first after books with no OCR (the order before French moved to 4 a call). */
const FIRST_READ_FIRST_LANGUAGES = Object.freeze(['lat', 'deu']);
/** Libraries whose held, unread books here are manuscripts and archival hands (census 2026-10-29: Vat.sir., Cod. Pal., Universitätsarchiv). */
export const MANUSCRIPT_PROVIDERS = Object.freeze(['vatican', 'heidelberg', 'morgan', 'museumsofindia']);
const MANUSCRIPT_TITLE = /\bmanuscripts?\b|\bMS\.?\s?[A-Z]*\s?\d|\bcodex\b|\bmss?\b|\bcod\.\s|handschrift|\bVat\.\s?[a-z]+\.\s?\d/i;

/** The book's first language code, ISO 639-3 (`Latin` and `la` alike → 'lat'), or null. */
export const firstReadLanguage = (book) => toLanguageCodes(book?.language).codes[0] ?? null;

/** Why this book may be handwritten (a sentence), or null. Book-level only; the reader's <script> tag decides per page. */
export function manuscriptReason(book) {
  const provider = String(book?.image_source?.provider || '').toLowerCase();
  if (MANUSCRIPT_PROVIDERS.includes(provider)) return `manuscript library (${provider})`;
  if (MANUSCRIPT_TITLE.test(String(book?.title || ''))) return 'manuscript by title';
  const year = /\b(\d{4})\b/.exec(String(book?.published || ''))?.[1];
  if (year && +year < 1450) return `published ${year}: before print`;
  return null;
}

/**
 * Why the first-read lane does not read this book (a short key for `count`), or null. `languages`: codes the run reads
 * (null = every language). Book-level: the page-level spread check (spreadReason) runs on the unread pages.
 */
export function firstReadSkip(book, { languages = null } = {}) {
  const pa = book?.pipeline_auto ?? {};
  if (!book?.visible || !(book.pages_count > 0)) return 'not visible';
  if (pa.status !== HOLD_STATUS || !pa.hold) return 'not held: the pipeline owns it';
  if (pa.held === true) return 'pipeline_auto.held';
  if (!FIRST_READ_HOLDS.includes(pa.hold.reason)) return `other hold (${pa.hold.reason})`;
  if (isUnsplitSpread(book)) return 'unsplit spread (needs_splitting)';
  if (manuscriptReason(book)) return 'manuscript';
  const { model } = ocrLaneForBook(book);
  if (!PRINT_ROUTE_MODELS.includes(model)) return `route ${model}: not a print route`;
  if (languages && !languages.includes(firstReadLanguage(book))) return 'language not in --languages';
  return null;
}

/** Books with no OCR first, then Latin and German, then processing_priority, then the fewest pages read, then id. */
export const byFirstReadOrder = (a, b) => ((a.pages_ocr ?? 0) > 0) - ((b.pages_ocr ?? 0) > 0)
  || !FIRST_READ_FIRST_LANGUAGES.includes(firstReadLanguage(a)) - !FIRST_READ_FIRST_LANGUAGES.includes(firstReadLanguage(b))
  || (b.processing_priority ?? 0) - (a.processing_priority ?? 0)
  || (a.pages_ocr ?? 0) - (b.pages_ocr ?? 0)
  || String(a.id).localeCompare(String(b.id));

/** The Mongo selector the run reads from: firstReadSkip's book-level rules that a query can carry. */
export const FIRST_READ_BOOKS = Object.freeze({
  visible: true, pages_count: { $gt: 0 }, 'pipeline_auto.status': HOLD_STATUS, 'pipeline_auto.hold.reason': { $in: FIRST_READ_HOLDS },
  'pipeline_auto.held': { $ne: true }, ...NOT_UNSPLIT_SPREAD, $expr: { $lt: [{ $ifNull: ['$pages_ocr', 0] }, '$pages_count'] },
});
const FIRST_READ_PROJECTION = { id: 1, title: 1, language: 1, published: 1, visible: 1, pages_count: 1, pages_ocr: 1, processing_priority: 1, image_source: 1, needs_splitting: 1, split_completed: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, 'pipeline_auto.held': 1, 'pipeline_auto.split_checked': 1 };

/** The quota flags every agy lane here shares (QUOTA FLOOR and POOL in the header), validated; exits 2 on a bad one. */
function quotaFlags(arg) {
  const FLOOR5H = Number(arg('floor-5h') ?? 0.25), WEEKLY_END = Number(arg('weekly-end') ?? 0);
  if (!(WEEKLY_END >= 0 && WEEKLY_END < 1)) { console.error('--weekly-end must be in [0, 1)'); process.exit(2); }
  const PACE_OFF_UNTIL = arg('pace-off-until') ? Date.parse(arg('pace-off-until')) : null;
  if (PACE_OFF_UNTIL !== null && !Number.isFinite(PACE_OFF_UNTIL)) { console.error('--pace-off-until must be an ISO time'); process.exit(2); }
  return { floor5h: FLOOR5H, weeklyEnd: WEEKLY_END, paceOffUntil: PACE_OFF_UNTIL };
}

async function firstReadMain(mode, arg) {
  const APPLY = process.argv.includes('--apply');
  const OUT = arg('out') && path.resolve(arg('out'));
  if (mode === 'run' && !OUT) { console.error('run needs --out=DIR'); process.exit(2); }
  const LEDGER = arg('ledger') || (OUT ? path.join(path.dirname(OUT), 'first-read-ledger.jsonl') : null);
  const BOOKS_SKIPPED = LEDGER ? path.join(path.dirname(LEDGER), 'first-read-books-skipped.jsonl') : null;
  const LANGS = arg('languages') ? arg('languages').split(',').map((l) => toLanguageCodes(l).codes[0] ?? l) : null;
  // --correct=deu[,…]: the languages whose first reads get the second pass (the router picks it per cell, #7701 arm B)
  const CORRECT_LANGS = arg('correct') ? arg('correct').split(',').map((l) => toLanguageCodes(l).codes[0] ?? l) : [];
  if (mode === 'run') await routeCheck(servedByFirstRead({ languages: LANGS, correct: CORRECT_LANGS, perCall: Number(arg('per-call') || 1), perCallLanguages: FIRST_READ_PER_CALL_LANGUAGES, perCallByLanguage: FIRST_READ_PER_CALL_BY_LANGUAGE }), arg);
  const ONLY = arg('book') ? new Set(arg('book').split(',')) : null;
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const ledger = new Set(), tailState = { offset: 0 };
  ledgerTail(LEDGER, ledger, tailState);
  const skippedBooks = readLedger(BOOKS_SKIPPED);   // rows carry page_id = the book id
  const unreadPages = (b) => db.collection('pages').find({ book_id: b.id, ...UNREAD }, { projection: { id: 1, page_number: 1, crop: 1, cropped_photo: 1, split_from_spread: 1 } }).sort({ page_number: 1 }).toArray();

  if (mode === 'count') {
    // Every visible book with unread pages that is held or has no OCR at all, by the reason the lane skips it; pages
    // are estimated from the counters (pages_count - pages_ocr), so the count is a few queries, not one per book.
    const books = (await db.collection('books').find(
      { visible: true, pages_count: { $gt: 0 }, $expr: { $lt: [{ $ifNull: ['$pages_ocr', 0] }, '$pages_count'] }, $or: [{ 'pipeline_auto.status': HOLD_STATUS }, { pages_ocr: { $in: [0, null] } }] },
      { projection: FIRST_READ_PROJECTION },
    ).toArray()).filter((b) => !ONLY || ONLY.has(b.id));
    const why = new Map(books.map((b) => [b.id, firstReadSkip(b, { languages: LANGS }) ?? (skippedBooks.has(b.id) ? 'skipped: reader tagged it handwritten' : null)]));
    // The page-level spread check (spreadReason) for the books still in: a book is in only if Phase 1.25 checked it
    // or some page carries crop data.
    const unchecked = books.filter((b) => !why.get(b.id) && !b.pipeline_auto?.split_checked).map((b) => b.id);
    const cropped = new Set();
    for (let i = 0; i < unchecked.length; i += 300) {
      for (const id of await db.collection('pages').distinct('book_id', { book_id: { $in: unchecked.slice(i, i + 300) }, $or: [{ crop: { $exists: true, $ne: null } }, { cropped_photo: { $exists: true, $nin: [null, ''] } }, { split_from_spread: { $exists: true } }] })) cropped.add(id);
    }
    for (const id of unchecked) if (!cropped.has(id)) why.set(id, 'possible unsplit spreads (not split_checked, no crop data, #523)');
    const t = {};
    for (const b of books) {
      const k = why.get(b.id) ? `skip: ${why.get(b.id)}` : `read: ${b.pages_ocr ? 'partly read' : 'no OCR'}`;
      const lang = firstReadLanguage(b) ?? String(b.language ?? '?');
      t[k] ??= { books: 0, pages_est: 0, by_language: {} };
      const u = Math.max(0, b.pages_count - (b.pages_ocr ?? 0));
      t[k].books++; t[k].pages_est += u;
      (t[k].by_language[lang] ??= { books: 0, pages_est: 0 }); t[k].by_language[lang].books++; t[k].by_language[lang].pages_est += u;
    }
    console.log(`first-read cohort (${FIRST_READ_LANE}): ${books.length} visible books with unread pages, held or with no OCR${LANGS ? `; --languages=${LANGS.join(',')}` : ''}; ${ledger.size} page(s) ledgered`);
    for (const [k, v] of Object.entries(t).sort((a, b) => b[1].pages_est - a[1].pages_est)) {
      const top = Object.entries(v.by_language).sort((a, b) => b[1].pages_est - a[1].pages_est).slice(0, 8).map(([l, x]) => `${l} ${x.books}/${x.pages_est}`).join(', ');
      console.log(`  ${k.padEnd(72)} ${String(v.books).padStart(6)} books ${String(v.pages_est).padStart(9)} pages  [${top}]`);
    }
    await client.close(); return;
  }

  const books = (await db.collection('books').find(FIRST_READ_BOOKS, { projection: FIRST_READ_PROJECTION }).toArray())
    .filter((b) => (!ONLY || ONLY.has(b.id)) && !skippedBooks.has(b.id) && !firstReadSkip(b, { languages: LANGS })).sort(byFirstReadOrder);
  const MAX = Number(arg('max-pages') || 400), MAX_BOOKS = Number(arg('max-books') || Infinity), CHUNK = Number(arg('book-chunk') || 40);
  const QF = quotaFlags(arg);
  const int = (name, dflt, hi) => { const v = Number(arg(name) || dflt); if (!(Number.isInteger(v) && v >= 1 && v <= hi)) { console.error(`--${name} must be 1 to ${hi}`); process.exit(2); } return v; };
  const PER_CALL = int('per-call', 1, 4), CONCURRENCY = int('concurrency', 1, 8);
  const want = parseAgyHome(arg('agy-home'));
  let HOME = want.home ?? null;
  if (want.auto) {
    const toBuckets = (r) => [{ id: 'gemini-weekly', remaining_fraction: r.weekly, reset_time: r.weeklyReset }, { id: 'gemini-5h', remaining_fraction: r.fiveHour }];
    const pick = choosePool(readPools(), (r) => { const q = quotaFloor(toBuckets(r), QF); return { open: q.ok, why: q.why }; });
    if (!pick) { console.log('run: no pool has its floor open; nothing read'); await client.close(); return; }
    HOME = pick.home;
  } else if (HOME && !fs.existsSync(HOME)) { console.error(`--agy-home: ${HOME} does not exist`); await client.close(); process.exit(2); }
  const POOL = poolName({ home: HOME });
  const CHILD_ENV = agyEnv(HOME, process.env, { AGY_JOB: 'cli-ocr-first-read-7701' });
  const CLAIMS_DIR = path.join(path.dirname(LEDGER), 'claims-first-read');
  const ME = { pid: process.pid, pool: POOL, lane: FIRST_READ_LANE };
  const held = new Set();
  process.on('exit', () => { for (const id of held) releaseBookClaim(CLAIMS_DIR, id); });
  const DEADLINE = arg('deadline-min') ? Date.now() + Number(arg('deadline-min')) * 60_000 : Infinity;
  const job = `cli-ocr-first-read-${new Date().toISOString().slice(0, 10)}`;
  fs.mkdirSync(OUT, { recursive: true });
  // The second pass's template: the #5924 one-page template the correction lane sends, built once per day folder.
  const TPL = path.join(OUT, 'fc-correct-prompt.txt');
  if (CORRECT_LANGS.length && !fs.existsSync(TPL)) {
    const r = spawnSync(process.execPath, [path.join(HERE, '../eval/flash-reread-5924/fc-prompt.mjs'), TPL], { stdio: 'inherit', env: process.env });
    if (r.status !== 0) { console.error('fc-prompt.mjs refused: the correction template could not be built; nothing read'); await client.close(); process.exit(1); }
  }
  console.log(`run --cohort=${FIRST_READ_COHORT}: pool ${POOL}; ${books.length} books in frame${LANGS ? ` (${LANGS.join(',')})` : ''}, up to ${MAX} pages${Number.isFinite(MAX_BOOKS) ? ` in ${MAX_BOOKS} books` : ''}, ${CONCURRENCY} book(s) at a time, ${CHUNK} pages a chunk, ${FIRST_READ_PER_CALL_LANGUAGES.map((l) => `${l} ${firstReadPerCall(l, PER_CALL)}`).join(', ')} a call${Number.isFinite(DEADLINE) ? `, no new chunk after ${new Date(DEADLINE).toISOString()}` : ''}`);
  let budget = MAX, stop = null, bi = 0, booksTaken = 0;
  const tally = { written: 0, handwritten: 0, has_ocr_now: 0, failed: 0, other: 0, books: 0, books_skipped_handwritten: 0, spread_wait: 0, corrected: 0, correct_unchanged: 0, correct_other: 0 };
  const nextChunk = async () => {
    while (bi < books.length) {
      if (booksTaken >= MAX_BOOKS) return null;
      const b = books[bi++];
      if (!claimBook(CLAIMS_DIR, b.id, ME)) continue;  // another live run is on this book
      held.add(b.id);
      ledgerTail(LEDGER, ledger, tailState);
      const pages = await unreadPages(b);
      const spread = spreadReason(b, pages);
      const open = pages.filter((p) => !ledger.has(p.id));
      if (open.length && !spread) { booksTaken++; return { book: b, open }; }
      if (spread && open.length) tally.spread_wait++;
      releaseBookClaim(CLAIMS_DIR, b.id); held.delete(b.id);
    }
    return null;
  };
  const worker = async () => {
    while (!stop) {
      if (budget <= 0) { stop ??= 'page budget spent'; break; }
      if (Date.now() >= DEADLINE) { stop ??= 'deadline'; break; }
      const q = quotaFloor(readQuota(HOME), QF);
      if (!q.ok) { stop ??= `quota floor: ${q.why}`; break; }
      const c = await nextChunk();
      if (!c) { stop ??= 'queue empty'; break; }
      const { book } = c;
      const release = () => { releaseBookClaim(CLAIMS_DIR, book.id); held.delete(book.id); };
      if (budget <= 0) { release(); stop ??= 'page budget spent'; break; }
      const take = c.open.slice(0, Math.min(CHUNK, budget));
      budget -= take.length;
      tally.books++;
      const { model: routed } = ocrLaneForBook(book);
      const perCall = perCallFor(book, { perCall: firstReadPerCall(firstReadLanguage(book), PER_CALL) });
      const tag = CONCURRENCY > 1 ? `[${book.id.slice(-6)}] ` : '';
      const dir = path.join(OUT, book.id);
      fs.mkdirSync(dir, { recursive: true });
      const ids = path.join(dir, `page-ids-${Date.now()}.json`);
      fs.writeFileSync(ids, JSON.stringify(take.map((p) => p.id)));
      console.log(`\n${tag}${book.id} ${String(book.title || '').slice(0, 40)} (${book.language}, ${book.pages_ocr ?? 0}/${book.pages_count} read, hold ${book.pipeline_auto.hold.reason}): ${take.length} of ${c.open.length} pages, ${perCall}/call; pool ${POOL} weekly ${(100 * q.weekly).toFixed(1)}% (line ${(100 * q.line).toFixed(1)}%), 5h ${(100 * q.five_h).toFixed(1)}%`);
      const read = await run([path.join(HERE, 'cli-ocr.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${FIRST_READ_MODEL}`, `--job=${job}`, '--stop-on-quota',
        ...(perCall > 1 ? [`--per-call=${perCall}`] : [])], tag, CHILD_ENV);
      if (read === 3) { release(); stop ??= 'quota'; console.log(`${tag}quota reached: stopping; the next run resumes`); break; }
      if (read !== 0) { release(); console.log(`${tag}  reader exited ${read}: chunk skipped this run`); continue; }
      const reason = `${FIRST_READ_REASON}: visible book held ${book.pipeline_auto.hold.reason} (the hold stays), routed ${routed}, first read by ${FIRST_READ_MODEL} through agy${perCall > 1 ? `, ${perCall} pages a call (#7522)` : ''}`;
      const t0 = Date.now();
      const applied = await run([path.join(HERE, 'cli-ocr.mjs'), 'apply', `--out=${dir}`, `--only=${ids}`, `--reason=${reason}`, `--lane=${FIRST_READ_LANE}`, '--first-read-only', '--print-only', ...(APPLY ? ['--apply'] : [])], tag, CHILD_ENV);
      if (!APPLY || applied !== 0) { release(); continue; }
      const summaryFile = fs.readdirSync(dir).filter((f) => /^apply-summary-(?!dry|refused).*\.json$/.test(f)).map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).mtimeMs >= t0).sort().pop();
      const sum = summaryFile ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : {};
      const written = new Set(sum.written_page_ids || []);
      let hand = 0;
      for (const p of take) {
        const why = written.has(p.id) ? 'written' : sum.skipped_pages?.[p.id] ?? 'not_read';
        const k = why === 'written' ? 'written' : /--print-only/.test(why) ? 'handwritten' : /has OCR now/.test(why) ? 'has_ocr_now' : /cli exit|empty read|refus|wrapper|not_read/.test(why) ? 'failed' : 'other';
        if (k === 'handwritten') hand++;
        tally[k]++;
        fs.appendFileSync(LEDGER, JSON.stringify({ page_id: p.id, book_id: book.id, page_number: p.page_number, outcome: k, why, run: sum.run ?? null, pool: POOL, at: new Date().toISOString() }) + '\n');
        ledger.add(p.id);
      }
      // A book the reader tags mostly handwritten is not this lane's: its other pages are not read again (the gpu-correct rule).
      if (hand * 2 >= take.length && take.length >= 4) { tally.books_skipped_handwritten++; fs.appendFileSync(BOOKS_SKIPPED, JSON.stringify({ page_id: book.id, why: `reader tagged ${hand}/${take.length} pages not printed`, at: new Date().toISOString() }) + '\n'); console.log(`${tag}  book skipped from now on: ${hand}/${take.length} pages not printed`); }
      // The second pass (--correct): the pages just written, corrected by the correction lane's own read and apply
      // (cli-ocr.mjs --correct-prompt on the stored first read, the image; UNCHANGED, CONTAIN or a > 25% change leaves the
      // first read), stamped FIRST_READ_CORRECT_LANE. A quota stop leaves the first read standing.
      if (CORRECT_LANGS.includes(firstReadLanguage(book)) && written.size) {
        const cdir = path.join(dir, 'correct');
        fs.mkdirSync(cdir, { recursive: true });
        const cids = path.join(cdir, `page-ids-${Date.now()}.json`);
        fs.writeFileSync(cids, JSON.stringify([...written]));
        const cread = await run([path.join(HERE, 'cli-ocr.mjs'), 'read', `--page-ids-file=${cids}`, `--out=${cdir}`, `--model=${FIRST_READ_MODEL}`, `--correct-prompt=${TPL}`, `--lane=${FIRST_READ_CORRECT_LANE}`, `--job=${job}`, '--stop-on-quota'], tag, CHILD_ENV);
        if (cread === 0) {
          const t1 = Date.now();
          const creason = `${FIRST_READ_CORRECT_REASON}: the first read (${FIRST_READ_LANE}) corrected by ${FIRST_READ_MODEL} through agy with the image (the #7558 template; #7701 arm B, the router's pick for ${firstReadLanguage(book)})`;
          const capplied = await run([path.join(HERE, 'cli-ocr.mjs'), 'apply', `--out=${cdir}`, `--only=${cids}`, `--reason=${creason}`, ...(APPLY ? ['--apply'] : [])], tag, CHILD_ENV);
          const cf = capplied === 0 && APPLY ? fs.readdirSync(cdir).filter((f) => /^apply-summary-(?!dry|refused).*\.json$/.test(f)).map((f) => path.join(cdir, f)).filter((f) => fs.statSync(f).mtimeMs >= t1).sort().pop() : null;
          const cs = cf ? JSON.parse(fs.readFileSync(cf, 'utf8')) : {};
          for (const id of written) { const w = (cs.written_page_ids || []).includes(id) ? 'corrected' : /UNCHANGED/.test(cs.skipped_pages?.[id] ?? '') ? 'correct_unchanged' : 'correct_other'; tally[w]++; }
          for (const cl of cs.contain_claims || []) fs.appendFileSync(path.join(path.dirname(LEDGER), 'first-read-contain-claims.jsonl'), JSON.stringify({ ...cl, at: new Date().toISOString(), lane: FIRST_READ_CORRECT_LANE }) + '\n');
        } else if (cread === 3) { stop ??= 'quota'; console.log(`${tag}quota reached in the second pass: the first reads stand; stopping`); }
        for (const id of written) fs.rmSync(path.join(cdir, `ws-${id}`), { recursive: true, force: true });
      }
      // Ledgered: the page images are not needed again (apply checked the image hash; provenance keeps the prompt). #6223.
      for (const p of take) fs.rmSync(path.join(dir, `ws-${p.id}`), { recursive: true, force: true });
      release();
      console.log(`${tag}  ${JSON.stringify(tally)}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\nfirst-read run ended (pool ${POOL}): ${stop ?? 'done'}; ${MAX - budget} page(s) taken; ${JSON.stringify(tally)}`);
  fs.appendFileSync(path.join(path.dirname(LEDGER), 'first-read-runs.jsonl'), JSON.stringify({ at: new Date().toISOString(), pool: POOL, apply: APPLY, stop: stop ?? 'done', taken: MAX - budget, ...tally }) + '\n');
  await client.close();
}

async function main() {
  const mode = process.argv[2];
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  if (mode === 'correct' || mode === 'correct-count') return correctMain(mode, arg);
  if (mode === 'gpu-correct' || mode === 'gpu-count') return gpuMain(mode, arg);
  if (/^armc(-(plan|fetch|collect|count|left))?$/.test(mode)) return armcMain(mode, arg);
  if ((mode === 'run' || mode === 'count') && arg('cohort')) {
    if (arg('cohort') !== FIRST_READ_COHORT) { console.error(`--cohort: the only cohort is ${FIRST_READ_COHORT}`); process.exit(2); }
    return firstReadMain(mode, arg);
  }
  if (!['count', 'run'].includes(mode)) { console.error('usage: cli-ocr-lane.mjs count | run --out=DIR [--max-pages=120] [--book=ID] [--apply] | count --cohort=visible-unread | run --cohort=visible-unread --out=DIR [--apply] | correct-count | correct --out=DIR [--apply]'); process.exit(2); }
  const APPLY = process.argv.includes('--apply');
  const OUT = arg('out') && path.resolve(arg('out'));
  const LEDGER = arg('ledger') || (OUT ? path.join(path.dirname(OUT), 'cli-ocr-ledger.jsonl') : null);
  if (mode === 'run' && !OUT) { console.error('run needs --out=DIR'); process.exit(2); }
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const ledger = LEDGER ? readLedger(LEDGER) : new Set();

  const ONLY_BOOK = arg('book');
  const books = (await heldBooks(db)).filter((b) => !ONLY_BOOK || b.id === ONLY_BOOK);
  const plan = [];
  for (const book of books) {
    const lane = ocrLaneForBook(book);
    const pages = await db.collection('pages').find({ book_id: book.id, ...UNREAD }, { projection: { id: 1, page_number: 1, crop: 1, cropped_photo: 1, split_from_spread: 1 } }).sort({ page_number: 1 }).toArray();
    plan.push({ book, lane, cliModel: CLI_MODEL_FOR[lane.model] ?? null, spread: spreadReason(book, pages), pages, open: pages.filter((p) => !ledger.has(p.id)) });
  }
  const tally = {};
  for (const r of plan) {
    const k = r.lane.channel !== 'cli' ? 'now api channel: release' : r.spread ? 'spread book: waits for a spread read' : r.cliModel ? `${r.book.language ?? '?'} → ${r.cliModel}` : `no CLI model for ${r.lane.model}: waits`;
    tally[k] ??= { books: 0, pages: 0, ledgered: 0, visible: 0 };
    tally[k].books++; tally[k].pages += r.open.length; tally[k].ledgered += r.pages.length - r.open.length; tally[k].visible += r.book.visible ? 1 : 0;
  }
  console.log(`books held for the CLI OCR lane (${CLI_FLASH_OCR_HOLD.reason}): ${books.length}`);
  for (const [k, t] of Object.entries(tally)) console.log(`  ${k.padEnd(48)} ${String(t.books).padStart(4)} books (${t.visible} visible) · ${String(t.pages).padStart(6)} pages to read · ${t.ledgered} ledgered`);
  for (const r of plan.filter((x) => x.open.length === 0 && x.pages.length > 0)) console.log(`  stuck: ${r.book.id} ${String(r.book.title || '').slice(0, 50)} — ${r.pages.length} ledgered page(s) only; look at ${LEDGER ?? 'the ledger'}`);
  for (const r of plan.filter((x) => x.spread && x.pages.length)) console.log(`  spread: ${r.book.id} ${String(r.book.title || '').slice(0, 50)} — ${r.spread}`);
  if (mode === 'count') { await client.close(); return; }

  const MAX = Number(arg('max-pages') || 120);
  const int14 = (name, dflt) => { const v = Number(arg(name) || dflt); if (!(Number.isInteger(v) && v >= 1 && v <= 4)) { console.error(`--${name} must be 1 to 4`); process.exit(2); } return v; };
  const PER_CALL = int14('per-call', 1), PER_CALL_ARABIC = int14('per-call-arabic', 1), CONCURRENCY = int14('concurrency', 1);
  const VARIANT = arg('prompt-variant');
  const DEADLINE = arg('deadline-min') ? Date.now() + Number(arg('deadline-min')) * 60_000 : Infinity;
  const job = `cli-ocr-lane-${new Date().toISOString().slice(0, 10)}`;
  let budget = MAX, stop = null;
  console.log(`run: up to ${MAX} pages, ${CONCURRENCY} book(s) at a time, ${PER_CALL}/call (Arabic ${PER_CALL_ARABIC}/call)${VARIANT ? `, prompt ${VARIANT}` : ''}${Number.isFinite(DEADLINE) ? `, no new book after ${new Date(DEADLINE).toISOString()}` : ''}`);
  // Releases first, in order (no read, no quota): then the books to read go to the workers.
  const toRead = [];
  for (const r of plan) {
    const { book, lane, cliModel } = r;
    const label = `${book.id} ${String(book.title || '').slice(0, 40)}`;
    if (lane.channel !== 'cli') {
      console.log(`\n${label}: now routed to ${lane.model} on the API channel; releasing to the Batch lanes`);
      if (APPLY) console.log(`  ${JSON.stringify(await releaseBook(db, book.id, { note: `ocr routing now sends this book to ${lane.model} (API channel)`, source: 'cli-ocr-lane' }))}`);
      continue;
    }
    if (r.pages.length === 0) {
      console.log(`\n${label}: nothing left to read; releasing`);
      if (APPLY) console.log(`  ${JSON.stringify(await releaseBook(db, book.id, { note: 'every unread page read by the CLI OCR lane (#7089)', source: 'cli-ocr-lane' }))}`);
      continue;
    }
    if (r.spread) continue;
    if (!cliModel || r.open.length === 0) continue;
    toRead.push(r);
  }
  const readBook = async (r) => {
    const { book, lane, cliModel } = r;
    const tag = CONCURRENCY > 1 ? `[${book.id.slice(-6)}] ` : '';
    const label = `${book.id} ${String(book.title || '').slice(0, 40)}`;
    const take = r.open.slice(0, budget);
    budget -= take.length;
    const perCall = perCallFor(book, { perCall: PER_CALL, perCallArabic: PER_CALL_ARABIC });
    const dir = path.join(OUT, book.id);
    fs.mkdirSync(dir, { recursive: true });
    const ids = path.join(dir, 'page-ids.json');
    fs.writeFileSync(ids, JSON.stringify(take.map((p) => p.id)));
    console.log(`\n${tag}${label}: ${take.length} of ${r.open.length} pages on ${cliModel} (routed ${lane.model}), ${perCall}/call`);
    const read = await run([path.join(HERE, 'cli-ocr.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${cliModel}`, `--job=${job}`, '--stop-on-quota',
      ...(perCall > 1 ? [`--per-call=${perCall}`] : []), ...(VARIANT ? [`--prompt-variant=${VARIANT}`] : [])], tag);
    if (read === 3) { stop ??= 'quota'; console.log(`${tag}quota reached: stopping; the next run resumes`); return; }
    if (read !== 0) { console.log(`${tag}  reader exited ${read}: book skipped this run`); return; }
    const reason = `#7089 CLI OCR lane: routed ${lane.model}, read by ${cliModel} through agy (agy offers no 3 Flash)${perCall > 1 ? `, ${perCall} pages a call (#7558)` : ''}`;
    const applied = await run([path.join(HERE, 'cli-ocr.mjs'), 'apply', `--out=${dir}`, `--reason=${reason}`, ...(APPLY ? ['--apply'] : [])], tag);
    if (!APPLY || applied !== 0) return;
    // What this run tried and could not write goes to the ledger, so it is not read again every run.
    const left = new Set((await db.collection('pages').find({ id: { $in: take.map((p) => p.id) }, ...UNREAD }, { projection: { id: 1 } }).toArray()).map((p) => p.id));
    for (const p of take.filter((x) => left.has(x.id))) {
      let meta = null;
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, `${p.id}.meta.json`), 'utf8')); } catch { /* not read */ }
      fs.appendFileSync(LEDGER, JSON.stringify({ page_id: p.id, book_id: book.id, page_number: p.page_number, model: cliModel, exit: meta?.exit ?? null, error_class: meta?.error_class ?? (meta ? 'not_written' : 'not_read'), at: new Date().toISOString() }) + '\n');
    }
    if (left.size) console.log(`${tag}  ${left.size} page(s) not written: ledgered, not retried`);
    const remaining = await db.collection('pages').countDocuments({ book_id: book.id, ...UNREAD });
    if (remaining === 0) console.log(`${tag}  released: ${JSON.stringify(await releaseBook(db, book.id, { note: 'every unread page read by the CLI OCR lane (#7089)', source: 'cli-ocr-lane' }))}`);
  };
  const queue = [...toRead];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length && !stop) {
      if (budget <= 0) { stop ??= 'page budget spent'; break; }
      if (Date.now() >= DEADLINE) { stop ??= 'deadline'; break; }
      await readBook(queue.shift());
    }
  }));
  console.log(`\nrun ended: ${stop ?? 'queue empty'}; ${MAX - budget} page(s) taken, ${queue.length} book(s) left for the next run`);
  await client.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
