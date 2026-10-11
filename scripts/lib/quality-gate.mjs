// PRIOR ART: scripts/lib/pause.mjs — the per-step PAUSE (`paused_phases`), which stops ALL of a step's
// spend, in-flight rounds included; this is a narrower brake that stops only ENROLMENT of new books, so
// it sits beside pause.mjs rather than inside its vocabulary (a NO-GO must let paid, in-flight work
// finish). scripts/lib/versioned-config.mjs — the revision trail every write here goes through.
// /root/translate-next/s1-*.mjs (Hetzner, not in the repo) — the hand-run spot check of translate-300
// (translate-next-5467 STEP 1) that this makes standing; its screens are ported to quality-gate-screens.mjs.
// Nothing in the repo kept a gate record, an enrolment brake or a cadence.
//
// quality-gate — the standing by-eye quality gate (#5826, step R7 of .claude/docs/pipeline-next-step.md).
//
// DECIDED 2026-10-10 (Derek, decision 8, default accepted): for each paid step (ocr, translate), every
// 300 books or 7 days, whichever comes first, a person (or a headless session on the subscription, $0)
// reads 3 consecutive pages in each of 10 books, drawn with a seed and stratified by language: image,
// OCR and English side by side. Mechanical screens run over every page of the window. The verdict is one
// `quality_gates` row. A NO-GO pauses ENROLMENT of new books into that step — not reader access, and
// in-flight work finishes — until a person records a GO that names the fix.
//
// THE RECORD (`quality_gates`):
//   { id, step, window: { label, from, to, books, pages, ... }, seed, sample_ids: [{ book_id, language,
//     page_ids, page_numbers }], verdict: 'GO'|'NO-GO', failure_classes: [{ code, pages, books, severity,
//     note }] (codes from .claude/docs/page-error-taxonomy.md), screens, findings?, by, fix?, notes?, at,
//     actuation: { enrol_paused?, enrol_resumed?, ntfy } }
//
// THE BRAKE: `system_config.processing_control.lane_budgets.<step>.enrol_paused = { gate_id, at, by }`.
// `lane_budgets` is the per-lane control the design reserves (R8 adds the budget fields beside it).
// Every unattended path that ENROLS a book into a paid step asks `enrolBrake(db, step)` first:
//   translate — translate-batch-chained `enrolChainedRun` (--enrol, --enrol-auto, orchestrator Phase 4's
//               chained path) and translate-batch-worker's --enrol / --enrol-auto entry; orchestrator
//               Phase 4 dispatch; translate-worker `selfDispatch`.
//   ocr       — orchestrator Phase 1.5 (preview OCR) and Phase 2 (OCR submit).
// Collection, ticks of already-open runs and already-created jobs are NOT braked: that is the
// "in-flight work finishes" half of the decision. tests/unit/quality-gate.test.ts pins the call sites.
//
// CADENCE: `gateState()` says ok | due | overdue for a step from the books that went through the lane
// since the last gate. Overdue (due + GRACE_BOOKS more books, or no gate ever) is what the standing driver
// (R6, #5825, not yet landed) idles on — a missing check fails closed THERE. The live enrolers read only
// the NO-GO brake: counting the window is an 18 s scan of translate_batch_runs, too slow for every tick.

export const GATE_STEPS = Object.freeze(['ocr', 'translate']);
export const DUE_BOOKS = 300;
export const DUE_DAYS = 7;
export const GRACE_BOOKS = 100;
export const SAMPLE_BOOKS = 10;
export const RUN_PAGES = 3;
export const GATES_COLLECTION = 'quality_gates';
export const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';

/** A drill step: `test-<name>`. Never a real lane; lets the NO-GO path be exercised end to end. */
export const isTestStep = (step) => typeof step === 'string' && /^test-[a-z0-9-]{1,40}$/.test(step);

export function assertStep(step) {
  if (GATE_STEPS.includes(step) || isTestStep(step)) return step;
  throw new Error(`quality-gate: '${step}' is not a gated step (${GATE_STEPS.join(', ')}, or test-<name> for a drill)`);
}

