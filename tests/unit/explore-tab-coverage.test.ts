import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * ExploreTabBar coverage guard.
 *
 * The explore tools have NO shared layout nav — `src/app/explore/layout.tsx` is
 * a passthrough — so cross-navigation depends entirely on each page remembering
 * to render <ExploreTabBar />. Two ways that silently breaks, both of which had
 * happened by 2026-07-22:
 *
 *   1. A tool exists but is missing from TABS. `/ngrams` shipped with a card on
 *      the /explore hub but no tab, so from /explore/map there was no route to
 *      it at all.
 *   2. A route IS in TABS but never renders the bar. `/explore/timeline` was
 *      listed as a tab and was itself a dead end — no way onward to Map,
 *      Constellation or Ngrams.
 *
 * Landing on any explore tool must let you reach the others.
 */

const REPO = path.resolve(__dirname, '../..');
const TAB_BAR = path.join(REPO, 'src/components/explore/ExploreTabBar.tsx');

/** Route href -> the page file that must render the bar. */
function pageFileFor(href: string): string {
  return path.join(REPO, 'src/app', href.replace(/^\//, ''), 'page.tsx');
}

function tabHrefs(): string[] {
  const src = fs.readFileSync(TAB_BAR, 'utf8');
  const block = src.match(/const TABS = \[([\s\S]*?)\] as const;/);
  expect(block, 'ExploreTabBar must declare `const TABS = [...] as const;`').toBeTruthy();
  return [...block![1].matchAll(/href:\s*'([^']+)'/g)].map(m => m[1]);
}

describe('ExploreTabBar coverage', () => {
  const hrefs = tabHrefs();

  it('lists every explore tool', () => {
    // Ngrams lives outside /explore/* — a tool is not exempt just because its
    // route is top-level. Add new tools here AND to TABS.
    for (const required of ['/explore/map', '/explore/timeline', '/explore/constellation', '/ngrams']) {
      expect(hrefs, `${required} missing from ExploreTabBar`).toContain(required);
    }
  });

  it.each(tabHrefs())('%s exists as a page', href => {
    expect(fs.existsSync(pageFileFor(href)), `${href} has no page.tsx`).toBe(true);
  });

  it.each(tabHrefs())('%s renders ExploreTabBar (no dead ends)', href => {
    const file = pageFileFor(href);
    if (!fs.existsSync(file)) return; // covered by the existence test above
    const src = fs.readFileSync(file, 'utf8');
    expect(
      src.includes('ExploreTabBar'),
      `${href} is a tab but never renders <ExploreTabBar /> — landing there strands the reader`,
    ).toBe(true);
  });
});
