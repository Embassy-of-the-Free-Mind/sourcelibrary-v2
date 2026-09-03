import { describe, it, expect } from 'vitest';
import { bookCoverResponsiveLoader } from '@/lib/book-cover-loader';

describe('bookCoverResponsiveLoader', () => {
  const display = 'https://images.sourcelibrary.org/pages/book-abc/0001.jpg';
  const thumb = 'https://images.sourcelibrary.org/pages/book-abc/0001-thumb.jpg';
  const full = 'https://images.sourcelibrary.org/pages/book-abc/0001-full.jpg';
  const external = 'https://gallica.bnf.fr/ark/12148/btv1b8442266h/f1.image';

  // The `-thumb.jpg` variant is 150px wide. Swapping it into a 400-500px
  // slot upscaled it ~3x and covers rendered visibly soft (de Bary 1864 on
  // /collections/slime-moulds, 2026-08-24), so the swap now stops at 200px.
  // Card slots are served by the `-card.avif` variant and never reach this.
  describe('small widths (≤200): swap to thumb', () => {
    it('display → thumb for w=150', () => {
      expect(bookCoverResponsiveLoader({ src: display, width: 150 })).toBe(thumb);
    });

    it('display → thumb for w=200 (boundary)', () => {
      expect(bookCoverResponsiveLoader({ src: display, width: 200 })).toBe(thumb);
    });

    it('-full.jpg also gets normalised to thumb', () => {
      expect(bookCoverResponsiveLoader({ src: full, width: 150 })).toBe(thumb);
    });

    it('already-thumb URL is left alone', () => {
      expect(bookCoverResponsiveLoader({ src: thumb, width: 150 })).toBe(thumb);
    });
  });

  describe('mid and large widths (>200): use display, never the 150px thumb', () => {
    it('display stays display at w=400 (the thumb would upscale 2.7x)', () => {
      expect(bookCoverResponsiveLoader({ src: display, width: 400 })).toBe(display);
    });

    it('display stays display at w=500', () => {
      expect(bookCoverResponsiveLoader({ src: display, width: 500 })).toBe(display);
    });

    it('-full.jpg is left alone at w=400', () => {
      expect(bookCoverResponsiveLoader({ src: full, width: 400 })).toBe(full);
    });

    it('display stays display at w=640', () => {
      expect(bookCoverResponsiveLoader({ src: display, width: 640 })).toBe(display);
    });

    it('display stays display at w=1200', () => {
      expect(bookCoverResponsiveLoader({ src: display, width: 1200 })).toBe(display);
    });

    it('display stays display at w=1920', () => {
      expect(bookCoverResponsiveLoader({ src: display, width: 1920 })).toBe(display);
    });
  });

  describe('non-sourcelibrary URLs: pass through unchanged', () => {
    it('external IIIF URL untouched at small width', () => {
      expect(bookCoverResponsiveLoader({ src: external, width: 150 })).toBe(external);
    });

    it('external IIIF URL untouched at large width', () => {
      expect(bookCoverResponsiveLoader({ src: external, width: 1200 })).toBe(external);
    });
  });

  // Single-variant R2 paths have ONLY the bare `.jpg` — rewriting them to
  // `-thumb.jpg` 404s the small-viewport candidate (homepage broken cover,
  // 2026-07-08). They must pass through unchanged even at mobile widths.
  describe('single-variant paths (no -thumb sibling): pass through unchanged', () => {
    // PDF-import blob path — note it CONTAINS `/pages/` but is NOT the
    // canonical `.../pages/{id}/...` scan path, so must not be swapped.
    const pdfBlob = 'https://images.sourcelibrary.org/books/69c1bdc0b82ba5d5bed96a69/pages/0000.jpg';
    const archivedRaw = 'https://images.sourcelibrary.org/archived/6992c88d4f3a879124230200/346.jpg';

    it('PDF-import /books/{id}/pages/ blob untouched at w=150', () => {
      expect(bookCoverResponsiveLoader({ src: pdfBlob, width: 150 })).toBe(pdfBlob);
    });

    it('PDF-import blob untouched at w=400', () => {
      expect(bookCoverResponsiveLoader({ src: pdfBlob, width: 400 })).toBe(pdfBlob);
    });

    it('raw /archived/ upload untouched at w=150', () => {
      expect(bookCoverResponsiveLoader({ src: archivedRaw, width: 150 })).toBe(archivedRaw);
    });
  });
});