/**
 * The failure classes of .claude/docs/page-error-taxonomy.md, by code. tests/unit/quality-gate.test.ts
 * pins this list against the doc's headings, both ways.
 */
export const TAXONOMY_CLASSES = Object.freeze([
  'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7',
  'O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8', 'O9', 'O10', 'O11', 'O12', 'O13', 'O14', 'O15', 'O16', 'O17', 'O18',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'T13', 'T14', 'T15', 'T16', 'T17',
  'D1', 'E1', 'E2',
]);
export const SEVERITIES = Object.freeze(['minor', 'major', 'blocking']);

/** Parse `O6:3,T7:2` (code:pages) into failure-class rows. */
export function parseFailureClasses(spec) {
  if (!spec) return [];
  return String(spec).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [code, pages] = s.split(':');
    return { code: code.trim(), pages: pages == null ? null : Number(pages) };
  });
}

/** Validate failure-class rows; returns the list of problems (empty = valid). */
export function failureClassProblems(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!TAXONOMY_CLASSES.includes(r?.code)) out.push(`unknown failure class '${r?.code}' (page-error-taxonomy.md codes: ${TAXONOMY_CLASSES.join(' ')})`);
    if (r?.severity != null && !SEVERITIES.includes(r.severity)) out.push(`${r.code}: severity '${r.severity}' is not one of ${SEVERITIES.join('/')}`);
    if (r?.pages != null && !(Number.isInteger(r.pages) && r.pages >= 0)) out.push(`${r.code}: pages must be a count`);
  }
  return out;
}

// A GO that lifts a NO-GO must come from a person (decision 8: "until a person records a GO naming the
// fix"). A session can RECORD a NO-GO — braking only reduces spend — but cannot release its own brake.
const NOT_A_PERSON = /\b(claude|agent|bot|session|job|cron|headless|gpt|gemini)\b/i;
export const looksLikePerson = (by) => typeof by === 'string' && by.trim().length >= 2 && !NOT_A_PERSON.test(by);

/**
 * Validate a gate record before anything is written. `pausedNow` = the step's current enrol_paused (or
 * null). Returns a list of problems; empty means the record may be written.
 */
export function recordProblems(rec, { pausedNow = null } = {}) {
  const p = [];
  try { assertStep(rec.step); } catch (e) { p.push(e.message); }
  if (!['GO', 'NO-GO'].includes(rec.verdict)) p.push(`verdict must be GO or NO-GO, got '${rec.verdict}'`);
  if (!rec.by || !String(rec.by).trim()) p.push('by is required: who read the pages');
  p.push(...failureClassProblems(rec.failure_classes));
  if (rec.verdict === 'NO-GO' && !(rec.failure_classes || []).length) p.push('a NO-GO names at least one failure class (page-error-taxonomy.md)');
  if (rec.verdict === 'GO' && pausedNow && !isTestStep(rec.step)) {
    if (!rec.fix || !String(rec.fix).trim()) p.push(`enrolment is paused by NO-GO gate ${pausedNow.gate_id}: a GO must name the fix (--fix)`);
    if (!looksLikePerson(rec.by)) p.push(`enrolment is paused by NO-GO gate ${pausedNow.gate_id}: only a person can lift it (by='${rec.by}')`);
  }
  if (!isTestStep(rec.step) && !(rec.sample_ids || []).length) p.push('sample_ids is empty: a gate is a read of named pages (pass the sample file)');
  return p;
}

/** The step's NO-GO brake, or null. Pure: reads a processing_control document. */
export function enrolPausedFor(control, step) {
  const v = control?.lane_budgets?.[step]?.enrol_paused;
  return v && typeof v === 'object' && v.gate_id ? v : null;
}

