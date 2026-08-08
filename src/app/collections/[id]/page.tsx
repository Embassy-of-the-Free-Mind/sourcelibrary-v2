import React, { Suspense, cache } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { ArrowLeft, BookOpen, Images, Library } from 'lucide-react';
import { headers } from 'next/headers';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import SiteHeader from '@/components/layout/SiteHeader';
import { getReadDb } from '@/lib/mongodb';
import { notFound, permanentRedirect } from 'next/navigation';
import collectionRedirects from '@/lib/collection-redirects.json';
import CollectionSchema from '@/components/seo/CollectionSchema';
import CollectionAllBooks from '@/components/collections/CollectionAllBooks';
import IndexCatalogBrowser from '@/components/collections/IndexCatalogBrowser';
import ExhibitionLayout from '@/components/collections/ExhibitionLayout';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { bookUrl, tenantBookUrl } from '@/lib/slugify';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import EmbedNavigationReporter from '@/components/embed/EmbedNavigationReporter';
import { ART_EXCLUDED_RESOURCE_TYPES, bookTitle, sanitizeThumbnail, withTimeout } from '@/lib/collections-utils';
import { getBookThumbnailUrl } from '@/lib/utils';
import { firstTranslationBadge } from '@/lib/first-translation-labels';
import { isTranslationReadable } from '@/lib/first-translation/derive';
import { ftRenderProps, type FtRenderSource } from '@/lib/first-translation/render';
import { browseBooks } from '@/lib/books-catalog';
import { supabase } from '@/lib/supabase';
import { authorUrl } from '@/lib/slugify';
import { ObjectId } from 'mongodb';

// ISR: rebuild at most once per day
export const revalidate = 86400;
export const dynamic = 'force-dynamic';
export const dynamicParams = true;
export const maxDuration = 60;
export async function generateStaticParams() {
  // Don't pre-render collections at build time — Atlas timeouts during build
  // cause hard failures. ISR will generate on first request instead.
  return [];
}

interface Props {
  params: Promise<{ id: string }>;
}

// ---------- Metadata ----------

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const redirectTarget = (collectionRedirects as Record<string, string>)[id];
  if (redirectTarget) permanentRedirect(`/collections/${redirectTarget}`);
  try {
    const db = await Promise.race([
      getReadDb(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 15000)),
    ]);
    const collection = await db.collection('collections').findOne({ slug: id, visible: { $ne: false } });

    if (!collection) {
      return { title: 'Collection Not Found - Source Library' };
    }

    const description = collection.description
      ? String(collection.description).slice(0, 200)
      : `Browse the ${collection.name} collection on Source Library.`;

    // Social-card image: the curated hero plate, falling back to the site
    // default. Without an explicit entry this page ships no og:image at all —
    // defining `openGraph` replaces the root layout's block, images included.
    const cardImage = typeof collection.hero_image === 'string' && collection.hero_image
      ? collection.hero_image
      : 'https://sourcelibrary.org/og-image.jpg';

    return {
      title: `${collection.name} - Source Library`,
      description,
      alternates: { canonical: `/collections/${id}` },
      openGraph: {
        title: `${collection.name} - Source Library`,
        description,
        type: 'website',
        images: [{ url: cardImage, alt: `${collection.name} — Source Library collection` }],
      },
      twitter: {
        card: 'summary_large_image',
        title: `${collection.name} - Source Library`,
        description,
        images: [{ url: cardImage, alt: `${collection.name} — Source Library collection` }],
      },
    };
  } catch {
    return { title: 'Collection - Source Library' };
  }
}

// ---------- Helpers ----------

/** Flatten inline markdown links `[text](/href)` to their anchor text.
 *  The rendered page body parses these into <Link>s, but plain-text consumers
 *  (schema.org JSON-LD `description`) must not carry raw markdown syntax. */
function stripMarkdownLinks(text: string | null | undefined): string {
  return (text || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

interface BookItem {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  pages_blank?: number;
  photo?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  categories?: string[];
  published?: string;
  read_count?: number;
  is_first_translation?: boolean;
  ft_disposition?: string;
  ft_claim?: 'confirmed' | 'candidate';
  resource_type?: string;
}

interface CuratedHighlight {
  book_id: string;
  rank: number;
  tier: number;
  note: string;
  title?: string;
  author?: string;
  year?: number;
  // Added during merge with book data
  slug?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  is_first_translation?: boolean;
  ft_disposition?: string;
  ft_claim?: 'confirmed' | 'candidate';
  language?: string;
  // Carried through the merge so the badge can be qualified when the
  // translation is barely started (#3435).
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  pages_blank?: number;
  id: string;
}

/** Auto-link book titles found in description text to their book pages.
 *  Explicit mentions (from collection.mentioned_books) take priority over auto-detection. */
// Inline markdown links [anchor](/path) authored in a collection description.
// Only INTERNAL hrefs (starting with "/") are honored — this both matches the
// intended use (deep links to /book/<id>/page/<pageId>) and blocks javascript:
// or off-site hrefs from admin-authored prose. Everything outside a markdown
// link is still run through the book-title / author auto-linker.
const MD_LINK_RE = /\[([^\]\n]+)\]\((\/[^)\s]+)\)/g;

function linkBookTitles(
  text: string,
  allBooks: BookItem[],
  explicitMentions?: { text: string; book_id: string }[],
  tenantSlug?: string | null,
  authorLinks: { name: string; href: string; canonical?: string; count?: number }[] = [],
): React.ReactNode {
  MD_LINK_RE.lastIndex = 0;
  if (!MD_LINK_RE.test(text)) {
    return autoLinkPlain(text, allBooks, explicitMentions, tenantSlug, authorLinks);
  }
  MD_LINK_RE.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = MD_LINK_RE.exec(text)) !== null) {
    if (m.index > last) {
      out.push(autoLinkPlain(text.slice(last, m.index), allBooks, explicitMentions, tenantSlug, authorLinks));
    }
    const anchor = m[1];
    const href = m[2];
    out.push(
      <Link key={`md-${k++}-${m.index}`} href={href} className="text-accent-rust hover:underline italic">
        {anchor}
      </Link>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push(autoLinkPlain(text.slice(last), allBooks, explicitMentions, tenantSlug, authorLinks));
  }
  return <>{out}</>;
}

