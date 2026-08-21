'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import AuthorAuthorityPicker, { type AuthorAuthoritySelection } from '@/components/catalog/AuthorAuthorityPicker';
import ContributorsEditor from '@/components/catalog/ContributorsEditor';
import type { BphContributor } from '@/lib/bph-contributors';

/**
 * BPH catalogue entry edit form. Renders every whitelisted editable field
 * grouped by section, captures a single "Source" citation that applies to
 * any changed field on this save, and POSTs to the editor API which calls
 * applyWorkRevision (see src/lib/bph-catalog.ts).
 *
 * The "from" snapshot recorded in the revision is whatever bph_works held
 * at the moment the API processes the request — NOT what was on the form
 * when it loaded. So a stale tab whose values are now wrong still produces
 * accurate revision history; the worst case is a noisy diff showing the
 * intervening change being overwritten.
 *
 * Repeatable authors/contributors ARE supported via the `contributors` JSONB
 * column (BphContributor[]), edited through ContributorsEditor and linked to
 * our canonical author thesaurus. Other repeatables (binding, keywords, …)
 * remain single TEXT with the existing comma-separated convention.
 */

interface Props {
  ubn: string;
  tenant: string;
  initial: Record<string, unknown>;
  editorEmail: string;
  /** 'editor' → Save applies directly via applyWorkRevision.
   *  'contributor' → Save queues a row in bph_works_pending_changes for
   *  editor review. The form UI changes copy but is otherwise identical.
   *  'create' → brand-new record; the form shows a UBN field and POSTs to
   *  the create endpoint. `initial` is empty so every filled field is a
   *  change. */
  mode: 'editor' | 'contributor' | 'create';
  /** Create mode only: the pre-filled, editable catalogue id. */
  suggestedUbn?: string;
}

// Mirrors EDITABLE_BPH_FIELDS in src/lib/bph-catalog.ts, organised into the
// same visual sections as the read-only catalog detail page so cataloguers
// can map their mental model 1:1.
const SECTIONS: Array<{
  title: string;
  fields: Array<{ name: string; label: string; type?: 'text' | 'number' | 'textarea'; hidden?: boolean; editorOnly?: boolean }>;
}> = [
  {
    title: 'Title',
    fields: [
      { name: 'title', label: 'Short title' },
      // Manuscripts are titled here, not in `title`: 663 of the 812 manuscripts
      // carry full_title and NONE carry title. It was missing from this form
      // entirely, which made a manuscript's title uneditable anywhere in the UI.
      { name: 'full_title', label: 'Full title', type: 'textarea' },
      { name: 'parallel_title', label: 'Full title (transcription)', type: 'textarea' },
      { name: 'uniform_title', label: 'Variant title' },
      { name: 'series_title', label: 'Series' },
      { name: 'volume_title', label: 'Volume' },
    ],
  },
  {
    title: 'Authorship',
    fields: [
      { name: 'author', label: 'Author (standard name)' },
      { name: 'variant_author', label: 'Author (as on title page)' },
      { name: 'pseudonym', label: 'Pseudonym' },
      { name: 'editor', label: 'Editor / translator' },
      { name: 'variant_editor', label: 'Editor (as on title page)' },
      // VIAF authority fields — driven by the AuthorAuthorityPicker, not a
      // raw text input. Listed here so the change detection + provenance
      // pipeline picks them up. `hidden: true` flips off the visible row.
      { name: 'author_entity_id', label: 'Canonical author entity FK', hidden: true },
      { name: 'author_canonical_name', label: 'Canonical name', hidden: true },
      { name: 'author_wikidata_qid', label: 'Wikidata Q', hidden: true },
      { name: 'author_viaf_id', label: 'VIAF id', hidden: true },
    ],
  },
  {
    title: 'Imprint',
    fields: [
      { name: 'place', label: 'Place of publication' },
      { name: 'year', label: 'Year of publication', type: 'number' },
      { name: 'printer', label: 'Printer' },
      { name: 'variant_printer', label: 'Printer (variant)' },
      { name: 'publisher', label: 'Publisher' },
      { name: 'variant_publisher', label: 'Publisher (variant)' },
      // Verbatim original imprint line as printed (Paul D., 2026-06-24):
      // e.g. "Getruckt vnd verlegt zu Schw. Hall, bey Johann Lentzen, 1641".
      { name: 'impressum_original', label: 'Original impressum (verbatim from title page)', type: 'textarea' },
    ],
  },
  {
    title: 'Subject & Language',
    fields: [
      { name: 'keywords', label: 'Keywords (comma-separated)' },
      { name: 'language', label: 'Language' },
    ],
  },
  {
    title: 'Physical',
    fields: [
      { name: 'object_size_cm', label: 'Object size (cm)' },
      { name: 'bibliographic_format', label: 'Format (folio / quarto / …)' },
      { name: 'number_of_copies', label: 'Number of copies held', type: 'number' },
      { name: 'binding', label: 'Binding', type: 'textarea' },
      { name: 'bound_with', label: 'Bound with', type: 'textarea' },
    ],
  },
  {
    title: 'Location at the BPH',
    fields: [
      { name: 'present_location', label: 'Present location' },
      { name: 'shelf_mark', label: 'Shelf mark' },
      { name: 'state_shelf_mark', label: 'State Collection shelf mark' },
      // Provenance (ownership history) and collection (which named collection
      // the copy belongs to) are distinct — split per Paul D. (2026-06-24).
      { name: 'provenance', label: 'Provenance (ownership history)', type: 'textarea' },
      { name: 'collection', label: 'Collection', type: 'textarea' },
    ],
  },
  {
    title: 'Notes',
    fields: [
      { name: 'bibliography', label: 'Bibliography', type: 'textarea' },
      { name: 'remarks', label: 'Remarks', type: 'textarea' },
      // Memorix "Internal remarks" — staff working notes (José B.). Shown to
      // editors only; the public catalog page never renders this field.
      { name: 'internal_remarks', label: 'Internal remarks (staff only, never public)', type: 'textarea', editorOnly: true },
      // Exhibition history — staff-only on the same terms (José B., 2026-07-29).
      { name: 'exhibition_history', label: 'Exhibition history (staff only, never public)', type: 'textarea', editorOnly: true },
    ],
  },
  {
    title: 'Identifiers',
    fields: [
      { name: 'ustc_sn', label: 'USTC serial number', type: 'number' },
      { name: 'ia_identifier', label: 'Internet Archive identifier' },
    ],
  },
];

