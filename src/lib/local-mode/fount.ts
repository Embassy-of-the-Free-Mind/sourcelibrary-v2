/**
 * Which face the original pane is set in, offline.
 *
 * PRIOR ART: src/lib/fonts/aldine.ts and src/lib/fonts/aldine-fount.ts — why they
 * do not fit *as they stand*: `aldine.ts` instantiates Cardo through
 * `next/font/google`, which reaches out to Google at compile time. That is
 * correct on Vercel and wrong here: the desk reader has to compile and run on a
 * plane. This module re-declares only the local `@font-face` (the same woff2 file,
 * `next/font/local`, no network) and puts system old-style serifs behind it. The
 * whitelist in `aldine-fount.ts` is imported and used UNCHANGED — see below.
 *
 * DECISION 1 (design/DECISIONS.md, Derek's, 2026-09-12): production keeps the
 * whitelist, because there the fount is a provenance claim — "read in the type it
 * was printed in" — and widening it would make that claim false for every other
 * book. Local mode widens it to every Latin-script original, as the stand-in for
 * the scan we do not have. There it is a reading face, not a claim, and nothing in
 * the UI says otherwise. The widening lives HERE, at the local reader's own call
 * site; `ALDINE_FOUNT_BOOKS` is not touched and `isAldineFount` keeps its meaning.
 */
import localFont from 'next/font/local';
import { isAldineFount } from '@/lib/fonts/aldine-fount';

/**
 * The facsimile, with no Google fallback behind it.
 *
 * `preload: false` for the same reason production sets it: the face is 30 KB of
 * 1496 letterforms and not every book uses it. `fallback` is macOS/Windows
 * old-style serifs — the facsimile carries 136 Latin glyphs and nothing else, so
 * something complete must sit behind it for digits, j k v w z and most capitals.
 */
export const aldineAetnaLocal = localFont({
  src: '../../../public/fonts/aldine-aetna/AldineAetna-Regular.woff2',
  variable: '--font-aldine-aetna',
  display: 'swap',
  preload: false,
  fallback: ['Iowan Old Style', 'Palatino Linotype', 'Palatino', 'Georgia', 'serif'],
});

/**
 * Is this text Latin-script?
 *
 * Decided from the CHARACTERS, not from `books.language`. The language field is
 * the edition's label and it is wrong often enough to matter — an IA import can
 * land Maya plates as "Lb", and the resolver overrides the caller. The glyphs
 * cannot lie about which alphabet they are.
 *
 * The threshold is deliberately loose: an early-modern Latin book quotes Greek in
 * passing, and a page that is 90% roman should still be set in the roman it was
 * printed in, with Cardo's successors picking up the Greek run.
 */
export function isLatinScriptText(text: string | null | undefined): boolean {
  if (!text) return false;
  let latin = 0;
  let other = 0;
  for (const ch of text) {
    if (/\p{Script=Latin}/u.test(ch)) latin++;
    else if (/\p{L}/u.test(ch)) other++;
  }
  const total = latin + other;
  if (total < 40) return false; // too little text to judge — leave the reading face alone
  return latin / total >= 0.85;
}

/**
 * Should the original pane be set in Aldine Aetna?
 *
 * On the website this is `isAldineFount(id)` alone. Here it is
 * `isAldineFount(id) || <this is a Latin-script original>`, which is the widening
 * decision 1 authorises — and only here.
 */
export function useFountOffline(bookId: string | undefined, originalText: string | null | undefined): boolean {
  return isAldineFount(bookId) || isLatinScriptText(originalText);
}

/**
 * Why this page is set in the facsimile, for the reading-settings line. The desk
 * reader shows the honest one: a book on the whitelist is read in its own type; a
 * book off it is merely being read in a Renaissance face. Never label a
 * non-Aldine book as "read in its own type" — that is the specimen page's promise
 * and it has to stay true.
 */
export function fountProvenance(bookId: string | undefined): 'own-type' | 'reading-face' {
  return isAldineFount(bookId) ? 'own-type' : 'reading-face';
}
