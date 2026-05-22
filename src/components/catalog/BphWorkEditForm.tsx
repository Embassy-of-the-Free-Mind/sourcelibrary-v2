'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import AuthorAuthorityPicker, { type AuthorAuthoritySelection } from '@/components/catalog/AuthorAuthorityPicker';

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
 * Repeatable schema (TEXT[]/JSONB for binding, notes, keywords, etc.) is
 * deferred — the current bph_works schema has these as single TEXT, and
 * the existing data convention (comma-separated for keywords, free-form
 * for notes) is preserved here. Real repeatables get their own PR with
 * the schema migration; the field whitelist already covers them.
 */

interface Props {
  ubn: string;
  tenant: string;
  initial: Record<string, unknown>;
  editorEmail: string;
}

// Mirrors EDITABLE_BPH_FIELDS in src/lib/bph-catalog.ts, organised into the
// same visual sections as the read-only catalog detail page so cataloguers
// can map their mental model 1:1.
const SECTIONS: Array<{
  title: string;
  fields: Array<{ name: string; label: string; type?: 'text' | 'number' | 'textarea'; hidden?: boolean }>;
}> = [
  {
    title: 'Title',
    fields: [
      { name: 'title', label: 'Short title' },
      { name: 'parallel_title', label: 'Full title (transcription)', type: 'textarea' },
      { name: 'uniform_title', label: 'Variant title' },
      { name: 'series_title', label: 'Series' },
      { name: 'volume_title', label: 'Volume' },
    ],
  },
  {
    title: 'Authorship',
    fields: [
      { name: 'author', label: 'Author (canonical)' },
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
      { name: 'provenance', label: 'Provenance / collection', type: 'textarea' },
    ],
  },
  {
    title: 'Notes',
    fields: [
      { name: 'bibliography', label: 'Bibliography', type: 'textarea' },
      { name: 'remarks', label: 'Remarks', type: 'textarea' },
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

export default function BphWorkEditForm({ ubn, tenant, initial, editorEmail: _editorEmail }: Props) {
  const router = useRouter();

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
  const [source, setSource] = useState('');
  const [evidence, setEvidence] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (changedFields.length === 0) {
      setError('No fields have changed — nothing to save.');
      return;
    }
    if (!source.trim()) {
      setError('Please cite a source for this change (e.g. "title page, vol. I" or "USTC 12345").');
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

    try {
      const res = await fetch(`/api/${tenant}/catalog/${encodeURIComponent(ubn)}/edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
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
      // Redirect back to the detail page. The catalog row is cached by
      // Next.js; pushing the same route forces a fresh fetch.
      router.push(`/catalog/${encodeURIComponent(ubn)}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message || 'Save failed');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Source citation — required, applies to every changed field. */}
      <div className="p-4 bg-white border border-border-light rounded-lg">
        <h2 className="text-xs uppercase tracking-wider text-muted font-medium mb-3">Source for this change</h2>
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

      {SECTIONS.map((section) => (
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
                  <span className="text-xs text-muted">Canonical author (VIAF)</span>
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
            {section.fields.filter((f) => !f.hidden).map((field) => {
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
          </div>
        </section>
      ))}

      {/* Sticky save bar — always visible so cataloguers don't have to
          scroll back to the top after editing the bottom of the form. */}
      <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 p-3 bg-white border border-border-light rounded-lg shadow-sm">
        <div className="text-sm text-muted">
          {changedFields.length === 0 ? (
            'No changes yet'
          ) : (
            <>
              <span className="font-medium text-primary">{changedFields.length}</span>{' '}
              field{changedFields.length === 1 ? '' : 's'} changed
            </>
          )}
          {error && <span className="ml-3 text-accent-rust">{error}</span>}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/catalog/${encodeURIComponent(ubn)}`}
            className="px-3 py-1.5 text-sm text-muted hover:text-primary transition-colors"
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={submitting || changedFields.length === 0}
            className="px-4 py-1.5 text-sm rounded-md bg-accent-rust text-white hover:bg-accent-rust/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Saving…' : 'Save changes'}
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