/**
 * What kind of object a record describes. Constrained enum `bph_record_type`;
 * production holds exactly these three (28,110 · 959 · 812, measured
 * 2026-08-13). Order is most-common-first so the default sits at the top.
 */
const RECORD_TYPES = [
  { value: 'printed', label: 'Printed book', hint: 'Has a UBN. The default for the collection.' },
  { value: 'manuscript', label: 'Manuscript', hint: 'Identified by its manuscript number (M 341, or bare 216). No UBN.' },
  { value: 'photocopy', label: 'Photograph / photocopy', hint: 'The Fot series. No UBN.' },
] as const;

type RecordType = (typeof RECORD_TYPES)[number]['value'];

/**
 * The fields a manuscript record actually uses, measured across all 812
 * manuscripts in production (2026-08-13). Everything else is 0.0% populated —
 * no manuscript has a title, ubn, place, year, printer, publisher, keywords or
 * number_of_copies, because those describe an edition coming off a press and a
 * manuscript is a unique object.
 *
 *   shelf_mark 100%  ·  full_title 82%  ·  uniform_title 70%  ·  author 64%
 *   language 48%  ·  object_size_cm 47%  ·  remarks 41%  ·  binding 29%
 *   provenance 22%  ·  bibliography 15%
 *
 * This is what "the same format as those already catalogued" means concretely
 * (José Bouman, 2026-08-13). present_location and the two staff-only note
 * fields are included as well — they apply to any physical object we hold.
 */
const MANUSCRIPT_FIELDS = new Set<string>([
  'full_title', 'uniform_title',
  'author', 'variant_author', 'pseudonym',
  'author_entity_id', 'author_canonical_name', 'author_wikidata_qid', 'author_viaf_id',
  'language',
  'object_size_cm', 'binding', 'bound_with',
  'present_location', 'shelf_mark', 'provenance', 'collection',
  'bibliography', 'remarks', 'internal_remarks', 'exhibition_history',
]);

