/**
 * Smoke tests — crawl the live site and flag broken pages, dead links,
 * missing images, and API errors. Runs daily alongside E2E tests.
 *
 * These tests hit production (or BASE_URL) and verify the site is healthy
 * from a user's perspective. They don't test specific UI behavior — that's
 * what the other E2E specs do.
 */
import { test, expect, type Page, type Response } from '@playwright/test';

// Pages to check. Add new ones here as the site grows.
const CRITICAL_PAGES = [
  '/',
  '/collections',
  '/collections/alchemy',
  '/collections/classical-philosophy',
  '/collections/sacred-texts',
  '/gallery',
  '/libraries',
  '/timeline',
  '/search?q=Ficino',
  '/book/the-hermetic-museum-various-sendivogius',
];

const API_ENDPOINTS = [
  { url: '/api/books/search?q=alchemy&limit=1', expectKey: 'results' },
  { url: '/api/collections', expectKey: null },
  { url: '/api/books/timeline?era=renaissance&limit=1', expectKey: null },
];

// ---- Page-level smoke tests ----

test.describe('Smoke: critical pages load', () => {
  for (const path of CRITICAL_PAGES) {
    test(`${path} returns 200 and renders content`, async ({ page }) => {
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), `${path} returned ${response?.status()}`).toBe(200);

      // Page should have a title
      const title = await page.title();
      expect(title.length, `${path} has empty title`).toBeGreaterThan(0);

      // No Next.js error overlay or "not found" states
      const body = await page.textContent('body');
      expect(body).not.toContain('Application error');
      expect(body).not.toContain('Internal Server Error');
      // Don't check for "not found" generically — some pages legitimately contain that text
    });
  }
});

// ---- API endpoint smoke tests ----

test.describe('Smoke: API endpoints respond', () => {
  for (const endpoint of API_ENDPOINTS) {
    test(`${endpoint.url} returns valid JSON`, async ({ request }) => {
      const response = await request.get(endpoint.url);
      expect(response.status(), `${endpoint.url} returned ${response.status()}`).toBe(200);

      const json = await response.json();
      expect(json).toBeTruthy();

      if (endpoint.expectKey) {
        expect(json).toHaveProperty(endpoint.expectKey);
      }
    });
  }
});

// ---- Broken internal links ----

test.describe('Smoke: no broken internal links', () => {
  // Check a sample of pages for dead internal links.
  // We don't crawl the entire site — just the pages most likely to have stale links.
  const PAGES_TO_CRAWL = ['/', '/collections', '/collections/alchemy'];

  for (const path of PAGES_TO_CRAWL) {
    test(`${path} has no broken internal links (sample)`, async ({ page, request }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      // Collect all internal links
      const links = await page.$$eval('a[href]', (anchors) =>
        anchors
          .map((a) => a.getAttribute('href')!)
          .filter((href) => href.startsWith('/') && !href.startsWith('/api/'))
      );

      // Deduplicate and sample — don't check hundreds of book links
      const unique = [...new Set(links)];
      const sample = unique.slice(0, 20);

      const broken: string[] = [];
      for (const href of sample) {
        try {
          const res = await request.get(href);
          if (res.status() >= 400) {
            broken.push(`${href} → ${res.status()}`);
          }
        } catch (err) {
          broken.push(`${href} → network error`);
        }
      }

      expect(broken, `Broken links on ${path}:\n${broken.join('\n')}`).toHaveLength(0);
    });
  }
});

// ---- Image health ----

test.describe('Smoke: images load on key pages', () => {
  // Verify that visible images on key pages actually resolve (not 404/broken).
  const PAGES_WITH_IMAGES = ['/', '/collections', '/gallery'];

  for (const path of PAGES_WITH_IMAGES) {
    test(`${path} images resolve (sample)`, async ({ page, request }) => {
      // Track failed image requests during page load
      const failedImages: string[] = [];

      page.on('response', (response: Response) => {
        const url = response.url();
        const isImage = /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i.test(url) ||
          response.request().resourceType() === 'image';
        if (isImage && response.status() >= 400) {
          failedImages.push(`${url} → ${response.status()}`);
        }
      });

      await page.goto(path, { waitUntil: 'load' });

      // Also check <img> src attributes that might be lazy-loaded
      const imgSrcs = await page.$$eval('img[src]', (imgs) =>
        imgs
          .map((img) => img.getAttribute('src')!)
          .filter((src) => src.startsWith('http'))
          .slice(0, 10) // sample
      );

      for (const src of imgSrcs) {
        try {
          const res = await request.get(src);
          if (res.status() >= 400) {
            failedImages.push(`${src} → ${res.status()}`);
          }
        } catch {
          failedImages.push(`${src} → network error`);
        }
      }

      expect(
        failedImages,
        `Broken images on ${path}:\n${failedImages.join('\n')}`
      ).toHaveLength(0);
    });
  }
});
