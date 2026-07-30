import type { FieldProvenanceEntry } from '@/lib/types/book';

/**
 * Writing `books.field_provenance` — the bibliographic provenance layer.
 *
 * This is the sibling of the AI-text provenance chain documented in
 * `.claude/docs/data-provenance.md`. That layer answers "what does this page
 * say"; this one answers "whose book is this, what year, who printed it" —
 * every citation claim the library makes — and it is rendered to readers by
 * `BibliographicInfo.tsx`.
 *
 * WHY THIS HELPER EXISTS. 81 writers hand-rolled their own stamp objects,
 * producing 164 distinct key-shapes across 134,488 entries; only 23.7% named
 * the script that wrote them and only 16.1% recorded what they replaced. With
 * no shared path, nothing tied a *value* write to a *stamp* write, so stamps
 * silently outlived the values they described:
 *
 *   - 1,304 of 7,323 `contributing_library` stamps assert `method:'ia_metadata'`
 *     while the stored value is "Internet Archive" — the host, which is not what
 *     IA's metadata said. The record looked sourced, which is plausibly why the
 *     placeholder problem survived four months.
 *   - The 2026-07-29 holding-library harvest replaced 833 values and left their
 *     stamps reading `provider_mapping, 2026-03-24`.
 *
 * A stamp that is wrong is worse than a stamp that is missing: it converts
 * "we don't know" into a false claim of knowing.
 *
 * USE: build the update with `provenanceUpdate()` and merge it into the same
 * `updateOne` that writes the value, so the two cannot diverge.
 */

/** Fields required on every stamp. `date` is filled in when omitted. */
export interface ProvenanceInput extends Omit<FieldProvenanceEntry, 'source' | 'date'> {
  /** Who or what produced the value: 'ia_metadata_harvest', 'ai_enrichment', 'admin_edit', … */
  source: string;
  /** The file that wrote it. Required for scripted writes — without it a stamp cannot be traced to code. */
  script?: string;
  date?: string | Date;
  /**
   * What this write replaced. Pass `null` explicitly for a first write — the
   * key must be PRESENT so "there was nothing here" is distinguishable from
   * "nobody recorded what was here".
   */
  previous_value: unknown;
}

export interface ProvenanceUpdate {
  $set: Record<string, FieldProvenanceEntry>;
  $push: Record<string, FieldProvenanceEntry>;
}

export class ProvenanceError extends Error {}

/** Field names we refuse to stamp — a typo here silently orphans the record. */
const FIELD_NAME_RE = /^[a-z][a-z0-9_.]*$/i;

export function normalizeProvenance(input: ProvenanceInput): FieldProvenanceEntry {
  if (!input || typeof input !== 'object') throw new ProvenanceError('provenance stamp must be an object');
  const source = typeof input.source === 'string' ? input.source.trim() : '';
  if (!source) throw new ProvenanceError('provenance stamp requires a non-empty `source`');
  // Callers must decide explicitly, so an overwrite can never look like a first write.
  if (!('previous_value' in input)) {
    throw new ProvenanceError('provenance stamp requires `previous_value` (pass null for a first write)');
  }
  const date = input.date ? new Date(input.date) : new Date();
  if (Number.isNaN(date.getTime())) throw new ProvenanceError(`provenance stamp has an invalid date: ${String(input.date)}`);
  return { ...input, source, date };
}

/**
 * Mongo update operators that record a value's provenance.
 *
 * Writes BOTH the current stamp and an append-only history entry. The history
 * is what makes a repeat sweep safe: `field_provenance.<field>` holds one
 * object, so a second run overwrites the first `previous_value` and the chain
 * of custody is lost. That is not hypothetical — the holding-library harvest
 * runs in two passes (fill, then verify) over overlapping books.
 *
 * Merge into the update that writes the value itself:
 *
 *   const prov = provenanceUpdate('contributing_library', { source, script, previous_value });
 *   await books.updateOne({ _id }, {
 *     $set: { 'image_source.contributing_library': next, ...prov.$set },
 *     $push: prov.$push,
 *   });
 */
export function provenanceUpdate(field: string, input: ProvenanceInput): ProvenanceUpdate {
  if (!FIELD_NAME_RE.test(field)) throw new ProvenanceError(`invalid provenance field name: ${JSON.stringify(field)}`);
  const entry = normalizeProvenance(input);
  return {
    $set: { [`field_provenance.${field}`]: entry },
    $push: { [`field_provenance_history.${field}`]: entry },
  };
}

/**
 * Does a stamp still describe the value sitting next to it?
 *
 * Cannot prove freshness in general — it catches the one detectable class:
 * a stamp claiming a specific upstream method while the value is a known
 * placeholder that method would never have produced. Used by
 * `scripts/audit/field-provenance.mjs`.
 */
export function isStampContradicted(entry: FieldProvenanceEntry | undefined, value: unknown, placeholder: (v: string) => boolean): boolean {
  if (!entry || typeof value !== 'string') return false;
  const claimsUpstream = typeof entry.method === 'string' && /metadata|catalog|manifest|authority/i.test(entry.method);
  return claimsUpstream && placeholder(value);
}
