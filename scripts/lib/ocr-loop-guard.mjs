/**
 * PRIOR ART: scripts/lib/blank-page-guard.mjs — same write-boundary shape (screen the
 * response, refuse on positive evidence, record the refusal), but a different failure:
 * that guard needs the page IMAGE to tell a fabrication from a reading, because the
 * fabricated text looks like ordinary prose. A degeneration loop is visible in the text
 * alone, so this one needs no fetch and cannot fail open on a network blip.
 * scripts/audit/detect-fabricated-ocr.mjs uses repetition only as a WEAK supporting
 * signal for the blank-leaf class (measured 0 confirmed of 316) — it looks for a repeated
 * OPENING across pages; this measures the repeat WITHIN one page.
 *
 * Write-time guard: refuse OCR that degenerated into a repetition loop (#4850).
 *
 * THE FAILURE THIS STOPS
 * ----------------------
 * Handed a page it cannot read, the model sometimes stops transcribing and starts
 * repeating: one syllable, or one 14-character run, emitted until the output cap.
 * On `Kidung Panji Malat Rasmi` (Balinese lontar, 423 pages) that happened on more
 * than a third of the book — three pages ran to the full 18,000-character cap — and
 * the pipeline stored every one of them and marked the book `translate_complete`.
 *
 * The stored loop is not merely useless. 102 of those pages were then TRANSLATED,
 * and a model handed a loop writes fluent connected prose with no basis in the page
 * (#4765, where every fabrication in the #4759 read came from a looping input).
 * So the loop is the upstream half of a fabrication, which is why it is refused at
 * the write boundary rather than filtered at read time.
 *
 * WHY NOT THE EXISTING LENGTH GUARD
 * `batch-collector.mjs` drops responses over HALLUCINATION_LIMIT (25,000 chars).
 * A loop only trips that if it runs long enough: the Kidung loops were 700–18,000
 * characters, and 153 of the 156 sat under the limit. Length measures the runaway,
 * not the repetition.
 *
 * WHAT IT MEASURES
 * The largest run anywhere in the transcription body that is an exact repetition of
 * one unit — `(unit)^k` — as a share of the body. This is script-agnostic: it counts
 * code points, so it works identically on Balinese aksara, Tibetan and Latin, where a
 * word-token ratio silently reads a spaceless script as ONE token (#4806).
 *
 * THE TRAP, AND THE POSITIVE CONTROL
 * We hold genuinely repetitive text: litanies, mantra repetition, `mani` sequences,
 * a psalter refrain. A gate tuned on the loop alone would withhold exactly the
 * material this library exists to serve. So the thresholds below were fixed against
 * real repetitive pages, not just against loops — see tests/unit/ocr-loop-guard.test.ts,
 * whose control cases are genuine repetition that MUST pass. Two properties keep them
 * apart: genuine repetition repeats a unit with variation between repeats (a new name
 * in each line of a litany, a verse number, OCR noise), and it does not run for
 * thousands of consecutive characters without a break.
 *
 * Kill switch: OCR_LOOP_GUARD=off disables it (writes proceed unchecked).
 */
import { transcriptionBody } from './blank-page-guard.mjs';
import { randomBytes } from 'node:crypto';

/** Characters of body text below which a page cannot be judged (a short page repeating
 *  a colophon formula is normal; a loop is a runaway). */
export const DEFAULT_MIN_BODY = 300;
/** Code points the repeating run must cover before it counts as a loop. */
export const DEFAULT_MIN_RUN = 240;
/** Share of the body the run must cover. Below half, the page still carries reading. */
export const DEFAULT_MIN_SHARE = 0.5;
/** Repetitions of the unit. A refrain repeated four times is a refrain. */
export const DEFAULT_MIN_REPS = 6;
/** Longest repeating unit considered. Above this the "unit" is a paragraph, and a
 *  repeated paragraph is a different defect (duplicated page text), not a loop. */
const MAX_PERIOD = 200;

/**
 * Collapse whitespace so a loop broken by line wrapping still reads as one run, and
 * collapse LEADER RUNS — `. . . . . .`, `-----`, `______` — to a single character.
 *
 * Leader dots are the first false positive this gate produced: an index page in a
 * Polish botanical work carries a two-character unit (`. `) repeated 4,581 times
 * between the entry and its page number, which is 63% of the page and is ordinary
 * typography, not a degeneration. The repeating unit must carry a letter or digit
 * (see `hasContent`) for the same reason.
 *
 * HTML entities go first, and they are the LARGEST false-positive class: the model
 * lays out tables and figure captions with runs of `&nbsp;`, which is whitespace to a
 * reader but six letters to a repeat metric — 164 of 181 pages in one calibration
 * sample. Same reason `scan-title-mismatch.mjs` strips entities before tokenising.
 */
function normalise(body) {
  return [...body
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    // Editorial placeholders. A page transcribed as `[illegible — 1 line]` fourteen
    // times is the model doing its job, not looping; the marker is apparatus, so it
    // is stripped here exactly as the tags are stripped by `transcriptionBody`.
    .replace(/\[[^\]\n]{0,40}\]/g, ' ')
    .replace(/([.·・‧…\-—_*=~+])(?:[\s]*\1){3,}/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim()];
}

