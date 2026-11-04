// PRIOR ART: scripts/eval/lane-judge-sampler.mjs — writes the live rows of lane_judge_verdicts and holds their read-side
// check (validRecord); it has no notion of a row from a test, and every reader queried the store whole.
// scripts/lib/book-checks.mjs recordPageVerdicts (#8069) — the book_checks recorder, another store with reader
// warnings; not this one. Searched `git grep lane_judge_verdicts`, scripts/eval/lib/, scripts/lib/: no origin filter.
/**
 * judge-rows (#7263): one row per judged page in `lane_judge_verdicts`, from a live lane OR a test, so evidence adds up.
 *
 * ORIGIN. A row is `origin: 'live'` (the #7611 sampler judging what a lane wrote) or `origin: 'test'` (a router test,
 * pilot or eval). A row with no `origin` is live: every row before #7263 was written by the sampler or by
 * confidence-7866/analyze.mjs, and its readers already read them. READERS exclude test rows unless they ask for them
 * (`verdictQuery(q, { tests: true })`): a test read the readers never saw must never reach book_checks
 * (judge-verdicts-to-book-checks.mjs), the sampler's export to the router, its draw history or weekly cap, or
 * defect-rate.mjs. tests/unit/judge-rows.test.ts fails on any query of the store that does neither.
 *
 * A TEST ROW (testRow) carries what varied, so rows from different tests can be told apart instead of pooled blind:
 *   selection   random | hand-picked | hard-frame | unknown  (only `random` may decide a router cell; the rest set a prior)
 *   test        { id, issue, record, arm, evidence, stratum }
 *   settings    pages_per_call, prev_page_context, thinking, draft_source, draft_hash, prompt_version, image_px, model
 *               (null = the test did not record it; never guessed)
 *   judge       { instrument, model, prompt_sha }  — the instrument names the scale its verdict is on
 *   verdict     the judge's answer in its own words (route judge: accept / fidelity / defects; Step T: misleading /
 *               flawed / sound ...). Never renamed into another instrument's fields.
 *   outcome     { accept, wrong_text, mapped_by } or null. Set only where the instrument itself answers it (the route
 *               judge's own accept and wrong_text severity). Another scale stays null until a mapping is MEASURED
 *               (severity-cal-7263's Step T x route-judge cross-table), and outcome_null_reason says why.
 *   book_id     required. cost { judge_list_usd, candidate_list_usd, quota_points } (null = not measured).
 * The `draw` field stays what the sampler writes (its draw keys); `selection` is the draw KIND.
 */
import crypto from 'node:crypto';

export const COLLECTION = 'lane_judge_verdicts';
export const ORIGINS = Object.freeze(['live', 'test']);
export const SELECTIONS = Object.freeze(['random', 'hand-picked', 'hard-frame', 'unknown']);
export const SETTINGS = Object.freeze(['pages_per_call', 'prev_page_context', 'thinking', 'draft_source', 'draft_hash', 'prompt_version', 'image_px', 'model']);
/** The route judge (route-judge-6740 judgePrompt): its own fields answer accept and wrong text. */
export const ROUTE_JUDGE = 'route-judge-6740 judgePrompt';

/** Missing origin = live (every row before #7263). */
export const originOf = (r) => (r && r.origin != null ? r.origin : 'live');
export const isLive = (r) => originOf(r) === 'live';
export const isTest = (r) => originOf(r) === 'test';

/**
 * A Mongo filter over the store. Default: live rows only (origin missing or 'live'). `tests: true` = every row (say why
 * at the call site), `tests: 'only'` = test rows only.
 */
export function verdictQuery(q = {}, { tests = false } = {}) {
  if (q && Object.prototype.hasOwnProperty.call(q, 'origin')) throw new Error('verdictQuery: pass origin through { tests }, not in the filter');
  if (tests === true) return { ...q };
  if (tests === 'only') return { ...q, origin: 'test' };
  if (tests !== false) throw new Error(`verdictQuery: tests must be true, false or 'only', got ${tests}`);
  return { ...q, origin: { $ne: 'test' } };
}

const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
const wrongTextOf = (v) => (v?.defects || []).some((d) => d?.severity === 'wrong_text');

