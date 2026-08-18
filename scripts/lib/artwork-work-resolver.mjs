/**
 * Resolve a work or author NAME (as written by artwork enrichment) to a book we hold.
 *
 * WHY (#4037): artworks and the books they came from live in the same `books`
 * collection with 5 edges between them. 19,530 artworks already carry
 * `enrichment.cross_references[]` naming texts and authors — 23,363 assertions
 * that render as dead prose in the "Connected Texts" panel because nothing
 * resolves them to a book.
 *
 * This module is the resolution half. It deliberately does NOT write anything:
 * a resolved link renders as a public claim ("read the full text with
 * translation"), so the write path must go through review.
 *
 * ── The specificity gate is the whole trick ──────────────────────────────────
 * Measured 2026-08-18 over all 4,779 distinct cross-reference names: matching
 * every name resolves 1,021; requiring >= 2 words AND >= 12 chars resolves 769.
 * The 252 it drops were the WRONG ones. Single-word allegory and deity labels
 * are the poison, because the corpus contains a book whose title starts with
 * almost any of them:
 *     "Prudence" -> "Klugheit vereint mit Tugend"
 *     "Saturn"   -> "Saturn Gnosis" (a 20th-c occult periodical)
 *     "Mercury"  -> "Mercury, or The Secret and Swift Messenger"
 *     "Apollo"   -> "The Apollonian Harmony, Vol. 2"
 *     "Justice"  -> "Archeion, or Of the High Court"
 * Those are artworks depicting a personification, not editions of a text. With
 * the gate, matches read as they should: "Ovid, Metamorphoses" -> the Aldine
 * edition; "Robert Fludd, Utriusque Cosmi Historia" -> Utriusque Cosmi Vol. 1.
 *
 * ── A work reference and an author reference are different links ─────────────
 * "Athanasius Kircher" resolves to *a* Kircher book (Iter Exstaticum Coeleste)
 * — real, but not "the source". An author-only reference belongs on /author/,
 * never on an arbitrary volume by that author. Callers get the kind back and
 * must route accordingly.
 */

