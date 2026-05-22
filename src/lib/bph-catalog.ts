/**
 * Mutation helper for the BPH catalogue (Supabase `bph_works`).
 *
 * Source Library is becoming the BPH catalogue of record (see issue #1878),
 * which means every change to `bph_works` must be traceable: who proposed it,
 * who applied it, when, and what source they were citing. `applyWorkRevision`
 * is the single mutation path. Anything else writing to `bph_works` directly
 * is a bug — code review enforces this, and `bph_works_revisions` RLS is the
 * second line of defence.
 *
 * Three things happen on every call, in order:
 *
 *   1. INSERT into `bph_works_revisions` (append-only). If this fails, we
 *      abort — better to have no change than a change without history.
 *   2. UPDATE `bph_works` row: apply `to` values + merge per-field provenance
 *      into the existing JSONB. Field-level provenance entries carry source,
 *      evidence, editor email, and timestamp.
 *   3. Best-effort mirror to Atlas `books` for the curated subset (title,
 *      author, year, place, publisher, language). Only fires when the BPH
 *      row is matched to a Source Library book via `sl_book_id`. Mirror
 *      failures are logged and swallowed — bph_works is canonical.
 *
 * Issue: #1877.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { getDb } from '@/lib/mongodb';

/**
 * Fields a contributor or editor can change through this helper. Adding a
 * new field here is the explicit code-review step that gates expanding the
 * editor — keeps drift impossible.
 *
 * `sl_book_id`, `sl_book_slug`, `field_provenance`, `search_tsv`, and the
 * timestamps are deliberately excluded — they're managed by other writers
 * (link enrichers, the generated tsvector trigger, this helper itself).
 */
export const EDITABLE_BPH_FIELDS = [
  // Title family
  'title',
  'parallel_title',
  'uniform_title',
  // Authorship
  'author',
  'variant_author',
  'pseudonym',
  'editor',
  'variant_editor',
  // Author authority (#1921 P3) — VIAF id is the canonical anchor; the
  // sibling display fields are denormalised so the catalog page renders
  // without an extra join. The whole triple flips together via the picker.
  'author_entity_id',
  'author_canonical_name',
  'author_wikidata_qid',
  // Imprint
  'place',
  'printer',
  'publisher',
  'variant_printer',
  'variant_publisher',
  'year',
  // Series / volume
  'series_title',
  'volume_title',
  // Location
  'shelf_mark',
  'state_shelf_mark',
  'present_location',
  // Subject / language
  'keywords',
  'language',
  // Physical
  'object_size_cm',
  'bibliographic_format',
  'binding',
  'bound_with',
  'number_of_copies',
  // Notes
  'bibliography',
  'remarks',
  // Provenance
  'provenance',
  // External identifiers — contributors can correct/add a USTC or IA match
  'ustc_sn',
  'ia_identifier',
] as const;

export type EditableBphField = (typeof EDITABLE_BPH_FIELDS)[number];

/** Subset of bph_works that mirrors back to Atlas `books` (one-way). */
const ATLAS_MIRROR_FIELDS: Record<string, string> = {
  // bph_works column → Atlas books field
  title: 'title',
  author: 'author',
  year: 'year',
  place: 'place_published',
  publisher: 'publisher',
  language: 'language',
};

export type ChangeType = 'edit' | 'create' | 'delete';

export interface FieldChange {
  /** Pre-edit value (from the live row at the moment of application). */
  from: unknown;
  /** New value being applied. */
  to: unknown;
  /** Citation: where the contributor / editor learned this value. */
  source?: string;
  /** Optional URL or further evidence supporting the source. */
  evidence?: string;
}

export type FieldChangeMap = Partial<Record<EditableBphField, FieldChange>>;

export interface ApplyWorkRevisionInput {
  ubn: string;
  changeType?: ChangeType;
  fieldChanges: FieldChangeMap;
  /** Email of the editor applying the change. Use 'system:<job>' for cron writes. */
  editorEmail: string;
  /** Contributor's email if this revision was applied from a pending row. */
  proposedBy?: string | null;
  /** Pending-changes UUID that produced this revision. */
  sourcePendingId?: string | null;
  /** Free-text note attached to the revision (visible in history). */
  note?: string | null;
}

export interface ApplyWorkRevisionResult {
  revisionId: string;
  appliedAt: string;
}

export class BphCatalogError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'BphCatalogError';
  }
}

function assertEditableFields(fieldChanges: FieldChangeMap): asserts fieldChanges is FieldChangeMap {
  const allowed = new Set<string>(EDITABLE_BPH_FIELDS);
  for (const key of Object.keys(fieldChanges)) {
    if (!allowed.has(key)) {
      throw new BphCatalogError(`Field "${key}" is not editable via applyWorkRevision`);
    }
  }
}

/**
 * Apply a revision to a BPH work. Single mutation path for bph_works.
 *
 * Throws BphCatalogError on any failure. Caller should treat the error as
 * "nothing changed" — the helper aborts before mutating bph_works if it
 * can't write the revision row, and bph_works is mutated atomically as one
 * UPDATE so partial writes aren't possible.
 */
