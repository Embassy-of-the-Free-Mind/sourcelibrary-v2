import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PAGE_STATUS,
  compilePagePattern,
  isLivePath,
  pageStatusRobotsDisallow,
  type PageStatusEntry,
} from '@/lib/page-status';
import { pageStatusDecision } from '@/lib/page-status-gate';
import SITE_FEATURES from '@/lib/site-features.json';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const SAMPLE: Record<string, PageStatusEntry> = {
  '/roadmap': { state: 'archived', since: '2026-10-18', note: 'Blank.', sendTo: '/about' },
  '/processing': { state: 'internal', since: '2026-10-18', note: 'Pipeline dashboard.' },
  '/ficino-society/:path*': { state: 'draft', since: '2026-10-18', note: 'Not launched.' },
  '/book/:id/page/:pageId/v2a': { state: 'archived', since: '2026-10-18', note: 'Old reader.', sendTo: '/search' },
};

describe('page-status patterns', () => {
  it('matches exact paths, with or without a trailing slash', () => {
    expect(compilePagePattern('/roadmap').test('/roadmap')).toBe(true);
    expect(compilePagePattern('/roadmap').test('/roadmap/')).toBe(true);
    expect(compilePagePattern('/roadmap').test('/roadmap/x')).toBe(false);
    expect(compilePagePattern('/roadmap').test('/roadmaps')).toBe(false);
  });

  it(':name matches exactly one segment', () => {
    const re = compilePagePattern('/book/:id/page/:pageId/v2a');
    expect(re.test('/book/abc/page/12/v2a')).toBe(true);
    expect(re.test('/book/abc/page/12')).toBe(false);
    expect(re.test('/book/abc/page/12/v2c')).toBe(false);
  });

  it(':name* matches the page itself and everything under it', () => {
    const re = compilePagePattern('/ficino-society/:path*');
    expect(re.test('/ficino-society')).toBe(true);
    expect(re.test('/ficino-society/discussions/42')).toBe(true);
    expect(re.test('/ficino-societyx')).toBe(false);
  });

  it('treats regex characters in a path literally', () => {
    expect(compilePagePattern('/a.b').test('/axb')).toBe(false);
  });
});

describe('pageStatusDecision', () => {
  const out = { signedIn: false };
  const reader = { signedIn: true, role: 'reader' };
  const admin = { signedIn: true, role: 'superadmin' };

  it('lets everyone through a live page', () => {
    expect(pageStatusDecision('/about', out, SAMPLE)).toEqual({ action: 'pass' });
  });

  it('sends everyone but an admin from an archived page to its successor', () => {
    expect(pageStatusDecision('/roadmap', out, SAMPLE)).toEqual({ action: 'send-to', path: '/about' });
    expect(pageStatusDecision('/roadmap', reader, SAMPLE)).toEqual({ action: 'send-to', path: '/about' });
    expect(pageStatusDecision('/roadmap', admin, SAMPLE)).toEqual({ action: 'pass' });
  });

  it('sends a signed-out visitor to sign-in and back, and a reader to /unauthorized', () => {
    expect(pageStatusDecision('/processing', out, SAMPLE)).toEqual({
      action: 'sign-in',
      path: '/auth/signin?callbackUrl=%2Fprocessing',
    });
    expect(pageStatusDecision('/ficino-society/members', reader, SAMPLE)).toEqual({
      action: 'unauthorized',
      path: '/unauthorized',
    });
    expect(pageStatusDecision('/processing', admin, SAMPLE)).toEqual({ action: 'pass' });
  });

  it('admits only admin roles; editors and tenant roles do not count', () => {
    expect(pageStatusDecision('/processing', { signedIn: true, role: 'admin' }, SAMPLE).action).toBe('pass');
    expect(pageStatusDecision('/processing', { signedIn: true, role: 'editor' }, SAMPLE).action).toBe('unauthorized');
    expect(pageStatusDecision('/processing', { signedIn: true }, SAMPLE).action).toBe('unauthorized');
  });

  it('only ever returns a path on the same host', () => {
    for (const p of ['/roadmap', '/processing', '/ficino-society', '/book/x/page/1/v2a']) {
      for (const s of [out, reader]) {
        const d = pageStatusDecision(p, s, SAMPLE);
        if (d.action !== 'pass') expect(d.path.startsWith('/') && !d.path.startsWith('//')).toBe(true);
      }
    }
  });
});

describe('pageStatusRobotsDisallow', () => {
  it('lists internal and draft pages in robots syntax and leaves archived pages crawlable', () => {
    expect(pageStatusRobotsDisallow(SAMPLE)).toEqual(['/processing', '/ficino-society/']);
  });
});

describe('the real PAGE_STATUS list', () => {
  const entries = Object.entries(PAGE_STATUS);

  it('has well-formed entries', () => {
    for (const [pattern, e] of entries) {
      expect(pattern, pattern).toMatch(/^\/[^?#\s]*$/);
      expect(['internal', 'draft', 'archived'], pattern).toContain(e.state);
      expect(e.since, pattern).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.note.trim().length, pattern).toBeGreaterThan(0);
    }
  });

  it('gives every archived page a live successor on this site', () => {
    for (const [pattern, e] of entries.filter(([, e]) => e.state === 'archived')) {
      expect(e.sendTo, `${pattern} needs sendTo`).toMatch(/^\/(?!\/)/);
      expect(isLivePath(e.sendTo!.split('?')[0]), `${pattern} → ${e.sendTo} is not live`).toBe(true);
    }
  });

  it('keeps listed pages out of the sitemap static list', () => {
    const src = read('src/app/sitemap.ts');
    const urls = [...src.matchAll(/`\$\{BASE_URL\}(\/[^`$]*)`/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(10);
    expect(urls.filter((u) => !isLivePath(u))).toEqual([]);
  });

  it('keeps listed pages out of the header, footer and user menus', () => {
    const files = [
      'src/components/layout/SiteHeader.tsx',
      'src/components/layout/SiteMenuPanel.tsx',
      'src/components/layout/GlobalFooter.tsx',
      'src/lib/footer-nav.ts',
      'src/components/layout/SectionsNav.tsx',
      'src/components/layout/UserMenu.tsx',
    ];
    const links: string[] = [];
    for (const f of files) {
      for (const m of read(f).matchAll(/['"`](\/[a-z0-9][a-z0-9/_-]*)['"`?#]/gi)) links.push(`${f}: ${m[1]}`);
    }
    // The scan must actually see the menus, or an empty result proves nothing.
    expect(links.length).toBeGreaterThan(20);
    expect(links.filter((l) => !isLivePath(l.split(': ')[1]))).toEqual([]);
  });

  it('keeps listed pages out of site search (site-features.json)', () => {
    const hidden = (SITE_FEATURES as { href: string }[]).map((f) => f.href).filter((h) => !isLivePath(h.split(/[?#]/)[0]));
    expect(hidden).toEqual([]);
  });
});
