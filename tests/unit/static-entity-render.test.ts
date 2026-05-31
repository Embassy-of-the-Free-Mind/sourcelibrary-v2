import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Render paths for author / artist / encyclopedia entity pages must be a pure
 * static read of the cached `entities` fields. Wikidata enrichment is OFFLINE
 * only (cron + link hook, see src/lib/wikidata-enrichment.ts) — birth/death/
 * portrait are immutable facts and must not be pulled per page view.
 *
 * This guards the decision behind the PR #2187 follow-up: no enrichment import
 * may creep back into a render path.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../..');

const RENDER_FILES = [
  'src/app/author/[name]/page.tsx',
  'src/app/artist/[name]/page.tsx',
  'src/app/encyclopedia/[name]/layout.tsx',
  'src/app/encyclopedia/[name]/page.tsx',
];

describe('entity render paths are static (no Wikidata at render time)', () => {
  it.each(RENDER_FILES)('%s does not import wikidata-enrichment', (rel) => {
    const src = readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');
    expect(
      src,
      `${rel} must not import wikidata-enrichment — entity life dates/portrait ` +
        `are a static DB read; enrich offline via the cron or link hook instead.`,
    ).not.toMatch(/from\s+['"]@\/lib\/wikidata-enrichment['"]/);
  });

  it('the enrichment helper is reached only from offline callers', () => {
    const helper = '@/lib/wikidata-enrichment';
    const offline = [
      'src/app/api/cron/enrich-entities/route.ts',
      'src/lib/author-authority.ts',
    ];
    for (const rel of offline) {
      const src = readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');
      expect(src, `${rel} should import ${helper}`).toMatch(
        /from\s+['"]@\/lib\/wikidata-enrichment['"]/,
      );
    }
  });
});
