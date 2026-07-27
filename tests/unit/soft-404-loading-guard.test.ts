import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

// Unknown detail-page slugs must return a REAL 404 status, not a soft-404
// (HTTP 200 + "Not Found" body). Crawlers index soft-404s as junk/duplicate
// URLs and status-code link checks can't detect breakage (#3232, #3376).
//
// The mechanism that broke it: a `loading.tsx` at (or above) a route wraps its
// page in an automatic <Suspense> boundary, and Next.js flushes the 200 loading
// shell as soon as the page's data fetch suspends — BEFORE the page component's
// notFound() runs. Once the 200 shell is flushed, notFound() can only swap in
// the not-found UI; it can no longer set the status to 404.
//
// The fix keeps each route's existence check in the SHELL (no loading.tsx above
// it) and streams the heavy body via an INNER <Suspense>. Re-adding any of these
// loading.tsx files silently reintroduces the soft-404, so guard their absence.
const repoRoot = path.resolve(__dirname, '..', '..');

const FORBIDDEN_LOADING_FILES = [
  // The book detail page self-streams via an inner <Suspense fallback={BookInfoSkeleton}>.
  // A segment loading.tsx here would flush 200 before BookDetailPage's early
  // existence check. (Reader page/[pageId] and pipeline keep their OWN loading.tsx.)
  'src/app/book/[id]/loading.tsx',
  // Both of these sit ABOVE collections/[id]/page.tsx's shell existence check.
  // The /collections list page self-streams via its own inner <Suspense>, so it
  // does not need a segment loading.tsx either.
  'src/app/collections/loading.tsx',
  'src/app/collections/[id]/loading.tsx',

  // --- #3376: same shape, four more routes ---------------------------------
  // /gallery/loading.tsx sat ABOVE gallery/image/[id]/layout.tsx, whose
  // notFound() gate (#3049) was therefore never able to set a status. The
  // /gallery index self-streams via its own inner <Suspense fallback={<GalleryShell/>}>,
  // so removing the segment file costs it nothing.
  // NOTE: gallery/image/[id]/loading.tsx is deliberately KEPT — it sits *below*
  // that layout, so it cannot flush before the gate runs.
  'src/app/gallery/loading.tsx',
  // Above gallery/collections/[slug]/page.tsx's notFound(); the index is ISR
  // (revalidate = 86400) and prerendered, so it has no runtime skeleton to lose.
  'src/app/gallery/collections/loading.tsx',
  'src/app/gallery/collections/[slug]/loading.tsx',
  // Above artwork/[slug] and artwork/artist/[slug], both of which notFound() in
  // the shell. The /artwork index is `revalidate = false` (fully static).
  'src/app/artwork/loading.tsx',
  'src/app/artwork/[slug]/loading.tsx',
  'src/app/artwork/artist/[slug]/loading.tsx',
  // /author/[name] resolves through the author thesaurus (variant slugs 301 to
  // the canonical one) before its notFound(); that logic must stay in the page,
  // so the segment simply cannot carry a loading.tsx.
  'src/app/author/[name]/loading.tsx',
];

describe('soft-404 guard: no loading.tsx above a route existence check (#3232, #3376)', () => {
  for (const rel of FORBIDDEN_LOADING_FILES) {
    it(`does not reintroduce ${rel}`, () => {
      expect(existsSync(path.join(repoRoot, rel))).toBe(false);
    });
  }
});

// The reader takes the OTHER solution to the same problem, and needs its own
// guard because "the loading.tsx is absent" cannot express it.
//
// `/book/[id]/page/[pageId]` is the one route where the skeleton genuinely
// earns its keep — it shows on every page turn — so deleting its loading.tsx
// would trade a status code for a visible regression. Instead the existence
// check moved UP into the segment's layout.tsx, which renders above the
// automatic <Suspense> that loading.tsx creates. Keep both halves: the layout
// gate is what sets the status, the loading.tsx is what the reader sees.
describe('soft-404 guard: the reader gates in its layout, above the boundary (#3376)', () => {
  const readerDir = 'src/app/book/[id]/page/[pageId]';
  const layout = readFileSync(path.join(repoRoot, readerDir, 'layout.tsx'), 'utf8');

  it('keeps its loading.tsx — the skeleton is load-bearing on page turns', () => {
    expect(existsSync(path.join(repoRoot, readerDir, 'loading.tsx'))).toBe(true);
  });

  it('calls notFound() from the layout shell, not only from page.tsx', () => {
    expect(layout).toMatch(/from ['"]next\/navigation['"]/);
    expect(layout).toMatch(/if \(!book \|\| !page\) notFound\(\);/);
  });

  it('dedupes the lookup so the gate costs no extra query', () => {
    // generateMetadata and the layout shell both read it.
    expect(layout).toMatch(/const getPageData = cache\(/);
  });

  it('does not gate on visibility — that would 404 the editor preview route', () => {
    // page/[pageId]/preview renders hidden books for editors through this same
    // layout (allowHidden). The hidden-book 404 belongs in page.tsx alone.
    expect(layout).not.toMatch(/isHiddenBook/);
  });
});
