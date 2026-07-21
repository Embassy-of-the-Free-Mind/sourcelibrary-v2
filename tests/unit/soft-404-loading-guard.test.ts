import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';

// Unknown /book/<slug> and /collections/<slug> must return a REAL 404 status,
// not a soft-404 (HTTP 200 + "Not Found" body). Crawlers index soft-404s as
// junk/duplicate URLs and status-code link checks can't detect breakage (#3232).
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
];

describe('soft-404 guard: no loading.tsx above the book/collection existence checks (#3232)', () => {
  for (const rel of FORBIDDEN_LOADING_FILES) {
    it(`does not reintroduce ${rel}`, () => {
      expect(existsSync(path.join(repoRoot, rel))).toBe(false);
    });
  }
});