/** Photographs use the same reduced shape as manuscripts. */
const FIELDS_BY_TYPE: Record<RecordType, Set<string> | null> = {
  printed: null, // null = show everything
  manuscript: MANUSCRIPT_FIELDS,
  photocopy: MANUSCRIPT_FIELDS,
};

/** Records of these types carry no UBN, so the create form must not demand one. */
const TYPES_WITHOUT_UBN = new Set<RecordType>(['manuscript', 'photocopy']);

/** Normalise the stored `contributors` JSONB into editable rows. */
function parseContributors(v: unknown): BphContributor[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      role: typeof c.role === 'string' && c.role ? c.role : 'Author',
      name: typeof c.name === 'string' ? c.name : '',
      variant_name: typeof c.variant_name === 'string' ? c.variant_name : '',
      author_id: typeof c.author_id === 'string' ? c.author_id : null,
      canonical_name: typeof c.canonical_name === 'string' ? c.canonical_name : null,
    }));
}

/** Drop blank rows and trim before diffing / saving. */
function cleanContributors(rows: BphContributor[]): BphContributor[] {
  return rows
    .map((c) => ({
      role: c.role || 'Author',
      name: (c.name || '').trim(),
      variant_name: (c.variant_name || '').trim() || undefined,
      author_id: c.author_id || undefined,
      canonical_name: c.author_id ? c.canonical_name || undefined : undefined,
    }))
    .filter((c) => c.name.length > 0);
}

/** Convert null/undefined to '' for form inputs, numbers to strings. */
function toFormValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

/** Convert form string back to the API value: empty → null, number-typed → number. */
function fromFormValue(name: string, raw: string, type: 'text' | 'number' | 'textarea' = 'text'): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (type === 'number') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return trimmed;
}

/** Loose equality that treats null/'' as the same — empty strings come back
    from the DB as null but show as '' in inputs; don't diff those. */
function isUnchanged(orig: unknown, next: unknown): boolean {
  if (orig === next) return true;
  if ((orig === null || orig === undefined || orig === '') && (next === null || next === undefined || next === '')) {
    return true;
  }
  return false;
}

