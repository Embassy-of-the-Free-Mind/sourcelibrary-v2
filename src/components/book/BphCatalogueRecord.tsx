import { supabase } from '@/lib/supabase';
import { ExternalLink } from 'lucide-react';

/**
 * Inline display of a book's BPH catalogue record, side-loaded from Supabase
 * `bph_works`. Renders only when the book has a numeric BPH UBN and the row
 * exists. Used on the book detail page (server component) so a partner like
 * the BPH can see the full bibliographic record (variant titles, printer,
 * shelf marks, provenance, …) inline rather than via the separate /catalog/{ubn}
 * page. See issue #1688.
 *
 * Catalogue-only entries (no Source Library book) still live at /catalog/{ubn} —
 * this component is the inverse, surfacing catalogue richness on the reading
 * page when both records exist.
 */

interface FieldProvenance {
  source: string;
  evidence?: string;
}

interface BphWorkRow {
  ubn: string;
  parallel_title: string | null;
  uniform_title: string | null;
  variant_author: string | null;
  pseudonym: string | null;
  editor: string | null;
  variant_editor: string | null;
  place: string | null;
  printer: string | null;
  publisher: string | null;
  variant_printer: string | null;
  variant_publisher: string | null;
  shelf_mark: string | null;
  state_shelf_mark: string | null;
  present_location: string | null;
  keywords: string | null;
  series_title: string | null;
  volume_title: string | null;
  bibliography: string | null;
  remarks: string | null;
  number_of_copies: number | null;
  object_size_cm: string | null;
  bibliographic_format: string | null;
  binding: string | null;
  bound_with: string | null;
  provenance: string | null;
  ia_identifier: string | null;
  ustc_sn: string | null;
  field_provenance: Record<string, FieldProvenance> | null;
}

async function fetchWork(ubn: string): Promise<BphWorkRow | null> {
  const { data } = await supabase
    .from('bph_works')
    .select(`
      ubn, parallel_title, uniform_title,
      variant_author, pseudonym, editor, variant_editor,
      place, printer, publisher, variant_printer, variant_publisher,
      shelf_mark, state_shelf_mark, present_location,
      keywords, series_title, volume_title,
      bibliography, remarks, number_of_copies, object_size_cm,
      bibliographic_format, binding, bound_with,
      provenance, ia_identifier, ustc_sn, field_provenance
    `)
    .eq('ubn', ubn)
    .maybeSingle();
  return (data as BphWorkRow | null) ?? null;
}

/** Returns true when at least one displayable field is set. */
function hasRenderableContent(w: BphWorkRow): boolean {
  return !!(
    w.parallel_title || w.uniform_title ||
    w.variant_author || w.pseudonym || w.editor || w.variant_editor ||
    w.place || w.printer || w.publisher || w.variant_printer || w.variant_publisher ||
    w.shelf_mark || w.state_shelf_mark || w.present_location ||
    w.keywords || w.series_title || w.volume_title ||
    w.bibliography || w.remarks ||
    w.number_of_copies != null || w.object_size_cm || w.bibliographic_format ||
    w.binding || w.bound_with ||
    w.provenance || w.ia_identifier || w.ustc_sn
  );
}

