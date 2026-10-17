import { describe, it, expect } from 'vitest';
import { GET } from '@/app/robots.txt/route';
import { metadata as authLayoutMetadata } from '@/app/auth/layout';
import { metadata as esSigninMetadata } from '@/app/es/auth/signin/page';

/**
 * #6398: the sign-in screens drew ~200 Google landings/30d. They carry
 * `noindex`, and that only takes effect if Google may fetch them — so the
 * default robots.txt group must NOT disallow /auth/. Pins both halves.
 */
describe('auth pages stay out of search results', () => {
  it('marks /auth/* and /es/auth/signin noindex', () => {
    expect(authLayoutMetadata.robots).toMatchObject({ index: false });
    expect(esSigninMetadata.robots).toMatchObject({ index: false });
  });

  it('lets crawlers fetch /auth/ so they can see the noindex', async () => {
    const text = await (GET() as Response).text();
    const star = text.split(/\n\n/).find((b) => b.startsWith('User-agent: *\n'));
    expect(star).toBeTruthy();
    expect(star).not.toMatch(/^Disallow: \/auth\//m);
  });
});
