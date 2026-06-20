import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Famous-text slugs that readers type as a book URL but that we hold across
// several editions (e.g. `corpus-hermeticum`, which is also a hidden empty
// stub book squatting the slug → the /book route would render "Book Not
// Found"). The proxy 308s these to a library search so the reader sees every
// edition. Like the author/bare-page blocks, it must live in the proxy and not
// a page component, where a redirect() in the streamed RSC tree commits a 200
// shell first.

const PROXY = path.join(path.resolve(__dirname, '../..'), 'src/proxy.ts');

describe('guessed famous-text book slug → search proxy redirect', () => {
  const src = readFileSync(PROXY, 'utf8');

  it('maps corpus-hermeticum to a corpus hermeticum search', () => {
    expect(
      src,
      "BOOK_SLUG_SEARCH_REDIRECTS must map 'corpus-hermeticum' → 'corpus hermeticum'"
    ).toMatch(/'corpus-hermeticum':\s*'corpus hermeticum'/);
  });

  it('matches single-segment /book/<slug> and 308s to /search', () => {
    const idx = src.search(/\/\^\\\/book\\\/\(\[\^\/\]\+\)\\\/\?\$\//);
    expect(
      idx,
      String.raw`src/proxy.ts must match pathname against /^\/book\/([^/]+)\/?$/`
    ).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 500);
    expect(block, 'the slug match must target /search').toMatch(/url\.pathname\s*=\s*'\/search'/);
    expect(block, 'and issue a 308').toMatch(/NextResponse\.redirect\([^)]*,\s*308\)/);
  });
});