export async function applyWorkRevision(input: ApplyWorkRevisionInput): Promise<ApplyWorkRevisionResult> {
  if (!supabaseAdmin) {
    throw new BphCatalogError('supabaseAdmin not configured — SUPABASE_SERVICE_ROLE_KEY missing');
  }

  const {
    ubn,
    changeType = 'edit',
    fieldChanges,
    editorEmail,
    proposedBy = null,
    sourcePendingId = null,
    note = null,
  } = input;

  if (!ubn) throw new BphCatalogError('ubn is required');
  if (!editorEmail) throw new BphCatalogError('editorEmail is required');
  if (Object.keys(fieldChanges).length === 0) {
    throw new BphCatalogError('fieldChanges is empty — nothing to apply');
  }
  assertEditableFields(fieldChanges);

  // 1. Fetch the current row so we can: (a) merge field_provenance without
  //    clobbering existing entries (USTC matcher, metadata enrichment, etc.)
  //    write their own provenance keys and we must preserve them, and
  //    (b) capture the `from` snapshot for the revisions row.
  // Supabase typed select() with a dynamic column list returns an over-broad
  // union; the runtime shape is { ubn, field_provenance, sl_book_id, ...editable fields }
  // so we cast through unknown and narrow on the application side.
  const selectCols = ['ubn', 'field_provenance', 'sl_book_id', ...Object.keys(fieldChanges)].join(', ');
  const { data: rawCurrent, error: fetchErr } = await supabaseAdmin
    .from('bph_works')
    .select(selectCols)
    .eq('ubn', ubn)
    .maybeSingle();

  if (fetchErr) throw new BphCatalogError('fetch bph_works failed', fetchErr);
  const current = rawCurrent as unknown as
    | (Record<string, unknown> & { field_provenance: unknown; sl_book_id: string | null })
    | null;
  if (!current && changeType !== 'create') {
    throw new BphCatalogError(`bph_works row not found for ubn=${ubn}`);
  }

  const appliedAt = new Date().toISOString();
  const revisionId = crypto.randomUUID();

  // Build the from-snapshot from the live row (caller-supplied `from` is the
  // value the contributor saw at submit time — we override with the actual
  // current value so revision history is accurate at the moment of application).
  const liveFieldChanges: FieldChangeMap = {};
  const updates: Record<string, unknown> = {};
  const provenancePatch: Record<string, unknown> = {};

  for (const [field, change] of Object.entries(fieldChanges) as [EditableBphField, FieldChange][]) {
    const liveFrom = current ? current[field] : null;
    liveFieldChanges[field] = {
      from: liveFrom ?? null,
      to: change.to,
      ...(change.source ? { source: change.source } : {}),
      ...(change.evidence ? { evidence: change.evidence } : {}),
    };
    updates[field] = change.to;
    provenancePatch[field] = {
      ...(change.source ? { source: change.source } : { source: 'manual' }),
      ...(change.evidence ? { evidence: change.evidence } : {}),
      edited_by: editorEmail,
      edited_at: appliedAt,
      ...(proposedBy ? { proposed_by: proposedBy } : {}),
    };
  }

  // 2. Write the revision row FIRST. If this fails, we abort without touching
  //    bph_works — better to refuse the edit than to mutate the live row
  //    without recording history.
  const { error: revErr } = await supabaseAdmin
    .from('bph_works_revisions')
    .insert({
      id: revisionId,
      ubn,
      change_type: changeType,
      field_changes: liveFieldChanges,
      editor_email: editorEmail,
      proposed_by: proposedBy,
      source_pending_id: sourcePendingId,
      applied_at: appliedAt,
      note,
    });

  if (revErr) throw new BphCatalogError('insert bph_works_revisions failed', revErr);

  // 3. Update bph_works. Merge provenance into the existing JSONB so other
  //    writers' entries survive — Postgres does a deep merge with `||` only
  //    at top level, which is exactly what we want here (per-field keys).
  const existingProvenance = current?.field_provenance;
  const mergedProvenance = {
    ...(typeof existingProvenance === 'object' && existingProvenance !== null
      ? (existingProvenance as Record<string, unknown>)
      : {}),
    ...provenancePatch,
  };

  const { error: updErr } = await supabaseAdmin
    .from('bph_works')
    .update({
      ...updates,
      field_provenance: mergedProvenance,
    })
    .eq('ubn', ubn);

  if (updErr) {
    // Revision row is already in. Surface the error so the caller knows
    // bph_works was NOT mutated, and the revision is a no-op record.
    // Operationally rare — a later cleanup script can flag orphan revisions
    // whose field_changes never landed.
    throw new BphCatalogError('update bph_works failed (revision is orphaned)', updErr);
  }

  // 4. Best-effort Atlas mirror. The BPH row is canonical; Atlas books is
  //    derived. Failures here are logged and swallowed — the cron supabase
  //    sync (or the next applyWorkRevision) will recover.
  const slBookId = current?.sl_book_id;
  if (slBookId) {
    try {
      await mirrorToAtlas(slBookId, updates);
    } catch (mirrorErr) {
      console.warn(`[bph-catalog] Atlas mirror failed for ubn=${ubn}, book=${slBookId}:`, mirrorErr);
    }
  }

  return { revisionId, appliedAt };
}

/**
 * Write the curated subset of fields onto the matched Atlas books row.
 * One-way: Supabase bph_works is canonical for BPH-held works.
 */
async function mirrorToAtlas(bookId: string, updates: Record<string, unknown>): Promise<void> {
  const atlasUpdates: Record<string, unknown> = {};
  for (const [bphField, atlasField] of Object.entries(ATLAS_MIRROR_FIELDS)) {
    if (bphField in updates) {
      atlasUpdates[atlasField] = updates[bphField];
    }
  }
  if (Object.keys(atlasUpdates).length === 0) return;

  atlasUpdates.updated_at = new Date();

  const db = await getDb();
  await db.collection('books').updateOne({ id: bookId }, { $set: atlasUpdates });
}
