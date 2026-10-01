/**
 * pause — one vocabulary for `system_config.processing_control.paused_phases` (#5492).
 *
 * PRIOR ART: scripts/workers/lib/selective-unpause.mjs — owns the GLOBAL pause
 * (`paused: true`) and the scope that bypasses it; it knows nothing of per-step
 * pauses, so this sits beside it rather than inside it. The per-step readers it
 * replaces were inline: pipeline-orchestrator `shouldRun` (numbers only),
 * translate-worker (`'translation'`), enrich-worker (`'enrichment'`). The name
 * readers for `'ocr'`/`'images'` survived only in src/app/api/cron/_archived/.
 *
 * WHY THIS EXISTS. `paused_phases` had two vocabularies that did not overlap. The
 * documented form (`'ocr'`, `'images'`) was read by no live worker; the numbers the
 * orchestrator read (`2`, `8`) were read by no worker outside it; and the chained
 * batch lane — the main translation lane — read neither. A pause for `['ocr']`
 * returned success and stopped nothing. A brake keyed by a word no worker reads is
 * not a brake (spend-controls.md, failure mode 5).
 *
 * THE VOCABULARY is the pipeline steps of .claude/docs/pipeline-next-step.md plus
 * embeddings. Every lane that spends asks `isPaused(control, '<its key>')` on its
 * spending path; scripts/audit/spend-perimeter.mjs asserts that it does.
 *
 * A step pause is ABSOLUTE: a selective-unpause scope bypasses the global pause,
 * never a step pause. That is what makes it usable as an emergency brake while
 * scopes are configured (29 were, on 2026-10-01).
 *
 * The TS twin is src/lib/pause.ts (emergency-stop validates with it);
 * tests/unit/pause-parity.test.ts pins that the two agree.
 */

/** The canonical keys. The only words a worker asks about. */
export const PAUSE_KEYS = Object.freeze(['archive', 'ocr', 'translate', 'enrich', 'images', 'embeddings']);

/**
 * Legacy entries that still mean a whole step. Numbers are the orchestrator phase
 * numbers that were written into `paused_phases` by hand; names are the two words
 * the realtime workers read. Each now pauses EVERY lane of its step, not only the
 * reader that used to understand it.
 */
export const PAUSE_ALIASES = Object.freeze({
  translation: 'translate',
  enrichment: 'enrich',
  '1.5': 'ocr',
  '2': 'ocr',
  '4': 'translate',
  '5': 'translate',
  '6': 'enrich',
  '7': 'enrich',
  '8': 'images',
});

/**
 * Orchestrator phase numbers that are valid entries but name no step: pausing one
 * stops that orchestrator phase only (the pre-#5492 meaning, kept). `1.97` has its
 * own documented meaning in Phase 2 (skip the dedup prerequisite).
 */
export const PHASE_ONLY_ENTRIES = Object.freeze([0, 1, 1.25, 1.3, 1.45, 1.6, 1.95, 1.97, 3, 3.1, 3.5, 3.7, 8.5, 8.9, 9]);

/**
 * Which key governs each orchestrator phase that does a step's work (`shouldRun`).
 * Phases absent here are bookkeeping — completion checks, recovery, cover, finalize —
 * and spend nothing; they stop only for the global pause or their own number.
 */
export const PHASE_PAUSE_KEY = Object.freeze({
  1: 'archive',
  1.25: 'ocr',
  1.45: 'ocr',
  1.5: 'ocr',
  1.6: 'ocr',
  2: 'ocr',
  3.7: 'ocr',
  4: 'translate',
  6: 'enrich',
  7: 'enrich',
  8: 'images',
});

const isNumeric = (x) => (typeof x === 'number' && Number.isFinite(x)) || (typeof x === 'string' && /^\d+(\.\d+)?$/.test(x.trim()));

/**
 * What one `paused_phases` entry means.
 *   { kind: 'key', key }          a canonical key
 *   { kind: 'alias', key }        a legacy number or name for a key
 *   { kind: 'phase', phase }      an orchestrator phase number with no step
 *   { kind: 'unknown' }           read by nothing — the defect this module exists for
 */
export function classifyPauseEntry(entry) {
  if (typeof entry === 'string' && PAUSE_KEYS.includes(entry)) return { kind: 'key', key: entry };
  const norm = isNumeric(entry) ? String(Number(entry)) : (typeof entry === 'string' ? entry : null);
  if (norm !== null && Object.prototype.hasOwnProperty.call(PAUSE_ALIASES, norm)) return { kind: 'alias', key: PAUSE_ALIASES[norm] };
  if (isNumeric(entry) && PHASE_ONLY_ENTRIES.includes(Number(entry))) return { kind: 'phase', phase: Number(entry) };
  return { kind: 'unknown' };
}

const entriesOf = (control) => (Array.isArray(control?.paused_phases) ? control.paused_phases : []);

/** The canonical keys a control document pauses (aliases resolved). */
export function pausedKeys(control) {
  const keys = new Set();
  for (const e of entriesOf(control)) {
    const c = classifyPauseEntry(e);
    if (c.key) keys.add(c.key);
  }
  return keys;
}

/** Entries no lane reads. Non-empty means somebody believes in a brake that does not exist. */
export function unknownPauseEntries(control) {
  return entriesOf(control).filter((e) => classifyPauseEntry(e).kind === 'unknown');
}

/** Validate a list a caller wants to WRITE. Returns { ok, keys, unknown }; keys are canonical. */
export function validatePauseKeys(list) {
  if (!Array.isArray(list)) return { ok: false, keys: [], unknown: [list] };
  const keys = [];
  const unknown = [];
  for (const e of list) {
    const c = classifyPauseEntry(e);
    if (c.kind === 'unknown') unknown.push(e);
    else keys.push(c.key ?? c.phase);
  }
  return { ok: unknown.length === 0, keys: [...new Set(keys)], unknown };
}

// Unknown entries are logged on every cycle: once per key per process per minute, so a
// long-lived worker repeats itself and a 2-minute cron logs every run.
const LOG_EVERY_MS = 60 * 1000;
const lastLogged = new Map();
/** Test hook: forget what has been logged. */
export function resetPauseWarnings() { lastLogged.clear(); }

function warnUnknown(control, log, now) {
  for (const e of unknownPauseEntries(control)) {
    const k = JSON.stringify(e);
    if (now - (lastLogged.get(k) ?? -Infinity) < LOG_EVERY_MS) continue;
    lastLogged.set(k, now);
    log(`[pause] UNKNOWN paused_phases entry ${k} — no lane reads it, so it pauses NOTHING. Valid keys: ${PAUSE_KEYS.join(', ')} (legacy aliases: ${Object.keys(PAUSE_ALIASES).join(', ')}). See scripts/lib/pause.mjs (#5492).`);
  }
}

/**
 * Is this step paused? `key` must be canonical — a lane that asks with any other
 * word is the bug this module exists to prevent, so that throws. Does NOT read the
 * global `paused` flag: a lane checks that separately with shouldBypassPause, which
 * a scope can bypass and a step pause cannot.
 */
export function isPaused(control, key, { log = console.error, now = Date.now() } = {}) {
  if (!PAUSE_KEYS.includes(key)) throw new Error(`isPaused: '${key}' is not a pause key (valid: ${PAUSE_KEYS.join(', ')})`);
  warnUnknown(control, log, now);
  return pausedKeys(control).has(key);
}