export default async function BphCatalogueRecord({ ubn }: { ubn: string }) {
  if (!ubn || !/^\d+$/.test(ubn)) return null;
  const work = await fetchWork(ubn);
  if (!work) return null;
  if (!hasRenderableContent(work)) return null;

  // Show bibliographic_format only when its source is genuine (not derived
  // from book size — BPH librarians prefer blank over an estimate).
  const showFormat = !!(
    work.bibliographic_format
    && work.field_provenance?.bibliographic_format?.source
    && work.field_provenance.bibliographic_format.source !== 'derived_from_size'
  );

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm text-stone-400 hover:text-stone-200 transition-colors list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
        <svg className="w-4 h-4 transition-transform [details[open]_&]:rotate-90" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M6.5 4a.5.5 0 01.854-.354l6 6a.5.5 0 010 .708l-6 6A.5.5 0 016.5 16V4z" clipRule="evenodd"/>
        </svg>
        Catalogue record (BPH UBN {work.ubn})
      </summary>

      <div className="mt-3 p-4 bg-stone-800/50 rounded-lg border border-stone-700 space-y-4">
        {(work.parallel_title || work.uniform_title || work.series_title || work.volume_title) && (
          <Section title="Title">
            <Field label="Full title (transcription)" value={work.parallel_title} />
            <Field label="Variant title" value={work.uniform_title} />
            <Field label="Series" value={work.series_title} />
            <Field label="Volume" value={work.volume_title} />
          </Section>
        )}

        {(work.variant_author || work.pseudonym || work.editor || work.variant_editor) && (
          <Section title="Authorship">
            <Field label="Author (as on title page)" value={work.variant_author} />
            <Field label="Pseudonym" value={work.pseudonym} />
            <Field label="Editor / translator" value={work.editor} />
            <Field label="Editor (as on title page)" value={work.variant_editor} />
          </Section>
        )}

        {(work.place || work.printer || work.publisher || work.variant_printer || work.variant_publisher) && (
          <Section title="Imprint">
            <Field label="Place of publication" value={work.place} />
            <Field label="Printer" value={work.printer} />
            <Field label="Printer (variant)" value={work.variant_printer} />
            <Field label="Publisher" value={work.publisher} />
            <Field label="Publisher (variant)" value={work.variant_publisher} />
          </Section>
        )}

        {work.keywords && (
          <Section title="Subject">
            <Field label="Keywords" value={work.keywords} />
          </Section>
        )}

        {(work.object_size_cm || showFormat || work.number_of_copies != null || work.binding || work.bound_with) && (
          <Section title="Physical">
            <Field label="Object size" value={work.object_size_cm} />
            {showFormat && (
              <FieldRaw label="Format">
                <span className="capitalize">{work.bibliographic_format}</span>
              </FieldRaw>
            )}
            <Field label="Copies held" value={work.number_of_copies != null ? String(work.number_of_copies) : null} />
            <Field label="Binding" value={work.binding} />
            <Field label="Bound with" value={work.bound_with} />
          </Section>
        )}

        {(work.present_location || work.shelf_mark || work.state_shelf_mark || work.provenance) && (
          <Section title="Location at the BPH">
            <Field label="Present location" value={work.present_location} />
            <Field label="Shelf mark" value={work.shelf_mark} mono />
            <Field label="State Collection shelf mark" value={work.state_shelf_mark} mono />
            <Field label="Provenance / collection" value={work.provenance} />
          </Section>
        )}

        {(work.bibliography || work.remarks) && (
          <Section title="Notes">
            <Field label="Bibliography" value={work.bibliography} />
            <Field label="Remarks" value={work.remarks} />
          </Section>
        )}

        <Section title="Identifiers">
          <Field label="UBN" value={work.ubn} mono />
          <Field label="USTC" value={work.ustc_sn} mono />
          {work.ia_identifier && (
            <FieldRaw label="Internet Archive">
              <a
                href={`https://archive.org/details/${work.ia_identifier}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent-rust hover:underline"
              >
                {work.ia_identifier}
                <ExternalLink className="w-3 h-3" />
              </a>
            </FieldRaw>
          )}
        </Section>

        <p className="text-xs text-stone-500 border-t border-stone-700 pt-3">
          Sourced from the Bibliotheca Philosophica Hermetica catalogue (UBN {work.ubn}).
        </p>
      </div>
    </details>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="text-xs uppercase tracking-wider text-stone-500 font-medium mb-1.5">{title}</h4>
      <dl className="space-y-1">{children}</dl>
    </section>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3 text-sm">
      <dt className="text-stone-500 shrink-0 sm:w-44">{label}</dt>
      <dd className={`text-stone-200 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function FieldRaw({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3 text-sm">
      <dt className="text-stone-500 shrink-0 sm:w-44">{label}</dt>
      <dd className="text-stone-200">{children}</dd>
    </div>
  );
}