function autoLinkPlain(
  text: string,
  allBooks: BookItem[],
  explicitMentions?: { text: string; book_id: string }[],
  tenantSlug?: string | null,
  authorLinks: { name: string; href: string; canonical?: string; count?: number }[] = [],
): React.ReactNode {
  const matches: { start: number; end: number; title: string; id: string; href?: string }[] = [];
  const usedRanges: [number, number][] = [];

  // 1. Explicit mentions first (highest priority — exact text from description)
  if (explicitMentions?.length) {
    // Sort longest first to avoid partial matches
    const sorted = [...explicitMentions].sort((a, b) => b.text.length - a.text.length);
    for (const { text: mentionText, book_id } of sorted) {
      const escaped = mentionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        const regex = new RegExp(escaped, 'gi');
        let match;
        while ((match = regex.exec(text)) !== null) {
          const start = match.index;
          const end = start + match[0].length;
          if (!usedRanges.some(([s, e]) => start < e && end > s)) {
            matches.push({ start, end, title: match[0], id: book_id });
            usedRanges.push([start, end]);
          }
        }
      } catch { /* skip bad regex */ }
    }
  }

  // 2. Auto-detect from book titles (fills gaps not covered by explicit mentions)
  const titleMap: { title: string; id: string }[] = [];
  for (const book of allBooks) {
    const id = book.id;
    const dt = book.display_title;
    const t = book.title;
    if (dt && dt !== 'None') titleMap.push({ title: dt, id });
    if (t && t !== dt) titleMap.push({ title: t, id });
  }
  titleMap.sort((a, b) => b.title.length - a.title.length);

  for (const { title, id } of titleMap.filter(t => t.title.length >= 8)) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!usedRanges.some(([s, e]) => start < e && end > s)) {
        matches.push({ start, end, title: match[0], id });
        usedRanges.push([start, end]);
      }
    }
  }

  // 3a. Full-name phrases first. A bare surname is often shared by several
  // people in one collection ("Bruno" → Giordano Bruno, Christoph Bruno,
  // Elwin Bruno Christoffel), so the single-token pass below rules it ambiguous
  // and drops it. The full/canonical name ("Giordano Bruno") is unambiguous,
  // so match those multi-token phrases here and claim their ranges — this is
  // what lets prominent authors link despite a contested surname (#2176/#2179).
  const phraseHrefs = new Map<string, Set<string>>();
  const phraseForm = (s: string) => s
    .replace(/\([^)]*\)/g, '').replace(/,?\s*\d{3,4}\b.*$/, '').replace(/[,;|].*$/, '').trim();
  for (const { name, href, canonical } of authorLinks) {
    if (!href) continue;
    for (const form of [canonical, name]) {
      if (!form) continue;
      const p = phraseForm(form);
      if (p.split(/\s+/).filter(Boolean).length < 2) continue; // need a full name
      const key = p.toLowerCase();
      if (!phraseHrefs.has(key)) phraseHrefs.set(key, new Set());
      phraseHrefs.get(key)!.add(href);
    }
  }
  // longest phrase first so "Giordano Bruno" wins before any shorter overlap
  for (const [key, hrefs] of [...phraseHrefs].sort((a, b) => b[0].length - a[0].length)) {
    if (hrefs.size !== 1) continue;
    const href = [...hrefs][0];
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!usedRanges.some(([s, e]) => start < e && end > s)) {
        matches.push({ start, end, title: match[0], id: `author-${key}`, href });
        usedRanges.push([start, end]);
      }
    }
  }

  // 3. Single surname/name tokens (≥5 chars). Descriptions usually name an
  // author by bare surname ("Bruno", "Spinoza", "Descartes"), so a token often
  // maps to several people in one collection (Giordano Bruno vs Christoph Bruno
  // vs Elwin Bruno Christoffel). Rather than drop every contested surname, link
  // it to the DOMINANT author when one clearly owns it — measured by how many of
  // the collection's books each candidate holds. Genuinely split surnames
  // (e.g. two prominent Picos) stay unlinked.
  const tokenWeights = new Map<string, Map<string, number>>(); // tok → href → book count
  for (const { name, href, count } of authorLinks) {
    if (!name || !href) continue;
    const seenInThisAuthor = new Set<string>();
    for (const raw of name.replace(/\([^)]*\)/g, '').replace(/,?\s*\d{3,4}\b.*$/, '').split(/[\s,;|]+/)) {
      const tok = raw.trim().toLowerCase();
      if (tok.length < 5 || seenInThisAuthor.has(tok)) continue;
      seenInThisAuthor.add(tok);
      if (!tokenWeights.has(tok)) tokenWeights.set(tok, new Map());
      const w = tokenWeights.get(tok)!;
      w.set(href, (w.get(href) || 0) + (count || 1));
    }
  }
  for (const [tok, weights] of tokenWeights) {
    const ranked = [...weights.entries()].sort((a, b) => b[1] - a[1]);
    const [topHref, topN] = ranked[0];
    const secondN = ranked[1]?.[1] ?? 0;
    // Unique owner → always link. Contested → link only on a clear plurality
    // (≥3 books and ≥3× the runner-up) so we don't guess on a real tie.
    if (ranked.length > 1 && !(topN >= 3 && topN >= 3 * secondN)) continue;
    const href = topHref;
    const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!usedRanges.some(([s, e]) => start < e && end > s)) {
        matches.push({ start, end, title: match[0], id: `author-${tok}`, href });
        usedRanges.push([start, end]);
      }
    }
  }

  if (matches.length === 0) return text;
  matches.sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  for (const m of matches) {
    if (m.start > lastIdx) parts.push(text.slice(lastIdx, m.start));
    parts.push(
      <Link key={m.id + '-' + m.start} href={m.href ?? tenantBookUrl({ id: m.id }, tenantSlug)} className="text-accent-rust hover:underline italic">
        {m.title}
      </Link>
    );
    lastIdx = m.end;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));

  return <>{parts}</>;
}

// ---------- Data fetching ----------

const COMPACT_LIMIT = 14;

/** Sanitize thumbnail URLs: unwrap /api/image?url= wrappers, reject non-http URLs.
 *  The /api/image wrapper crashes Next.js Image during SSR. */

// Lightweight, cached collection-existence lookup. Runs in the page SHELL (see
// CollectionDetailPage) so a missing collection returns a REAL 404 status
// instead of a soft-404 (HTTP 200 + "Not Found" body). #3232.
//
// React cache() dedupes this within a single request, so fetchCollectionData
// reuses the same result — no extra DB round trip. It THROWS on DB error/timeout
// (bubbles to error.tsx → 500) and returns null ONLY when the collection genuinely
// doesn't exist, so a transient Atlas blip is never mistaken for a 404. The tenant
// filter mirrors fetchCollectionData's exactly so the two can't disagree.
const getCollectionDoc = cache(async (id: string, tenantId: string | null) => {
  const db = await getReadDb();
  return db.collection('collections').findOne(
    tenantId
      ? {
        slug: id,
        visible: { $ne: false },
        $or: [
          { tenantId },
          { tenantId: { $exists: false } },
        ],
      }
      : { slug: id, visible: { $ne: false } },
    { maxTimeMS: 8000 },
  );
});

