import { notFound } from 'next/navigation';
import { BookMarked, BookOpen, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getReadDb } from '@/lib/mongodb';
// tenantBookUrl removed - using inline URL construction with embed path
import { formatAuthor, getBookThumbnailUrl } from '@/lib/utils';
import { isPublishedFirstTranslation } from '@/lib/book';
import type { LibraryPartner } from '@/lib/library-partners';
import { normalizeStateShelfMark } from '@/lib/bph-state-shelfmark';
import { AISection } from '@/components/embed/AISection';

// Generic catalogue detail renderer for tenants whose bibliographic data
// lives in `library_catalog_records` (set `hasUnifiedCatalogue: true` on
// the partner record). BPH stays on its own route logic in page.tsx.

interface CatalogRow {
  tenant_id: string;
  catalog_id: string;
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
  year_text: string | null;
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
  thumbnail: string | null;
  file_count: number | null;
  sl_book_id: string | null;
  sl_book_slug: string | null;
  ia_identifier: string | null;
  ustc_sn: string | null;
  sl_external_book_id: string | null;
  sl_external_slug: string | null;
  sl_external_source: string | null;
  metadata: Record<string, unknown> | null;
}

interface SlBook {
  id: string;
  slug: string;
  title?: string;
  display_title?: string;
  english_title?: string;
  author?: string;
  language?: string;
  published?: string;
  place_published?: string;
  publisher?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  categories?: string[];
  is_first_translation?: boolean;
  doi?: string;
  reading_summary?: { overview?: string };
  image_display?: string | null;
  image_thumb?: string | null;
  thumbnail?: string | null;
  thumbnail_blob?: string | null;
}

async function fetchRow(tenant: string, catalogId: string): Promise<CatalogRow | null> {
  const { data, error } = await supabase
    .from('library_catalog_records')
    .select('*')
    .eq('tenant_id', tenant)
    .eq('catalog_id', catalogId)
    .maybeSingle();
  if (error) return null;
  return (data as CatalogRow | null) ?? null;
}

async function fetchBookById(id: string): Promise<SlBook | null> {
  try {
    const db = await getReadDb();
    const book = await db.collection('books').findOne(
      { id },
      {
        projection: {
          id: 1, slug: 1, title: 1, display_title: 1, english_title: 1,
          author: 1, language: 1, published: 1, place_published: 1, publisher: 1,
          pages_count: 1, pages_ocr: 1, pages_translated: 1,
          categories: 1, is_first_translation: 1, doi: 1,
          'reading_summary.overview': 1,
          image_display: 1, image_thumb: 1, thumbnail: 1, thumbnail_blob: 1,
        },
        maxTimeMS: 8_000,
      },
    );
    if (!book) return null;
    return book as unknown as SlBook;
  } catch {
    return null;
  }
}

function externalSourceLabel(source: string | null | undefined): string {
  if (!source) return 'another archive';
  const map: Record<string, string> = {
    internet_archive: 'Internet Archive',
    cmc_kloss: 'CMC (Kloss collection)',
    mdz: 'MDZ',
    gallica: 'Gallica',
    'e-rara': 'e-rara',
    google_books: 'Google Books',
    allard_pierson: 'Allard Pierson',
    bodleian: 'Bodleian',
    vatican: 'Vatican',
    cambridge: 'Cambridge',
    laurenziana: 'Laurenziana',
  };
  if (map[source]) return map[source];
  return source.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const items = v.map(x => (typeof x === 'string' ? x : String(x))).filter(s => s.trim().length > 0);
  return items.length ? items : null;
}

export async function generateGenericMetadata(
  tenant: string,
  catalogId: string,
  partner: LibraryPartner,
) {
  const row = await fetchRow(tenant, catalogId);
  if (!row) {
    return { title: `Catalogue entry not found — ${partner.shortName}`, robots: { index: false, follow: false } };
  }
  const title = row.title || row.parallel_title || row.uniform_title || `Catalogue entry ${catalogId}`;
  const author = row.author || row.variant_author || '';
  const yearStr = row.year ? `(${row.year})` : row.year_text ? `(${row.year_text})` : '';
  const description = `${partner.name} catalogue entry. ${author ? author + '. ' : ''}${yearStr ? yearStr + ' ' : ''}Shelf mark: ${row.shelf_mark || '—'}.`;
  return { title: `${title} — ${partner.shortName} catalogue`, description };
}

