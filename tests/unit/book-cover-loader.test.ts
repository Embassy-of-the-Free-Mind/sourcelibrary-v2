import { describe, it, expect } from 'vitest';
import { bookCoverResponsiveLoader } from '@/lib/book-cover-loader';

describe('bookCoverResponsiveLoader', () => {
  const display = 'https://images.sourcelibrary.org/pages/book-abc/0001.jpg';
  const thumb = 'https://images.sourcelibrary.org/pages/book-abc/0001-thumb.jpg';
  const full = 'https://images.sourcelibrary.org/pages/book-abc/0001-full.jpg';
  const external = 'https://gallica.bnf.fr/ark/12148/btv1b8442266h/f1.image';

  describe('mobile widths (≤500): swap to thumb', () => {
    it('display → thumb for w=150', () => {
      expect(bookCoverResponsiveLoader({ src: display, width: 150 })).toBe(thumb);
    });

    it('display → thumb for w=400 (mobile 2x DPR 50vw)', () => {
      expect(bookCoverResponsiveLoader({ src: display, width: 400 })).toBe(thumb);
    });

    it('display → thumb for w=500 (boundary)', () => {
      expect(bookCoverResponsiveLoader({ src: display, width: 500 })).toBe(thumb);
    });

    it('-full.jpg also gets normalised to thumb', () => {
      expect(bookCoverResponsiveLoader({ src: full, width: 400 })).toBe(thumb);
    });

    it('already-thumb URL is left alone', () => {
      expect(bookCoverResponsiveLoader({ src: thumb, width: 400 })).toBe(thumb);
    });
  });

  describe('desktop / retina widths (>500): use display', () => {
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
});