async function fetchCollectionData(id: string, tenantId: string | null, provider?: string) {
  // Wrap getReadDb() in a timeout — when MongoDB Atlas is overloaded, the connection
  // itself can hang for 60+ seconds. Better to fail fast and let ISR retry.
  const db = await withTimeout(getReadDb(), 10000, null as unknown as Awaited<ReturnType<typeof getReadDb>>);
  if (!db) throw new Error('DB connection timeout');

  // Only explicit visible:false hides a collection (takedowns, prelaunch);
  // missing/undefined stays public — same convention as books. Reuses the
  // cache()'d shell lookup (getCollectionDoc), so this is free within a request.
  const collection = await getCollectionDoc(id, tenantId);
  if (!collection) return null;

  const isArtCollection = collection.collection_type === 'visual_art';

  const filter: Record<string, unknown> = isArtCollection
    ? {
      collections: id,
      resource_type: { $exists: true },
      ...(tenantId ? { tenantId } : {}),
    }
    : {
      collections: id,
      ...(tenantId ? { tenantId } : {}),
      $or: [
        { visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } },
        { resource_type: { $exists: true } },
      ],
    };
  // Provider filter — restrict to a specific library's books.
  if (provider) {
    filter.$and = [
      ...(filter.$and as unknown[] || []),
      { $or: [{ held_by: provider }, { 'image_source.provider': provider }] },
    ];
  }

  const projection = {
    _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1,
    language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1,
    photo: 1, categories: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, published: 1, read_count: 1,
    resource_type: 1, commons_width: 1, commons_height: 1,
    is_first_translation: 1,
    // What ftRenderProps needs to pick the claim register (#3726 Tier 3).
    // (The old `ft_disposition: 1` here projected a field Mongo books never
    // had — every card silently fell to the candidate register.)
    'translation_verification.disposition': 1,
    'first_translation.verdict': 1, 'first_translation.evidence_strength': 1,
    'first_translation.our_completeness': 1,
    'source_language_screen.verdict': 1, 'translator_author_screen.verdict': 1,
  };

  // Compute the badge render pair once, server-side, and drop the raw
  // subdocuments so client payloads stay lean.
  const withFtRender = <T extends Record<string, unknown>>(b: T) => {
    const ft = ftRenderProps(b as FtRenderSource);
    const {
      first_translation: _ft, translation_verification: _tv,
      source_language_screen: _sls, translator_author_screen: _tas,
      ...rest
    } = b;
    return { ...rest, ft_disposition: ft.disposition, ft_claim: ft.claim };
  };

  // Extract curated highlights from collection document
  const curatedHighlights: CuratedHighlight[] = collection.highlighted_books || [];
  const curatedBookIds = curatedHighlights.map((h: CuratedHighlight) => h.book_id);

  const mentionedBookIds = (collection.mentioned_books || [])
    .map((m: { book_id: string }) => m.book_id)
    .filter(Boolean);

  // Art collections share one canonical filter with the manifest API
  // (/api/collections/[id]?mode=manifest) — keep them in sync or the
  // server-rendered grid and the expanded grid show different works.
  const artFilter = {
    collections: id,
    resource_type: { $exists: true, $nin: ART_EXCLUDED_RESOURCE_TYPES },
    visible: true,
  };

  // book_count is cached by syncCollectionCounts in scripts/workers/sync-worker.mjs
  // (Hetzner, every 2h) and reflects only translated books (pages_translated > 0) —
  // meaningless for visual_art collections, whose items are artworks. Count those live.
  const total = isArtCollection
    ? await withTimeout(
      db.collection('books').countDocuments(artFilter, { maxTimeMS: 8000 }),
      8000, collection.artwork_count || 0,
    )
    : collection.book_count || 0;

  // Track gallery collection slug for linking (captured in the gallery query below)
  let galleryCollectionSlug: string | null = null;
  let galleryTotalCount: number | null = null; // real total from thematic gallery (not capped)

  // All queries run in parallel with timeouts. Cold MongoDB connections from
  // Mumbai→Virginia can take 15-20s, so even "critical" queries need protection.
  // Fetch artworks for mixed collections (book collections that also contain artworks)
  const artworksPromise = !isArtCollection
    ? withTimeout(
      db.collection('books')
        .find(
          { collections: id, resource_type: { $exists: true }, visible: true },
          {
            projection: {
              _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1,
              resource_type: 1, medium: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
              'enrichment.subject': 1, 'enrichment.genre': 1,
              commons_width: 1, commons_height: 1,
            },
            maxTimeMS: 8000,
          },
        )
        .sort({ author: 1, title: 1 })
        .limit(60)
        .toArray(),
      8000, [],
    )
    : Promise.resolve([]);

  // Books query: Supabase primary (fast), MongoDB fallback (has collection_scores
  // but Atlas multiplanner timeouts cause 10-15s delays or 500s).
  async function fetchBooksWithFallback() {
    // Art collections: use MongoDB directly, curated rank first then image
    // resolution — same filter and sort as the manifest API.
    if (isArtCollection) {
      const docs = await withTimeout(
        db.collection('books')
          .find(artFilter, { projection, maxTimeMS: 8000 })
          .sort({ [`art_collection_rank.${id}`]: -1, commons_width: -1 })
          .limit(COMPACT_LIMIT)
          .toArray(),
        15000, [],
      );
      return docs;
    }

    try {
      if (!tenantId) {
        const { books: sbBooks } = await browseBooks({
          collection: id,
          sort: 'popular',
          limit: COMPACT_LIMIT,
          skipCount: true, // collection.book_count is cached — skip expensive Supabase count
          hasPages: isArtCollection ? false : undefined,
          hasResourceType: isArtCollection || undefined,
          provider: provider || undefined,
        });
        return sbBooks.map(b => ({
          id: b.id, slug: b.slug, title: b.title, display_title: b.display_title,
          author: b.author, year: b.year, language: b.language,
          pages_count: b.pages_count, pages_ocr: b.pages_ocr,
          pages_translated: b.pages_translated, pages_blank: b.pages_blank,
          photo: b.photo, thumbnail: b.thumbnail, thumbnail_blob: b.thumbnail_blob,
          published: b.published, read_count: b.read_count,
          is_first_translation: b.is_first_translation,
          categories: b.categories,
          resource_type: b.resource_type,
        }));
      }

      const docs = await withTimeout(
        db.collection('books')
          .find(filter, { projection, maxTimeMS: 8000 })
          .sort({ read_count: -1, title: 1 })
          .limit(COMPACT_LIMIT)
          .toArray(),
        15000, [],
      );
      return docs;
    } catch {
      // MongoDB fallback — if Supabase is down
      console.warn(`[Collection ${id}] Supabase books query failed, falling back to MongoDB`);
      const docs = await withTimeout(
        db.collection('books')
          .find(filter, { projection, maxTimeMS: 8000 })
          .sort({ read_count: -1, title: 1 })
          .limit(COMPACT_LIMIT)
          .toArray(),
        15000, [],
      );
      return docs;
    }
  }

  const [books, highlights, galleryImages, mentionedBooks, firstTranslations] = await Promise.all([
    fetchBooksWithFallback(),
    curatedBookIds.length > 0
      ? withTimeout(
        db.collection('books')
          .find(
            { id: { $in: curatedBookIds }, visible: true },
            { projection: { ...projection, is_first_translation: 1, 'translation_verification.disposition': 1 } },
          )
          .toArray(),
        8000, [],
      )
      : Promise.resolve([]),
    // Gallery: prefer thematic gallery collection (materialized), then curated, then dynamic query
    withTimeout(
      db.collection('gallery_collections')
        .findOne({ book_collection_slug: id, type: 'thematic' })
        .then(async (thematicCol) => {
          if (thematicCol?.slug) {
            galleryCollectionSlug = thematicCol.slug as string;
          }
          const thematicIds = thematicCol?.image_ids as string[] | undefined;
          if (thematicIds && thematicIds.length > 0) {
            galleryTotalCount = thematicIds.length;
            // Resolve a sample of image IDs for rendering (full set available via gallery page)
            return db.collection('gallery_images')
              .find({ id: { $in: thematicIds.slice(0, 60) } }, { projection: { _id: 0 } })
              .toArray();
          }
          if (collection.curated_gallery_images?.length > 0) {
            return (collection.curated_gallery_images as any[]).map(({ _id, ...rest }: any) => rest);
          }
          // Fallback: dynamic query (before thematic collections are seeded)
          const bookDocs = await db.collection('books')
            .find(
              { collections: id, visible: true, ...(tenantId ? { tenantId } : {}) },
              { projection: { id: 1 }, maxTimeMS: 5000 }
            )
            .toArray();
          const bookIds = bookDocs.map(d => d.id);
          if (bookIds.length === 0) return [];
          return db.collection('gallery_images')
            .find({
              book_id: { $in: bookIds.slice(0, 200) },
              gallery_quality: { $gte: 0.8 },
              type: { $nin: ['decorative', 'symbol', 'musical_score', 'printer_device', 'printer_mark', 'ornament', 'border'] },
            }, { projection: { _id: 0 }, maxTimeMS: 3000 })
            .sort({ gallery_quality: -1 })
            .limit(60)
            .toArray();
        }),
      8000, [],
    ),
    mentionedBookIds.length > 0
      ? withTimeout(
        db.collection('books')
          .find(
            { id: { $in: mentionedBookIds }, pages_translated: { $gt: 0 }, ...(tenantId ? { tenantId } : {}) },
            { projection }
          )
          .toArray(),
        8000, [],
      )
      : Promise.resolve([]),
    // First translations — every readable book in this collection flagged as a
    // first translation. The compact grid above is capped at COMPACT_LIMIT and
    // popularity-sorted, so this is a separate, fuller query (chronological) for
    // the dedicated "First translations" band. Art collections skip it.
    isArtCollection
      ? Promise.resolve([])
      : withTimeout(
        db.collection('books')
          .find(
            { collections: id, is_first_translation: true, pages_translated: { $gt: 0 }, visible: true, ...(tenantId ? { tenantId } : {}) },
            { projection: { ...projection, 'translation_verification.disposition': 1 }, maxTimeMS: 8000 },
          )
          .sort({ year: 1, title: 1 })
          .limit(60)
          .toArray(),
        8000, [],
      ),
  ]);

  const artworks = await artworksPromise;

  // Fetch parent collection if this is a subcollection
  let parentCollection: { slug: string; name: string } | null = null;
  if (collection.parent) {
    const parentDoc = await withTimeout(
      db.collection('collections').findOne(
        tenantId
          ? {
            slug: collection.parent,
            $or: [
              { tenantId },
              { tenantId: { $exists: false } },
            ],
          }
          : { slug: collection.parent },
        { projection: { slug: 1, name: 1 } },
      ),
      5000, null,
    );
    if (parentDoc) {
      parentCollection = { slug: parentDoc.slug, name: parentDoc.name };
    }
  }

  // Fetch child collections if this is a parent collection
  const childCollections = await withTimeout(
    db.collection('collections')
      .find({ parent: id, visible: true, ...(tenantId ? { tenantId } : {}) })
      .sort({ book_count: -1 })
      .project({ slug: 1, name: 1, subtitle: 1, book_count: 1, total_book_count: 1, featured_images: 1 })
      .toArray(),
    8000, [],
  );

  const { _id, ...collectionClean } = collection;

  // Sanitize thumbnails to prevent /api/image wrapper URLs from crashing Next.js Image
  const sanitizeBookThumbs = (items: Record<string, unknown>[]) =>
    items.map(b => ({ ...b, thumbnail: sanitizeThumbnail(b.thumbnail_blob as string) || sanitizeThumbnail(b.thumbnail as string) }));

  // Merge curated highlights with live book data (thumbnails, slugs, first-translation status)
  const curatedBookMap = new Map(
    (highlights as Record<string, unknown>[]).map(b => [b.id as string, b]),
  );
  const mergedHighlights = curatedHighlights
    .filter((h: CuratedHighlight) => curatedBookMap.has(h.book_id))
    .map((h: CuratedHighlight) => {
      const book = curatedBookMap.get(h.book_id) as Record<string, unknown>;
      return {
        ...h,
        title: (book.display_title as string) || (book.title as string) || h.title,
        author: (book.author as string) || h.author,
        year: (book.year as number) || h.year,
        slug: book.slug as string | undefined,
        thumbnail: sanitizeThumbnail(book.thumbnail_blob as string) || sanitizeThumbnail(book.thumbnail as string),
        is_first_translation: book.is_first_translation as boolean | undefined,
        ...(() => {
          const ft = ftRenderProps(book as FtRenderSource);
          return { ft_disposition: ft.disposition, ft_claim: ft.claim };
        })(),
        language: book.language as string | undefined,
        pages_count: book.pages_count as number | undefined,
        pages_ocr: book.pages_ocr as number | undefined,
        pages_translated: book.pages_translated as number | undefined,
        pages_blank: book.pages_blank as number | undefined,
        id: h.book_id,
      };
    });

  // Fetch curated exhibition data (if available).
  // This decides the WHOLE page layout: when a draft exists, ExhibitionLayout renders
  // and the standard Featured/highlights/gallery/description bands are suppressed
  // (they all gate on `!exhibition?.layout`). A timeout here therefore silently FLIPS
  // a curated collection (e.g. /collections/yoga) back to the generic layout — so this
  // fetch must be reliable. Backed by the `collection_slug_status_idx` index (IXSCAN,
  // ~1ms), with a generous timeout so a transient slow read never drops the exhibition.
  const curationDraft = await withTimeout(
    db.collection('curation_drafts').findOne(
      { collection_slug: id, status: 'draft' },
      { projection: { curation: 1 } },
    ),
    12000, null,
  );

  // Resolve book references in curation layout — attach thumbnails and slugs
  let exhibitionBooks: BookItem[] = [];
  if (curationDraft?.curation?.layout) {
    const allBookIds = new Set<string>();
    for (const block of curationDraft.curation.layout) {
      if (block.component === 'sections') {
        for (const s of block.sections || []) {
          for (const b of s.books || []) allBookIds.add(b.id);
        }
      }
      if (block.component === 'reading_paths') {
        for (const p of block.paths || []) {
          for (const step of p.steps || []) allBookIds.add(step.book_id);
        }
      }
      if (block.component === 'key_figures') {
        for (const f of block.figures || []) {
          if (f.key_book_id) allBookIds.add(f.key_book_id);
        }
      }
      if (block.component === 'timeline') {
        for (const h of block.highlights || []) {
          if (h.book_id) allBookIds.add(h.book_id);
        }
      }
      if (block.component === 'quotes') {
        for (const q of block.quotes || []) {
          if (q.book_id) allBookIds.add(q.book_id);
        }
      }
    }
    if (allBookIds.size > 0) {
      const exBooks = await withTimeout(
        db.collection('books').find(
          { id: { $in: [...allBookIds] }, visible: true },
          { projection: { _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, is_first_translation: 1, 'translation_verification.disposition': 1, 'first_translation.verdict': 1, 'first_translation.evidence_strength': 1, 'first_translation.our_completeness': 1, 'source_language_screen.verdict': 1, 'translator_author_screen.verdict': 1 } },
        ).toArray(),
        8000, [],
      );
      exhibitionBooks = exBooks.map(b => withFtRender({
        ...b,
        thumbnail: sanitizeThumbnail(b.thumbnail_blob as string) || sanitizeThumbnail(b.thumbnail as string),
      })) as unknown as BookItem[];
    }
  }

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    collection: collectionClean as any,
    books: sanitizeBookThumbs(
      (books as Record<string, unknown>[]).map(withFtRender),
    ) as unknown as BookItem[],
    highlights: mergedHighlights,
    firstTranslations: sanitizeBookThumbs(
      (firstTranslations as Record<string, unknown>[]).map(withFtRender),
    ) as unknown as BookItem[],
    total,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    galleryImages: JSON.parse(JSON.stringify(galleryImages)) as any[],
    mentionedBooks: sanitizeBookThumbs(mentionedBooks) as unknown as BookItem[],
    parentCollection,
    galleryCollectionSlug,
    galleryTotalCount,
    exhibition: curationDraft?.curation ? JSON.parse(JSON.stringify(curationDraft.curation)) : null,
    exhibitionBooks,
    childCollections: childCollections.map(({ _id, ...rest }) => rest) as { slug: string; name: string; subtitle?: string; book_count?: number; total_book_count?: number; featured_images?: ({ extracted_url?: string; image_url?: string; thumbnail_url?: string } | string)[] }[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    artworks: artworks as any[],
  };
}

