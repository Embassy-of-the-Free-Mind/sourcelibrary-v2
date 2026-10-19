import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { FEED_LINKS } from '@/lib/feed-links';

// Feed autodiscovery <link>s must reach every page (#3968).
//
// Next.js replaces `metadata.alternates` wholesale when a route declares its
// own, so feeds declared as `alternates.types` in the root layout were dropped
// on every route that set a canonical URL — 214 files, the homepage included.
// They now render as plain <link> elements in the root layout's <head>, which
// that merge cannot touch. Two ways to undo it silently, both guarded here:
// moving them back into metadata, or re-declaring them on a route (the page
// would then advertise each feed twice).
const repoRoot = path.resolve(__dirname, '..', '..');

describe('feed autodiscovery links', () => {
  const layout = readFileSync(path.join(repoRoot, 'src/app/layout.tsx'), 'utf8');

  it('are rendered by the root layout <head>, from FEED_LINKS', () => {
    const head = layout.slice(layout.indexOf('<head>'), layout.indexOf('</head>'));
    expect(head).toMatch(/FEED_LINKS\.map\(/);
    expect(head).toMatch(/rel="alternate"/);
  });

  it('list absolute apex URLs, each with a title', () => {
    expect(FEED_LINKS.length).toBeGreaterThan(0);
    for (const feed of FEED_LINKS) {
      expect(feed.href).toMatch(/^https:\/\/sourcelibrary\.org\/api\/feed\//);
      expect(feed.title).not.toBe('');
    }
  });

  it('are not declared through any route metadata', () => {
    const files = execFileSync('git', ['ls-files', 'src/app'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.tsx?$/.test(f) && !f.startsWith('src/app/api/'));
    const offenders = files.filter((f) =>
      /application\/(atom|rss)\+xml/.test(readFileSync(path.join(repoRoot, f), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
