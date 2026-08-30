/**
 * Aldine type for Source Library.
 *
 * Two faces, both descended from the roman Francesco Griffo cut for Aldus
 * Manutius in Venice (Pietro Bembo, *De Aetna*, 1496):
 *
 * - `aldineAetna` — our own facsimile, traced glyph-by-glyph from the BNCF copy
 *   we hold (book 6a06d1f39a48d51399960d08). It carries only the characters the
 *   1496 text actually uses (see scripts/fonts/aldine-aetna/README.md), so it
 *   must always sit in front of a complete fallback.
 * - `cardo` — David Perry's open-licence revival of the same type (SIL OFL), via
 *   Google Fonts. Complete Latin, Greek and Hebrew; the sensible text face.
 *
 * Both are loaded with next/font, so they cost nothing on pages that don't
 * import them. `aldineStack` is the usual pairing: facsimile first, Cardo for
 * whatever the facsimile lacks (digits, j k v w z, most capitals).
 */
import localFont from 'next/font/local';
import { Cardo } from 'next/font/google';

export const aldineAetna = localFont({
  src: '../../../public/fonts/aldine-aetna/AldineAetna-Regular.woff2',
  variable: '--font-aldine-aetna',
  display: 'swap',
  // The reader route imports this for every book, but only books in
  // `aldine-fount.ts` actually reference the family. Without preload:false the
  // browser would fetch 30 KB of 1496 letterforms on every page of every book.
  preload: false,
  // Cardo supplies everything the facsimile is missing.
  fallback: ['Cardo', 'Georgia', 'serif'],
});

export const cardo = Cardo({
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin', 'latin-ext', 'greek'],
  variable: '--font-cardo',
  display: 'swap',
});

/** className to put on a wrapper so both CSS variables are in scope. */
export const aldineVariables = `${aldineAetna.variable} ${cardo.variable}`;

/** font-family stacks for inline styles or CSS vars. */
export const aldineStack = `var(--font-aldine-aetna), var(--font-cardo), Georgia, serif`;
export const cardoStack = `var(--font-cardo), Georgia, serif`;