export function normalizeTitle(t) {
  return String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Non-decomposable Latin letters, same set slugifyText transliterates.
    .replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss')
    .replace(/ø/g, 'o').replace(/þ/g, 'th').replace(/ð/g, 'd')
    .replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/ſ/g, 's')
    .replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|gli|el|los|las)\s+/, '')
    .replace(/\s*[([:]?\s*(vol\.?\s*\d+|tomus?\s*\d+|part\.?\s*\d+|band\s*\d+|tome?\s*\d+)[)\]]?\s*$/, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** >= 2 words AND >= 12 chars. See the gate note above. */
export function isSpecificEnough(normalized) {
  return normalized.split(' ').length >= 2 && normalized.length >= 12;
}

/**
 * How good a link target is this book? Higher wins.
 *
 * DEFECT THIS FIXES: the prototype took whichever edition Mongo returned first
 * for a normalized title. It filed *Atalanta Fugiens* as "unreadable" off a
 * hidden 225-page copy while a visible 194-page copy with 167 pages translated
 * sat beside it. Several editions of one work is the NORMAL case here, so
 * picking deliberately is not an edge case.
 */
export function linkQuality(book) {
  const visible = book.visible === true;
  const ocr = book.pages_ocr || 0;
  const translated = book.pages_translated || 0;
  if (!visible) return 0;                     // never link a reader to a hidden book
  if (ocr === 0) return 1;                    // exists, but there is nothing to read
  return 2 + Math.min(1, translated / Math.max(1, ocr)); // 2..3, favouring translated
}

/**
 * Person-name key: normalized words SORTED.
 *
 * Catalogue authors are "Ficino, Marsilio" while enrichment writes "Marsilio
 * Ficino". Keying on sorted words makes the two the same key without a name
 * parser, and without caring which half is the surname.
 */
export function authorKey(s) {
  const n = normalizeTitle(s);
  if (!n) return '';
  return n.split(' ').filter((w) => w.length > 1).sort().join(' ');
}

/**
 * Do two author strings name the same person?
 *
 * Deliberately loose: catalogue forms vary wildly ("Pico della Mirandola,
 * Giovanni" vs "Giovanni Pico della Mirandola"), so agreement is "they share a
 * distinctive name token". Short tokens are dropped because "della", "van",
 * "de" and "saint" are shared by hundreds of unrelated people.
 *
 * Used as a REFUSAL test, not a discovery one: it only ever removes a match the
 * title lookup already made, so being loose costs recall, never precision.
 */
export function authorsAgree(a, b) {
  const A = new Set(authorKey(a).split(' ').filter((w) => w.length >= 4));
  const B = new Set(authorKey(b).split(' ').filter((w) => w.length >= 4));
  if (!A.size || !B.size) return false;
  for (const w of A) if (B.has(w)) return true;
  return false;
}

/**
 * Build the lookup index over candidate books.
 * Pass books already fetched by the caller (it owns the projection + filters).
 */
export function buildIndex(books) {
  const byTitle = new Map();
  const byAuthor = new Map();
  const better = (a, b) => (!b || linkQuality(a) > linkQuality(b) ? a : b);

  for (const b of books) {
    for (const t of [b.title, b.english_title]) {
      const k = normalizeTitle(t);
      if (k.length > 5) byTitle.set(k, better(b, byTitle.get(k)));
    }
    const a = authorKey(b.author);
    // Require a multi-word author so a bare surname cannot swallow a work name.
    if (a && a.split(' ').length >= 2) byAuthor.set(a, better(b, byAuthor.get(a)));
  }

  // Token index over author names, because exact keys are too brittle.
  // "Pico della Mirandola" (as enrichment writes it) and "Pico della Mirandola,
  // Giovanni" (as the catalogue holds it) differ by one token, so an exact
  // lookup missed — and the name then fell through to title matching and
  // resolved as the WORK "Opera Omnia". Indexing by distinctive token and
  // confirming with authorsAgree() tolerates the name-form variation that is
  // normal across catalogues.
  const byAuthorToken = new Map();
  for (const b of books) {
    for (const w of authorKey(b.author).split(' ')) {
      if (w.length < 4) continue; // "de", "van", "della", "saint" are not identifying
      if (!byAuthorToken.has(w)) byAuthorToken.set(w, []);
      const list = byAuthorToken.get(w);
      if (list.length < 60) list.push(b); // cap: common tokens would collect thousands
    }
  }
  return { byTitle, byAuthor, byAuthorToken, titleKeys: [...byTitle.keys()] };
}

/** Best book by this person, or null. Fuzzy on name form; strict on agreement. */
export function findByPerson(index, name) {
  const tokens = authorKey(name).split(' ').filter((w) => w.length >= 4);
  if (tokens.length < 1) return null;
  const seen = new Map();
  for (const t of tokens) {
    for (const b of index.byAuthorToken?.get(t) || []) {
      if (!authorsAgree(name, b.author)) continue;
      const shared = new Set(authorKey(b.author).split(' ').filter((w) => w.length >= 4));
      const overlap = tokens.filter((w) => shared.has(w)).length;
      const prev = seen.get(b.id);
      if (!prev || overlap > prev.overlap || (overlap === prev.overlap && linkQuality(b) > linkQuality(prev.book))) {
        seen.set(b.id, { book: b, overlap });
      }
    }
  }
  if (!seen.size) return null;
  // Most name tokens in common wins; ties go to the better link target.
  return [...seen.values()].sort((x, y) => y.overlap - x.overlap || linkQuality(y.book) - linkQuality(x.book))[0].book;
}

/**
 * Resolve one name. Returns { kind: 'work'|'author', book, how } or null.
 *
 * `kind` decides the link target: 'work' -> /book/<slug>, 'author' -> /author/.
 */
export function resolveName(index, rawName) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  const parts = name.split(',').map((s) => s.trim()).filter(Boolean);

  const asWork = (c, requireSpecific = true) => {
    const k = normalizeTitle(c);
    if (requireSpecific && !isSpecificEnough(k)) return null;
    if (k.length < 8) return null;
    if (index.byTitle.has(k)) return { kind: 'work', book: index.byTitle.get(k), how: 'title-exact', matched: c };
    const prefix = index.titleKeys.find((tk) => tk.startsWith(k + ' '));
    if (prefix) return { kind: 'work', book: index.byTitle.get(prefix), how: 'title-prefix', matched: c };
    const inside = index.titleKeys.find((tk) => tk.length > 12 && k.includes(tk));
    if (inside) return { kind: 'work', book: index.byTitle.get(inside), how: 'title-contained', matched: c };
    return null;
  };

  // 1. "Author, Work" — the work half is the most specific thing on offer.
  //    Exempt from the 2-word gate: it is already qualified by the author half
  //    ("Ovid, Metamorphoses"), so a single distinctive word is safe there.
  //
  //    BUT the qualification only counts if we CHECK it. Early-modern catalogues
  //    are full of titles that are generic across authors — "Opera Omnia" is the
  //    extreme case, and unchecked it matched whichever Opera Omnia happened to
  //    index first, for any author. Worse, "Ovid, Metamorphoses" could land on
  //    Apuleius' "Metamorphoseon Libri XI". So: the matched book's author must
  //    agree with the author half, or the match is refused.
  if (parts.length > 1) {
    for (const p of parts.slice(1)) {
      const hit = asWork(p, false);
      if (hit && authorsAgree(parts[0], hit.book.author)) return { ...hit, how: `${hit.how}+author` };
    }
  }

  // 2. IS THIS A PERSON? Must be asked BEFORE title matching.
  //
  //    A person's name frequently prefixes a book title in a catalogue —
  //    "Marsilio Ficino" prefix-matches "Marsilio Ficino Epistolae", and
  //    "Leonardo da Vinci" matches "Leonardo da Vinci: der Denker, Forscher".
  //    Resolving those as WORKS pointed all 2,047 Ficino references at one
  //    volume regardless of what the artwork depicted. A name we hold as an
  //    author is an author reference; the right target is /author/, not a book.
  //    Only the author HALF is a candidate person. Testing the whole
  //    "Author, Work" string as a name matched "Raphael, Transfiguration" to a
  //    book by "Götz, Raphael" — a different person who merely shares a given
  //    name. With a comma present, parts[0] is the name and the rest is not.
  for (const c of parts.length > 1 ? [parts[0]] : [name]) {
    const k = authorKey(c);
    if (!k || k.split(' ').length < 2) continue; // a bare surname is too ambiguous
    if (index.byAuthor.has(k)) {
      return { kind: 'author', book: index.byAuthor.get(k), how: 'author-name', matched: c };
    }
    const person = findByPerson(index, c);
    if (person) return { kind: 'author', book: person, how: 'author-token', matched: c };
  }

  // 3. Otherwise treat the whole string as a work title, behind the full gate.
  return asWork(name, true);
}
