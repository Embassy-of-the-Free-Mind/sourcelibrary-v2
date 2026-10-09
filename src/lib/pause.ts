/**
 * pause — the `paused_phases` vocabulary, for request paths (#5492).
 *
 * PRIOR ART: scripts/lib/pause.mjs — the source of truth, used by every worker.
 * This is its twin for src/ routes that cannot import a script (emergency-stop
 * validates keys with it). Only the pure vocabulary is mirrored; the workers'
 * `isPaused` with its per-cycle logging stays in the .mjs. Parity is pinned by
 * tests/unit/pause-parity.test.ts — change both or neither.
 */

export const PAUSE_KEYS = ['archive', 'ocr', 'translate', 'enrich', 'images', 'embeddings'] as const;
export type PauseKey = (typeof PAUSE_KEYS)[number];

/** Legacy entries that still mean a whole step (see the .mjs for why each exists). */
export const PAUSE_ALIASES: Readonly<Record<string, PauseKey>> = Object.freeze({
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

/** Orchestrator phase numbers that are valid entries but name no step. */
export const PHASE_ONLY_ENTRIES: readonly number[] = Object.freeze([0, 1, 1.25, 1.3, 1.45, 1.6, 1.95, 1.97, 3, 3.1, 3.5, 3.7, 8.5, 8.9, 9]);

export type PauseEntryClass =
  | { kind: 'key'; key: PauseKey }
  | { kind: 'alias'; key: PauseKey }
  | { kind: 'phase'; phase: number }
  | { kind: 'unknown' };

const isNumeric = (x: unknown): boolean =>
  (typeof x === 'number' && Number.isFinite(x)) || (typeof x === 'string' && /^\d+(\.\d+)?$/.test(x.trim()));

export function isPauseKey(x: unknown): x is PauseKey {
  return typeof x === 'string' && (PAUSE_KEYS as readonly string[]).includes(x);
}

export function classifyPauseEntry(entry: unknown): PauseEntryClass {
  if (isPauseKey(entry)) return { kind: 'key', key: entry };
  const norm = isNumeric(entry) ? String(Number(entry)) : typeof entry === 'string' ? entry : null;
  if (norm !== null && Object.prototype.hasOwnProperty.call(PAUSE_ALIASES, norm)) return { kind: 'alias', key: PAUSE_ALIASES[norm] };
  if (isNumeric(entry) && PHASE_ONLY_ENTRIES.includes(Number(entry))) return { kind: 'phase', phase: Number(entry) };
  return { kind: 'unknown' };
}

/** The canonical keys a control document pauses (aliases resolved). */
export function pausedKeys(control: unknown): Set<PauseKey> {
  const keys = new Set<PauseKey>();
  const list = (control as { paused_phases?: unknown } | null | undefined)?.paused_phases;
  const entries: unknown[] = Array.isArray(list) ? list : [];
  for (const e of entries) {
    const c = classifyPauseEntry(e);
    if (c.kind === 'key' || c.kind === 'alias') keys.add(c.key);
  }
  return keys;
}

/** Validate a list a caller wants to WRITE. Keys come back canonical; phase-only numbers as numbers. */
export function validatePauseKeys(list: unknown): { ok: boolean; keys: Array<PauseKey | number>; unknown: unknown[] } {
  if (!Array.isArray(list)) return { ok: false, keys: [], unknown: [list] };
  const keys: Array<PauseKey | number> = [];
  const unknown: unknown[] = [];
  for (const e of list) {
    const c = classifyPauseEntry(e);
    if (c.kind === 'unknown') unknown.push(e);
    else keys.push(c.kind === 'phase' ? c.phase : c.key);
  }
  return { ok: unknown.length === 0, keys: [...new Set(keys)], unknown };
}
