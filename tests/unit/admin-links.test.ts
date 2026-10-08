import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { ADMIN_SECTIONS, UNLISTED_ADMIN_PAGES, adminMenuLinks, adminSectionsFor } from '@/lib/admin-links';

/** The page file a link opens, under src/app (route groups like (protected) are not in the URL). */
function pageExists(href: string): boolean {
  const seg = href.replace(/^\//, '');
  return [
    join('src/app', seg, 'page.tsx'),
    join('src/app/platform/(protected)', seg.replace(/^platform\//, ''), 'page.tsx'),
  ].some((p) => existsSync(p));
}

describe('admin links', () => {
  const all = ADMIN_SECTIONS.flatMap((s) => s.links);

  it('every link opens a page that exists, and none is listed twice', () => {
    expect(all.filter((l) => !pageExists(l.href)).map((l) => l.href)).toEqual([]);
    expect(new Set(all.map((l) => l.href)).size).toBe(all.length);
  });

  it('every /admin page is linked or listed as unlisted with its reason', () => {
    const listed = new Set(all.map((l) => l.href));
    const pages = readdirSync('src/app/admin', { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join('src/app/admin', d.name, 'page.tsx')))
      .map((d) => `/admin/${d.name}`);
    expect(pages.filter((p) => !listed.has(p) && !UNLISTED_ADMIN_PAGES[p])).toEqual([]);
    // An unlisted entry for a page that is gone, or that is also linked, is stale.
    expect(Object.keys(UNLISTED_ADMIN_PAGES).filter((p) => !pages.includes(p) || listed.has(p))).toEqual([]);
  });

  it('the account menu shows the same pages to a superadmin as the bar marks for it, Decisions first', () => {
    const menu = adminMenuLinks({ role: 'superadmin' }).map((l) => l.label);
    expect(menu[0]).toBe('Decisions');
    expect(menu).toEqual(expect.arrayContaining(['Dashboard', 'Work in flight', 'Spend', 'API keys', 'Introductions', 'Feedback', 'Analytics']));
  });

  it('an admin who is not a superadmin sees no superadmin pages; spend follows the server answer in the bar', () => {
    const labels = (canSeeSpend?: boolean) => adminSectionsFor({ role: 'admin', canSeeSpend }).flatMap((s) => s.links.map((l) => l.label));
    expect(labels()).not.toContain('Decisions');
    expect(labels()).not.toContain('Metrics');
    expect(labels()).not.toContain('Spend');
    expect(labels(true)).toContain('Spend');
    expect(adminSectionsFor({ role: 'superadmin', canSeeSpend: false }).flatMap((s) => s.links.map((l) => l.label))).not.toContain('Spend');
  });

  it('a reader sees nothing', () => {
    expect(adminSectionsFor({ role: undefined })).toEqual([]);
    expect(adminMenuLinks({ role: 'editor' })).toEqual([]);
  });
});