/** The outcome the instrument itself answers, or null with the reason. Never a mapping across scales. */
export function ownOutcome(instrument, verdict) {
  if (instrument === ROUTE_JUDGE && verdict && typeof verdict.accept === 'boolean')
    return { outcome: { accept: verdict.accept, wrong_text: wrongTextOf(verdict), mapped_by: 'own fields (accept; any defect of severity wrong_text)' }, outcome_null_reason: null };
  if (instrument === ROUTE_JUDGE) return { outcome: null, outcome_null_reason: 'unparsed verdict' };
  return { outcome: null, outcome_null_reason: `no measured mapping from "${instrument}" to accept / wrong text yet (severity-cal-7263)` };
}

/**
 * Build one test row; throws on anything a reader would have to guess. `id` is deterministic (test, arm, page, kind,
 * judge, rep), so a rerun of the same backfill inserts nothing it already holds.
 */
export function testRow(f) {
  const miss = [];
  if (!nonEmpty(f.book_id)) miss.push('book_id');
  if (!nonEmpty(f.page_id) && !Number.isInteger(f.page_number)) miss.push('page_id or page_number');
  if (!SELECTIONS.includes(f.selection)) miss.push(`selection (${SELECTIONS.join(' | ')})`);
  if (!nonEmpty(f.test?.id)) miss.push('test.id');
  if (!nonEmpty(f.judge?.instrument)) miss.push('judge.instrument');
  if (!nonEmpty(f.kind) || !['item', 'wrong_page', 'planted', 'draft'].includes(f.kind)) miss.push('kind');
  if (f.verdict === undefined) miss.push('verdict (null = unparsed)');
  if (!nonEmpty(f.cell)) miss.push('cell');
  if (!nonEmpty(f.route)) miss.push('route');
  if (miss.length) throw new Error(`testRow ${f.test?.id ?? '?'} ${f.book_id ?? '?'}:${f.page_number ?? '?'}: missing ${miss.join(', ')}`);
  const settings = Object.fromEntries(SETTINGS.map((k) => [k, f.settings?.[k] ?? null]));
  const extra = Object.keys(f.settings || {}).filter((k) => !SETTINGS.includes(k));
  if (extra.length) throw new Error(`testRow: unknown settings ${extra.join(', ')} (add to SETTINGS)`);
  const { outcome, outcome_null_reason } = f.outcome !== undefined ? { outcome: f.outcome, outcome_null_reason: f.outcome ? null : f.outcome_null_reason ?? 'not mapped' } : ownOutcome(f.judge.instrument, f.verdict);
  const key = [f.test.id, f.test.arm ?? '', f.page_id ?? `${f.book_id}:${f.page_number}`, f.kind, f.judge.instrument, f.rep ?? 0].join('|');
  return {
    _id: `ljt${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`,
    origin: 'test', selection: f.selection, kind: f.kind,
    page_id: f.page_id ?? null, book_id: f.book_id, page_number: f.page_number ?? null,
    cell: f.cell, route: f.route, lane: `test:${f.test.id}`, lang: f.lang ?? null, task: f.task ?? 'ocr',
    script_type: f.script_type ?? null, script_source: f.script_type ? (f.script_source ?? 'test record') : null,
    test: { id: f.test.id, issue: f.test.issue ?? null, record: f.test.record ?? null, arm: f.test.arm ?? null, evidence: f.test.evidence ?? null, stratum: f.test.stratum ?? null, rep: f.rep ?? 0, judged_at: f.judged_at ?? null },
    settings,
    judge: { instrument: f.judge.instrument, model: f.judge.model ?? null, model_reported: f.judge.model ?? null, prompt_sha: f.judge.prompt_sha ?? null },
    verdict: f.verdict, outcome, outcome_null_reason,
    text_hash: f.text_hash ?? null,
    cost: { judge_list_usd: f.cost?.judge_list_usd ?? null, candidate_list_usd: f.cost?.candidate_list_usd ?? null, quota_points: f.cost?.quota_points ?? null },
    // judged_at stays null on purpose: the sampler's validRecord requires it, so a checkout from before origin existed
    // (a box that has not pulled) still drops test rows from its export and its 7-day call count. The time is test.judged_at.
    run_id: `test:${f.test.id}`, judged_at: null, backfilled_at: f.backfilled_at ?? null,
  };
}
