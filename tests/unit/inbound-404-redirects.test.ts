/**
 * Dead inbound links whose target is certain land on it; the rest keep their
 * 404 (#102). Each rule here is pinned on both sides: what it rescues, and what
 * it must leave alone, because a redirect to a guess is worse than a 404.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Db } from 'mongodb';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { compile } from 'next/dist/compiled/path-to-regexp';
import nextConfig from '../../next.config';

// Next's own matcher and compiler, so the rule is tested as it runs.
const getRedirect = async (source: string) => (await nextConfig.redirects!()).find(r => r.source === source);
async function matchRedirect(pathname: string) {
  for (const rule of await nextConfig.redirects!()) {
    if (rule.has || rule.missing) continue;
    const params = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(pathname);
    if (params) return { destination: compile(rule.destination, { validate: false })(params), permanent: rule.permanent };
  }
  return null;
}

vi.mock('@/lib/auth-helpers', () => ({ isInnerCircle: async () => false }));

type Doc = Record<string, unknown>;
let books: Doc[] = [];

vi.mock('@/lib/tenant-catalog-books', () => ({
  findBookForTenant: async (_db: Db, idOrSlug: string) => {
    const book = books.find(d => d.id === idOrSlug || d.slug === idOrSlug);
    return book ? { book, matchedBySlug: book.slug === idOrSlug } : null;
  },
}));

import { findDeletedDuplicateKeeper } from '@/lib/book-access';
import { englishCollectionFallback } from '@/lib/es-collections';
import { trimmedGalleryImageId } from '@/lib/gallery-image-id';
import { parseDeadContentLink, slugBeforePastedText } from '@/lib/not-found-recovery';

describe('/books/<slug> (next.config)', () => {
  it('goes to the same tail under /book', async () => {
    expect(await matchRedirect('/books/bonaventura-centiloquium-1503')).toEqual({
      destination: '/book/bonaventura-centiloquium-1503', permanent: true,
    });
    expect((await matchRedirect('/books/some-slug/read'))?.destination).toBe('/book/some-slug/read');
  });

  it('is path-relative and host-free, so a partner subdomain stays on its host', async () => {
    const rule = await getRedirect('/books/:path+');
    expect(rule?.destination.startsWith('/')).toBe(true);
    expect(rule?.has).toBeUndefined();
  });

  it('leaves bare /books and the real /book alone', async () => {
    expect(await matchRedirect('/books')).toBeNull();
    expect(await matchRedirect('/book/some-slug')).toBeNull();
  });
});

describe('slugBeforePastedText', () => {
  it.each([
    ['ghayat-al-hakim-arabic-ms-al-majriti.', 'ghayat-al-hakim-arabic-ms-al-majriti'],
    ['oedipus-aegyptiacus-tomus-iii-kircher)%EC%9D%98', 'oedipus-aegyptiacus-tomus-iii-kircher'],
    ['69c87ac06c6f3cc53c85874a)', '69c87ac06c6f3cc53c85874a'],
    ['sancai-tuhui-juan-89%29', 'sancai-tuhui-juan-89'],
    ['holy-almodel-of-solomon-latin-ms-18th-c-pseudo-solomon%20deel%206', 'holy-almodel-of-solomon-latin-ms-18th-c-pseudo-solomon'],
    ['drebbel-tractatus-duo-1628-latin-laurembergi=', 'drebbel-tractatus-duo-1628-latin-laurembergi'],
    ['proclus-theologia-platonica-michael-psellos-psellos[reference:5]%E3%80%82', 'proclus-theologia-platonica-michael-psellos-psellos'],
  ])('%s names %s', (segment, front) => {
    expect(slugBeforePastedText(segment)).toBe(front);
  });

  it.each([
    'ghayat-al-hakim-arabic-ms-al-majriti', // clean
    'barb-lat-172-', // cut short: the front may be another book's whole slug
    'xingming-guizhi-principles-of-joint-cultivation-of-',
    'the-she-king-or-the-book-of-ancient-poetry_1876', // a guessed variant, not pasted text
    'Raymond%20Lull\'s%20memory%20training', // a title, not a slug
    'a.', // too short to be a slug
    '%E0%A4%A', // malformed escape
  ])('leaves %s alone', (segment) => {
    expect(slugBeforePastedText(segment)).toBeNull();
  });
});

describe('trimmedGalleryImageId', () => {
  it.each([
    ['6992ce2b3ea667fbac82861e-0[reference:4]', '6992ce2b3ea667fbac82861e-0'],
    ['6992ce2b3ea667fbac82861e-0%5Breference:4%5D', '6992ce2b3ea667fbac82861e-0'],
    ['6a45298cc6d95bc278fbc8c6-0q', '6a45298cc6d95bc278fbc8c6-0'],
    ['6A45298CC6D95BC278FBC8C6:12).', '6a45298cc6d95bc278fbc8c6-12'],
  ])('%s names %s', (id, trimmed) => {
    expect(trimmedGalleryImageId(id)).toBe(trimmed);
  });

  it.each([
    '6992ce2b3ea667fbac82861e-0', // clean
    '6992ce2b3ea667fbac82861e', // no index: which image is not known
    '6950050cf426a210d109ca0-0', // a 23-character id, cut somewhere unknown
    '6953b56577f38f67611bd97eb-0', // 25 characters
    'met-448183',
    'gallery-6992ce2b3ea667fbac82861e-0',
  ])('leaves %s alone', (id) => {
    expect(trimmedGalleryImageId(id)).toBeNull();
  });
});

describe('englishCollectionFallback', () => {
  const dbWith = (docs: Doc[]) => {
    const seen: Doc[] = [];
    return {
      seen,
      collection: () => ({
        findOne: async (q: Doc) => { seen.push(q); return docs.find(d => d.slug === q.slug) ?? null; },
      }),
    };
  };

  it('sends a Spanish address to the English page when the English route serves the slug', async () => {
    const db = dbWith([{ slug: 'school-of-athens' }]);
    expect(await englishCollectionFallback(db, 'school-of-athens')).toBe('/collections/school-of-athens');
    // The English page's own filter, so the target cannot 404 on arrival.
    expect(db.seen[0]).toEqual({ slug: 'school-of-athens', visible: { $ne: false } });
  });

  it('keeps the 404 for a slug no page serves', async () => {
    expect(await englishCollectionFallback(dbWith([]), 'hesychasm')).toBeNull();
  });

  it('never queries or redirects on a string that is not slug-shaped', async () => {
    const db = dbWith([{ slug: 'x' }]);
    expect(await englishCollectionFallback(db, 'x/../admin')).toBeNull();
    expect(await englishCollectionFallback(db, '$ne')).toBeNull();
    expect(db.seen).toHaveLength(0);
  });
});

describe('findDeletedDuplicateKeeper', () => {
  const KEEPER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const TWIN = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const dbWith = (deleted: Doc[]) => ({
    collection: () => ({
      find: (q: { slug?: { $in: string[] }; $or?: [{ slug: { $in: string[] } }, { id: { $in: string[] } }] }) => {
        const slugs = q.$or ? q.$or[0].slug.$in : q.slug!.$in;
        const ids = q.$or ? q.$or[1].id.$in : [];
        const rows = deleted.filter(d => slugs.includes(d.slug as string) || ids.includes(d.id as string));
        return { limit: () => ({ toArray: async () => rows }) };
      },
    }),
  }) as unknown as Db;
  const twin = (reason: string): Doc => ({ id: TWIN, slug: 'art-canal-bridge', deleted_reason: reason });
  const dedup = `artwork dedup (#2209): commons_sha1 byte-identical; keeper ${KEEPER}`;

  it('finds the keeper by the dead slug', async () => {
    books = [{ id: KEEPER, slug: 'canal-bridge', visible: true, content_type: 'artwork', resource_type: 'painting' }];
    expect(await findDeletedDuplicateKeeper(dbWith([twin(dedup)]), ['art-canal-bridge']))
      .toEqual({ slug: 'canal-bridge', artworkSlug: 'canal-bridge' });
  });

  it('finds the keeper by the dead id', async () => {
    books = [{ id: KEEPER, slug: 'kept-book', visible: true }];
    expect(await findDeletedDuplicateKeeper(dbWith([twin(dedup)]), [TWIN]))
      .toEqual({ slug: 'kept-book', artworkSlug: null });
  });

  it.each([
    'copyrighted_ia_lending_library',
    `dedup takedown; keeper ${KEEPER}`,
    'IA access restricted, all images blocked',
  ])('keeps the 404 for a deletion that names no keeper or touches rights: %s', async (reason) => {
    books = [{ id: KEEPER, slug: 'kept-book', visible: true }];
    expect(await findDeletedDuplicateKeeper(dbWith([twin(reason)]), ['art-canal-bridge', TWIN])).toBeNull();
  });

  it('keeps the 404 when the keeper is hidden or gone', async () => {
    books = [{ id: KEEPER, slug: 'kept-book', visible: false }];
    expect(await findDeletedDuplicateKeeper(dbWith([twin(dedup)]), [TWIN])).toBeNull();
    books = [];
    expect(await findDeletedDuplicateKeeper(dbWith([twin(dedup)]), [TWIN])).toBeNull();
  });
});

describe('a dead /work link', () => {
  it('is read as a content link, so the 404 page can prefill its search', () => {
    expect(parseDeadContentLink('/work/ficino-de-vita')).toEqual({ kind: 'work', slug: 'ficino-de-vita' });
    expect(parseDeadContentLink('/es/work/ficino-de-vita/compare')).toEqual({ kind: 'work', slug: 'ficino-de-vita' });
    expect(parseDeadContentLink('/works')).toBeNull();
  });
});
