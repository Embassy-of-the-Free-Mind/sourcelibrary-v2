import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { BookMarked, ExternalLink, BookOpen, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getReadDb, getDb } from '@/lib/mongodb';
import { tenantBookUrl } from '@/lib/slugify';
import { formatAuthor, getBookThumbnailUrl } from '@/lib/utils';
import { getPartnerBySlug } from '@/lib/library-partners';
import { auth } from '@/lib/auth';
import { ROLE_LEVEL, type Role } from '@/lib/auth';
import GenericCatalogEntry, { generateGenericMetadata } from './GenericCatalogEntry';

// Catalogue entry routing
// - BPH (providerKey === 'bph'): legacy `bph_works` table + bespoke fields
//   like `bibliographic_format` and `field_provenance`. Logic stays in this
//   file because it predates the unified table.
// - Other unified-catalogue tenants (kloss-collection, …): read
//   `library_catalog_records` via GenericCatalogEntry. Selected by partner
//   metadata (`hasUnifiedCatalogue: true` in library-partners.ts).

interface Props {
  params: Promise<{ tenant: string; ubn: string }>;
}

interface FieldProvenance {
  source: string;
  evidence?: string;
  derived_at?: string;
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
  bibliographic_format: string | null;
  binding: string | null;
  bound_with: string | null;
  provenance: string | null;
  ia_identifier: string | null;
  ustc_sn: string | null;
  sl_book_id: string | null;
  sl_book_slug: string | null;
  // Cross-provider link (see add-bph-external-links.sql): work is BPH-held but
  // the scan lives at another archive (IA / CMC Kloss / MDZ / etc.). Surfaced
  // as a secondary "Read at [source]" panel only when there's no BPH-native
  // sl_book_id — when both exist, the BPH-native digitisation takes priority.
  sl_external_book_id: string | null;
  sl_external_slug: string | null;
  sl_external_source: string | null;
  field_provenance: Record<string, FieldProvenance> | null;
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

async function fetchWork(ubn: string): Promise<BphWorkRow | null> {
  // Try with the external-link columns first; if the column doesn't exist yet
  // (migration not applied on this environment), retry without them so the
  // page still renders.
  const select = `
      ubn, title, parallel_title, uniform_title,
      author, variant_author, pseudonym, editor, variant_editor,
      place, printer, publisher, variant_printer, variant_publisher,
      year, shelf_mark, state_shelf_mark, present_location,
      keywords, language, series_title, volume_title,
      bibliography, remarks, number_of_copies, object_size_cm, bibliographic_format,
      binding, bound_with,
      provenance, ia_identifier, ustc_sn, sl_book_id, sl_book_slug,
      sl_external_book_id, sl_external_slug, sl_external_source,
      field_provenance
    `;
  const fallbackSelect = select.replace(
    'sl_external_book_id, sl_external_slug, sl_external_source,\n      ',
    '',
  );
  const first = await supabase.from('bph_works').select(select).eq('ubn', ubn).maybeSingle();
  if (first.error) {
    const msg = (first.error.message || '').toLowerCase();
    if (msg.includes('does not exist') || msg.includes('could not find')) {
      const retry = await supabase.from('bph_works').select(fallbackSelect).eq('ubn', ubn).maybeSingle();
      return (retry.data as BphWorkRow | null) ?? null;
    }
    return null;
  }
  return (first.data as BphWorkRow | null) ?? null;
}

/** Look up a Source Library book by Mongo id — used for cross-provider
    scans where the catalogue row points at a non-BPH-hosted book. */
async function fetchExternalBook(id: string): Promise<SlBook | null> {
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
    return {
      id: book.id as string,
      slug: (book.slug as string) || (book.id as string),
      title: book.title as string | undefined,
      display_title: book.display_title as string | undefined,
      english_title: book.english_title as string | undefined,
      author: book.author as string | undefined,
      language: book.language as string | undefined,
      published: book.published as string | undefined,
      place_published: book.place_published as string | undefined,
      publisher: book.publisher as string | undefined,
      pages_count: book.pages_count as number | undefined,
      pages_ocr: book.pages_ocr as number | undefined,
      pages_translated: book.pages_translated as number | undefined,
      categories: book.categories as string[] | undefined,
      is_first_translation: book.is_first_translation as boolean | undefined,
      doi: book.doi as string | undefined,
      reading_summary: book.reading_summary as { overview?: string } | undefined,
      image_display: book.image_display as string | null | undefined,
      image_thumb: book.image_thumb as string | null | undefined,
      thumbnail: book.thumbnail as string | null | undefined,
      thumbnail_blob: book.thumbnail_blob as string | null | undefined,
    };
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

/** Look up the live Source Library book matching this UBN, if any. */
async function fetchSlBook(ubn: string): Promise<SlBook | null> {
  try {
    const db = await getReadDb();
    const book = await db.collection('books').findOne(
      { 'image_source.provider': 'bph', 'dublin_core.dc_identifier': ubn },
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
      }
    );
    if (!book) return null;
    return {
      id: book.id as string,
      slug: (book.slug as string) || (book.id as string),
      title: book.title as string | undefined,
      display_title: book.display_title as string | undefined,
      english_title: book.english_title as string | undefined,
      author: book.author as string | undefined,
      language: book.language as string | undefined,
      published: book.published as string | undefined,
      place_published: book.place_published as string | undefined,
      publisher: book.publisher as string | undefined,
      pages_count: book.pages_count as number | undefined,
      pages_ocr: book.pages_ocr as number | undefined,
      pages_translated: book.pages_translated as number | undefined,
      categories: book.categories as string[] | undefined,
      is_first_translation: book.is_first_translation as boolean | undefined,
      doi: book.doi as string | undefined,
      reading_summary: book.reading_summary as { overview?: string } | undefined,
      image_display: book.image_display as string | null | undefined,
      image_thumb: book.image_thumb as string | null | undefined,
      thumbnail: book.thumbnail as string | null | undefined,
      thumbnail_blob: book.thumbnail_blob as string | null | undefined,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tenant, ubn } = await params;
  const partner = getPartnerBySlug(tenant);
  if (partner && partner.providerKey !== 'bph' && partner.hasUnifiedCatalogue) {
    return generateGenericMetadata(tenant, ubn, partner) as Promise<Metadata>;
  }
  const work = await fetchWork(ubn);
  if (!work) return { title: 'Catalogue entry not found - BPH', robots: { index: false, follow: false } };
  const title = work.title || work.parallel_title || work.uniform_title || `BPH catalogue entry ${ubn}`;
  const author = work.author || work.variant_author || '';
  const description = `BPH catalogue entry. ${author ? author + '. ' : ''}${work.year ? `(${work.year}). ` : ''}Shelf mark: ${work.shelf_mark || '—'}.`;
  return { title: `${title} - BPH catalogue`, description };
}

function normalizeRoleSafe(role: unknown): Role {
  if (
    role === 'superadmin' ||
    role === 'admin' ||
    role === 'editor' ||
    role === 'contributor' ||
    role === 'reader'
  ) {
    return role;
  }
  if (role === 'inner_circle' || role === 'curator') return 'editor';
  return 'reader';
}

async function effectiveCatalogRole(
  email: string | null | undefined,
  platformRole: Role,
  tenantSlug: string,
): Promise<Role> {
  if (!email) return platformRole;
  if (ROLE_LEVEL[platformRole] >= ROLE_LEVEL['editor']) return platformRole;
  try {
    const db = await getDb();
    const tenant = await db.collection('tenants').findOne({ slug: tenantSlug, status: { $ne: 'deleted' } });
    if (!tenant) return platformRole;
    const membership = await db.collection('memberships').findOne({
      email: email.toLowerCase(),
      tenantId: tenant.id,
      status: 'active',
    });
    const tenantRole = normalizeRoleSafe(membership?.role);
    return ROLE_LEVEL[tenantRole] >= ROLE_LEVEL[platformRole] ? tenantRole : platformRole;
  } catch {
    return platformRole;
  }
}

export default async function CatalogEntryPage({ params }: Props) {
  const { tenant, ubn } = await params;

  // Generic unified-catalogue tenants (kloss-collection, …) — render via the
  // shared component that reads library_catalog_records. BPH falls through.
  const partner = getPartnerBySlug(tenant);
  if (partner && partner.providerKey !== 'bph' && partner.hasUnifiedCatalogue) {
    return <GenericCatalogEntry tenant={tenant} catalogId={ubn} partner={partner} />;
  }

  // Fetch BPH catalog row + live SL book + session in parallel
  const [work, slBook, session] = await Promise.all([
    fetchWork(ubn),
    fetchSlBook(ubn),
    auth(),
  ]);
  if (!work) notFound();

  const platformRole = normalizeRoleSafe((session?.user as { role?: unknown } | undefined)?.role);
  const role = await effectiveCatalogRole(session?.user?.email, platformRole, tenant);
  const showEditButton = ROLE_LEVEL[role] >= ROLE_LEVEL['contributor'];
  const showReviewLink = ROLE_LEVEL[role] >= ROLE_LEVEL['editor'];
  const editLabel = ROLE_LEVEL[role] >= ROLE_LEVEL['editor'] ? 'Edit catalogue entry' : 'Propose a change';

  // If the work has no BPH-native digitisation but does have a cross-provider
  // scan recorded, fetch that book so we can offer a "Read at [source]" panel.
  const externalBook = !slBook && work.sl_external_book_id
    ? await fetchExternalBook(work.sl_external_book_id)
    : null;

  const displayTitle = work.title || work.parallel_title || work.uniform_title || `(untitled — UBN ${work.ubn})`;
  const slBookHref = slBook ? tenantBookUrl({ id: slBook.id, slug: slBook.slug }, tenant) : null;
  const slCoverUrl = slBook ? getBookThumbnailUrl(slBook, 'display') : null;
  const externalBookHref = externalBook
    ? tenantBookUrl({ id: externalBook.id, slug: externalBook.slug }, tenant)
    : null;
  const externalCoverUrl = externalBook ? getBookThumbnailUrl(externalBook, 'display') : null;
  const canonicalAuthor = slBook?.author ? formatAuthor(slBook.author).name : null;
  const translationPct = slBook && slBook.pages_translated && slBook.pages_ocr
    ? Math.round((slBook.pages_translated / Math.max(slBook.pages_ocr, 1)) * 100)
    : null;

  return (
    <div className="bg-cream">
      <div className="max-w-2xl mx-auto px-6 py-8">
        {showEditButton && (
          <div className="flex justify-end gap-2 mb-2">
            {showReviewLink && (
              <a
                href="/catalog/review"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border-light text-secondary hover:bg-warm hover:text-primary transition-colors"
              >
                Review queue
              </a>
            )}
            <a
              href={`/catalog/${encodeURIComponent(work.ubn)}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border-light text-secondary hover:bg-warm hover:text-primary transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              {editLabel}
            </a>
          </div>
        )}
        {/* Identity */}
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

        {/* Source Library digital edition (when available) */}
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

            {slBook.display_title && slBook.display_title !== work.title && (
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
              {canonicalAuthor && canonicalAuthor !== work.author && (
                <Field label="Canonical author" value={canonicalAuthor} />
              )}
              {slBook.published && slBook.published !== String(work.year || '') && (
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
              {slBook.is_first_translation && (
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
              <p className="text-sm text-secondary leading-relaxed mb-4 italic">
                {slBook.reading_summary.overview.length > 380
                  ? slBook.reading_summary.overview.slice(0, 380) + '…'
                  : slBook.reading_summary.overview}
              </p>
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

        {/* Cross-provider scan — BPH holds the work, but the digitisation
            lives at another archive. Visually distinct from the BPH-native
            panel above so users (and EFM) can see at a glance which scan
            they're looking at. Only renders when the row has no BPH-native
            link AND we successfully resolved the external book. */}
        {externalBook && externalBookHref && (
          <section className="mb-8 p-5 rounded-lg border border-border-light bg-white">
            <div className="flex items-center gap-2 mb-3">
              <BookMarked className="w-4 h-4 text-secondary" />
              <h2 className="text-sm font-medium text-secondary uppercase tracking-wide">
                Scan via {externalSourceLabel(work.sl_external_source)}
              </h2>
            </div>
            <p className="text-xs text-muted mb-3 leading-relaxed">
              BPH holds this work; the digitisation shown here was produced by{' '}
              {externalSourceLabel(work.sl_external_source)} and is read through Source Library.
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
                {externalBook.display_title && externalBook.display_title !== work.title && (
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
                  Read the {externalSourceLabel(work.sl_external_source)} scan
                </a>
              </div>
            </div>
          </section>
        )}

        {/* Catalogue metadata — every public field, single column */}
        <Section title="Title">
          <Field label="Short title" value={work.title} />
          <Field label="Full title (transcription)" value={work.parallel_title} />
          <Field label="Variant title" value={work.uniform_title} />
          <Field label="Series" value={work.series_title} />
          <Field label="Volume" value={work.volume_title} />
        </Section>

        <Section title="Authorship">
          <Field label="Author (BPH)" value={work.author} />
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
          {/* Only show the bibliographic format when it has a real source — the
              size-derived bucket ("smaller" etc.) is unreliable without signature
              collation, and BPH librarians have asked us to leave the field blank
              rather than show an estimate that masquerades as a determination. */}
          {work.bibliographic_format
            && work.field_provenance?.bibliographic_format?.source
            && work.field_provenance.bibliographic_format.source !== 'derived_from_size' && (
            <FieldRaw label="Format">
              <span className="text-primary capitalize">{work.bibliographic_format}</span>
            </FieldRaw>
          )}
          <Field label="Number of copies held" value={work.number_of_copies != null ? String(work.number_of_copies) : null} />
          <Field label="Binding" value={work.binding} />
          <Field label="Bound with" value={work.bound_with} />
        </Section>

        <Section title="Location at the BPH">
          <Field label="Present location" value={work.present_location} />
          <Field label="Shelf mark" value={work.shelf_mark} mono />
          <Field label="State Collection shelf mark" value={work.state_shelf_mark?.trim().toLowerCase() === 'neen' ? null : work.state_shelf_mark} mono />
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

        <p className="text-xs text-muted border-t border-border-light pt-4 mt-2">
          Catalogue data sourced from the Bibliotheca Philosophica Hermetica (UBN {work.ubn}).
          {showEditButton ? (
            <>
              {' '}
              <a
                href={`/catalog/${encodeURIComponent(work.ubn)}/edit`}
                className="text-accent-rust hover:underline"
              >
                {ROLE_LEVEL[role] >= ROLE_LEVEL['editor'] ? 'Edit this entry' : 'Propose a change'}
              </a>
              .
            </>
          ) : null}
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
