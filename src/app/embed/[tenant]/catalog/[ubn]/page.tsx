import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { BookMarked, ExternalLink, BookOpen, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getReadDb, getDb } from '@/lib/mongodb';
// tenantBookUrl removed - using inline URL construction with embed path
import { formatAuthor, getBookThumbnailUrl } from '@/lib/utils';
import { isPublishedFirstTranslation } from '@/lib/book';
import { getPartnerBySlug } from '@/lib/library-partners';
import { buildSignInHref } from '@/lib/tenant-signin-url';
import { auth } from '@/lib/auth';
import { ROLE_LEVEL, type Role } from '@/lib/auth';
import type { BphContributor } from '@/lib/bph-catalog';
import { normalizeStateShelfMark } from '@/lib/bph-state-shelfmark';
import { AISection } from '@/components/embed/AISection';
import CatalogEditorNav from '@/components/catalog/CatalogEditorNav';
import { effectiveCatalogRole, normalizeCatalogRole } from '@/lib/catalog-role';
import CatalogueUnavailable from '@/components/embed/CatalogueUnavailable';
import GenericCatalogEntry, { generateGenericMetadata } from './GenericCatalogEntry';
import { catalogKeyColumn } from '@/lib/bph-catalog-key';

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

// UBNs like "BPH 151" contain a space, which arrives URL-encoded ("BPH%20151")
// in the route segment. The stored value in bph_works has a real space, so an
// undecoded param never matches and the page 404s (the entire reason BPH-shelf-
// mark catalogue links were dead). Numeric UBNs have nothing to encode, which
// is why they always worked. Decode defensively — for already-decoded values
// (no '%') this is a no-op, and a malformed escape sequence falls back to raw.
function normalizeUbn(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * 2,012 catalogue rows have NO ubn at all — every one of the 110 `Fot`
 * photographs and 442 of the `M ` manuscripts among them. Memorix simply does
 * not issue a UBN for those record types. Since this route keyed on `ubn`, and
 * the browser's `detailUrl()` returns null without one, those records had no
 * address anywhere on the site: they rendered as plain text in the catalogue and
 * could not be opened. Reported twice by BPH staff — José Bouman 2026-07-31
 * ("not possible to click on titles with a shelf mark M (+number), nor on those
 * with shelfmark Fot (+ number)") and Natalie Koch 2026-08-05 ("the manuscript
 * records aren't clickable yet").
 *
 * They all carry a `uuid`, so the route accepts either key. A UBN is a short
 * digit string and a uuid is 8-4-4-4-12 hex, so the two can never be confused.
 */
// Rule + collision proof live in src/lib/bph-catalog-key.ts, pinned by
// tests/unit/bph-catalog-key.test.ts.

interface FieldProvenance {
  source: string;
  evidence?: string;
  derived_at?: string;
}

interface BphWorkRow {
  ubn: string | null;
  // Present on every row; the only key the 2,012 UBN-less records have.
  uuid: string | null;
  // Manuscript records carry their title here rather than in `title`, which is
  // null on all 812 of them. Without this fallback they render "(untitled)".
  full_title: string | null;
  title: string | null;
  parallel_title: string | null;
  uniform_title: string | null;
  author: string | null;
  variant_author: string | null;
  pseudonym: string | null;
  editor: string | null;
  variant_editor: string | null;
  // Author authority columns (#1921 P3) — present after migration
  // 20260522000000_bph_works_author_authority.sql is applied. The fetchWork
  // fallback below drops these if the columns aren't there yet.
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
  // Memorix "Internal remarks" — cataloguers' working notes. Rendered ONLY
  // for editor+ roles; must never appear on the public page (José B., #3105).
  internal_remarks: string | null;
  // Where this copy has been exhibited. Staff-only on the same terms as
  // internal_remarks above (José B., 2026-07-29).
  exhibition_history: string | null;
  number_of_copies: number | null;
  object_size_cm: string | null;
  bibliographic_format: string | null;
  binding: string | null;
  bound_with: string | null;
  provenance: string | null;
  collection: string | null;
  impressum_original: string | null;
  contributors: BphContributor[] | null;
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
  const row = await fetchWorkBy(catalogKeyColumn(ubn), ubn);
  if (row) return row;
  // Second chance on the primary key. `bph_works.id` is a DIFFERENT uuid from
  // `bph_works.uuid`, and until 2026-08-13 the workspace worklist built its
  // sample links from `id` — so every link a librarian copied or bookmarked out
  // of "Needs your attention" addresses a key `catalogKeyColumn` sends to the
  // `uuid` column, where it matches nothing (José Bouman, 2026-08-12). The RPC
  // now emits `uuid`, but those older links are already out in the world.
  if (catalogKeyColumn(ubn) === 'uuid') return fetchWorkBy('id', ubn);
  return null;
}

async function fetchWorkBy(col: 'ubn' | 'uuid' | 'id', ubn: string): Promise<BphWorkRow | null> {
  // Try with the external-link columns first; if the column doesn't exist yet
  // (migration not applied on this environment), retry without them so the
  // page still renders.
  const select = `
      ubn, uuid, full_title,
      title, parallel_title, uniform_title,
      author, variant_author, pseudonym, editor, variant_editor,
      author_entity_id, author_canonical_name, author_wikidata_qid, author_viaf_id,
      place, printer, publisher, variant_printer, variant_publisher,
      year, shelf_mark, state_shelf_mark, present_location,
      keywords, language, series_title, volume_title,
      bibliography, remarks, internal_remarks, exhibition_history, number_of_copies, object_size_cm, bibliographic_format,
      binding, bound_with,
      provenance, collection, impressum_original, contributors,
      ia_identifier, ustc_sn, sl_book_id, sl_book_slug,
      sl_external_book_id, sl_external_slug, sl_external_source,
      field_provenance
    `;
  // Stacked fallbacks: drop newer columns (collection/impressum/contributors),
  // then external-link columns, then author-authority columns. Each migration
  // runs independently per environment — the page renders if any are missing.
  const fallbackSelect = select
    .replace('remarks, internal_remarks, exhibition_history,', 'remarks,')
    .replace('provenance, collection, impressum_original, contributors,', 'provenance,')
    .replace(
      'sl_external_book_id, sl_external_slug, sl_external_source,\n      ',
      '',
    );
  const fallbackNoAuthority = fallbackSelect.replace(
    'author_entity_id, author_canonical_name, author_wikidata_qid, author_viaf_id,\n      ',
    '',
  );
  const first = await supabase.from('bph_works').select(select).eq(col, ubn).maybeSingle();
  if (first.error) {
    const msg = (first.error.message || '').toLowerCase();
    if (msg.includes('does not exist') || msg.includes('could not find')) {
      const retry = await supabase.from('bph_works').select(fallbackSelect).eq(col, ubn).maybeSingle();
      if (retry.error) {
        const retryMsg = (retry.error.message || '').toLowerCase();
        if (retryMsg.includes('does not exist') || retryMsg.includes('could not find')) {
          const retry2 = await supabase.from('bph_works').select(fallbackNoAuthority).eq(col, ubn).maybeSingle();
          return (retry2.data as BphWorkRow | null) ?? null;
        }
        return null;
      }
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
      {
        'image_source.provider': 'bph',
        'dublin_core.dc_identifier': ubn,
        // Only surface a readable book. A hidden book (`visible: false`) 404s at
        // the reader's visibility gate, so the "Read in Source Library" link
        // built below would dead-end. When the mapped book isn't readable, fall
        // through to null and the entry renders as a catalogue-only record.
        visible: { $ne: false },
        pages_count: { $gt: 0 },
      },
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
  const { tenant, ubn: rawUbn } = await params;
  const ubn = normalizeUbn(rawUbn);
  const partner = getPartnerBySlug(tenant);
  if (partner && partner.providerKey !== 'bph' && partner.hasUnifiedCatalogue) {
    return generateGenericMetadata(tenant, ubn, partner) as Promise<Metadata>;
  }
  const work = await fetchWork(ubn);
  if (!work) return { title: 'Catalogue entry not found - BPH', robots: { index: false, follow: false } };
  const title = work.title || work.full_title || work.parallel_title || work.uniform_title || `BPH catalogue entry ${ubn}`;
  const author = work.author || work.variant_author || '';
  const description = `BPH catalogue entry. ${author ? author + '. ' : ''}${work.year ? `(${work.year}). ` : ''}Shelf mark: ${work.shelf_mark || '—'}.`;
  return { title: `${title} - BPH catalogue`, description };
}

export default async function CatalogEntryPage({ params }: Props) {
  const { tenant, ubn: rawUbn } = await params;
  const ubn = normalizeUbn(rawUbn);

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
  // The catalogue must never dead-end. If there's no catalogue row for this
  // reference (mis-typed UBN, re-catalogued, or an incomplete link), render a
  // graceful in-catalogue landing with a "New search" link — not a hard 404.
  if (!work) {
    return (
      <CatalogueUnavailable
        heading="Catalogue entry unavailable"
        detail={`We couldn't find a catalogue record for reference “${ubn}”. It may have been re-catalogued, or the reference may be incomplete. Try a new search.`}
      />
    );
  }

  // Sign-in link for signed-out visitors. Built from the REQUEST host, never
  // from the public pathname: the proxy rewrites bph.sourcelibrary.org/catalog/X
  // to /embed/bph/catalog/X internally, so the path we render under is not the
  // one the visitor's browser shows. Sending them back to the internal path
  // would strand them on a URL the tenant host doesn't serve. (Gating on
  // usePathname() is the same mistake that broke #3383.)
  const requestHeaders = await headers();
  const requestHost = requestHeaders.get('host') || '';
  // UBN-less records (manuscripts, photographs) are addressed by uuid.
  const publicPath = `/catalog/${encodeURIComponent(work.ubn || work.uuid || ubn)}`;
  const signInHref = buildSignInHref(
    requestHost,
    requestHost ? `https://${requestHost}${publicPath}` : publicPath
  );

  const platformRole = normalizeCatalogRole((session?.user as { role?: unknown } | undefined)?.role);
  const role = await effectiveCatalogRole(session?.user?.email, platformRole, tenant);
  const showEditButton = ROLE_LEVEL[role] >= ROLE_LEVEL['contributor'];
  const editLabel = ROLE_LEVEL[role] >= ROLE_LEVEL['editor'] ? 'Edit catalogue entry' : 'Propose a change';

  // If the work has no BPH-native digitisation but does have a cross-provider
  // scan recorded, fetch that book so we can offer a "Read at [source]" panel.
  const externalBook = !slBook && work.sl_external_book_id
    ? await fetchExternalBook(work.sl_external_book_id)
    : null;

  // Manuscripts keep their title in full_title; `title` is null on all 812.
  const displayTitle = work.title || work.full_title || work.parallel_title || work.uniform_title
    || (work.shelf_mark ? `(untitled — ${work.shelf_mark})` : `(untitled — ${work.ubn || work.uuid})`);
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

  return (
    <div className="bg-cream">
      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Back to the catalogue search start screen — visible to everyone, not
            just editors (Paul D., 2026-06-24: no way to start a new search from
            a record). `/catalog` is rewritten by the proxy to the tenant's
            catalogue search view. */}
        <div className="mb-3">
          <a
            href="/catalog"
            className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-primary transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            New search
          </a>
        </div>
        <CatalogEditorNav role={role} ubn={work.ubn || work.uuid || ubn} editLabel={editLabel} />
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
                    <Field label="Standard name" value={canonicalAuthor} />
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
                  <AISection kind="ai-summary-catalog">
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
          {/* Author authority (#1921 P3) — only render when an identifier is
              actually linked. The label uses "Standard name (VIAF)" to mirror
              the terminology in the editor's picker, so cataloguers see the
              same wording on read and write. */}
          {(work.author_canonical_name || work.author_viaf_id || work.author_wikidata_qid) && (
            <FieldRaw label="Standard name (VIAF)">
              <span className="flex flex-wrap items-baseline gap-x-2 text-primary">
                {work.author_canonical_name && <span>{work.author_canonical_name}</span>}
                {work.author_viaf_id && (
                  <a
                    href={`https://viaf.org/viaf/${work.author_viaf_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-secondary hover:underline text-xs"
                  >
                    VIAF {work.author_viaf_id}
                  </a>
                )}
                {work.author_wikidata_qid && (
                  <a
                    href={`https://www.wikidata.org/wiki/${work.author_wikidata_qid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-secondary hover:underline text-xs"
                  >
                    {work.author_wikidata_qid}
                  </a>
                )}
              </span>
            </FieldRaw>
          )}
          {work.contributors && work.contributors.length > 0 && (
            <FieldRaw label="Other contributors">
              <ul className="space-y-1 text-primary">
                {work.contributors.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-muted text-xs uppercase tracking-wide">{c.role}</span>
                    {c.author_id ? (
                      <a href={`/author/${c.author_id}`} className="text-accent-rust hover:underline">
                        {c.name || c.canonical_name}
                      </a>
                    ) : (
                      <span>{c.name}</span>
                    )}
                    {c.variant_name && <span className="text-secondary text-xs">(&ldquo;{c.variant_name}&rdquo;)</span>}
                  </li>
                ))}
              </ul>
            </FieldRaw>
          )}
        </Section>

        <Section title="Imprint">
          <Field label="Place of publication" value={work.place} />
          <Field label="Year of publication" value={work.year ? String(work.year) : null} />
          <Field label="Printer" value={work.printer} />
          <Field label="Printer (variant)" value={work.variant_printer} />
          <Field label="Publisher" value={work.publisher} />
          <Field label="Publisher (variant)" value={work.variant_publisher} />
          <Field label="Original impressum" value={work.impressum_original} />
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
          <Field label="State Collection shelf mark" value={normalizeStateShelfMark(work.state_shelf_mark)} mono />
          <Field label="Provenance" value={work.provenance} />
          <Field label="Collection" value={work.collection} />
        </Section>

        <Section title="Notes">
          <Field label="Bibliography" value={work.bibliography} />
          <Field label="Remarks" value={work.remarks} />
          {/* Staff-only working notes — never rendered for public visitors.
              Safe to role-gate here: this page is fully dynamic (private,
              no-store), so an editor's render is never cached for others. */}
          {ROLE_LEVEL[role] >= ROLE_LEVEL['editor'] && (
            <>
              <Field label="Internal remarks (staff only)" value={work.internal_remarks} />
              <Field label="Exhibition history (staff only)" value={work.exhibition_history} />
            </>
          )}
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
                href={`/catalog/${encodeURIComponent(work.ubn || work.uuid || ubn)}/edit`}
                className="text-accent-rust hover:underline"
              >
                {ROLE_LEVEL[role] >= ROLE_LEVEL['editor'] ? 'Edit this entry' : 'Propose a change'}
              </a>
              .
            </>
          ) : null}
          {/* Cataloguers arrive here signed out and, with the SiteHeader
              stripped on tenant hosts, previously had nothing to click —
              the record simply rendered read-only with no hint that editing
              existed or that they needed a session (#3468). The gear menu
              carries a Sign in item too, but nobody looking to catalogue
              thinks to open a settings icon. */}
          {!session ? (
            <>
              {' '}
              <a href={signInHref} className="text-accent-rust hover:underline">
                Sign in to edit
              </a>
              {' — for BPH cataloguers.'}
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