/** Extra drill steps a process asks about (env QUALITY_GATE_DRILL_STEP, test-* only): they only ADD brakes. */
export function drillSteps(env = process.env) {
  return String(env.QUALITY_GATE_DRILL_STEP || '').split(',').map((s) => s.trim()).filter(isTestStep);
}

export function brakeMessage(step, paused) {
  return `[quality-gate] ${step} ENROLMENT PAUSED by NO-GO gate ${paused.gate_id} (${paused.at instanceof Date ? paused.at.toISOString() : paused.at}) — enrolling nothing; in-flight work continues. Resume: a person records a GO naming the fix (node scripts/maintenance/quality-gate.mjs record --step=${step} --verdict=GO --by=… --fix=…). #5826`;
}

/**
 * Ask before enrolling a book into `step`. Reads processing_control fresh unless `control` is passed.
 * Returns { paused, step, gate_id?, at?, message? }; logs the message when paused. An unreadable
 * control document THROWS — the caller's run fails rather than enrolling blind.
 */
export async function enrolBrake(db, step, { control = null, log = console.log, env = process.env } = {}) {
  const ctl = control ?? await db.collection('system_config').findOne({ _id: 'processing_control' });
  for (const s of [step, ...drillSteps(env)]) {
    const paused = enrolPausedFor(ctl, s);
    if (paused) {
      const message = brakeMessage(s, paused);
      if (log) log(message);
      return { paused: true, step: s, gate_id: paused.gate_id, at: paused.at, message };
    }
  }
  return { paused: false, step };
}

/**
 * Books that went through a step's lane in [from, to): [{ book_id, at }] (at = first time in the window).
 *   translate — chained runs that completed having written pages (`completed_at`), or, for a cohort
 *               window (`bookIds`), runs CREATED in the window for those books.
 *   ocr       — Batch OCR jobs (orchestrator, bulk re-OCR, API) saved in the window.
 * This counts books the lane delivered output to, which over-counts rung CROSSINGS (a tail run on a
 * readable book crosses none): no rung history is stored. Measured 2026-10-10 over 7 days: translate
 * 2,711 books, OCR 2,173 — so at 300 books the gate is due about daily for each step.
 */
export async function windowBooks(db, step, { from = null, to = new Date(), bookIds = null } = {}) {
  assertStep(step);
  if (isTestStep(step)) return [];
  const range = () => ({ ...(from ? { $gte: from } : {}), $lt: to });
  if (step === 'translate') {
    const match = bookIds
      ? { mode: 'chained', book_id: { $in: bookIds }, created_at: range() }
      : { mode: 'chained', phase: 'complete', 'counts.written': { $gt: 0 }, completed_at: range() };
    const timeField = bookIds ? '$created_at' : '$completed_at';
    const rows = await db.collection('translate_batch_runs').aggregate([
      { $match: match },
      { $group: { _id: '$book_id', at: { $min: timeField }, runs: { $push: '$id' } } },
    ], { maxTimeMS: 120000 }).toArray();
    return rows.map((r) => ({ book_id: r._id, at: r.at, runs: r.runs }));
  }
  const rows = await db.collection('batch_jobs').aggregate([
    { $match: { type: 'ocr', status: { $in: ['saved', 'completed_with_errors'] }, created_at: range(), ...(bookIds ? { $or: [{ book_id: { $in: bookIds } }, { book_ids: { $in: bookIds } }] } : {}) } },
    { $project: { b: { $ifNull: ['$book_ids', ['$book_id']] }, at: { $ifNull: ['$updated_at', '$created_at'] }, id: 1 } },
    { $unwind: '$b' },
    ...(bookIds ? [{ $match: { b: { $in: bookIds } } }] : []),
    { $group: { _id: '$b', at: { $min: '$at' }, runs: { $push: '$id' } } },
  ], { maxTimeMS: 120000 }).toArray();
  return rows.filter((r) => r._id).map((r) => ({ book_id: r._id, at: r.at, runs: r.runs }));
}

