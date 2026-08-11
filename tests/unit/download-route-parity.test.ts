import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { pageExportImageUrl, hasExportImage } from '@/lib/export-page-images';
import type { Page } from '@/lib/types';

const ROUTES = [
  'src/app/api/books/[id]/download/route.ts',
  'src/app/api/[tenant]/books/[id]/download/route.ts',
];

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');

/**
 * #3909. The two download routes are near-twins that are NOT parity-tested, and
 * they drifted: fixes landed on the global route and were ported to the tenant
 * one only at the call site that motivated them. Three of four tenant image
 * formats sat on the legacy path for months.
 *
 * Every failure in that set was SILENT — a wrong image is still a valid JPEG, a
 * serial fetch is just slow until Cloudflare cuts it, and a missing book index
 * looks exactly like a book that has none. So these guards pin the properties
 * whose violation produces no error, not the ones a test would catch anyway.
 */
describe('download routes: shared export machinery', () => {
  for (const rel of ROUTES) {
    const src = read(rel);

    it(`${rel} resolves export images through the canonical resolver`, () => {
      // The #3909 bug shape: reading the raw fields at a call site. `photo` is
      // the SOURCE-provider URL and on split-from-spread pages it is the
      // uncropped spread — a different picture than the reader sees.
      expect(src).not.toMatch(/p\.photo\s*\|\|\s*p\.compressed_photo/);
      expect(src).not.toMatch(/page\.compressed_photo\s*\|\|\s*page\.photo/);
      expect(src).toContain("from '@/lib/export-page-images'");
    });

    it(`${rel} does not define the image helpers locally`, () => {
      expect(src).not.toMatch(/function\s+pageExportImageUrl\s*\(/);
      expect(src).not.toMatch(/function\s+fetchPageImagesOrdered\s*\(/);
      expect(src).not.toMatch(/function\s+fetchAndCompressImage\s*\(/);
    });

    it(`${rel} gives image-heavy formats room beyond the default window`, () => {
      // Image formats fetch + recompress one image per page. The tenant route
      // ran on the default window until #3909.
      expect(src).toMatch(/export const maxDuration = 300;/);
    });

    it(`${rel} streams the images zip rather than buffering it`, () => {
      // A buffered zip emits zero bytes for the whole build; big books crossed
      // Cloudflare's ~100s origin window and died as a 524 that readers saved
      // as a corrupt .zip.
      expect(src).toContain('generateImagesZipStream');
      expect(src).not.toMatch(/await\s+generateImagesZip\s*\(/);
    });

    it(`${rel} labels a truncated facsimile as partial`, () => {
      // "No silent caps": a bounded export must say what was dropped, in the
      // artifact itself. The truncation notice lives in the SHARED facsimile
      // generator (src/lib/pdf-export.ts) — the route must build its PDFs
      // through it, not re-implement one beside the call site (the same rule
      // as the image helpers above).
      expect(src).toContain('generatePdfFacsimileStream');
      expect(src).not.toMatch(/function\s+generatePdfFacsimileStream\s*\(/);
      const pdfLib = read('src/lib/pdf-export.ts');
      expect(pdfLib).toContain('partial facsimile edition');
      expect(pdfLib).toContain('This edition is incomplete');
    });

    it(`${rel} does not filter book_indexes by a field it does not have`, () => {
      // Measured 2026-08-11: 0 of 18,273 book_indexes documents carry tenantId,
      // so this filter matched nothing and the scholarly EPUB silently shipped
      // with no index on every tenant subdomain.
      expect(src).not.toMatch(/book_id:[^)]*tenantId[^)]*\}\s*,?\s*\n?\s*\{\s*projection/);
      expect(src).not.toMatch(/collection\('book_indexes'\)/);
    });
  }
});

describe('pageExportImageUrl', () => {
  const page = (fields: Partial<Page>) => fields as Page;

  it('prefers the R2 display variant over the source-provider photo', () => {
    const url = pageExportImageUrl(page({
      display_photo: 'https://cdn.example.org/r2/display.jpg',
      photo: 'https://archive.org/download/foo/page.jp2',
    }));
    expect(url).toBe('https://cdn.example.org/r2/display.jpg');
  });

  it('falls back to the legacy fields when nothing resolves', () => {
    const url = pageExportImageUrl(page({ compressed_photo: 'https://cdn.example.org/small.jpg' }));
    expect(url).toBe('https://cdn.example.org/small.jpg');
  });

  it('returns null when a page has no image at all', () => {
    expect(pageExportImageUrl(page({}))).toBeNull();
    expect(hasExportImage(page({}))).toBe(false);
  });

  it('absolutises a site-relative resolver result so an export can fetch it', () => {
    const url = pageExportImageUrl(page({
      photo: 'https://archive.org/download/foo/page.jp2',
      cropped_photo: '/api/image?src=x',
    }));
    if (url?.startsWith('/')) throw new Error('relative URL leaked to the fetcher');
    expect(url === null || /^https?:\/\//.test(url)).toBe(true);
  });
});
