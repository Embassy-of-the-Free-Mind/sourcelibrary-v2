import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Bare /book/<id>/page (page number missing) must 308 to /book/<id> at the
// proxy level. It cannot live in a page component: a redirect() inside the
// streamed /book RSC tree commits a 200 shell before the redirect resolves
// (the same gotcha documented on the proxy's author-canonical block), so
// crawlers would index the junk URL. Evidence the links are real traffic:
// ~230 hits/week in not_found_reports.

const PROXY = path.join(path.resolve(__dirname, '../..'), 'src/proxy.ts');

describe('bare /book/<id>/page proxy redirect', () => {
  it('proxy.ts matches the bare /page segment and issues a 308', () => {
    const src = readFileSync(PROXY, 'utf8');
    const idx = src.search(/\/\^\\\/book\\\/\(\[\^\/\]\+\)\\\/page\\\/\?\$\//);
    expect(
      idx,
      String.raw`src/proxy.ts must match pathname against /^\/book\/([^/]+)\/page\/?$/`
    ).toBeGreaterThan(-1);
    expect(
      src.slice(idx, idx + 400),
      'the bare-page match must redirect with a 308'
    ).toMatch(/NextResponse\.redirect\([^)]*,\s*308\)/);
  });

  it('the redirect is not implemented as a page component', () => {
    const pageDir = path.join(
      path.resolve(__dirname, '../..'),
      'src/app/book/[id]/page'
    );
    // Only the [pageId] dynamic segment may live here — a page.tsx would
    // reintroduce the streamed-200 variant of the redirect.
    const entries = require('fs').readdirSync(pageDir);
    expect(entries).toEqual(['[pageId]']);
  });
});