/** Does this repeating unit carry anything a reader could read? */
function hasContent(unit) {
  return /[\p{L}\p{N}]/u.test(unit);
}

/** A run must repeat this many times, and cover this many code points, to be counted
 *  at all. Below either, it is a refrain or a formula, not a degeneration. */
const RUN_MIN_REPS = 5;
const RUN_MIN_CHARS = 80;

/**
 * Every exact periodic run in `cp` worth counting, longest first.
 *
 * Why ALL of them, not just the longest: a two-column lontar page degenerates into a
 * DIFFERENT unit per column, so no single run covers half the page and a longest-run
 * test reads a wholly degenerate page as merely repetitive. On the #4850 exhibit book
 * that was the difference between catching 90 pages and catching 156.
 *
 * O(MAX_PERIOD × n). The cheap screen in `loopVerdict` keeps this off the ~99% of
 * pages that are nowhere near repetitive, so the cost lands only where it is earned.
 */
export function periodicRuns(cp) {
  const n = cp.length;
  const runs = [];
  const push = (p, end, matches) => {
    const chars = matches + p;
    const reps = Math.floor(chars / p);
    if (reps < RUN_MIN_REPS || chars < RUN_MIN_CHARS) return;
    const at = end - chars;
    const unit = cp.slice(at, at + p).join('');
    if (!hasContent(unit)) return;
    runs.push({ period: p, chars, reps, at, unit });
  };
  for (let p = 1; p <= Math.min(MAX_PERIOD, Math.floor(n / 2)); p++) {
    let matches = 0;
    for (let i = 0; i + p < n; i++) {
      if (cp[i] === cp[i + p]) { matches++; continue; }
      if (matches) push(p, i + p, matches);
      matches = 0;
    }
    if (matches) push(p, n, matches);
  }
  return runs.sort((a, b) => b.chars - a.chars);
}

/** Code points covered by the union of `runs` (they overlap across periods). */
export function coveredChars(runs) {
  const iv = runs.map(r => [r.at, r.at + r.chars]).sort((a, b) => a[0] - b[0]);
  let total = 0, end = -1;
  for (const [s, e] of iv) {
    if (e <= end) continue;
    total += e - Math.max(s, end);
    end = e;
  }
  return total;
}

/**
 * Cheap screen: share of distinct 3-grams. A loop reuses the same few trigrams for
 * its whole length, so this falls near zero; ordinary prose in any script stays well
 * above it. Only used to decide whether the exact scan is worth running — never to
 * refuse a page, because a short repetitive-but-genuine page also scores low.
 */
export function distinctTrigramShare(cp) {
  if (cp.length < 3) return 1;
  const seen = new Set();
  for (let i = 0; i + 3 <= cp.length; i++) seen.add(cp[i] + cp[i + 1] + cp[i + 2]);
  return seen.size / (cp.length - 2);
}

/** Screen threshold — generous on purpose: it must not be the thing that decides. */
const SCREEN_MAX = 0.35;

/**
 * The second arm (2026-11-02): one short word or syllable repeated, space-separated,
 * many times IN A ROW — `긇 긇 긇 …`, `ꝑ ꝑ ꝑ …`, `ἦν ἦν ἦν …`, `et et et …`.
 *
 * The share arm misses it two ways, both measured on the corpus mirror that day:
 *  - the run sits inside a page that is otherwise text, so it covers under half the
 *    body (Avicenna, Canon p.592: `ꝑ` 3,051 times in a row, 42% of the page);
 *  - the page is short, or the real text before the run keeps trigram diversity above
 *    the screen, so the exact scan never runs (a Korean manuscript, p.27: 44 × `긇`).
 * Over all 8.4M live OCR pages in the corpus mirror (2026-11-02) this arm refuses 421
 * pages in 178 books that the share arm passes; 386 of them are already translated, and
 * that English has no basis in the page (the Korean p.27 translation explains its filler
 * as "a breakdown in the conversation"). 12 of 12 sampled were degenerate reads, across
 * Latin, Greek, Hebrew, Italian, Dutch and Law French.
 *
 * The false positive found while calibrating, and why runs must cross a line: a TABLE
 * row repeats one sign across its columns (御製歷象考成: `黃道宮 三 三 三 …` ×31), and every
 * Chinese hit at a 25 bar with no line rule was one. A loop runs on over line breaks; a
 * row stops at one. Hence: 25+ across two or more lines, or 60+ on one line.
 * Genuine prose repeats a PHRASE (the share arm's job, and its controls still pass);
 * word-level repeats in print — `hūṃ hūṃ hūṃ`, `sanctus sanctus sanctus` — stop at a few.
 * Known residual: a letter diagram drawn as text (troop formations of `o o o` in
 * Machiavelli's Arte della guerra) can trip it; such a page is rare and the refusal is
 * recorded, not silent.
 */
