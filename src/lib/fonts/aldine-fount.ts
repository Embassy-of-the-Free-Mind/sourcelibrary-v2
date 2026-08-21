/**
 * Which books are read in the type they were printed in.
 *
 * A *fount* is the case of sorts a book was set from. Where we hold a facsimile
 * of that fount — traced from our own scans, see `scripts/fonts/aldine-aetna/` —
 * the reader can set the transcription and the English translation in it, so the
 * page image and the live text are the same letterforms.
 *
 * This is a PILOT (issue #4083). One book is enabled: Bembo's *De Aetna*, the
 * 1496 Aldine the type was traced from — the one case where facsimile and
 * original are provably the same metal. Widen the list only after looking at
 * real pages: the other books set in this fount are listed below, commented,
 * ready to switch on.
 *
 * Display only. Nothing here changes stored text: no ſ is substituted, no
 * orthography is normalised, and copying a passage yields exactly the
 * characters in `pages.ocr.data`. The facsimile carries no Greek, Hebrew or
 * Arabic, so Cardo (a revival of the same Griffo roman) sits behind it in the
 * stack and those scripts render as they always did.
 */

/** Books whose reader text is set in Aldine Aetna. Keys are `books.id`. */
export const ALDINE_FOUNT_BOOKS: Record<string, string> = {
  // The pilot: the book the type was traced from (BNCF copy, IA ita-bnc-ald-00000673-001).
  '6a06d1f39a48d51399960d08': 'De Aetna (Aldus Manutius, Venice 1496)',

  // Same fount, verified by eye and used as glyph sources — enable after the pilot is judged:
  // '69b220c6f79d8af0eab7fcef': 'De Aetna, second copy (ita-bnc-ald-00000039)',
  // '69b220de56715b0e3247381a': 'Leoniceno, De morbo gallico (1497)',
  // '69b220da56715b0e32473793': 'Maiolo, Epiphyllides (1497)',
  // '69b220cff79d8af0eab7fe91': 'Maiolo, De gradibus medicinarum (1497)',
  // '69b220ccf79d8af0eab7fd3a': 'Lascaris, Erotemata (1495) — Greek falls back to Cardo',
  // '69b220f356715b0e32473bd0': 'Perotti, Cornucopiae (1499) — smaller roman, figures came from here',
};

/** True when this book should be read in its own fount. */
export function isAldineFount(bookId: string | undefined | null): boolean {
  return !!bookId && bookId in ALDINE_FOUNT_BOOKS;
}
