/**
 * Which books are read in the type they were printed in.
 *
 * A *fount* is the case of sorts a book was set from. Where we hold a facsimile
 * of that fount — traced from our own scans, see `scripts/fonts/aldine-aetna/` —
 * the reader sets the transcription and the English translation in it, so the
 * page image and the live text are the same letterforms. Readers can switch back
 * to the library's reading face from the reading-settings popover; the choice is
 * remembered (`sl_reader_prefs.fount`).
 *
 * Everything below is the **roman Francesco Griffo cut for Aldus Manutius**,
 * first used in 1495 and in service until the 1501 italic octavos. Each entry
 * was checked against a page image: same a, e, ampersand, the ct/ſt ligatures,
 * the same abbreviation marks. Editions we hold in more than one scan are all
 * listed — same fount, different copy.
 *
 * Display only. Nothing here changes stored text: no ſ is substituted, no
 * orthography is normalised, and copying a passage yields exactly the characters
 * in `pages.ocr.data`. The facsimile carries no Greek, Hebrew or Arabic, so Cardo
 * (a revival of the same Griffo roman) sits behind it in the stack and those
 * scripts render as they always did.
 */

/** Books whose reader text is set in Aldine Aetna. Keys are `books.id`. */
export const ALDINE_FOUNT_BOOKS: Record<string, string> = {
  // ── 1495–96 · the type's first years, and the book it was traced from ──
  '6a06d1f39a48d51399960d08': 'Bembo, De Aetna (Aldus, Venice 1496) — the book this type was traced from',
  '69b220c6f79d8af0eab7fcef': 'Bembo, De Aetna (Aldus, Venice 1496)',
  '69aeabd767e6731bc1366d91': 'Bembo, De Aetna (Aldus, Venice 1496)',
  // Lascaris is Greek with a facing Latin translation: the Greek falls back to Cardo.
  '6a08574849638a50931c42e9': 'Lascaris, Erotemata (Aldus, Venice 1495)',
  '69b220ccf79d8af0eab7fd3a': 'Lascaris, Erotemata (Aldus, Venice 1495)',

  // ── 1497 ──
  '69b220de56715b0e3247381a': 'Leoniceno, De morbo gallico (Aldus, Venice 1497)',
  '6a08514215c643eb1af4a33f': 'Leoniceno, De morbo gallico (Aldus, Venice 1497)',
  '69b220da56715b0e32473793': 'Maiolo, Epiphyllides in dialecticis (Aldus, Venice 1497)',
  '69b220cff79d8af0eab7fe91': 'Maiolo, De gradibus medicinarum (Aldus, Venice 1497)',
  '6a08569515c643eb1af59560': 'Maiolo, De gradibus medicinarum (Aldus, Venice 1497)',
  '912cf0da-035c-425b-8975-e5a195a47767': 'Iamblichus, De mysteriis Aegyptiorum, tr. Ficino (Aldus, Venice 1497)',
  '69540d5d790862145d7de805': 'Iamblichus, De mysteriis Aegyptiorum, tr. Ficino (Aldus, Venice 1497)',

  // ── 1498–99 ──
  '69aeac38ce3ea0f6a5a79b9a': 'Poliziano, Opera (Aldus, Venice 1498)',
  '69b220e256715b0e32473869': 'Amaseus, Vaticinium (Aldus, Venice 1499)',
  // The Cornucopiae index is set in the shop's smaller roman — the same design at a
  // smaller body, and the source of the facsimile's figures.
  '69b220f356715b0e32473bd0': 'Perotti, Cornucopiae linguae Latinae (Aldus, Venice 1499)',
};

/**
 * Deliberately NOT listed, so nobody adds them by pattern-matching on "early Aldine":
 *
 * - **Hypnerotomachia Poliphili (1499)**, all four copies. Set in Griffo's *recut*
 *   roman — the type later revived as Poliphilus. A near relation, not this fount;
 *   claiming otherwise would be a claim we cannot support from the page.
 * - **The Greek editions** (Aristotle, Aristophanes, Theocritus, Dioscorides, the
 *   Psalters, the letter collections…). Set in Aldus's Greek types, which this
 *   facsimile does not contain at all.
 * - **Firmicus, Astronomici veteres (1499)** and **Ficino, De Voluptate (1497)**:
 *   plausible, but their scans could not be pulled at a resolution that settles the
 *   fount. Check a page before adding.
 */

/** True when this book should be read in its own fount. */
export function isAldineFount(bookId: string | undefined | null): boolean {
  return !!bookId && bookId in ALDINE_FOUNT_BOOKS;
}