export default function BphWorkEditForm({ ubn, tenant, initial, editorEmail: _editorEmail, mode, suggestedUbn }: Props) {
  const router = useRouter();
  const isCreate = mode === 'create';

  // Form state — one entry per editable field, all strings (number-typed
  // fields are coerced at submit time so users can clear them by deleting).
  const initialFormValues = useMemo(() => {
    const v: Record<string, string> = {};
    for (const section of SECTIONS) {
      for (const field of section.fields) {
        v[field.name] = toFormValue(initial[field.name]);
      }
    }
    return v;
  }, [initial]);

  const [values, setValues] = useState<Record<string, string>>(initialFormValues);
  const initialContributors = useMemo(() => parseContributors(initial.contributors), [initial]);
  const [contributors, setContributors] = useState<BphContributor[]>(initialContributors);
  const contributorsChanged = useMemo(
    () => JSON.stringify(cleanContributors(contributors)) !== JSON.stringify(cleanContributors(initialContributors)),
    [contributors, initialContributors],
  );
  // What kind of object this record describes. Drives which fields the form
  // shows and whether a UBN is required at all. Editable on existing records
  // too: 252 rows with an "M …" shelf mark are typed `printed`, and a librarian
  // needs to be able to correct that.
  const initialRecordType = ((): RecordType => {
    const v = initial.record_type;
    return RECORD_TYPES.some((t) => t.value === v) ? (v as RecordType) : 'printed';
  })();
  const [recordType, setRecordType] = useState<RecordType>(initialRecordType);
  const needsUbn = !TYPES_WITHOUT_UBN.has(recordType);

  // Sections/fields filtered to the chosen record type. Hidden fields stay in
  // the list (they carry the author-authority quad) — the filter is about which
  // *kinds of description* apply to this object, not about the render.
  const visibleSections = useMemo(() => {
    const allowed = FIELDS_BY_TYPE[recordType];
    if (!allowed) return SECTIONS;
    return SECTIONS.map((s) => ({ ...s, fields: s.fields.filter((f) => allowed.has(f.name)) })).filter(
      (s) => s.fields.length > 0,
    );
  }, [recordType]);

  const [createUbn, setCreateUbn] = useState(suggestedUbn || '');
  const [source, setSource] = useState('');
  const [evidence, setEvidence] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedPendingId, setSubmittedPendingId] = useState<string | null>(null);

  const changedFields = useMemo(() => {
    const changed: string[] = [];
    for (const section of SECTIONS) {
      for (const field of section.fields) {
        const next = fromFormValue(field.name, values[field.name] || '', field.type);
        if (!isUnchanged(initial[field.name], next)) {
          changed.push(field.name);
        }
      }
    }
    return changed;
  }, [values, initial]);

  const recordTypeChanged = recordType !== initialRecordType;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Only printed books have a UBN. Demanding one for a manuscript is what
    // blocked José Bouman from cataloguing them at all (2026-08-13); the record
    // is addressed by its uuid instead, and found by its manuscript number.
    if (isCreate && needsUbn && !createUbn.trim()) {
      setError('Give the new record a UBN (catalogue id).');
      return;
    }
    if (isCreate && !needsUbn && !values['shelf_mark']?.trim()) {
      setError(
        recordType === 'manuscript'
          ? 'Give the manuscript its number (e.g. “M 341” or “216”) in the Shelf mark field — it is how the object is found.'
          : 'Give the record its shelf mark (e.g. “Fot 118”) — it is how the object is found.',
      );
      return;
    }
    if (changedFields.length === 0 && !contributorsChanged && !recordTypeChanged) {
      setError(isCreate ? 'Add at least a title before saving.' : 'No fields have changed — nothing to save.');
      return;
    }
    if (!source.trim()) {
      setError(
        isCreate
          ? 'Please cite a source for this record (e.g. "title page" or "BPH accession record").'
          : 'Please cite a source for this change (e.g. "title page, vol. I" or "USTC 12345").',
      );
      return;
    }
    setError(null);
    setSubmitting(true);

    // Build the field_changes payload: only changed fields, with their
    // new value + source citation. The API resolves the actual "from" from
    // the live bph_works row at write time, so revision history is accurate
    // even if the tab is stale.
    const fieldChanges: Record<string, { to: unknown; source: string; evidence?: string }> = {};
    for (const section of SECTIONS) {
      for (const field of section.fields) {
        if (!changedFields.includes(field.name)) continue;
        fieldChanges[field.name] = {
          to: fromFormValue(field.name, values[field.name] || '', field.type),
          source: source.trim(),
          ...(evidence.trim() ? { evidence: evidence.trim() } : {}),
        };
      }
    }
    // Repeatable contributors are a single JSONB field, edited outside the flat
    // value map — include the cleaned array when it changed.
    // record_type lives outside the flat value map (it's a radio group, and it
    // decides what the rest of the form shows). Always sent on create so a new
    // record is typed rather than left null — an untyped record can never
    // appear in the worklist buckets that filter on record_type.
    if (recordTypeChanged || isCreate) {
      fieldChanges.record_type = {
        to: recordType,
        source: source.trim(),
        ...(evidence.trim() ? { evidence: evidence.trim() } : {}),
      };
    }
    if (contributorsChanged) {
      fieldChanges.contributors = {
        to: cleanContributors(contributors),
        source: source.trim(),
        ...(evidence.trim() ? { evidence: evidence.trim() } : {}),
      };
    }

    try {
      const endpoint = isCreate
        ? `/api/${tenant}/catalog/create`
        : `/api/${tenant}/catalog/${encodeURIComponent(ubn)}/edit`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // A UBN-less record sends no ubn at all; the API mints a uuid to key
          // it by. Sending '' would read as "a UBN I forgot to fill in".
          ...(isCreate && needsUbn ? { ubn: createUbn.trim() } : {}),
          fieldChanges,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        setError(body.error || `Save failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      const body = (await res.json()) as {
        mode?: 'applied' | 'queued' | 'created';
        pendingId?: string;
        ubn?: string;
        key?: string;
      };
      if (body.mode === 'created') {
        // New record is live. Land the cataloguer on it so they can see the
        // entry they just made (and its first history row). `key` is the
        // addressable id — the UBN for printed books, the minted uuid for
        // manuscripts and photographs, which have no UBN to navigate by.
        const newKey = body.key || body.ubn || createUbn.trim();
        router.push(`/catalog/${encodeURIComponent(newKey)}`);
        router.refresh();
        return;
      }
      if (body.mode === 'queued' && body.pendingId) {
        // Contributor flow: hold on the form, show a clear success banner,
        // and let the user navigate back when they're ready. Redirecting to
        // the detail page would land them on the unchanged record with no
        // signal that their work landed somewhere.
        setSubmittedPendingId(body.pendingId);
        setSubmitting(false);
        return;
      }
      // Editor flow: changes are live. Bounce back to the detail page so the
      // updated values are visible immediately (router.refresh forces a
      // fresh server-side fetch).
      router.push(`/catalog/${encodeURIComponent(ubn)}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message || 'Save failed');
      setSubmitting(false);
    }
  };

  if (submittedPendingId) {
    return (
      <div className="p-6 rounded-lg border border-accent-gold/50 bg-accent-gold/10">
        <h2 className="text-lg font-medium text-primary mb-2">Submitted for review</h2>
        <p className="text-sm text-secondary mb-4">
          An editor will look at your proposed change and either apply it or leave a note explaining why not. The change isn&rsquo;t live yet — the catalogue entry is unchanged until the editor approves.
        </p>
        <p className="text-xs text-muted mb-4 font-mono">Submission ID: {submittedPendingId}</p>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/catalog/${encodeURIComponent(ubn)}`}
            className="px-3 py-1.5 text-sm rounded-md bg-accent-rust text-white hover:bg-accent-rust/90 transition-colors"
          >
            Back to catalogue entry
          </a>
          <a
            href={`/catalog/${encodeURIComponent(ubn)}/edit`}
            className="px-3 py-1.5 text-sm rounded-md border border-border-light text-secondary hover:bg-warm hover:text-primary transition-colors"
          >
            Propose another change
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Mode banner — clarifies what Save will do. Contributor edits queue
          for editor review; editor edits apply immediately. Both write to
          the same revision history once approved. */}
      {mode === 'contributor' && (
        <div className="p-3 rounded-lg border border-accent-gold/50 bg-accent-gold/10 text-sm text-primary">
          <p className="font-medium mb-0.5">Your changes will be sent for review</p>
          <p className="text-xs text-secondary">
            An editor (Jose or Paul) will see your proposed changes and either apply them or leave a note. You&rsquo;ll be able to track the status from this work&rsquo;s page.
          </p>
        </div>
      )}

      {/* What is being catalogued. First question on the form, because it
          decides which fields the rest of it shows and whether a UBN applies
          at all — "the blank form should show other fields than the one for
          printed books. No UBN required." (José Bouman, 2026-08-13) */}
      <div className="p-4 bg-white border border-border-light rounded-lg">
        <h2 className="text-xs uppercase tracking-wider text-muted font-medium mb-3">
          {isCreate ? 'What are you cataloguing?' : 'Kind of record'}
        </h2>
        <div className="space-y-2">
          {RECORD_TYPES.map((t) => (
            <label key={t.value} className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="record_type"
                value={t.value}
                checked={recordType === t.value}
                onChange={() => setRecordType(t.value)}
                className="mt-1 accent-accent-rust"
              />
              <span className="text-sm">
                <span className="text-primary font-medium">{t.label}</span>
                {recordTypeChanged && recordType === t.value && (
                  <span className="ml-2 text-[10px] uppercase text-accent-rust font-medium">changed</span>
                )}
                <span className="block text-xs text-muted">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Create mode — the catalogue id, for the record types that have one.
          Pre-filled from the 33,000+ allocation range (José Bouman, 2026-07-15:
          the UBN gets written into the physical book by hand, so it must be a
          plain number in the BPH's own sequence). */}
      {isCreate && needsUbn && (
        <div className="p-4 bg-white border border-border-light rounded-lg">
          <h2 className="text-xs uppercase tracking-wider text-muted font-medium mb-3">New catalogue record</h2>
          <FormField
            label="UBN (catalogue id) *"
            hint="Pre-filled with the next free number in the BPH range. Replace it if this record already has a UBN. Letters, numbers, dot, dash, underscore only."
          >
            <input
              type="text"
              value={createUbn}
              onChange={(e) => setCreateUbn(e.target.value)}
              className="w-full text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
              placeholder={suggestedUbn || '33000'}
            />
          </FormField>
        </div>
      )}

      {/* Create mode, no-UBN types — say plainly that this is correct, not a
          field we forgot. The shelf mark below carries the identity. */}
      {isCreate && !needsUbn && (
        <div className="p-4 bg-white border border-border-light rounded-lg">
          <h2 className="text-xs uppercase tracking-wider text-muted font-medium mb-1">No UBN</h2>
          <p className="text-sm text-secondary">
            {recordType === 'manuscript'
              ? 'Manuscripts have no UBN. Give this one its manuscript number in the Shelf mark field below — “M 341”, or a bare number like “216”.'
              : 'Photographs have no UBN. Give this one its shelf mark in the field below — e.g. “Fot 118”.'}
          </p>
        </div>
      )}

      {/* Edit mode — surface the identifier read-only so the cataloguer always
          sees which record they're editing (Paul D., 2026-06-24). */}
      {!isCreate && (
        <div className="p-4 bg-white border border-border-light rounded-lg">
          <h2 className="text-xs uppercase tracking-wider text-muted font-medium mb-1">
            {needsUbn ? 'UBN (catalogue id)' : 'Record id (no UBN)'}
          </h2>
          <p className="font-mono text-sm text-primary">{ubn}</p>
        </div>
      )}

      {/* Source citation — required, applies to every changed field. */}
      <div className="p-4 bg-white border border-border-light rounded-lg">
        <h2 className="text-xs uppercase tracking-wider text-muted font-medium mb-3">
          {isCreate ? 'Source for this record' : 'Source for this change'}
        </h2>
        <div className="space-y-3">
          <FormField label="Source citation *" hint="What did you consult to make this change? E.g. &ldquo;title page, vol. I, 1602&rdquo; or &ldquo;USTC 2024571&rdquo;.">
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
              placeholder="e.g. title page · USTC 2024571 · author's autograph note"
            />
          </FormField>
          <FormField label="Evidence URL (optional)" hint="A link supporting the source — IIIF manifest, scan, USTC page.">
            <input
              type="text"
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              className="w-full text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
              placeholder="https://…"
            />
          </FormField>
          <FormField label="Revision note (optional)" hint="A free-text note attached to the history entry.">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
              placeholder="e.g. correcting OCR-induced 'rn' → 'm'"
            />
          </FormField>
        </div>
      </div>

      {visibleSections.map((section) => (
        <section key={section.title}>
          <h2 className="text-xs uppercase tracking-wider text-muted font-medium mb-2">{section.title}</h2>
          <div className="space-y-3 p-4 bg-white border border-border-light rounded-lg">
            {/* Author authority picker rendered inline within the Authorship
                section so cataloguers can canonicalise the author in the same
                visual block where they edit the title-page form. The picker
                writes to three "hidden" virtual fields (author_entity_id +
                siblings) which flow through the regular change-detection /
                provenance pipeline like any other edit. */}
            {section.title === 'Authorship' && (
              <div className="pb-2 border-b border-stone-100">
                <label className="flex items-baseline gap-2 mb-1">
                  <span className="text-xs text-muted">Standard name (VIAF)</span>
                  {(changedFields.includes('author_entity_id') ||
                    changedFields.includes('author_canonical_name') ||
                    changedFields.includes('author_wikidata_qid') ||
                    changedFields.includes('author_viaf_id')) && (
                    <span className="text-[10px] uppercase text-accent-rust font-medium">changed</span>
                  )}
                </label>
                <AuthorAuthorityPicker
                  authorText={values.author || values.variant_author || ''}
                  current={{
                    viaf_id: values.author_viaf_id || null,
                    wikidata_qid: values.author_wikidata_qid || null,
                    canonical_name: values.author_canonical_name || null,
                  }}
                  onSelect={(sel: AuthorAuthoritySelection) => {
                    setValues((v) => ({
                      ...v,
                      author_entity_id: sel.entity_id,
                      author_viaf_id: sel.viaf_id,
                      author_canonical_name: sel.canonical_name,
                      author_wikidata_qid: sel.wikidata_qid || '',
                    }));
                  }}
                  onClear={() => {
                    setValues((v) => ({
                      ...v,
                      author_entity_id: '',
                      author_viaf_id: '',
                      author_canonical_name: '',
                      author_wikidata_qid: '',
                    }));
                  }}
                />
              </div>
            )}
            {section.fields.filter((f) => !f.hidden && !(f.editorOnly && mode === 'contributor')).map((field) => {
              const provenance =
                (initial.field_provenance as Record<string, { source?: string; edited_by?: string; edited_at?: string }> | null)?.[field.name];
              const isChanged = changedFields.includes(field.name);
              return (
                <FormField
                  key={field.name}
                  label={field.label}
                  changed={isChanged}
                  hint={
                    provenance?.source
                      ? `Last source: ${provenance.source}${provenance.edited_by ? ` · ${provenance.edited_by}` : ''}`
                      : undefined
                  }
                >
                  {field.type === 'textarea' ? (
                    <textarea
                      value={values[field.name] || ''}
                      onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                      rows={2}
                      className="w-full text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
                    />
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      inputMode={field.type === 'number' ? 'numeric' : undefined}
                      value={values[field.name] || ''}
                      onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                      className="w-full text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
                    />
                  )}
                </FormField>
              );
            })}
            {/* Repeatable authors / contributors (Paul D.) — the "Add author"
                layer beyond the lead author, each linkable to our thesaurus. */}
            {section.title === 'Authorship' && (
              <div className="pt-2 border-t border-stone-100">
                <label className="flex items-baseline gap-2 mb-2">
                  <span className="text-xs text-muted">Additional authors &amp; contributors</span>
                  {contributorsChanged && (
                    <span className="text-[10px] uppercase text-accent-rust font-medium">changed</span>
                  )}
                </label>
                <ContributorsEditor value={contributors} onChange={setContributors} />
              </div>
            )}
          </div>
        </section>
      ))}

      {/* Sticky save bar — always visible so cataloguers don't have to
          scroll back to the top after editing the bottom of the form. */}
      <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 p-3 bg-white border border-border-light rounded-lg shadow-sm">
        <div className="text-sm text-muted">
          {changedFields.length + (contributorsChanged ? 1 : 0) === 0 ? (
            isCreate ? 'Add a title to begin' : 'No changes yet'
          ) : (
            <>
              <span className="font-medium text-primary">{changedFields.length + (contributorsChanged ? 1 : 0)}</span>{' '}
              field{changedFields.length + (contributorsChanged ? 1 : 0) === 1 ? '' : 's'} {isCreate ? 'filled' : 'changed'}
            </>
          )}
          {error && <span className="ml-3 text-accent-rust">{error}</span>}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={isCreate ? '/catalog' : `/catalog/${encodeURIComponent(ubn)}`}
            className="px-3 py-1.5 text-sm text-muted hover:text-primary transition-colors"
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={submitting || (changedFields.length === 0 && !contributorsChanged)}
            className="px-4 py-1.5 text-sm rounded-md bg-accent-rust text-white hover:bg-accent-rust/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting
              ? isCreate ? 'Creating…' : mode === 'contributor' ? 'Submitting…' : 'Saving…'
              : isCreate ? 'Create record' : mode === 'contributor' ? 'Submit for review' : 'Save changes'}
          </button>
        </div>
      </div>
    </form>
  );
}

function FormField({
  label,
  hint,
  changed,
  children,
}: {
  label: string;
  hint?: string;
  changed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-baseline gap-2 mb-1">
        <span className="text-xs text-muted">{label}</span>
        {changed && <span className="text-[10px] uppercase text-accent-rust font-medium">changed</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted mt-1 italic">{hint}</p>}
    </div>
  );
}
