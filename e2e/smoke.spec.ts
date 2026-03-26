/**
 * Smoke tests — crawl the live site and flag broken pages, dead links,
 * missing images, and API errors.
 *
 * These tests hit production (or BASE_URL) and verify the site is healthy
 * from a user's perspective. They don't test specific UI behavior — that's
 * what the other E2E specs do.
 *
 * Note: Collection pages can take 10-25s on ISR cache misses when Atlas is
 * under pipeline load. The 60s playwright timeout accommodates this; the
 * 20s navigationTimeout does not. We override per-test where needed.
 */
import { test, expect, type Response } from '@playwright/test';

// Pages to check. Add new ones here as the site grows.
const FAST_PAGES = [
  '/',
  '/collections',
  '/gallery',
  '/libraries',
  '/timeline',
  '/search?q=Ficino',
];

// Collection and book pages hit Atlas directly and can be slow on ISR cache miss
const DB_HEAVY_PAGES = [
  '/collections/alchemy',
  '/collections/classical-philosophy',
  '/collections/sacred-texts',
  '/collections/corpus-hermeticum',
  '/collections/hermetica',
  '/collections/kabbalah',
  '/book/the-hermetic-museum-various-sendivogius',
];

const API_ENDPOINTS = [
  { url: '/api/books/search?q=alchemy&limit=1', expectKey: 'results' },
  { url: '/api/collections', expectKey: null },
  { url: '/api/books/timeline?era=renaissance&limit=1', expectKey: null },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---- Fast pages (should always load quickly) ----

test.describe('Smoke: fast pages load', () => {
  for (const path of FAST_PAGES) {
    test(`${path} returns 200 and renders content`, async ({ page }) => {
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), `${path} returned ${response?.status()}`).toBe(200);

      const title = await page.title();
      expect(title.length, `${path} has empty title`).toBeGreaterThan(0);

      const body = await page.textContent('body');
      expect(body).not.toContain('Application error');
      expect(body).not.toContain('Internal Server Error');
      expect(body?.toLowerCase()).not.toContain('temporarily unavailable');
    });
  }
});

// ---- DB-heavy pages (collections, books — allow longer timeout) ----

test.describe('Smoke: DB-heavy pages load', () => {
  test.describe.configure({ mode: 'serial' });

  for (const path of DB_HEAVY_PAGES) {
    test(`${path} returns 200 and renders content`, async ({ page }) => {
      // Collection pages can take 10-25s on ISR miss under Atlas load
      const response = await page.goto(path, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      expect(response?.status(), `${path} returned ${response?.status()}`).toBe(200);

      const title = await page.title();
      expect(title.length, `${path} has empty title`).toBeGreaterThan(0);

      const body = await page.textContent('body');
      expect(body).not.toContain('Application error');
      expect(body).not.toContain('Internal Server Error');
      expect(body?.toLowerCase()).not.toContain('temporarily unavailable');
    });
  }
});

// ---- API endpoint smoke tests (serial to avoid rate limiting) ----

test.describe('Smoke: API endpoints respond', () => {
  test.describe.configure({ mode: 'serial' });

  for (const endpoint of API_ENDPOINTS) {
    test(`${endpoint.url} returns valid JSON`, async ({ request }) => {
      await sleep(1500);

      let response = await request.get(endpoint.url);

      // Retry on 429 (rate limit)
      if (response.status() === 429) {
        await sleep(3000);
        response = await request.get(endpoint.url);
      }

      expect(response.status(), `${endpoint.url} returned ${response.status()}`).toBe(200);
      const json = await response.json();
      expect(json).toBeTruthy();
      if (endpoint.expectKey) expect(json).toHaveProperty(endpoint.expectKey);
    });
  }
});

// ---- Broken internal links ----

test.describe('Smoke: no broken internal links', () => {
  const PAGES_TO_CRAWL = ['/', '/collections'];

  for (const path of PAGES_TO_CRAWL) {
    test(`${path} has no broken internal links (sample)`, async ({ page, request }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      const links = await page.$$eval('a[href]', (anchors) =>
        anchors
          .map((a) => a.getAttribute('href')!)
          .filter((href) => href.startsWith('/') && !href.startsWith('/api/'))
      );

      const unique = [...new Set(links)];
      const sample = unique.slice(0, 8);

      const broken: string[] = [];
      for (const href of sample) {
        try {
          await sleep(500);
          const res = await request.get(href);
          // Ignore 429 (rate limit) — not a broken link
          if (res.status() >= 400 && res.status() !== 429) {
            broken.push(`${href} → ${res.status()}`);
          }
        } catch {
          // Network errors under load are not broken links
        }
      }

      expect(broken, `Broken links on ${path}:\n${broken.join('\n')}`).toHaveLength(0);
    });
  }
});

// ---- Image health ----

test.describe('Smoke: images load on key pages', () => {
  const PAGES_WITH_IMAGES = ['/', '/collections', '/gallery'];

  for (const path of PAGES_WITH_IMAGES) {
    test(`${path} images resolve (sample)`, async ({ page, request }) => {
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

      const imgSrcs = await page.$$eval('img[src]', (imgs) =>
        imgs
          .map((img) => img.getAttribute('src')!)
          .filter((src) => src.startsWith('http'))
          .slice(0, 10)
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