/**
 * Pure cadence rule. `entries` = windowBooks() since the last gate; `from` = the last gate's window end
 * (null = no gate ever). Due at DUE_BOOKS books or DUE_DAYS days, whichever first; overdue once
 * GRACE_BOOKS more books have gone through after the due moment. No gate ever = overdue: a missing
 * check fails closed.
 */
export function gateState(entries, { from, now = new Date() } = {}) {
  const books = entries.length;
  if (!from) return { state: 'overdue', reason: 'no gate recorded for this step', books, due_at: null, books_past_due: books };
  const times = entries.map((e) => new Date(e.at).getTime()).sort((a, b) => a - b);
  const byDays = new Date(from).getTime() + DUE_DAYS * 864e5;
  const byBooks = times.length >= DUE_BOOKS ? times[DUE_BOOKS - 1] : Infinity;
  const dueAt = Math.min(byDays, byBooks);
  const days = +((now.getTime() - new Date(from).getTime()) / 864e5).toFixed(2);
  if (now.getTime() < dueAt) return { state: 'ok', books, days, due_at: null, books_past_due: 0 };
  const pastDue = times.filter((t) => t > dueAt).length;
  const why = byBooks <= byDays ? `${DUE_BOOKS} books` : `${DUE_DAYS} days`;
  if (pastDue >= GRACE_BOOKS) return { state: 'overdue', reason: `due at ${why}, then ${pastDue} more books (grace ${GRACE_BOOKS})`, books, days, due_at: new Date(dueAt), books_past_due: pastDue };
  return { state: 'due', reason: `due at ${why}; ${GRACE_BOOKS - pastDue} books of grace left`, books, days, due_at: new Date(dueAt), books_past_due: pastDue };
}

/** The last gate for a step, or null. */
export const lastGate = (db, step) => db.collection(GATES_COLLECTION).findOne({ step }, { sort: { at: -1 } });

/** Where the next window starts: the last gate's window end (its `at` when it named none). */
export const windowStartAfter = (gate) => (gate ? new Date(gate.window?.to || gate.at) : null);

/** Full status for one step: last gate, the window since, cadence state, and the brake. */
export async function gateStatus(db, step, { now = new Date(), control = null } = {}) {
  assertStep(step);
  const last = await lastGate(db, step);
  const from = windowStartAfter(last);
  const entries = await windowBooks(db, step, { from: from || new Date(now.getTime() - DUE_DAYS * 864e5), to: now });
  const ctl = control ?? await db.collection('system_config').findOne({ _id: 'processing_control' });
  return {
    step,
    last_gate: last ? { id: last.id, verdict: last.verdict, at: last.at, by: last.by } : null,
    window_from: from,
    ...gateState(entries, { from, now }),
    enrol_paused: enrolPausedFor(ctl, step),
  };
}

/** What a standing driver does with a step this tick: enrol, or idle and say why. Pure. */
export function driverGate({ state, enrol_paused: paused }) {
  if (paused) return { enrol: false, gate: 'NO-GO', reason: `enrol_paused by gate ${paused.gate_id}` };
  if (state === 'overdue') return { enrol: false, gate: 'overdue', reason: 'quality gate overdue (a missing check fails closed)' };
  return { enrol: true, gate: state === 'due' ? 'due' : 'GO' };
}