export const DEFAULT_MIN_TOKEN_RUN = 25;
/** Longest token, in code points, the run arm considers — a syllable or short word. */
const TOKEN_MAX_CP = 4;
/** A run confined to one line must be this long: past any table's column count. */
const ONE_LINE_TOKEN_RUN = 60;

/** Longest run of one identical short letter token, and how many lines it spans. */
export function tokenRun(text) {
  // Lines matter: a TABLE row legitimately repeats one sign across its columns
  // (御製歷象考成: 黃道宮 三 三 三 … thirty times), and it ends at the line break.
  // A loop runs on across lines. So keep line breaks, drop markup.
  const lines = String(text || '').replace(/&[a-z]+;|&#\d+;/gi, ' ').replace(/<[^>]*>/g, ' ').split(/\n/);
  let best = { reps: 0, chars: 0, unit: '', lines: 0 };
  let prev = null, run = 0, startLine = 0;
  lines.forEach((line, li) => {
    for (const t of line.split(/\s+/).filter(Boolean)) {
      if (t === prev) run++; else { prev = t; run = 1; startLine = li; }
      if (run > best.reps && [...t].length <= TOKEN_MAX_CP && /\p{L}/u.test(t)) {
        best = { reps: run, chars: run * ([...t].length + 1), unit: ` ${t}`, lines: li - startLine + 1 };
      }
    }
  });
  return best;
}

export function guardEnabled() {
  return String(process.env.OCR_LOOP_GUARD || '').toLowerCase() !== 'off';
}

/**
 * Is this OCR result a degeneration loop?
 *
 * Returns `{ refuse, reason, share, period, reps, chars, body }`. `refuse` is true
 * only on positive evidence: a body long enough to judge, containing one exact
 * repeating run that covers at least half of it. Everything else — guard disabled,
 * short body, repetition that leaves real text around it — returns refuse:false with
 * a reason, so a caller can log why nothing happened.
 */
export function loopVerdict(text, {
  minBody = DEFAULT_MIN_BODY,
  minRun = DEFAULT_MIN_RUN,
  minShare = DEFAULT_MIN_SHARE,
  minReps = DEFAULT_MIN_REPS,
  minTokenRun = DEFAULT_MIN_TOKEN_RUN,
} = {}) {
  if (!guardEnabled()) return { refuse: false, reason: 'guard_disabled', share: 0, period: 0, reps: 0, chars: 0, body: 0 };

  const cp = normalise(transcriptionBody(text));
  const body = cp.length;
  const tr = tokenRun(text);
  if (tr.reps >= minTokenRun && (tr.lines >= 2 || tr.reps >= ONE_LINE_TOKEN_RUN)) {
    return { refuse: true, reason: 'token_run', share: +(tr.chars / Math.max(1, body)).toFixed(3), covered: tr.chars, body,
      period: tr.unit.length, reps: tr.reps, chars: tr.chars, unit: tr.unit, runs: 1 };
  }
  if (body < minBody) return { refuse: false, reason: 'body_too_short', share: 0, period: 0, reps: 0, chars: 0, body };

  if (distinctTrigramShare(cp) > SCREEN_MAX) {
    return { refuse: false, reason: 'not_repetitive', share: 0, period: 0, reps: 0, chars: 0, body };
  }

  const runs = periodicRuns(cp);
  const top = runs[0] || { period: 0, chars: 0, reps: 0, unit: '' };
  const covered = coveredChars(runs);
  const share = covered / body;
  const out = {
    share: +share.toFixed(3), covered, body,
    period: top.period, reps: top.reps, chars: top.chars, unit: top.unit, runs: runs.length,
  };
  if (covered >= minRun && top.reps >= minReps && share >= minShare) {
    return { refuse: true, reason: 'repetition_loop', ...out };
  }
  return { refuse: false, reason: 'repetition_below_threshold', ...out };
}

/**
 * Record a refusal so it is auditable and countable — never a silent drop, which
 * nothing downstream could tell from "never processed" (the same contract as
 * `recordRefusal` in blank-page-guard.mjs, and the same collection, so both
 * populations read out by `source`).
 */
export async function recordLoopRefusal(db, { pageId, bookId, pageNumber, text, model, verdict, jobId }) {
  try {
    await db.collection('page_revisions').insertOne({
      id: randomBytes(6).toString('hex'),
      page_id: pageId,
      book_id: bookId,
      page_number: pageNumber ?? null,
      field: 'ocr',
      data: text,
      source: 'loop-guard-refused-2026-09',
      model: model ?? null,
      reason: '#4850',
      note: `OCR refused at write time: ${(verdict.share * 100).toFixed(0)}% of the ${verdict.body}-character body is one ${verdict.period}-character unit repeated ${verdict.reps}x (degeneration loop).`,
      batch_job_id: jobId ?? null,
      created_at: new Date(),
    });
    return true;
  } catch (e) {
    console.warn(`[ocr-loop-guard] could not record refusal for ${pageId}: ${e?.message}`);
    return false;
  }
}
