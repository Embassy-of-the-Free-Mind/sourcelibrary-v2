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
import { catalogKeyColumn } from '@/lib/bph-catalog-key';

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
  // What kind of object this record describes. Decides which fields the editor
  // form even shows, and gates two of the worklist buckets. Constrained enum
  // `bph_record_type`; measured production values are exactly:
  // printed (28,110) · photocopy (959) · manuscript (812).
  'record_type',
  // Title family. `full_title` is where MANUSCRIPTS keep their title — 82% of
  // the 812 manuscripts have one and ZERO have `title` — so leaving it out of
  // this whitelist made a manuscript's title uneditable anywhere in the UI
  // (José Bouman, 2026-08-13: "the same format as those already catalogued").
  'title',
  'full_title',
  'parallel_title',
  'uniform_title',
  // Authorship
  'author',
  'variant_author',
  'pseudonym',
  'editor',
  'variant_editor',
  // Author authority (#1921 P3) — VIAF id is the canonical anchor; the
  // Author authority — entity_id is the FK into the `entities` collection
  // (string of entity._id), shared with the batch enrichment script. Three
  // siblings denormalised so the catalog page renders without a join. The
  // whole quad flips together via the picker.
  'author_entity_id',
  'author_canonical_name',
  'author_wikidata_qid',
  'author_viaf_id',
  // Repeatable authors/contributors (Paul D., 2026-06-24) — a JSONB array of
  // BphContributor, each optionally linked to a canonical authors._id. The
  // primary `author` above stays the lead author (display/search/Atlas mirror);
  // this is the additive "Add author" layer for co-authors, editors, etc.
  'contributors',
  // Imprint
  'place',
  'printer',
  'publisher',
  'variant_printer',
  'variant_publisher',
  'year',
  // Verbatim original imprint line as printed on the title page (Paul D.).
  'impressum_original',
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
  // Memorix "Internal remarks" — staff working notes. Editable/visible for
  // editor+ only; the public catalog entry page must never render it.
  'internal_remarks',
  // Exhibition history — where this copy has been shown (José B., 2026-07-29).
  // Staff-only on the same terms as internal_remarks. Unbounded TEXT: entries
  // accumulate one line per exhibition over the life of a copy.
  'exhibition_history',
  // Provenance (ownership history) + collection (named collection the copy
  // belongs to) — kept as two distinct fields per Paul D. (2026-06-24).
  'provenance',
  'collection',
  // External identifiers — contributors can correct/add a USTC or IA match
  'ustc_sn',
  'ia_identifier',
] as const;

export type EditableBphField = (typeof EDITABLE_BPH_FIELDS)[number];

