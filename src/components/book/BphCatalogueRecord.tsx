import { supabase } from '@/lib/supabase';
import { ExternalLink } from 'lucide-react';
import { normalizeStateShelfMark } from '@/lib/bph-state-shelfmark';

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
  title: string | null;
  parallel_title: string | null;
  uniform_title: string | null;
  author: string | null;
  variant_author: string | null;
  pseudonym: string | null;
  editor: string | null;
  variant_editor: string | null;
  author_entity_id: string | null;
  author_canonical_name: string | null;
  author_wikidata_qid: string | null;
  author_viaf_id: string | null;
  place: string | null;
  printer: string | null;
  publisher: string | null;
  variant_printer: string | null;
  variant_publisher: string | null;
  year: number | null;
  shelf_mark: string | null;
  state_shelf_mark: string | null;
  present_location: string | null;
  keywords: string | null;
  language: string | null;
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
  // Two-pass fetch: try with the author-authority columns (added by migration
  // 20260522000000_bph_works_author_authority.sql); fall back to the legacy
  // set if those columns aren't there yet on this environment.
  const fullSelect = `
      ubn, title, parallel_title, uniform_title,
      author, variant_author, pseudonym, editor, variant_editor,
      author_entity_id, author_canonical_name, author_wikidata_qid, author_viaf_id,
      place, printer, publisher, variant_printer, variant_publisher,
      year, shelf_mark, state_shelf_mark, present_location,
      keywords, language, series_title, volume_title,
      bibliography, remarks, number_of_copies, object_size_cm,
      bibliographic_format, binding, bound_with,
      provenance, ia_identifier, ustc_sn, field_provenance
    `;
  const legacySelect = fullSelect.replace(
    'author_entity_id, author_canonical_name, author_wikidata_qid, author_viaf_id,\n      ',
    '',
  );
  const first = await supabase.from('bph_works').select(fullSelect).eq('ubn', ubn).maybeSingle();
  if (first.error) {
    const msg = (first.error.message || '').toLowerCase();
    if (msg.includes('does not exist') || msg.includes('could not find')) {
      const retry = await supabase.from('bph_works').select(legacySelect).eq('ubn', ubn).maybeSingle();
      return (retry.data as BphWorkRow | null) ?? null;
    }
    return null;
  }
  return (first.data as BphWorkRow | null) ?? null;
}

/** Returns true when at least one displayable field is set. */
function hasRenderableContent(w: BphWorkRow): boolean {
  return !!(
    w.parallel_title || w.uniform_title ||
    w.variant_author || w.pseudonym || w.editor || w.variant_editor ||
    w.author_entity_id || w.author_canonical_name || w.author_wikidata_qid || w.author_viaf_id ||
    w.place || w.printer || w.publisher || w.variant_printer || w.variant_publisher ||
    w.shelf_mark || w.state_shelf_mark || w.present_location ||
    w.keywords || w.language || w.series_title || w.volume_title ||
    w.bibliography || w.remarks ||
    w.number_of_copies != null || w.object_size_cm || w.bibliographic_format ||
    w.binding || w.bound_with ||
    w.provenance || w.ia_identifier || w.ustc_sn
  );
}

export default async function BphCatalogueRecord({ ubn }: { ubn: string }) {
  // Accept any non-empty key; bph_works.ubn is the catalogue primary key and
  // is mostly numeric for the printed-book set, but the Allard Pierson IIIF
  // manuscripts (backfill-bph-allard-pierson.mjs) use their PH-shelfmark
  // (e.g. "PH441") as the catalogue key. Reject only empty strings.
  if (!ubn) return null;
  const work = await fetchWork(ubn);
  if (!work) return null;
  if (!hasRenderableContent(work)) return null;
  const isNumericUbn = /^\d+$/.test(work.ubn);

  // Show bibliographic_format only when its source is genuine (not derived
  // from book size — BPH librarians prefer blank over an estimate).
  const showFormat = !!(
    work.bibliographic_format
    && work.field_provenance?.bibliographic_format?.source
    && work.field_provenance.bibliographic_format.source !== 'derived_from_size'
  );

  return (
    // Closed by default on the book detail page: the catalogue record is
    // reference material, and the primary action here is to start reading.
    // Users arrive from bph.sourcelibrary.org expecting the book, not the
    // bibliographic dossier — they can expand it when they want the detail.
    <details className="mt-4">
      <summary className="cursor-pointer text-sm text-stone-400 hover:text-stone-200 transition-colors list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
        <svg className="w-4 h-4 transition-transform [details[open]_&]:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6"/>
        </svg>
        Catalogue record ({isNumericUbn ? `BPH UBN ${work.ubn}` : `BPH shelfmark ${work.ubn}`})
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

        {(work.variant_author || work.pseudonym || work.editor || work.variant_editor ||
          work.author_entity_id || work.author_canonical_name || work.author_wikidata_qid || work.author_viaf_id) && (
          <Section title="Authorship">
            <Field label="Author (as on title page)" value={work.variant_author} />
            <Field label="Pseudonym" value={work.pseudonym} />
            <Field label="Editor / translator" value={work.editor} />
            <Field label="Editor (as on title page)" value={work.variant_editor} />
            {(work.author_canonical_name || work.author_viaf_id || work.author_wikidata_qid) && (
              <FieldRaw label="Standard name (VIAF)">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  {work.author_canonical_name && (
                    <span>{work.author_canonical_name}</span>
                  )}
                  {work.author_viaf_id && (
                    <a
                      href={`https://viaf.org/viaf/${work.author_viaf_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-gold hover:text-accent-gold/80 text-xs inline-flex items-center gap-0.5"
                    >
                      VIAF {work.author_viaf_id}
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                  {work.author_wikidata_qid && (
                    <a
                      href={`https://www.wikidata.org/wiki/${work.author_wikidata_qid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-gold hover:text-accent-gold/80 text-xs inline-flex items-center gap-0.5"
                    >
                      {work.author_wikidata_qid}
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </span>
              </FieldRaw>
            )}
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

        {(work.keywords || work.language) && (
          <Section title="Subject & Language">
            <Field label="Keywords" value={work.keywords} />
            <Field label="Language" value={work.language} />
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

        {(() => {
          const stateShelfMark = normalizeStateShelfMark(work.state_shelf_mark);
          if (!work.present_location && !work.shelf_mark && !stateShelfMark && !work.provenance) return null;
          return (
            <Section title="Location at the BPH">
              <Field label="Present location" value={work.present_location} />
              <Field label="Shelf mark" value={work.shelf_mark} mono />
              <Field label="State Collection shelf mark" value={stateShelfMark} mono />
              <Field label="Provenance / collection" value={work.provenance} />
            </Section>
          );
        })()}

        {(work.bibliography || work.remarks) && (
          <Section title="Notes">
            <Field label="Bibliography" value={work.bibliography} />
            <Field label="Remarks" value={work.remarks} />
          </Section>
        )}

        <Section title="Identifiers">
          <Field label={isNumericUbn ? 'UBN' : 'BPH shelfmark'} value={work.ubn} mono />
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
          Sourced from the Bibliotheca Philosophica Hermetica catalogue
          {isNumericUbn ? ` (UBN ${work.ubn})` : ` (shelfmark ${work.ubn})`}.
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
