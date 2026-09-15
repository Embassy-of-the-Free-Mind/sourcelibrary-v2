import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// A visibility flip that does not evict the cache is only half a flip (#4843).
//
// While a book is hidden, the reader's per-page route answers 404 — and that
// 404 is raised in the route-group LAYOUT
// (src/app/book/[id]/page/[pageId]/(reader)/layout.tsx), because that is the
// only place above `loading.tsx` where a real status can still be set. A
// layout-level cache entry is NOT cleared by revalidating the same path as a
// 'page', nor by layout-revalidating the parent `/book/<slug>`: measured
// 2026-09-15, 9 of 81 links into 16 freshly published books still served a
// cached 404 (x-vercel-cache HIT) after revalidate-book plus a Cloudflare
// purge, while the origin returned 200 to a cache-busted request.
//
// The call that clears them is the route PATTERN with type 'layout'. Removing
// it silently restores a 24h window in which a published book reads as missing
// on every URL anyone had touched while it was hidden.
const repoRoot = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

describe('visibility flip evicts the reader page cache', () => {
  const route = read('src/app/api/books/[id]/visibility/route.ts');

  it('revalidates the reader route pattern as a layout', () => {
    expect(route).toContain("revalidatePath('/book/[id]/page/[pageId]', 'layout')");
  });

  it('revalidates the book paths as both page and layout', () => {
    expect(route).toMatch(/revalidatePath\(p\);/);
    expect(route).toMatch(/revalidatePath\(p, 'layout'\);/);
  });

  it('the hidden-book 404 still lives in the reader layout (the reason the pattern call is needed)', () => {
    const layout = read('src/app/book/[id]/page/[pageId]/(reader)/layout.tsx');
    expect(layout).toContain('isHiddenBook');
    expect(layout).toContain('notFound()');
  });
});

describe('admin revalidate accepts a type', () => {
  const route = read('src/app/api/admin/revalidate/route.ts');

  it('passes page/layout through to revalidatePath', () => {
    // Without a type, a route pattern is a no-op and a layout-cached response
    // is left served — both are unreachable through this endpoint otherwise.
    expect(route).toMatch(/body\.type === 'layout'/);
    expect(route).toMatch(/revalidatePath\(path, type\)/);
  });
});