// Contributor type + role vocabulary live in a client-safe module (no server
// deps) so 'use client' components can import them without pulling this
// mongodb/supabase-bound module into the browser bundle. Re-exported here for
// server-side callers.
export { BPH_CONTRIBUTOR_ROLES } from './bph-contributors';
export type { BphContributor, BphContributorRole } from './bph-contributors';

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
  /**
   * How to address the work: a UBN, or — for the 2,012 records Memorix issues
   * no UBN for (manuscripts, photographs) — that row's `uuid`. Which column is
   * queried is decided by shape via catalogKeyColumn(), the same rule the
   * /catalog/{key} route uses; no UBN in production is uuid-shaped, so the two
   * cannot collide.
   *
   * On create this is the identifier the new row gets. Pass a uuid here to
   * create a record with NO ubn, which is what a manuscript requires — the BPH
   * writes UBNs into the physical book by hand, so a synthetic one would end up
   * in ink inside a manuscript that is not supposed to have one (José Bouman,
   * 2026-08-13).
   */
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

  // Which column this key addresses. Shape-based, identical to the public
  // route's rule — see src/lib/bph-catalog-key.ts for why it cannot collide.
  const keyCol = catalogKeyColumn(ubn);
  const isUuidKeyed = keyCol === 'uuid';

  // 1. Fetch the current row so we can: (a) merge field_provenance without
  //    clobbering existing entries (USTC matcher, metadata enrichment, etc.)
  //    write their own provenance keys and we must preserve them, and
  //    (b) capture the `from` snapshot for the revisions row.
  // Supabase typed select() with a dynamic column list returns an over-broad
  // union; the runtime shape is { ubn, field_provenance, sl_book_id, ...editable fields }
  // so we cast through unknown and narrow on the application side.
  const selectCols = ['ubn', 'uuid', 'field_provenance', 'sl_book_id', ...Object.keys(fieldChanges)].join(', ');
  const { data: rawCurrent, error: fetchErr } = await supabaseAdmin
    .from('bph_works')
    .select(selectCols)
    .eq(keyCol, ubn)
    .maybeSingle();

  if (fetchErr) throw new BphCatalogError('fetch bph_works failed', fetchErr);
  const current = rawCurrent as unknown as
    | (Record<string, unknown> & { uuid: string | null; field_provenance: unknown; sl_book_id: string | null })
    | null;
  if (!current && changeType !== 'create') {
    throw new BphCatalogError(`bph_works row not found for ${keyCol}=${ubn}`);
  }
  if (current && changeType === 'create') {
    throw new BphCatalogError(
      isUuidKeyed
        ? `A catalogue entry with uuid "${ubn}" already exists — edit it instead`
        : `A catalogue entry with UBN "${ubn}" already exists — edit it instead`,
    );
  }

  // The uuid this revision hangs off. For a ubn-keyed edit it comes from the
  // live row; for a uuid-keyed create the caller's key IS the uuid; for a
  // ubn-keyed create we mint one so every new row is addressable both ways.
  const workUuid = isUuidKeyed ? ubn : current?.uuid || crypto.randomUUID();

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

  const existingProvenance = current?.field_provenance;
  const mergedProvenance = {
    ...(typeof existingProvenance === 'object' && existingProvenance !== null
      ? (existingProvenance as Record<string, unknown>)
      : {}),
    ...provenancePatch,
  };

  // A revision targets a work by UBN or by uuid — never neither (there is a
  // CHECK constraint saying so). Manuscripts and photographs have no UBN at
  // all, so `ubn` is null for those and `work_uuid` carries the link. See
  // scripts/migration/add-bph-uuid-keyed-revisions.sql.
  const revisionRow = {
    id: revisionId,
    ubn: isUuidKeyed ? (current?.ubn as string | null) ?? null : ubn,
    work_uuid: workUuid,
    change_type: changeType,
    field_changes: liveFieldChanges,
    editor_email: editorEmail,
    proposed_by: proposedBy,
    source_pending_id: sourcePendingId,
    applied_at: appliedAt,
    note,
  };

  /**
   * Insert the revision, degrading if the work_uuid migration hasn't run on
   * this environment yet.
   *
   * Without this, deploying the code before applying the migration would break
   * EVERY catalogue edit, not just the manuscript ones — an unknown column
   * fails the insert, and the insert is the gate the whole mutation path sits
   * behind. A ubn-keyed edit works perfectly well on the old schema, so it
   * should keep working; only the uuid-keyed rows genuinely need the column,
   * and they are unreachable on the old schema anyway (the FK would reject
   * them). Mirrors the same graceful-degradation pattern used by the catalogue
   * read routes for un-run migrations.
   */
  const insertRevision = async () => {
    const first = await supabaseAdmin!.from('bph_works_revisions').insert(revisionRow);
    if (!first.error) return first;
    const msg = (first.error.message || '').toLowerCase();
    const missingColumn =
      msg.includes('work_uuid') && (msg.includes('does not exist') || msg.includes('could not find'));
    if (!missingColumn) return first;
    if (isUuidKeyed) {
      // No ubn to fall back on: this row is only reachable through the new
      // schema. Report the real cause rather than a confusing FK error.
      return {
        ...first,
        error: {
          ...first.error,
          message:
            'This record has no UBN, which needs scripts/migration/add-bph-uuid-keyed-revisions.sql to be applied first. ' +
            first.error.message,
        },
      };
    }
    const { work_uuid: _dropped, ...legacyRow } = revisionRow;
    return supabaseAdmin!.from('bph_works_revisions').insert(legacyRow);
  };

  if (changeType === 'create') {
    // 2a. The revisions table has a FK on ubn → bph_works(ubn), so the row
    //     must exist before its revision. INSERT the row first, then the
    //     history; if the history write fails, roll the row back so we never
    //     leave a created record with no provenance trail. Only `ubn` is
    //     required by the schema (everything else nullable). The row is marked
    //     Source-Library-originated (via acquisition_source) so it's
    //     distinguishable from Memorix-synced rows.
    //
    //     `record_type` is supplied by the cataloguer through the form (it
    //     decides which fields the form even shows), so it arrives in
    //     `updates` like any other field. It used to be left unset here
    //     rather than guessed between printed/manuscript/photocopy — but a
    //     record with no type can never appear in the worklist buckets that
    //     filter on it, so guessing was replaced by asking.
    //
    //     A uuid-keyed create writes NO ubn: that is the manuscript case.
    const { error: insErr } = await supabaseAdmin
      .from('bph_works')
      .insert({
        ubn: isUuidKeyed ? null : ubn,
        uuid: workUuid,
        ...updates,
        field_provenance: mergedProvenance,
        created_at: appliedAt,
        acquisition_source: `source-library-editor:${editorEmail}`,
      });
    if (insErr) {
      throw new BphCatalogError('insert bph_works failed', insErr);
    }
    const { error: revErr } = await insertRevision();
    if (revErr) {
      // Roll back the just-created row — a record without history would
      // violate the audit invariant. Delete by uuid: it is set on every row we
      // insert, including the manuscripts that have no ubn to delete by.
      await supabaseAdmin.from('bph_works').delete().eq('uuid', workUuid);
      throw new BphCatalogError('insert bph_works_revisions failed (create rolled back)', revErr);
    }
  } else {
    // 2b. Edit: write the revision FIRST. If it fails we abort without
    //     touching the live row — better to refuse the edit than to mutate
    //     bph_works without recording history. Then UPDATE in place, merging
    //     provenance into the existing JSONB so other writers' entries survive
    //     (Postgres `||` deep-merges at the top level — per-field keys).
    const { error: revErr } = await insertRevision();
    if (revErr) throw new BphCatalogError('insert bph_works_revisions failed', revErr);

    const { error: updErr } = await supabaseAdmin
      .from('bph_works')
      .update({
        ...updates,
        field_provenance: mergedProvenance,
      })
      .eq(keyCol, ubn);

    if (updErr) {
      // Revision row is already in. Surface the error so the caller knows
      // bph_works was NOT mutated, and the revision is a no-op record.
      // Operationally rare — a later cleanup script can flag orphan revisions
      // whose field_changes never landed.
      throw new BphCatalogError('update bph_works failed (revision is orphaned)', updErr);
    }
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
 * First UBN reserved for records created on Source Library. The BPH's own
 * numbering is dense up to ~32,999, so 33,000 is the agreed start of the new
 * range (José Bouman, 2026-07-15) — see UBN_ALLOCATION_START's usage below.
 */
export const UBN_ALLOCATION_START = 33000;

/** How many ids to probe per round-trip when hunting for a free number. */
const UBN_PROBE_WINDOW = 200;

/** Give up after this many windows (covers 33,000 – 53,000). */
const UBN_MAX_PROBES = 100;

/**
 * Suggest the next free numeric UBN, starting at 33,000.
 *
 * This used to hand out `SL-000123`. The prefix was there to keep new records
 * out of the BPH's authoritative numeric namespace, but the BPH writes the UBN
 * into the physical book by hand and the `SL-` was too easy to forget, so a
 * shelf number and a catalogue number could silently diverge (José Bouman,
 * feedback 2026-07-15). A reserved numeric range gives the same collision
 * safety with nothing to forget. No `SL-` record was ever created, so there is
 * no legacy id to migrate.
 *
 * Collision safety is not assumed — the allocator probes a window of ids and
 * returns the lowest one that is actually free, so it stays correct as the
 * range fills and against the ~20 stray numeric UBNs that already sit above
 * 33,000 (39424, 40402, … 272622). Uniqueness is still enforced underneath by
 * the primary key and the create guard in applyWorkRevision; this only picks a
 * sensible default that the editor can overwrite with a real BPH UBN.
 *
 * Best-effort: on any lookup failure we fall back to the start of the range so
 * the create page still renders a usable default.
 */
export async function suggestNewUbn(): Promise<string> {
  if (!supabaseAdmin) return String(UBN_ALLOCATION_START);
  try {
    for (let probe = 0; probe < UBN_MAX_PROBES; probe++) {
      const base = UBN_ALLOCATION_START + probe * UBN_PROBE_WINDOW;
      const window = Array.from({ length: UBN_PROBE_WINDOW }, (_, i) => String(base + i));
      const { data, error } = await supabaseAdmin
        .from('bph_works')
        .select('ubn')
        .in('ubn', window);
      if (error) throw error;
      const taken = new Set((data as { ubn: string }[] | null)?.map((r) => r.ubn) ?? []);
      const free = window.find((candidate) => !taken.has(candidate));
      if (free) return free;
    }
    // Every id in the probed range is taken — fall through to the range start
    // rather than guessing past the window; the editor sets the UBN by hand.
    return String(UBN_ALLOCATION_START);
  } catch {
    return String(UBN_ALLOCATION_START);
  }
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
