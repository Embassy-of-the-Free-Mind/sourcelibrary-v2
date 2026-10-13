/**
 * HideOnTenantHost (#4330): hides an entry point to the Librarian on a partner
 * subdomain, where the proxy refuses it, and nowhere else.
 *
 * There is no DOM in this suite, so the post-mount switch is pinned through
 * the predicate it calls (`isTenantSubdomain(window.location.host)`), and the
 * server render through react-dom/server. The server render matters on its
 * own: it is what the apex serves, so it must be the children, unchanged.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import HideOnTenantHost from '@/components/tenant/HideOnTenantHost';
import { isTenantSubdomain } from '@/hooks/useEmbedContext';

describe('HideOnTenantHost', () => {
  it('renders its children on the server, unchanged', () => {
    const html = renderToStaticMarkup(
      <HideOnTenantHost>
        <p className="cta">Research a topic with the Librarian</p>
      </HideOnTenantHost>
    );
    expect(html).toBe('<p class="cta">Research a topic with the Librarian</p>');
  });

  it('hides on partner subdomains only', () => {
    for (const host of ['bph.sourcelibrary.org', 'bhutan.sourcelibrary.org', 'efm.sourcelibrary.org']) {
      expect(isTenantSubdomain(host), host).toBe(true);
    }
    for (const host of [
      'sourcelibrary.org',
      'www.sourcelibrary.org',
      'localhost:3000',
      // A preview host is not a subdomain of sourcelibrary.org.
      'sourcelibrary-v2-git-fix-x.vercel.app',
    ]) {
      expect(isTenantSubdomain(host), host).toBe(false);
    }
  });

  it('decides on the host alone, not on iframes, /embed or reading rooms', () => {
    // useIsEmbedded is also true inside an iframe and under /embed and /rooms,
    // which the apex serves and where the Librarian still answers.
    const src = readFileSync(path.resolve(__dirname, '../../src/hooks/useEmbedContext.ts'), 'utf8');
    const hook = src.slice(src.indexOf('export function useIsTenantHost'));
    expect(hook).toContain('isTenantSubdomain(window.location.host)');
    expect(hook).not.toMatch(/window\.top|usePathname|useEmbedContext\(/);
  });
});
