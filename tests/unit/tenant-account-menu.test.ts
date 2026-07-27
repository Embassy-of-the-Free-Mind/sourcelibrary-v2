import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// A signed-in reader on a partner subdomain must always have a way to reach
// their account and sign out (#2150).
//
// The failure this pins is structural, not visual, which is why it went
// unnoticed for two months: on a tenant host the global routes render with
// `ConditionalSiteHeader` removing the SiteHeader post-hydration, and
// `EmbedUserMenu` — the "only sign-out affordance" on embed surfaces — was
// mounted solely by `src/app/embed/layout.tsx`, which those routes never hit.
// The result was a page with zero auth affordances, verified live against the
// hydrated DOM of bph.sourcelibrary.org/book/… on 2026-07-27.
//
// Each assertion below is one link in the chain that keeps that from
// reoccurring. Removing any single one restores the bug silently.
const repoRoot = path.resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

describe('tenant subdomain account menu (#2150)', () => {
  const layout = read('src/app/layout.tsx');
  const menu = read('src/components/embed/TenantAccountMenu.tsx');
  const embedMenu = read('src/components/embed/EmbedUserMenu.tsx');

  it('is mounted from the ROOT layout, not only from embed/layout.tsx', () => {
    // embed/layout.tsx does not run on a tenant subdomain's global routes.
    expect(layout).toMatch(/import TenantAccountMenu from/);
    expect(layout).toMatch(/<TenantAccountMenu\s*\/>/);
  });

  it('is mounted inside <Providers> so the session is available', () => {
    const open = layout.indexOf('<Providers>');
    const close = layout.indexOf('</Providers>');
    const mount = layout.indexOf('<TenantAccountMenu />');
    expect(open).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(open);
    expect(mount).toBeLessThan(close);
  });

  it('keeps the root layout free of headers() — ISR on the book page depends on it', () => {
    // Detecting the tenant host server-side here would force dynamic rendering
    // and blank the ISR cache the book page relies on (revalidate = 86400).
    expect(layout).not.toMatch(/from ['"]next\/headers['"]/);
    expect(menu).toMatch(/useEmbedContext/);
  });

  it('does not double-mount on /embed/* routes', () => {
    // embed/layout.tsx renders the full menu there; a second floating control
    // would stack in the same corner.
    expect(menu).toMatch(/pathname\?\.startsWith\('\/embed\/'\)/);
  });

  it('renders nothing for anonymous visitors in account-only mode', () => {
    // A partner reading room stays a sign-in-free surface: this fix must not
    // add a floating control to pages anonymous readers see.
    expect(embedMenu).toMatch(/if \(accountOnly && !session\) return null;/);
  });

  it('keeps the view-options toggles out of account-only mode', () => {
    // Re-enabling those on tenant pages is a product decision (2026-05-28:
    // BPH is deliberately "hidden, no toggle"), not part of the bug fix.
    expect(embedMenu).toMatch(/\{!accountOnly && \(/);
    expect(menu).toMatch(/variant="account-only"/);
  });

  it('still offers Account and Sign out to signed-in users', () => {
    expect(embedMenu).toMatch(/Sign out/);
    expect(embedMenu).toMatch(/navigateToAccount/);
  });
});
