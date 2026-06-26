import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// /book/<slug>/page/<number> (a page NUMBER where the reader expects a page ID)
// must be resolved at the proxy level to the real page id. The reader route is
// ISR, so its notFound() renders HTTP 200 with a "Page Not Found" body — a
// Next.js soft-404. Google had ~1.2k of these indexed. The proxy rewrites the
// numeric form to the book-page resolver, which 301s to /book/<slug>/page/<id>.
// Real page ids (24-hex, met-*, base64-ish) are never purely 1–6 digit numbers,
// so they fall through to the normal page route untouched.

const PROXY = path.join(path.resolve(__dirname, '../..'), 'src/proxy.ts');

describe('/book/<slug>/page/<number> proxy resolution', () => {
  it('proxy.ts matches a numeric page segment and rewrites to the book-page resolver', () => {
    const src = readFileSync(PROXY, 'utf8');
    const idx = src.search(/\/\^\\\/book\\\/\(\[\^\/\]\+\)\\\/page\\\/\(\[1-9\]\\d\{0,5\}\)\$\//);
    expect(
      idx,
      String.raw`src/proxy.ts must match /^\/book\/([^/]+)\/page\/([1-9]\d{0,5})$/`
    ).toBeGreaterThan(-1);
    expect(
      src.slice(idx, idx + 500),
      'the numeric-page match must rewrite to /api/redirect/book-page with the page header'
    ).toMatch(/\/api\/redirect\/book-page/);
  });
});