/** POST one ntfy message. Never throws; returns { ok, status?, error? }. */
export async function pushNtfy({ title, body, priority = 'default', tags = '', topic = NTFY_TOPIC, fetchImpl = globalThis.fetch }) {
  try {
    const res = await fetchImpl(topic, { method: 'POST', headers: { Title: title, Priority: priority, ...(tags ? { Tags: tags } : {}) }, body });
    return { ok: !!res?.ok, status: res?.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const newGateId = (step, now) => `qg_${step}_${now.toISOString().slice(0, 16).replace(/[-:T]/g, '')}_${Math.random().toString(36).slice(2, 6)}`;

/**
 * Record a gate verdict, and actuate it:
 *   NO-GO → insert the row, set lane_budgets.<step>.enrol_paused (versioned), push ntfy (high; low for a drill).
 *   GO    → insert the row; if the step was paused, clear enrol_paused (versioned) and push ntfy (low).
 * Returns { gate, problems }. With problems nothing is written. `deps` injects { now, push, log }.
 */
export async function recordGate(db, rec, deps = {}) {
  const now = deps.now ? deps.now() : new Date();
  const log = deps.log || console.log;
  const push = deps.push || pushNtfy;
  const { updateConfigVersioned } = await import('./versioned-config.mjs');
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  const pausedNow = enrolPausedFor(control, rec.step);
  const problems = recordProblems(rec, { pausedNow });
  if (problems.length) return { gate: null, problems };

  const drill = isTestStep(rec.step);
  const gate = {
    id: newGateId(rec.step, now),
    step: rec.step,
    window: rec.window || null,
    seed: rec.seed ?? null,
    sample_ids: rec.sample_ids || [],
    verdict: rec.verdict,
    failure_classes: rec.failure_classes || [],
    screens: rec.screens || null,
    findings: rec.findings || null,
    by: String(rec.by).trim(),
    fix: rec.fix ? String(rec.fix).trim() : null,
    notes: rec.notes || null,
    drill,
    at: now,
    actuation: {},
  };
  if (rec.verdict === 'GO' && pausedNow) gate.resumes_gate_id = pausedNow.gate_id;
  await db.collection(GATES_COLLECTION).insertOne(gate);
  log(`[quality-gate] recorded ${gate.verdict} for ${gate.step}: ${gate.id}`);

  const path = `lane_budgets.${rec.step}.enrol_paused`;
  if (rec.verdict === 'NO-GO') {
    const flag = { gate_id: gate.id, at: now, by: gate.by };
    await updateConfigVersioned(db, 'processing_control', { $set: { [path]: flag } }, `quality-gate NO-GO ${gate.id} (${gate.by}) #5826`);
    gate.actuation.enrol_paused = flag;
    const classes = gate.failure_classes.map((c) => c.code + (c.pages != null ? `×${c.pages}` : '')).join(', ');
    const n = await push({
      title: `${drill ? '[DRILL] ' : ''}Quality gate NO-GO: ${rec.step} enrolment paused`,
      body: `${gate.by} recorded NO-GO for ${rec.step} (${gate.id}). Failure classes: ${classes}. New books are not enrolled into ${rec.step}; in-flight work finishes. Resume = a person records a GO naming the fix. #5826${gate.notes ? `\n${String(gate.notes).slice(0, 300)}` : ''}`,
      priority: drill ? 'low' : 'high',
      tags: drill ? 'test_tube' : 'no_entry',
    });
    gate.actuation.ntfy = n;
  } else if (pausedNow) {
    const unset = drill ? { $unset: { [`lane_budgets.${rec.step}`]: '' } } : { $unset: { [path]: '' } };
    await updateConfigVersioned(db, 'processing_control', unset, `quality-gate GO ${gate.id} (${gate.by}) lifts ${pausedNow.gate_id}: ${gate.fix || 'drill'} #5826`);
    gate.actuation.enrol_resumed = { gate_id: pausedNow.gate_id, at: now };
    gate.actuation.ntfy = await push({
      title: `${drill ? '[DRILL] ' : ''}Quality gate GO: ${rec.step} enrolment resumed`,
      body: `${gate.by} recorded GO for ${rec.step} (${gate.id}), lifting ${pausedNow.gate_id}. Fix: ${gate.fix || '(drill)'}. #5826`,
      priority: 'low',
      tags: 'white_check_mark',
    });
  }
  await db.collection(GATES_COLLECTION).updateOne({ id: gate.id }, { $set: { actuation: gate.actuation } });
  if (gate.actuation.ntfy && !gate.actuation.ntfy.ok) log(`[quality-gate] ntfy push FAILED: ${JSON.stringify(gate.actuation.ntfy)}`);
  return { gate, problems: [] };
}
