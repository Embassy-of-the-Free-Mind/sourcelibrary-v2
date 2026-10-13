/**
 * PRIOR ART: scripts/maintenance/backfill-book-checks.mjs (#6174 part 1) built these rows inline for the backfill;
 * overview-score.mjs and register.mjs now write the same rows at the end of a run, so the mapping lives here once:
 * a writer and the backfill can never disagree about what a verdict or a serious page is. The write itself is
 * recordBookCheck() in scripts/lib/book-checks.mjs.
 *
 * check-rows — turn a spot-check run's reviews into book_checks inputs (#6174).
 *   seriousPage / seriousClasses   overview-score.mjs's definition of a serious page, and the classes on it
 *   FIT                            shelf-overview's fit_to_show → show | caveat | fix
 *   derivedFortnightly             the fortnightly rule (scripts/eval/methods/fortnightly-spot-check.md)
 *   TIER / notePages / curationReader / curationCheck
 *                                  the curation check (scripts/eval/methods/curation-check.md): tier → verdict, the
 *                                  pages a note names, who read, and one verdict as a book_checks input
 *   pageFindings                   the serious findings per page, for book_checks.page_findings: what a reader's
 *                                  page-level warning is built from (#6199); each carries its KIND (#6203)
 *   pageRecords / packetProvenance the text a run read: the packet's model ids; the packet's TEXT is compared with the
 *                                  page's text now, so a page rewritten after the draw (before or after the review) is
 *                                  changed_since_check, and only an unchanged page gets the page's *_updated_at stamps
 *   checkedAtOf                    when an evidence file was written: the earlier of its git add time and its mtime
 *                                  (a checkout resets mtime; an uncommitted fresh run has no git time)
 *   runCost                        `claude -p` total_cost_usd and model id from run-reviewers.sh's meta/<packet>*.json
 *                                  (what run-cost.py sums), so a row carries its share of the run's cost
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { kindOfFinding } from '../../lib/review-vocabulary.mjs';

const allErrors = (p) => [...(p.ocr_errors || []), ...(p.tr_errors || []), ...(p.other || [])].filter((e) => e && typeof e === 'object');
export const seriousPage = (p) => allErrors(p).some((e) => e.severity === 'serious') || p.right_page === 'no';
export const seriousClasses = (pages) => [...new Set(pages.flatMap((p) => allErrors(p).filter((e) => e.severity === 'serious' && e.class).map((e) => String(e.class))))];

const STAGE = { ocr_errors: 'ocr', tr_errors: 'translation', other: 'other' };
const PROBLEM_MAX = 600;
/**
 * One entry per page that has a serious finding (a serious error, or right_page 'no'); a page read and found clean
 * has no entry, so `[]` means "every page read was free of serious errors". `problem` is the reviewer's own sentence.
 * Pass { withProblem: false } when the evidence file is private (ops:) — the class travels, the sentence does not.
 */
export function pageFindings(pages, { withProblem = true } = {}) {
  const out = [];
  for (const p of pages) {
    const errors = [];
    for (const [key, stage] of Object.entries(STAGE)) {
      for (const e of (p[key] || [])) {
        if (!e || typeof e !== 'object' || e.severity !== 'serious') continue;
        const problem = withProblem && typeof e.problem === 'string' && e.problem.trim() ? e.problem.trim().slice(0, PROBLEM_MAX) : null;
        const kind = kindOfFinding(e);   // the reviewer's own kind, else its class's default (review-vocabulary)
        errors.push({ stage, ...(e.class ? { class: String(e.class) } : {}), ...(kind ? { kind } : {}), ...(problem ? { problem } : {}) });
      }
    }
    const wrongPage = p.right_page === 'no';
    if (errors.length || wrongPage) out.push({ page_number: Number(p.page_number), ...(wrongPage ? { wrong_page: true } : {}), errors });
  }
  return out;
}
export const FIT = { show: 'show', show_with_caveat: 'caveat', do_not_show: 'fix' };

/** The fortnightly rule: stricter than a reviewer's own book verdict. Month 0 predates on_sight_defect. */
export function derivedFortnightly(b) {
  if (b.pages.some(seriousPage)) return 'fix';
  const onSight = 'on_sight_defect' in b ? b.on_sight_defect === true
    : !['yes', 'fits'].includes(b.shelf_fit) || b.pages.some((p) => allErrors(p).some((e) => e.severity === 'moderate'));
  return onSight ? 'caveat' : 'show';
}

// ── curation check (CURATION-ADDENDUM.md verdicts: { book_id, tier, title, note, interest }) ──
export const TIER = { 1: 'show', 2: 'caveat', 3: 'fix' };

