import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, BookMarked, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getReadDb } from '@/lib/mongodb';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import { tenantBookUrl } from '@/lib/slugify';

interface Props {
  params: Promise<{ tenant: string; ubn: string }>;
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
  binding: string | null;
  bound_with: string | null;
  provenance: string | null;
  ia_identifier: string | null;
  ustc_sn: string | null;
  sl_book_id: string | null;
  sl_book_slug: string | null;
}

async function fetchWork(ubn: string): Promise<BphWorkRow | null> {
  const { data } = await supabase
    .from('bph_works')
    .select(`
      ubn, title, parallel_title, uniform_title,
      author, variant_author, pseudonym, editor, variant_editor,
      place, printer, publisher, variant_printer, variant_publisher,
      year, shelf_mark, state_shelf_mark, present_location,
      keywords, language, series_title, volume_title,
      bibliography, remarks, number_of_copies, object_size_cm, binding, bound_with,
      provenance, ia_identifier, ustc_sn, sl_book_id, sl_book_slug
    `)
    .eq('ubn', ubn)
    .maybeSingle();
  return (data as BphWorkRow | null) ?? null;
}

/** Look up the live Source Library book matching this UBN, if any. */
async function fetchSlBook(ubn: string): Promise<{ id: string; slug: string } | null> {
  try {
    const db = await getReadDb();
    const book = await db.collection('books').findOne(
      { 'image_source.provider': 'bph', 'dublin_core.dc_identifier': ubn },
      { projection: { id: 1, slug: 1 }, maxTimeMS: 8_000 }
    );
    if (!book) return null;
    return { id: book.id as string, slug: (book.slug as string) || (book.id as string) };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ubn } = await params;
  const work = await fetchWork(ubn);
  if (!work) return { title: 'Catalog entry not found - BPH', robots: { index: false, follow: false } };
  const title = work.title || work.parallel_title || work.uniform_title || `BPH catalog entry ${ubn}`;
  const author = work.author || work.variant_author || '';
  const description = `BPH catalog entry. ${author ? author + '. ' : ''}${work.year ? `(${work.year}). ` : ''}Shelf mark: ${work.shelf_mark || '—'}.`;
  return { title: `${title} - BPH catalog`, description };
}

export default async function CatalogEntryPage({ params }: Props) {
  const { tenant, ubn } = await params;
  const work = await fetchWork(ubn);
  if (!work) notFound();

  // Bridge to a live SL book if one exists (prefer fresh MongoDB lookup over the cached sl_book_id column)
  const slBook = (await fetchSlBook(ubn)) ?? (work.sl_book_id ? { id: work.sl_book_id, slug: work.sl_book_slug || work.sl_book_id } : null);

  const displayTitle = work.title || work.parallel_title || work.uniform_title || `(untitled — UBN ${work.ubn})`;
  const backHref = `/catalog`;

  return (
    <div className="bg-cream">
      <ConditionalSiteHeader variant="dark" />

      <div className="max-w-4xl mx-auto px-6 py-8">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to catalog
        </Link>

        <h1 className="text-3xl sm:text-4xl text-primary font-display leading-tight mb-2">
          {displayTitle}
        </h1>

        {work.parallel_title && work.parallel_title !== displayTitle && (
          <p className="text-base text-secondary italic mb-2 leading-snug">
            {work.parallel_title}
          </p>
        )}
        {work.uniform_title && work.uniform_title !== displayTitle && work.uniform_title !== work.parallel_title && (
          <p className="text-sm text-muted mb-2">
            <span className="text-xs uppercase tracking-wide mr-2">Variant title</span>
            {work.uniform_title}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-secondary mb-6">
          {(work.author || work.variant_author) && (
            <span>{work.author || work.variant_author}</span>
          )}
          {work.year && <span className="tabular-nums">{work.year}</span>}
          {work.place && <span>{work.place}</span>}
          {work.language && <span className="text-muted">{work.language}</span>}
        </div>

        {slBook && (
          <a
            href={tenantBookUrl({ id: slBook.id, slug: slBook.slug }, tenant)}
            className="inline-flex items-center gap-2 px-4 py-2 mb-8 rounded-md bg-accent-rust text-white hover:bg-accent-rust/90 transition-colors"
          >
            <BookMarked className="w-4 h-4" />
            Read on Source Library
          </a>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 mb-8">
          <Section title="Title">
            <Field label="Short title" value={work.title} />
            <Field label="Full title (transcription)" value={work.parallel_title} />
            <Field label="Variant title" value={work.uniform_title} />
            <Field label="Series" value={work.series_title} />
            <Field label="Volume" value={work.volume_title} />
          </Section>

          <Section title="Authorship">
            <Field label="Author" value={work.author} />
            <Field label="Author (as on title page)" value={work.variant_author} />
            <Field label="Pseudonym" value={work.pseudonym} />
            <Field label="Editor / translator" value={work.editor} />
            <Field label="Editor (as on title page)" value={work.variant_editor} />
          </Section>

          <Section title="Imprint">
            <Field label="Place of publication" value={work.place} />
            <Field label="Year of publication" value={work.year ? String(work.year) : null} />
            <Field label="Printer" value={work.printer} />
            <Field label="Printer (variant)" value={work.variant_printer} />
            <Field label="Publisher" value={work.publisher} />
            <Field label="Publisher (variant)" value={work.variant_publisher} />
          </Section>

          <Section title="Subject & Language">
            <Field label="Keywords" value={work.keywords} />
            <Field label="Language" value={work.language} />
          </Section>

          <Section title="Physical">
            <Field label="Object size" value={work.object_size_cm} />
            <Field label="Number of copies held" value={work.number_of_copies != null ? String(work.number_of_copies) : null} />
            <Field label="Binding" value={work.binding} />
            <Field label="Bound with" value={work.bound_with} />
          </Section>

          <Section title="Location at the BPH">
            <Field label="Present location" value={work.present_location} />
            <Field label="Shelf mark" value={work.shelf_mark} mono />
            <Field label="State Collection shelf mark" value={work.state_shelf_mark} mono />
            <Field label="Provenance / collection" value={work.provenance} />
          </Section>

          <Section title="Notes">
            <Field label="Bibliography" value={work.bibliography} />
            <Field label="Remarks" value={work.remarks} />
          </Section>

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
        </div>

        <p className="text-xs text-muted border-t border-border-light pt-4">
          Source: Bibliotheca Philosophica Hermetica catalog (UBN {work.ubn}). Any data corrections should be made in the BPH catalog and re-imported.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  // Hide the section if every Field rendered nothing
  return (
    <section className="mb-6">
      <h2 className="text-xs uppercase tracking-wider text-muted font-medium mb-2">{title}</h2>
      <dl className="space-y-1.5">{children}</dl>
    </section>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3 text-sm">
      <dt className="text-muted shrink-0 sm:w-44">{label}</dt>
      <dd className={`text-primary ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function FieldRaw({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3 text-sm">
      <dt className="text-muted shrink-0 sm:w-44">{label}</dt>
      <dd className="text-primary">{children}</dd>
    </div>
  );
}