export default async function GenericCatalogEntry({
  tenant,
  catalogId,
  partner,
}: {
  tenant: string;
  catalogId: string;
  partner: LibraryPartner;
}) {
  const row = await fetchRow(tenant, catalogId);
  if (!row) notFound();

  // Live SL book if the row links to one. The map at /api/catalog/[tenant]
  // refreshes sl_book_id on the fly; here on the detail page we trust the
  // value stored on the row (a periodic sync cron will keep it fresh).
  const slBook = row.sl_book_id ? await fetchBookById(row.sl_book_id) : null;
  const externalBook = !slBook && row.sl_external_book_id
    ? await fetchBookById(row.sl_external_book_id)
    : null;

  const displayTitle = row.title || row.parallel_title || row.uniform_title || `(untitled — ${catalogId})`;
  const slBookHref = slBook ? `/embed/${tenant}/book/${encodeURIComponent(slBook.slug || slBook.id)}` : null;
  const slCoverUrl = slBook ? getBookThumbnailUrl(slBook, 'display') : null;
  const externalBookHref = externalBook
    ? `/embed/${tenant}/book/${encodeURIComponent(externalBook.slug || externalBook.id)}`
    : null;
  const externalCoverUrl = externalBook ? getBookThumbnailUrl(externalBook, 'display') : null;
  const canonicalAuthor = slBook?.author ? formatAuthor(slBook.author).name : null;
  const translationPct = slBook && slBook.pages_translated && slBook.pages_ocr
    ? Math.round((slBook.pages_translated / Math.max(slBook.pages_ocr, 1)) * 100)
    : null;

  // Tenant-specific extras stored in metadata JSONB. We surface the fields
  // we know about today (Kloss); future tenants can extend the map by
  // dropping new keys in here and rendering them below.
  const metadata = row.metadata || {};
  const klossShelfMark = asString(metadata.kloss_shelf_mark);
  const notes = asStringArray(metadata.notes);
  const digitalRefs = asStringArray(metadata.digital_references);
  const description = asString(metadata.description);
  const edition = asString(metadata.edition);
  const format = asString(metadata.format);
  const materialType = asString(metadata.material_type);
  const pagination = asString(metadata.pagination);
  const series = asString(metadata.series);
  const yearForDisplay = row.year ? String(row.year) : (row.year_text || null);

  return (
    <div className="bg-cream">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-3xl sm:text-4xl text-primary font-display leading-tight mb-2">
          {displayTitle}
        </h1>
        {row.parallel_title && row.parallel_title !== displayTitle && (
          <p className="text-base text-secondary italic mb-2 leading-snug">
            {row.parallel_title}
          </p>
        )}
        {row.uniform_title && row.uniform_title !== displayTitle && row.uniform_title !== row.parallel_title && (
          <p className="text-sm text-muted mb-2">
            <span className="text-xs uppercase tracking-wide mr-2">Variant title</span>
            {row.uniform_title}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-secondary mb-6">
          {(row.author || row.variant_author) && (
            <span>{row.author || row.variant_author}</span>
          )}
          {yearForDisplay && <span className="tabular-nums">{yearForDisplay}</span>}
          {row.place && <span>{row.place}</span>}
          {row.language && <span className="text-muted">{row.language}</span>}
        </div>

        {/* Digitised copy on Source Library */}
        {slBook && slBookHref && (
          <section className="mb-8 p-5 rounded-lg border border-accent-rust/30 bg-white">
            <div className="flex items-center gap-2 mb-3">
              <BookMarked className="w-4 h-4 text-accent-rust" />
              <h2 className="text-sm font-medium text-accent-rust uppercase tracking-wide">Digitised copy</h2>
            </div>

            <div className="flex gap-4">
              {slCoverUrl && (
                <a href={slBookHref} className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={slCoverUrl}
                    alt={slBook.display_title || slBook.title || displayTitle}
                    className="w-28 sm:w-32 rounded shadow-sm border border-border-light bg-cream object-cover"
                    loading="lazy"
                  />
                </a>
              )}
              <div className="flex-1 min-w-0">
                {slBook.display_title && slBook.display_title !== row.title && (
                  <p className="text-lg text-primary font-display leading-snug mb-1">
                    {slBook.display_title}
                  </p>
                )}
                {slBook.english_title && slBook.english_title !== slBook.display_title && (
                  <p className="text-sm text-secondary mb-1">
                    <span className="text-xs uppercase tracking-wide mr-2 text-muted">English</span>
                    {slBook.english_title}
                  </p>
                )}

                <dl className="space-y-1.5 text-sm mb-4">
                  {canonicalAuthor && canonicalAuthor !== row.author && (
                    <Field label="Standard name" value={canonicalAuthor} />
                  )}
                  {slBook.published && slBook.published !== String(row.year || '') && (
                    <Field label="Published" value={slBook.published} />
                  )}
                  {slBook.language && (
                    <Field label="Original language" value={slBook.language} />
                  )}
                  {slBook.pages_count != null && (
                    <Field label="Pages" value={String(slBook.pages_count)} />
                  )}
                  {translationPct != null && (
                    <Field label="Translation" value={`${translationPct}% translated to English`} />
                  )}
                  {isPublishedFirstTranslation(slBook) && (
                    <FieldRaw label="Status">
                      <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-accent-rust/10 text-accent-rust border border-accent-rust/30">
                        First English translation
                      </span>
                    </FieldRaw>
                  )}
                  {slBook.categories && slBook.categories.length > 0 && (
                    <Field label="Categories" value={slBook.categories.join(', ')} />
                  )}
                  {slBook.doi && (
                    <FieldRaw label="DOI">
                      <a href={`https://doi.org/${slBook.doi}`} target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:underline inline-flex items-center gap-1">
                        {slBook.doi} <ExternalLink className="w-3 h-3" />
                      </a>
                    </FieldRaw>
                  )}
                </dl>

                {slBook.reading_summary?.overview && (
                  <AISection>
                    <p className="text-sm text-secondary leading-relaxed mb-4 italic">
                      {slBook.reading_summary.overview.length > 380
                        ? slBook.reading_summary.overview.slice(0, 380) + '…'
                        : slBook.reading_summary.overview}
                    </p>
                  </AISection>
                )}

                <a
                  href={slBookHref}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-accent-rust text-white hover:bg-accent-rust/90 transition-colors"
                >
                  <BookOpen className="w-4 h-4" />
                  Read the digitised copy
                </a>
              </div>
            </div>
          </section>
        )}

        {/* Cross-provider scan */}
        {externalBook && externalBookHref && (
          <section className="mb-8 p-5 rounded-lg border border-border-light bg-white">
            <div className="flex items-center gap-2 mb-3">
              <BookMarked className="w-4 h-4 text-secondary" />
              <h2 className="text-sm font-medium text-secondary uppercase tracking-wide">
                Scan via {externalSourceLabel(row.sl_external_source)}
              </h2>
            </div>
            <p className="text-xs text-muted mb-3 leading-relaxed">
              {partner.name} holds this work; the digitisation shown here was produced by{' '}
              {externalSourceLabel(row.sl_external_source)} and is read through Source Library.
            </p>
            <div className="flex gap-4">
              {externalCoverUrl && (
                <a href={externalBookHref} className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={externalCoverUrl}
                    alt={externalBook.display_title || externalBook.title || displayTitle}
                    className="w-28 sm:w-32 rounded shadow-sm border border-border-light bg-cream object-cover"
                    loading="lazy"
                  />
                </a>
              )}
              <div className="flex-1 min-w-0">
                {externalBook.display_title && externalBook.display_title !== row.title && (
                  <p className="text-lg text-primary font-display leading-snug mb-1">
                    {externalBook.display_title}
                  </p>
                )}
                <dl className="space-y-1.5 text-sm mb-4">
                  {externalBook.author && (
                    <Field label="Author" value={externalBook.author} />
                  )}
                  {externalBook.published && (
                    <Field label="Published" value={externalBook.published} />
                  )}
                  {externalBook.pages_count != null && (
                    <Field label="Pages" value={String(externalBook.pages_count)} />
                  )}
                </dl>
                <a
                  href={externalBookHref}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-secondary/40 text-secondary hover:bg-warm transition-colors"
                >
                  <BookOpen className="w-4 h-4" />
                  Read the {externalSourceLabel(row.sl_external_source)} scan
                </a>
              </div>
            </div>
          </section>
        )}

        {/* Catalogue metadata */}
        <Section title="Title">
          <Field label="Short title" value={row.title} />
          <Field label="Full title (transcription)" value={row.parallel_title} />
          <Field label="Variant title" value={row.uniform_title} />
          <Field label="Series" value={row.series_title || series} />
          <Field label="Volume" value={row.volume_title} />
          <Field label="Edition" value={edition} />
        </Section>

        <Section title="Authorship">
          <Field label="Author" value={row.author} />
          <Field label="Author (as on title page)" value={row.variant_author} />
          <Field label="Pseudonym" value={row.pseudonym} />
          <Field label="Editor / translator" value={row.editor} />
          <Field label="Editor (as on title page)" value={row.variant_editor} />
        </Section>

        <Section title="Imprint">
          <Field label="Place of publication" value={row.place} />
          <Field label="Year of publication" value={yearForDisplay} />
          <Field label="Printer" value={row.printer} />
          <Field label="Printer (variant)" value={row.variant_printer} />
          <Field label="Publisher" value={row.publisher} />
          <Field label="Publisher (variant)" value={row.variant_publisher} />
        </Section>

        <Section title="Subject & Language">
          <Field label="Keywords" value={row.keywords} />
          <Field label="Language" value={row.language} />
        </Section>

        {(row.object_size_cm || format || materialType || pagination || row.binding || row.bound_with || row.number_of_copies != null) && (
          <Section title="Physical">
            <Field label="Object size" value={row.object_size_cm} />
            <Field label="Format" value={format} />
            <Field label="Material type" value={materialType} />
            <Field label="Pagination" value={pagination} />
            <Field label="Binding" value={row.binding} />
            <Field label="Bound with" value={row.bound_with} />
            <Field label="Number of copies held" value={row.number_of_copies != null ? String(row.number_of_copies) : null} />
          </Section>
        )}

        <Section title={`Location at ${partner.shortName}`}>
          <Field label="Present location" value={row.present_location} />
          <Field label="Shelf mark" value={row.shelf_mark} mono />
          <Field label="State Collection shelf mark" value={normalizeStateShelfMark(row.state_shelf_mark)} mono />
          <Field label="Kloss shelf mark" value={klossShelfMark} mono />
          <Field label="Provenance / collection" value={row.provenance} />
        </Section>

        {(description || row.bibliography || row.remarks || notes) && (
          <Section title="Notes">
            <Field label="Description" value={description} />
            <Field label="Bibliography" value={row.bibliography} />
            <Field label="Remarks" value={row.remarks} />
            {notes && notes.length > 0 && (
              <FieldRaw label="Catalogue notes">
                <ul className="list-disc pl-4 space-y-1">
                  {notes.map((n, i) => (
                    <li key={i} className="text-primary">{n}</li>
                  ))}
                </ul>
              </FieldRaw>
            )}
          </Section>
        )}

        <Section title="Identifiers">
          <Field label="Catalogue ID" value={row.catalog_id} mono />
          <Field label="USTC" value={row.ustc_sn} mono />
          {row.ia_identifier && (
            <FieldRaw label="Internet Archive">
              <a
                href={`https://archive.org/details/${row.ia_identifier}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent-rust hover:underline"
              >
                {row.ia_identifier}
                <ExternalLink className="w-3 h-3" />
              </a>
            </FieldRaw>
          )}
          {digitalRefs && digitalRefs.length > 0 && (
            <FieldRaw label="Digital references">
              <ul className="list-disc pl-4 space-y-0.5">
                {digitalRefs.map((r, i) => (
                  <li key={i} className="font-mono text-xs text-secondary break-all">{r}</li>
                ))}
              </ul>
            </FieldRaw>
          )}
        </Section>

        <p className="text-xs text-muted border-t border-border-light pt-4 mt-2">
          Catalogue data sourced from {partner.name} (entry {row.catalog_id}).
          Corrections should be made in the source catalogue and re-imported.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-xs uppercase tracking-wider text-muted font-medium mb-2">{title}</h2>
      <dl className="space-y-1.5">{children}</dl>
    </section>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3 text-sm">
      <dt className="text-muted shrink-0 sm:w-52">{label}</dt>
      <dd className={`text-primary ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function FieldRaw({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3 text-sm">
      <dt className="text-muted shrink-0 sm:w-52">{label}</dt>
      <dd className="text-primary">{children}</dd>
    </div>
  );
}