/** The page numbers a curation note names (`?page=N`, `p.N`, `pp. N`), ascending. */
export const notePages = (note) => [...new Set([...String(note ?? '').matchAll(/\?page=(\d+)/g), ...String(note ?? '').matchAll(/\bpp?\.\s?(\d+)/g)].map((m) => Number(m[1])))].sort((x, y) => x - y);

const READ_BY = {
  'reviewer by eye': { kind: 'model', model: 'opus', image_opened: true },
  'read from image': { kind: 'model', role: 'session', image_opened: true },
  'earlier session': { kind: 'model', role: 'earlier session' },
};
// The addendum tells a reviewer who could not read the image to say so in the note. Such a read must not be recorded
// as an image read; the sentence is free text, so the row says 'unrecorded' rather than guess false.
const IMAGE_NOT_READ = /(?:could ?n[o']t|cannot|can't|unable to|did not|didn't|failed to) (?:\w+ ){0,3}?(?:read|open|load|fetch|view|see) (?:\w+ ){0,3}?(?:image|scan)|(?:image|scan)s? (?:\w+ ){0,3}?(?:(?:could ?n[o']t|cannot|did not|didn't|failed to) (?:be )?(?:read|open|opened|load|loaded|fetch|fetched)|unreadable|illegible|not readable|fetch failed)|(?:judged |read )?from (?:the )?text (?:alone|only)/i;

/**
 * Who read a curation verdict. `read_by` is the 2026-10-06 Eternity shelf's per-book label; a verdict without one came
 * from a CURATION-ADDENDUM reviewer (`model` = the run's model id when run-reviewers.sh recorded it). Null for a
 * read_by this does not know. An 'earlier session' read is an image read only when its note says so.
 */
export function curationReader({ read_by, note }, model = 'opus') {
  if (read_by === undefined || read_by === null) return { kind: 'model', model, image_opened: IMAGE_NOT_READ.test(note ?? '') ? 'unrecorded' : true };
  const r = READ_BY[read_by];
  if (!r) return null;
  return { ...r, image_opened: r.image_opened ?? (/image/i.test(note ?? '') ? true : 'unrecorded') };
}

/**
 * One curation verdict as a book_checks input, minus what needs Mongo (text_provenance, exposure) and the registry
 * (method_version). `packet` = the book's record in the run's packets (overview-draw.mjs --picked), whose pages are
 * the two the reviewer was given; without one, the pages the note names. `cost` = runCost() of the verdict file's
 * packet, shared equally by the `booksInFile` verdicts in it. Returns { input } or { skip: reason }.
 * rights_note is never copied: this record is not where rights suspicions live.
 */
export function curationCheck({ verdict: v, file, runId, checkedAt, packet, cost, booksInFile = 1, frame = {} }) {
  const verdict = TIER[v.tier];
  if (!verdict) return { skip: `tier ${JSON.stringify(v.tier)} is not 1, 2 or 3` };
  const fromPacket = (packet?.pages ?? []).map((p) => p.page_number).filter((n) => typeof n === 'number');
  const pages = fromPacket.length ? fromPacket : notePages(v.note);
  if (!pages.length) return { skip: 'no packet for the book and the note names no page' };
  const reader = curationReader(v, cost?.model ?? 'opus');
  if (!reader) return { skip: `unknown read_by ${v.read_by}` };
  return { input: {
    book_id: v.book_id, checked_at: checkedAt, method_id: 'curation-check', run_id: runId,
    frame: { ...frame, pages_read_source: fromPacket.length ? 'packet' : 'note' },
    pages_read: pages, reader, verdict, verdict_source: 'reader', note: v.note, evidence_path: file,
    ...(cost ? { subscription_usd_eq: +(cost.usd / booksInFile).toFixed(4) } : {}),
  } };
}

const PAGE_PROJECTION = { _id: 0, id: 1, page_number: 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'ocr.prompt_version': 1,
  'translation.model': 1, 'translation.source': 1, 'translation.updated_at': 1, 'translation.content_hash': 1 };

/**
 * Current page records of one book, keyed by page number. One indexed query ({book_id, page_number}). With
 * `withText`, ocr.data and translation.data too — only the few pages a check read, to compare with its packet.
 */
export async function pageRecords(db, bookId, nums, { withText = false } = {}) {
  const projection = withText ? { ...PAGE_PROJECTION, 'ocr.data': 1, 'translation.data': 1 } : PAGE_PROJECTION;
  const rows = await db.collection('pages').find({ book_id: bookId, page_number: { $in: [...nums] } }, { projection }).toArray();
  return new Map(rows.map((r) => [r.page_number, r]));
}

/** When an evidence file was written: min(git add time, mtime). A checkout resets mtime; a fresh run has no commit. */
export function checkedAtOf(path) {
  const times = [statSync(path).mtime];
  try {
    const out = execFileSync('git', ['log', '--diff-filter=A', '--format=%aI', '-1', '--', basename(path)], { encoding: 'utf8', cwd: dirname(path), stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) times.push(new Date(out));
  } catch { /* not in a git checkout */ }
  return new Date(Math.min(...times.map((t) => t.getTime())));
}

const after = (d, at) => d && new Date(d) > at;

/**
 * Provenance entries for a run that froze its text in a packet. `now` = pageRecords() of the book; `packetPages` = the
 * packet's pages (ocr_model, ocr_engine, translation_model …). Without a packet entry it falls back to the page record,
 * and only when the text predates the check; otherwise the model ids are null with the reason.
 */
export function packetProvenance({ pagesRead, packetPages, now, checkedAt, provenanceFromPage }) {
  return pagesRead.map((n) => {
    const cur = now.get(n);
    const rewritten = cur && (after(cur.ocr?.updated_at, checkedAt) || after(cur.translation?.updated_at, checkedAt));
    const pk = packetPages?.find((p) => p.page_number === n);
    if (pk) {
      // The reviewer read the packet's frozen text. Compare TEXT when both sides have it (pageRecords withText): a
      // timestamp after checkedAt would miss a rewrite between the draw and the review.
      const compared = cur && typeof pk.ocr === 'string' && cur.ocr && 'data' in cur.ocr;
      const changed = !cur || (compared ? (cur.ocr?.data ?? '') !== pk.ocr || (cur.translation?.data ?? '') !== (pk.translation ?? '') : !!rewritten);
      const e = { page_number: n, page_id: pk.page_id ?? null, ocr_model: pk.ocr_model ?? (pk.ocr_engine ? `source:${pk.ocr_engine}` : null),
        ocr_source: pk.ocr_engine ?? null, translation_model: pk.translation_model ?? null, translation_source: pk.translation_source ?? null,
        source: 'packet', text_compared: !!compared, changed_since_check: changed };
      if (!changed) Object.assign(e, { ocr_updated_at: cur.ocr?.updated_at ?? null, ocr_prompt_version: cur.ocr?.prompt_version ?? null,
        translation_updated_at: cur.translation?.updated_at ?? null, translation_content_hash: cur.translation?.content_hash ?? null });
      const miss = [!e.ocr_model && 'packet has no ocr_model', !e.translation_model && 'packet has no translation_model'].filter(Boolean);
      if (miss.length) e.unknown_reason = miss.join('; ');
      return e;
    }
    if (!cur) return { page_number: n, ocr_model: null, translation_model: null, source: 'reconstructed', unknown_reason: 'no page record now and no packet' };
    if (rewritten) return { page_number: n, page_id: cur.id ?? null, ocr_model: null, translation_model: null, source: 'reconstructed', changed_since_check: true,
      unknown_reason: `text rewritten after the check (ocr ${cur.ocr?.updated_at?.toISOString?.() ?? '-'}, translation ${cur.translation?.updated_at?.toISOString?.() ?? '-'}) and no packet froze it` };
    return { ...provenanceFromPage(cur, 'reconstructed'), changed_since_check: false };
  });
}

/**
 * Cost and model of one packet's reviewer call(s) from run-reviewers.sh's meta dir (`<out_dir>/meta`, which the skill
 * keeps in the scratchpad; writers take it as --meta): Σ total_cost_usd over meta/<packet>.json and
 * meta/<packet>.retry.json (a call that wrote nothing still cost money), and the Opus model id from modelUsage. Null
 * when the run was not launched by run-reviewers.sh (a session's subagents leave no meta).
 */
export function runCost(meta, packet) {
  if (!meta || !existsSync(meta)) return null;
  let usd = 0, n = 0, model = null;
  for (const f of readdirSync(meta).filter((x) => x === `${packet}.json` || x === `${packet}.retry.json`)) {
    let r;
    try { r = JSON.parse(readFileSync(join(meta, f), 'utf8')); } catch { continue; }
    usd += r.total_cost_usd ?? 0; n++;
    const ids = Object.keys(r.modelUsage ?? {}).filter((k) => /opus/i.test(k));
    if (ids.length) model = ids.sort((a, b) => (r.modelUsage[b].outputTokens ?? 0) - (r.modelUsage[a].outputTokens ?? 0))[0];
  }
  return n ? { usd, model } : null;
}
