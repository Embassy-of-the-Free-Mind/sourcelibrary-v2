// Cross-section de-duplication for the homepage.
//
// PRIOR ART: src/lib/home-data.ts workKey() — collapses multi-volume sets
// WITHIN one slider; nothing compared sections with each other. #5689 collapses
// duplicate scans in collection grids (membership data), not homepage picks.
//
// Every homepage section picks its pictures independently — the curated
// showcase, two book sliders, the featured-collection band and the gallery
// wall — so a popular book could win several of them on the same render
// (2026-10-04: Fludd's History of the Two Worlds was the showcase lead, the
// featured band's background AND the first favorites card). This pass walks the
// sections and lets each BOOK appear once.
//
// Order of claims: the ranked book sliders first, because their cards are not
// substitutable (a slider is "the most liked", not "a liked book"); then the
// image-led sections, which all carry spare candidates and take the next one.
// No section is ever emptied: when every candidate is taken, the section keeps
// its original pick.

/** The book behind an image on our R2 host. Every page-image key carries its
 *  book id as a path segment (src/lib/r2-key.ts) — gallery crops
 *  (`gallery/<book_id>/<page>-<n>…`) and archived page scans
 *  (`archived/<book_id>/<n>.jpg`) alike — so take the first 24-hex segment.
 *  Gallery-only matching missed the archived scans a showcase card can use. */
export function bookIdFromImageUrl(url: string | null | undefined): string | null {
  const m = url?.match(/images\.sourcelibrary\.org\/(?:[^/?#]+\/)*?([0-9a-f]{24})\//i);
  return m ? m[1].toLowerCase() : null;
}

interface BookLike { id?: string }
interface ShowcaseItemLike { slug: string; imageCandidates: string[]; leadImageCandidates: string[] }
interface FeaturedLike { collection: { hero_image: string | null }; books: BookLike[]; heroCandidates?: string[] }
interface PlateLike { src: string; fallback?: string | string[] }

export interface HomeSections<B extends BookLike, L extends BookLike, S extends ShowcaseItemLike, F extends FeaturedLike, P extends PlateLike> {
  recentlyTranslated: B[];
  mostLiked: L[];
  showcaseItems: S[];
  featuredItems: F[];
  galleryPlates: P[];
}

/** Slugs whose showcase card has a hand-picked cover (coverOverride) keep it. */
export function dedupeHomeSections<B extends BookLike, L extends BookLike, S extends ShowcaseItemLike, F extends FeaturedLike, P extends PlateLike>(
  s: HomeSections<B, L, S, F, P>,
  opts: { pinnedShowcaseSlugs?: Set<string>; minFeaturedBooks?: number; minPlates?: number } = {},
): HomeSections<B, L, S, F, P> {
  const claimed = new Set<string>();
  const claim = (id: string | null | undefined) => { if (id) claimed.add(id.toLowerCase()); };
  const isClaimed = (id: string | null | undefined) => !!id && claimed.has(id.toLowerCase());

  // 1. Ranked sliders. A favorite already shown under "Recently translated"
  //    drops out of the favorites row rather than appearing twice.
  for (const b of s.recentlyTranslated) claim(b.id);
  const mostLiked = s.mostLiked.filter((b) => !isClaimed(b.id));
  for (const b of mostLiked) claim(b.id);

  // 2. Showcase cards: move candidates from an already-shown book to the back
  //    of the chain. Reordered, not removed — the chain is also the card's
  //    fallback when an image fails to load.
  const demote = (urls: string[]) => [
    ...urls.filter((u) => !isClaimed(bookIdFromImageUrl(u))),
    ...urls.filter((u) => isClaimed(bookIdFromImageUrl(u))),
  ];
  const showcaseItems = s.showcaseItems.map((item) => {
    const pinned = opts.pinnedShowcaseSlugs?.has(item.slug);
    const next = pinned ? item : { ...item, imageCandidates: demote(item.imageCandidates), leadImageCandidates: demote(item.leadImageCandidates) };
    claim(bookIdFromImageUrl(next.leadImageCandidates[0] ?? next.imageCandidates[0]));
    return next;
  });

  // 3. Featured band: first unclaimed hero, and its book strip without books
  //    already on the page (unless that would leave the strip nearly empty).
  const minFeaturedBooks = opts.minFeaturedBooks ?? 4;
  const featuredItems = s.featuredItems.map((f) => {
    const candidates = f.heroCandidates?.length ? f.heroCandidates : (f.collection.hero_image ? [f.collection.hero_image] : []);
    const hero = candidates.find((u) => !isClaimed(bookIdFromImageUrl(u))) ?? f.collection.hero_image;
    claim(bookIdFromImageUrl(hero));
    const strip = f.books.filter((b) => !isClaimed(b.id));
    const books = strip.length >= minFeaturedBooks ? strip : f.books;
    for (const b of books) claim(b.id);
    return { ...f, collection: { ...f.collection, hero_image: hero }, books };
  });

  // 4. Gallery wall: drop plates from books shown above.
  const minPlates = opts.minPlates ?? 20;
  const plates = s.galleryPlates.filter((p) => !isClaimed(bookIdFromImageUrl(p.src) ?? bookIdFromImageUrl([p.fallback ?? []].flat()[0])));
  const galleryPlates = plates.length >= minPlates ? plates : s.galleryPlates;

  return { recentlyTranslated: s.recentlyTranslated, mostLiked, showcaseItems, featuredItems, galleryPlates };
}