// ---------- Page ----------

// Skeleton shown while the heavy collection body streams in. Mirrors the old
// collections/[id]/loading.tsx — moved into an INNER Suspense boundary so the
// route's existence check can run in the shell and return a real 404. #3232.
function CollectionDetailSkeleton() {
  return (
    <div className="min-h-screen bg-cream">
      <ConditionalSiteHeader variant="light" />
      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="h-4 w-32 bg-stone-200 rounded animate-pulse mb-6" />
        <div className="mb-8">
          <div className="h-10 w-2/3 bg-stone-200 rounded animate-pulse mb-3" />
          <div className="h-5 w-full max-w-2xl bg-stone-100 rounded animate-pulse mb-2" />
          <div className="h-5 w-4/5 max-w-2xl bg-stone-100 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-[3/4] bg-stone-200 rounded-lg animate-pulse" />
              <div className="h-3 w-3/4 bg-stone-200 rounded animate-pulse" />
              <div className="h-3 w-1/2 bg-stone-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Shell: resolve params, honor redirects, and check existence BEFORE any Suspense
// boundary. There is no loading.tsx above this route (both were removed in #3232),
// so an await here blocks the streamed shell — letting notFound() commit a real 404
// status. The heavy data fetch + render streams in via <Suspense> below, preserving
// the loading skeleton users saw before.
export default async function CollectionDetailPage({ params, provider }: Props & { provider?: string }) {
  const { id } = await params;

  // Merged/retired collection slugs 308 to their successor — the old URLs are
  // public and indexed (see issue #3002; map maintained alongside
  // scripts/maintenance/reorganize-collections.mjs).
  const redirectTarget = (collectionRedirects as Record<string, string>)[id];
  if (redirectTarget) permanentRedirect(`/collections/${redirectTarget}`);

  const { slug: tenantSlug, id: tenantId } = getTenantContextFromRequest(await headers());

  // Existence check in the shell — returns a real 404 for unknown slugs instead
  // of a soft-404 (HTTP 200 + "Not Found" body). getCollectionDoc throws on DB
  // failure (→ error.tsx / 500) and returns null only when genuinely absent.
  const collectionDoc = await getCollectionDoc(id, tenantId);
  if (!collectionDoc) notFound();

  return (
    <Suspense fallback={<CollectionDetailSkeleton />}>
      <CollectionDetailContent id={id} tenantId={tenantId} tenantSlug={tenantSlug} provider={provider} />
    </Suspense>
  );
}

async function CollectionDetailContent({ id, tenantId, tenantSlug, provider }: { id: string; tenantId: string | null; tenantSlug: string | null; provider?: string }) {
  let data;
  try {
    data = await fetchCollectionData(id, tenantId, provider);
  } catch (err) {
    console.error('[Collection page] fetchCollectionData failed:', err instanceof Error ? err.message : err);
    // Preserve ISR/static behavior: dynamic APIs like unstable_noStore() inside
    // this path trigger DYNAMIC_SERVER_USAGE in production renders.
    // Re-throw so Next can serve a 500 for transient backend issues instead of
    // incorrectly caching a notFound() response.
    throw err;
  }
  // Defense-in-depth: the shell already 404'd truly-missing collections, but a
  // tenant-scoped mismatch can still return null here.
  if (!data) notFound();

  const { collection, books, highlights: curatedHighlightsData, firstTranslations, galleryImages, total, mentionedBooks, parentCollection, galleryCollectionSlug, galleryTotalCount, exhibition, exhibitionBooks, childCollections, artworks } = data;

  // Collections that carry an Index catalogue (index_catalogs editions) render
  // the catalogue browser as their centrepiece — hide the Visual Art section
  // there so it doesn't compete with the bans listing.
  const { count: catalogEditionCount } = await supabase
    .from('index_catalogs').select('id', { count: 'exact', head: true }).eq('collection_slug', id);
  const isCatalogCollection = (catalogEditionCount ?? 0) > 0;

  // For catalogue collections, the description names many authors (Bruno,
  // Galileo, …) — link them to their CANONICAL author page. Resolve each
  // distinct author string → its book's entity → canonical name → canonical
  // slug, so name-order variants of one person ("Bruno, Giordano" / "Giordano
  // Bruno") share a single href (this is what the canonical-author relink in
  // #2180 enables). Falls back to the raw string slug when unlinked.
  let descriptionAuthorLinks: { name: string; href: string; canonical?: string }[] = [];
  if (isCatalogCollection) {
    try {
      const db = await getReadDb();
      const pairs = await db.collection('books').aggregate([
        { $match: { collections: id, author: { $type: 'string', $ne: '' } } },
        { $group: { _id: '$author', ent: { $first: '$author_entity_id' }, n: { $sum: 1 } } },
      ]).toArray();
      const entIds = [...new Set(pairs.map(p => p.ent).filter(Boolean).map(String))];
      const entDocs = entIds.length
        ? await db.collection('entities').find(
          { _id: { $in: entIds.filter(s => ObjectId.isValid(s)).map(s => new ObjectId(s)) } },
          { projection: { canonical_name: 1, name: 1 } }).toArray()
        : [];
      const entName = new Map(entDocs.map(e => [String(e._id), e.canonical_name || e.name]));
      descriptionAuthorLinks = pairs.flatMap(p => {
        const canon = (p.ent ? entName.get(String(p.ent)) : null) as string | null;
        const href = authorUrl(canon || (p._id as string));
        return href ? [{ name: p._id as string, canonical: canon || undefined, href, count: (p.n as number) || 1 }] : [];
      });
    } catch { /* non-fatal — description just won't gain author links */ }
  }
  const languages = (collection.languages || []).filter((l: { count: number }) => l.count > 2);
  const isArtCollection = collection.collection_type === 'visual_art';
  const itemLabel = isArtCollection ? 'works' : 'books';

  // Group curated highlights by tier — cap each to avoid heavy pages crashing mobile Safari
  const tier1 = curatedHighlightsData.filter((h: { tier: number }) => h.tier === 1).slice(0, 6);
  const tier2 = curatedHighlightsData.filter((h: { tier: number }) => h.tier === 2).slice(0, 9);
  const tier3 = curatedHighlightsData.filter((h: { tier: number }) => h.tier === 3).slice(0, 8);
  const hasCuratedHighlights = curatedHighlightsData.length > 0;

  // Featured books — for collections without hand-curated highlights, surface a few
  // actual books high on the page (right under the sub-collections, above the
  // illustration gallery) instead of burying the catalogue at the bottom. `books` is
  // the compact, popularity-sorted set already fetched for the grid (no extra query),
  // so this is reliable even when the gallery image query times out. Curated
  // collections keep their Featured "Start here" + tier treatment untouched.
  const featuredPreviewBooks = (!isArtCollection && !hasCuratedHighlights)
    ? (books as BookItem[]).filter(b => !b.resource_type).slice(0, 8)
    : [];

  // Build a diverse pool of ~50 top images (max 2 per book), then randomly pick 9 for display
  const imagePool: typeof galleryImages = [];
  const bookImageCounts = new Map<string, number>();
  for (const img of galleryImages) {
    const thumb = img.extracted_url || img.extractedUrl || img.thumbnail_url || img.thumbnailUrl || img.imageUrl || img.image_url;
    if (!thumb) continue;
    const bid = img.book_id || img.bookId;
    const count = bookImageCounts.get(bid) || 0;
    if (count >= 2) continue;
    bookImageCounts.set(bid, count + 1);
    imagePool.push(img);
    if (imagePool.length >= 50) break;
  }

  // Fisher-Yates shuffle for randomized selection each ISR build
  const shuffled = [...imagePool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const diverseGalleryImages = shuffled.slice(0, 9);
  const heroImages = shuffled.slice(0, 6);

  // Fallback hero: use collection.hero_image or first featured_image when no gallery images
  const fallbackHeroUrl = !heroImages.length
    ? (collection.hero_image as string | undefined)
    || (() => {
      const fi = (collection.featured_images as { extracted_url?: string; image_url?: string; thumbnail_url?: string }[] | undefined);
      const first = fi?.find(img => img.thumbnail_url || img.extracted_url || img.image_url);
      return first?.thumbnail_url || first?.extracted_url || first?.image_url;
    })()
    || null
    : null;
  // For art collections, build artwork preview from the books array (which ARE artworks)
  type ArtPreview = { id: string; slug?: string; title: string; display_title?: string; author?: string; thumbnail?: string; thumbnail_blob?: string; resource_type?: string; enrichment?: { subject?: string }; commons_width?: number; commons_height?: number };
  let artworkPreviewImages: ArtPreview[] = [];
  if (isArtCollection && diverseGalleryImages.length === 0) {
    const artPool = (books as ArtPreview[]).filter(a => getBookThumbnailUrl(a));
    // Shuffle for variety on each ISR build
    for (let i = artPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [artPool[i], artPool[j]] = [artPool[j], artPool[i]];
    }
    artworkPreviewImages = artPool.slice(0, 9);
  }

  // Count total images and unique source books for gallery label
  // Use the real thematic total if available; otherwise fall back to fetched count
  const galleryTotalImages = galleryTotalCount ?? galleryImages.length;
  const galleryUniqueBooks = new Set(galleryImages.map((img: { book_id?: string; bookId?: string }) => img.book_id || img.bookId)).size;
  const allBooksForLinking = [
    ...curatedHighlightsData.map((h: { book_id: string; slug?: string; title?: string }) => ({
      id: h.book_id,
      slug: h.slug,
      title: h.title || '',
      display_title: h.title,
    })),
    ...books,
    ...mentionedBooks,
  ] as BookItem[];
  const explicitMentions: { text: string; book_id: string }[] = collection.mentioned_books || [];

  return (
    <div className="min-h-screen bg-cream">
      <EmbedNavigationReporter />
      <ConditionalSiteHeader variant="light" />
      <CollectionSchema
        slug={id}
        name={collection.name}
        description={stripMarkdownLinks(collection.expanded_description || collection.description)}
        bookCount={total}
        parentCollection={parentCollection}
        books={books.map(b => ({
          id: b.id,
          slug: b.slug,
          title: bookTitle(b),
          author: b.author,
          year: b.year,
        }))}
      />
      {/* Hero Section */}
      <div className="relative bg-dark overflow-hidden">
        {heroImages.length > 0 ? (
          <div className={`absolute inset-0 grid opacity-30 ${heroImages.length <= 2 ? 'grid-cols-2' :
            heroImages.length <= 3 ? 'grid-cols-3' :
              heroImages.length <= 4 ? 'grid-cols-2 sm:grid-cols-4' :
                'grid-cols-3 sm:grid-cols-6'
            }`}>
            {heroImages.map((img: { pageId?: string; page_id?: string; detectionIndex?: number; detection_index?: number; thumbnailUrl?: string; thumbnail_url?: string; extractedUrl?: string; extracted_url?: string; imageUrl?: string; image_url?: string }) => {
              const src = img.thumbnail_url || img.thumbnailUrl || img.extracted_url || img.extractedUrl || img.imageUrl || img.image_url;
              const key = `${img.pageId || img.page_id}-${img.detectionIndex ?? img.detection_index}`;
              if (!src) return null;
              return (
                <div key={key} className="relative overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
                </div>
              );
            })}
          </div>
        ) : artworkPreviewImages.length > 0 ? (
          <div className="absolute inset-0 grid grid-cols-3 sm:grid-cols-6 opacity-30">
            {artworkPreviewImages.slice(0, 6).map((art) => {
              const src = getBookThumbnailUrl(art, 'thumb');
              if (!src) return null;
              return (
                <div key={art.id} className="relative overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
                </div>
              );
            })}
          </div>
        ) : fallbackHeroUrl && (
          <div className="absolute inset-0 opacity-40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fallbackHeroUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-transparent" />

        <div className="relative max-w-[1500px] mx-auto px-6 pt-8 pb-12 sm:pb-16">
          <Link
            href={parentCollection ? (tenantSlug ? `/${tenantSlug}/collections/${parentCollection.slug}` : `/collections/${parentCollection.slug}`) : isArtCollection ? '/artwork' : '/#library'}
            className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            {parentCollection ? parentCollection.name : isArtCollection ? 'Visual Art' : 'Library'}
          </Link>

          <h1
            className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display"
          >
            {collection.name}
          </h1>

          {collection.subtitle && (
            <p className="text-lg sm:text-xl text-white/70 max-w-3xl leading-relaxed mb-4">
              {collection.subtitle}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4 text-sm text-white/50">
            <a
              href="#collection-all-books"
              className="hover:text-white/80 transition-colors underline underline-offset-2 decoration-white/30"
            >
              {total.toLocaleString('en-US')} {itemLabel}
            </a>
            {languages.length > 0 && (
              <>
                <span className="w-px h-4 bg-white/20" />
                <span>{languages.map((l: { lang: string }) => l.lang).join(', ')}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sub-collections grid */}
      {childCollections.length > 0 && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-[1500px] mx-auto px-6 py-8">
            <h2 className="text-2xl sm:text-3xl text-primary mb-5 font-display">
              Sub-collections
            </h2>
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
              {childCollections.map((child) => {
                const fi = child.featured_images;
                let heroUrl: string | undefined;
                if (fi?.length) {
                  const first = fi[0];
                  if (typeof first === 'string') { heroUrl = first; }
                  else {
                    const hero = fi.find((img) => typeof img !== 'string' && (img.thumbnail_url || img.extracted_url))
                      || fi.find((img) => typeof img !== 'string' && img.image_url);
                    if (hero && typeof hero !== 'string') heroUrl = hero.thumbnail_url || hero.extracted_url || hero.image_url;
                  }
                }
                return (
                  <Link
                    key={child.slug}
                    href={tenantSlug ? `/${tenantSlug}/collections/${child.slug}` : `/collections/${child.slug}`}
                    className="group relative block overflow-hidden rounded-lg aspect-[4/3]"
                  >
                    {heroUrl ? (
                      <Image
                        src={heroUrl}
                        alt={`Illustration from ${child.name}`}
                        fill
                        sizes="(max-width: 640px) 50vw, 25vw"
                        className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-[#3d3529] to-[#2a2318]" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
                    <div className="absolute inset-0 flex flex-col justify-end p-3 sm:p-4">
                      {(child.total_book_count ?? child.book_count) ? (
                        <p className="text-white/50 text-xs mb-1 hidden sm:block">
                          {(child.total_book_count ?? child.book_count)!.toLocaleString('en-US')} {itemLabel}
                        </p>
                      ) : null}
                      <h3 className="font-serif text-sm sm:text-base lg:text-lg text-white font-semibold leading-tight line-clamp-2 group-hover:text-accent-gold transition-colors">
                        {child.name}
                      </h3>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Featured books — a few of the collection's books, surfaced under the
          sub-collections and above the illustration gallery. Full catalogue stays below. */}
      {featuredPreviewBooks.length > 0 && !exhibition?.layout && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-[1500px] mx-auto px-6 py-10">
            <div className="flex items-end justify-between gap-4 mb-6">
              <h2 className="text-2xl sm:text-3xl text-primary font-display">
                Featured books
              </h2>
              <a
                href="#collection-all-books"
                className="text-sm text-muted hover:text-accent-rust transition-colors whitespace-nowrap"
              >
                All {total.toLocaleString('en-US')} {itemLabel} &darr;
              </a>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-4 sm:gap-5">
              {featuredPreviewBooks.map((b) => {
                const thumb = getBookThumbnailUrl(b);
                return (
                  <Link
                    key={b.id}
                    href={tenantBookUrl({ id: b.id, slug: b.slug }, tenantSlug)}
                    className="group block"
                  >
                    <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-white shadow-sm group-hover:shadow-md transition-shadow mb-2">
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt={bookTitle(b)}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="(min-width: 1024px) 170px, (min-width: 640px) 30vw, 45vw"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <BookOpen className="w-8 h-8 text-muted" />
                        </div>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug">
                      {bookTitle(b)}
                    </h3>
                    {b.author && (
                      <p className="text-xs text-muted line-clamp-1 mt-0.5">{b.author}</p>
                    )}
                    {b.is_first_translation && (b.pages_translated ?? 0) > 0 && (
                      <span className="inline-block mt-1 text-[9px] font-medium bg-accent-rust/10 text-accent-rust px-1 py-0.5 rounded">
                        {firstTranslationBadge(b.ft_disposition, b.language, !isTranslationReadable(b), b.ft_claim)}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* First translations — every readable first-translation in this collection.
          Renders only when there are any; hidden on art collections / exhibitions. */}
      {firstTranslations.length > 0 && !isArtCollection && !exhibition?.layout && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-[1500px] mx-auto px-6 py-10">
            <div className="flex items-end justify-between gap-4 mb-2">
              <h2 className="text-2xl sm:text-3xl text-primary font-display">
                First translations
              </h2>
              <span className="text-sm text-muted whitespace-nowrap">
                {firstTranslations.length} {firstTranslations.length === 1 ? 'title' : 'titles'}
              </span>
            </div>
            <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">
              Works in this collection appearing in a modern, readable translation for the first time — read them in full here.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {firstTranslations.map((b) => {
                const thumb = getBookThumbnailUrl(b);
                return (
                  <Link
                    key={b.id}
                    href={tenantBookUrl({ id: b.id, slug: b.slug }, tenantSlug)}
                    className="group block"
                  >
                    <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-white shadow-sm group-hover:shadow-md transition-shadow mb-2">
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt={bookTitle(b)}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="(min-width: 1280px) 280px, (min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <BookOpen className="w-8 h-8 text-muted" />
                        </div>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug">
                      {bookTitle(b)}
                    </h3>
                    {b.author && (
                      <p className="text-xs text-muted line-clamp-1 mt-0.5">
                        {b.author}{b.year ? `, ${b.year}` : ''}
                      </p>
                    )}
                    <span className="inline-block mt-1 text-[9px] font-medium bg-accent-rust/10 text-accent-rust px-1 py-0.5 rounded">
                      {firstTranslationBadge(b.ft_disposition, b.language, !isTranslationReadable(b), b.ft_claim)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Gallery — labeled illustrations */}
      {diverseGalleryImages.length > 0 && !isArtCollection && !exhibition?.layout && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-[1500px] mx-auto px-6 py-8">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-2xl sm:text-3xl text-primary font-display">
                Illustrations
              </h2>
              <Link
                href={galleryCollectionSlug ? (tenantSlug ? `/${tenantSlug}/gallery/collections/${galleryCollectionSlug}` : `/gallery/collections/${galleryCollectionSlug}`) : (tenantSlug ? `/${tenantSlug}/gallery?collection=${id}` : `/gallery?collection=${id}`)}
                className="text-sm text-muted hover:text-accent-rust transition-colors"
              >
                Browse all {galleryTotalImages.toLocaleString('en-US')}
              </Link>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-4 mt-5">
              {diverseGalleryImages.map((img: { pageId?: string; page_id?: string; bookId?: string; book_id?: string; detectionIndex?: number; detection_index?: number; thumbnailUrl?: string; thumbnail_url?: string; extractedUrl?: string; extracted_url?: string; imageUrl?: string; image_url?: string; museumDescription?: string; museum_description?: string; description?: string; bookTitle?: string; book_title?: string; type?: string }) => {
                const thumb = img.extracted_url || img.extractedUrl || img.thumbnail_url || img.thumbnailUrl || img.imageUrl || img.image_url;
                const pageId = img.pageId || img.page_id;
                const bookId = img.bookId || img.book_id;
                const detIdx = img.detectionIndex ?? img.detection_index;
                const galleryId = `${pageId}-${detIdx}`;
                const label = img.museumDescription || img.museum_description || img.description || img.bookTitle || img.book_title;
                return (
                  <Link
                    key={galleryId}
                    href={tenantBookUrl({ id: String(bookId) }, tenantSlug) + `/page/${pageId}`}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md"
                    title={label}
                  >
                    {thumb && (
                      <Image
                        src={thumb}
                        alt={img.description || img.bookTitle || img.book_title || 'Illustration'}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(min-width: 1024px) 200px, (min-width: 640px) 160px, 120px"
                        unoptimized
                      />
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-[11px] text-white leading-tight line-clamp-2">
                        {label}
                      </p>
                    </div>
                    {img.type && (
                      <span className="absolute top-1.5 left-1.5 text-[10px] bg-dark/70 text-white px-1.5 py-0.5 rounded capitalize leading-none">
                        {img.type}
                      </span>
                    )}
                  </Link>
                );
              })}
              {galleryTotalImages > diverseGalleryImages.length && (
                <Link
                  href={galleryCollectionSlug ? (tenantSlug ? `/${tenantSlug}/gallery/collections/${galleryCollectionSlug}` : `/gallery/collections/${galleryCollectionSlug}`) : (tenantSlug ? `/${tenantSlug}/gallery?collection=${id}` : `/gallery?collection=${id}`)}
                  className="group relative aspect-square rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md bg-cream flex flex-col items-center justify-center gap-2 text-center"
                >
                  <span className="text-sm font-medium text-muted group-hover:text-accent-rust transition-colors px-3">
                    View all {galleryTotalImages.toLocaleString('en-US')}
                  </span>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Featured Book — the #1 curated highlight, shown prominently to get visitors into a book fast */}
      {tier1.length > 0 && !isArtCollection && !exhibition?.layout && (() => {
        const featured = tier1[0];
        return (
          <div className="bg-warm border-b border-border-light">
            <div className="max-w-[1500px] mx-auto px-6 py-8">
              <Link
                href={tenantBookUrl({ id: featured.id, slug: featured.slug }, tenantSlug)}
                className="group flex flex-col sm:flex-row gap-6 sm:gap-8"
              >
                <div className="w-40 sm:w-48 flex-shrink-0 mx-auto sm:mx-0">
                  <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-white shadow-lg group-hover:shadow-xl transition-shadow">
                    {getBookThumbnailUrl(featured) ? (
                      <Image
                        src={getBookThumbnailUrl(featured)!}
                        alt={featured.title || ''}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                        sizes="192px"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <BookOpen className="w-12 h-12 text-muted" />
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <p className="text-xs font-medium uppercase tracking-wider text-accent-rust mb-2">Start here</p>
                  <h2 className="text-2xl sm:text-3xl font-semibold text-primary group-hover:text-accent-rust transition-colors leading-tight mb-2 font-display">
                    {featured.title}
                  </h2>
                  <p className="text-base text-muted mb-3">
                    {featured.author}{featured.year ? `, ${featured.year}` : ''}
                    {featured.is_first_translation && (
                      <span className="ml-2 text-[10px] font-medium bg-accent-rust/10 text-accent-rust px-1.5 py-0.5 rounded">
                        {firstTranslationBadge(featured.ft_disposition, featured.language, !isTranslationReadable(featured), featured.ft_claim)}
                      </span>
                    )}
                  </p>
                  <p className="text-secondary leading-relaxed max-w-2xl">
                    {featured.note}
                  </p>
                </div>
              </Link>
            </div>
          </div>
        );
      })()}

      {/* Exhibition Layout — renders curated components ABOVE gallery when available */}
      {exhibition?.layout && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-[1500px] mx-auto px-6 py-10">
            {exhibition.subtitle && (
              <p className="text-lg text-muted italic mb-6 font-display">{exhibition.subtitle}</p>
            )}
            <ExhibitionLayout
              layout={exhibition.layout}
              books={exhibitionBooks as any[]}
              images={galleryImages}
              collectionSlug={id}
            />
          </div>
        </div>
      )}

      {/* Gallery section moved above exhibition/featured book */}

      {/* Visual Art — artworks tagged to this collection (hidden when exhibition present) */}
      {artworks.length > 0 && !exhibition?.layout && !isCatalogCollection && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-[1500px] mx-auto px-6 py-8">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-2xl sm:text-3xl text-primary font-display">
                Visual Art
              </h2>
              <Link
                href="/artwork"
                className="text-sm text-muted hover:text-accent-rust transition-colors"
              >
                Browse all art &rarr;
              </Link>
            </div>
            <p className="text-sm text-muted mb-5">
              {artworks.length} {artworks.length === 1 ? 'work' : 'works'} of visual art in this collection
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {artworks.slice(0, 15).map((art: { id: string; slug?: string; title: string; display_title?: string; author?: string; published?: string; resource_type?: string; medium?: string; thumbnail?: string; thumbnail_blob?: string; enrichment?: { subject?: string; genre?: string }; commons_width?: number; commons_height?: number }) => {
                const thumb = getBookThumbnailUrl(art);
                const isPortrait = (art.commons_height || 0) > (art.commons_width || 0);
                return (
                  <Link
                    key={art.id}
                    href={`/artwork/${art.slug || art.id}?from=${id}`}
                    className="group block"
                  >
                    <div className="rounded-lg border border-border-light hover:border-accent-rust/40 hover:shadow-lg transition-[border-color,box-shadow] overflow-hidden bg-white">
                      <div className={`relative ${isPortrait ? 'aspect-[3/4]' : 'aspect-[4/3]'} bg-stone-100 overflow-hidden`}>
                        {thumb ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={thumb}
                            alt={art.display_title || art.title}
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="absolute inset-0 bg-cream" />
                        )}
                        {art.resource_type && art.resource_type !== 'printed_book' && (
                          <span className="absolute top-2 left-2 text-[10px] bg-dark/70 text-white px-1.5 py-0.5 rounded capitalize">
                            {art.resource_type}
                          </span>
                        )}
                      </div>
                      <div className="p-3">
                        <h3
                          className="text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors leading-tight line-clamp-2 mb-1"
                          style={{ fontFamily: 'var(--font-serif)' }}
                        >
                          {art.display_title || art.title}
                        </h3>
                        {art.author && (
                          <p className="text-xs text-muted line-clamp-1">{art.author}</p>
                        )}
                        {art.enrichment?.subject && (
                          <p className="text-xs text-secondary mt-1 line-clamp-2 leading-relaxed">
                            {art.enrichment.subject}
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
              {artworks.length > 15 && (
                <Link
                  href={tenantSlug ? `/${tenantSlug}/search?collection=${id}` : `/search?collection=${id}`}
                  className="flex items-center justify-center rounded-lg border border-dashed border-border-light hover:border-accent-rust/40 hover:bg-warm transition-all aspect-[4/3] text-sm text-muted hover:text-accent-rust"
                >
                  +{artworks.length - 15} more works
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Overview description */}
      {!exhibition?.layout && (collection.expanded_description || collection.description) && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-[1500px] mx-auto px-6 py-8">
            <div className="max-w-4xl">
              {(collection.expanded_description || collection.description)!.split('\n\n').map((para: string, i: number) => (
                <p key={i} className="text-secondary text-lg leading-relaxed mb-4 last:mb-0 font-body">
                  {linkBookTitles(para, allBooksForLinking, explicitMentions, tenantSlug, descriptionAuthorLinks)}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[1500px] mx-auto px-6 py-10">

        {/* Exhibition Layout is now rendered above the gallery section */}

        {/* Curated Highlights — remaining tier 1 + tiers 2 & 3 (hidden when exhibition is present) */}
        {hasCuratedHighlights && !isArtCollection && !exhibition?.layout && (
          <div className="mb-12">
            {/* Tier 1: Essential Reading (skip first, already shown as featured) */}
            {tier1.length > 1 && (
              <div className="mb-10">
                <h2 className="text-2xl sm:text-3xl text-primary mb-2 font-display">
                  Essential Reading
                </h2>
                <p className="text-sm text-muted mb-6">The foundational texts of this tradition</p>
                <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2">
                  {tier1.slice(1).map((h: CuratedHighlight) => (
                    <Link
                      key={h.book_id}
                      href={tenantBookUrl({ id: h.id, slug: h.slug }, tenantSlug)}
                      className="group flex gap-4 p-4 rounded-xl bg-white border border-border-light hover:border-accent-rust/30 hover:shadow-md transition-all"
                    >
                      <div className="w-20 sm:w-24 flex-shrink-0">
                        <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-warm">
                          {h.thumbnail ? (
                            <Image
                              src={h.thumbnail}
                              alt={h.title || ''}
                              fill
                              className="object-cover group-hover:scale-105 transition-transform duration-300"
                              sizes="96px"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <BookOpen className="w-8 h-8 text-muted" />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 py-1">
                        <h3 className="font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug mb-1 font-display">
                          {h.title}
                        </h3>
                        <p className="text-sm text-muted mb-2">
                          {h.author}{h.year ? `, ${h.year}` : ''}
                          {h.is_first_translation && (
                            <span className="ml-2 text-[10px] font-medium bg-accent-rust/10 text-accent-rust px-1.5 py-0.5 rounded">
                              {firstTranslationBadge(h.ft_disposition, h.language, !isTranslationReadable(h), h.ft_claim)}
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-secondary leading-relaxed line-clamp-3">
                          {h.note}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Tier 2: Important Works */}
            {tier2.length > 0 && (
              <div className="mb-10">
                <h2 className="text-xl sm:text-2xl text-primary mb-2 font-display">
                  Important Works
                </h2>
                <p className="text-sm text-muted mb-5">Significant texts that deepen understanding</p>
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {tier2.map((h: CuratedHighlight) => (
                    <Link
                      key={h.book_id}
                      href={tenantBookUrl({ id: h.id, slug: h.slug }, tenantSlug)}
                      className="group flex gap-3 p-3 rounded-xl bg-white border border-border-light hover:border-accent-rust/30 hover:shadow-md transition-all"
                    >
                      <div className="w-14 flex-shrink-0">
                        <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-warm">
                          {h.thumbnail ? (
                            <Image
                              src={h.thumbnail}
                              alt={h.title || ''}
                              fill
                              className="object-cover group-hover:scale-105 transition-transform duration-300"
                              sizes="56px"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <BookOpen className="w-5 h-5 text-muted" />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 py-0.5">
                        <h3 className="text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug mb-0.5">
                          {h.title}
                        </h3>
                        <p className="text-xs text-muted mb-1">
                          {h.author}{h.year ? `, ${h.year}` : ''}
                          {h.is_first_translation && (
                            <span className="ml-1.5 text-[9px] font-medium bg-accent-rust/10 text-accent-rust px-1 py-0.5 rounded">
                              {firstTranslationBadge(h.ft_disposition, h.language, !isTranslationReadable(h), h.ft_claim)}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-secondary leading-relaxed line-clamp-2">
                          {h.note}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Tier 3: Also Notable */}
            {tier3.length > 0 && (
              <div className="mb-10">
                <h2 className="text-lg sm:text-xl text-primary mb-4 font-display">
                  Also Notable
                </h2>
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                  {tier3.map((h: CuratedHighlight) => (
                    <Link
                      key={h.book_id}
                      href={tenantBookUrl({ id: h.id, slug: h.slug }, tenantSlug)}
                      className="group flex items-center gap-3 p-2.5 rounded-lg bg-white border border-border-light hover:border-accent-rust/30 hover:shadow-sm transition-all"
                    >
                      <div className="w-10 flex-shrink-0">
                        <div className="aspect-[3/4] relative rounded overflow-hidden bg-warm">
                          {h.thumbnail ? (
                            <Image
                              src={h.thumbnail}
                              alt={h.title || ''}
                              fill
                              className="object-cover"
                              sizes="40px"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <BookOpen className="w-3.5 h-3.5 text-muted" />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-primary group-hover:text-accent-rust transition-colors truncate">
                          {h.title}
                        </h4>
                        <p className="text-xs text-muted truncate">
                          {h.author}{h.year ? `, ${h.year}` : ''}
                          {h.is_first_translation && (
                            <span className="ml-1.5 text-[9px] font-medium bg-accent-rust/10 text-accent-rust px-1 py-0.5 rounded">
                              {firstTranslationBadge(h.ft_disposition, h.language, !isTranslationReadable(h), h.ft_claim)}
                            </span>
                          )}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Index Librorum Prohibitorum catalogue browser — self-gates (renders
            only for collections that have index_catalogs editions). */}
        <React.Suspense fallback={null}>
          <IndexCatalogBrowser collectionSlug={id} />
        </React.Suspense>

        {/* All Books — client component handles compact → expanded transition */}
        <CollectionAllBooks
          collectionId={id}
          compactBooks={isArtCollection ? books : books.filter(b => !b.resource_type)}
          total={total}
          languages={languages}
          collectionType={collection.collection_type}
          provider={provider}
        />
      </div>
      <SignUpCTA />
    </div>
  );
}
