/**
 * Does a Wikimedia Commons FILENAME share any word with the work it illustrates? (#4411)
 *
 * PRIOR ART: scripts/audit/scan-title-mismatch.mjs — same question one level in (title tokens
 * vs the book's OCR text); it never reads image URLs. scripts/lib/artwork-sources.mjs — resolves
 * a Commons File: title for ARTWORK records and fetches the file page; nothing tokenizes a
 * filename against a book. Searched scripts/{lib,audit,maintenance} for "wikimedia"/"commons".
 *
 * The April 2026 corpus importer paired text editions with Commons images by museum name or a
 * stray keyword (#4405): a Cézanne seascape on Merikare, Chinese woodblock prints on the
 * Shipwrecked Sailor. Not one of those filenames shares a word with its work's title or author.
 * This is a FINDING generator for a human queue, never a fix: zero overlap is a reason to look,
 * and some overlap is not proof of a match ("By Nile and Tigris" shares "nile" with "The Great
 * Hymn to the Nile" and was still wrong).
 *
 * Pure functions, no I/O, so an importer can call `commonsOverlap()` before it writes a page.
 */

/** Words that say nothing about WHICH work a file shows. */
const STOP = new Set([
  // en
  'the', 'and', 'for', 'from', 'with', 'into', 'upon', 'about', 'this', 'that', 'his', 'her',
  'its', 'are', 'was', 'were', 'been', 'being', 'which', 'other', 'book', 'books', 'part',
  'volume', 'vol', 'edition', 'collection', 'complete', 'works', 'unknown', 'anonymous',
  'author', 'untitled', 'text', 'texts', 'translation', 'translated',
  // de / fr / la / it / es / nl
  'der', 'die', 'das', 'den', 'dem', 'des', 'und', 'von', 'vom', 'zum', 'zur', 'ein', 'eine',
  'unbestimmt', 'les', 'aux', 'une', 'sur', 'par', 'pour', 'dans', 'del', 'della', 'delle',
  'los', 'las', 'una', 'het', 'een', 'van', 'qui', 'quae', 'quod', 'cum', 'sive', 'seu', 'liber',
  'libri', 'opera', 'omnia', 'tomus', 'tome', 'band', 'teil',
  // the object, not the work: a wrong papyrus is still a papyrus
  'papyrus', 'papyri', 'scroll', 'manuscript', 'manuscripts', 'codex', 'folio', 'fol', 'page',
  'pages', 'plate', 'plates', 'planche', 'tafel', 'recto', 'verso', 'stela', 'stele', 'tablet',
  'fragment', 'fragments', 'detail', 'facsimile', 'scan', 'image', 'photo', 'photograph',
  // Commons filename furniture
  'file', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'gif', 'svg', 'pdf', 'djvu', 'webp', 'crop',
  'cropped', 'retouched', 'edit', 'edited', 'restored', 'version', 'museum', 'library',
  'public', 'domain', 'commons', 'wikimedia', 'google', 'art', 'project', 'img', 'dsc',
]);

const MIN_LEN = 3;
/** Two tokens this long or longer that share this prefix count as the same word
 *  (Merikare/Merikara, Sinuhe/Sinuhet, Latin and German inflection). */
const STEM = 5;

/** Lowercase, strip diacritics, split on anything that is not a letter; drop stopwords. */
export function tokenize(s) {
  if (!s || typeof s !== 'string') return [];
  const norm = s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  // Split camelCase before lowercasing would lose it — do it on the original too.
  const camel = s.replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  const out = new Set();
  for (const src of [norm, camel]) {
    for (const t of src.split(/[^\p{L}]+/u)) {
      if (t.length >= MIN_LEN && !STOP.has(t)) out.add(t);
    }
  }
  return [...out];
}

/**
 * The Commons file NAME behind a URL, or null when the URL is not a Commons file.
 * Handles upload.wikimedia.org originals and /thumb/ derivatives, commons.wikimedia.org
 * `wiki/File:…` pages and `Special:FilePath/…` redirects.
 */
export function commonsFilename(url) {
  if (!url || typeof url !== 'string') return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split('/').filter(Boolean);
  let raw = null;
  if (host === 'upload.wikimedia.org') {
    // /wikipedia/commons/a/ab/Name.jpg  or  /wikipedia/commons/thumb/a/ab/Name.jpg/800px-Name.jpg
    const i = segs.indexOf('thumb');
    if (i !== -1 && segs.length > i + 3) raw = segs[i + 3];
    else if (segs.length >= 5 && /^[0-9a-f]$/.test(segs[2]) && /^[0-9a-f]{2}$/.test(segs[3])) raw = segs[4];
    else raw = segs[segs.length - 1];
  } else if (host === 'commons.wikimedia.org' || host.endsWith('.wikipedia.org')) {
    const last = segs[segs.length - 1] || '';
    const fp = segs.findIndex((s) => /^Special:FilePath$/i.test(decodeSafe(s)));
    if (fp !== -1 && segs[fp + 1]) raw = segs[fp + 1];
    else if (/^(File|Datei|Fichier|Image):/i.test(decodeSafe(last))) raw = last.replace(/^[^:]+:/, '');
    else if (u.searchParams.get('title')) raw = u.searchParams.get('title').replace(/^[^:]+:/, '');
    else return null;
  } else {
    return null;
  }
  if (!raw) return null;
  return decodeSafe(raw).replace(/_/g, ' ').replace(/\.[a-z0-9]{2,5}$/i, '').trim() || null;
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function sameWord(a, b) {
  if (a === b) return true;
  return a.length >= STEM && b.length >= STEM && a.slice(0, STEM) === b.slice(0, STEM);
}

/** The work's own words: title, display/original/alternate titles, author. Deliberately NOT
 *  importer notes or bibliography — a museum name in a bibliography is exactly how #4405 broke. */
export function workTokens(book) {
  const parts = [
    book?.title, book?.display_title, book?.original_title, book?.title_original,
    book?.subtitle, book?.author, book?.display_author,
    ...(Array.isArray(book?.alternate_titles) ? book.alternate_titles : []),
  ].filter((x) => typeof x === 'string');
  return tokenize(parts.join(' '));
}

/**
 * Compare a work against the Commons filenames its pages serve.
 * `verdict`: 'zero-overlap' (no filename shares a word — the finding),
 *            'overlap' (at least one filename does), or
 *            'unjudgeable' (the work or every filename has no usable token —
 *             e.g. a non-Latin title, or "IMG 0042"; reported, never flagged).
 * Per-file results let a reviewer see WHICH file on a mixed book is the odd one out.
 */
export function commonsOverlap(book, filenames) {
  const work = workTokens(book);
  const files = [...new Set(filenames.filter(Boolean))].map((name) => {
    const toks = tokenize(name);
    const shared = toks.filter((t) => work.some((w) => sameWord(t, w)));
    return { name, tokens: toks, shared };
  });
  const judgeable = files.filter((f) => f.tokens.length > 0);
  // A work titled only in Greek/Hebrew/CJK legitimately shares no letters with an English
  // filename; judging across a script boundary manufactures false positives.
  const latinWork = work.some((w) => /[a-z]/.test(w));
  let verdict;
  if (work.length === 0 || judgeable.length === 0 || !latinWork) verdict = 'unjudgeable';
  else if (judgeable.some((f) => f.shared.length > 0)) verdict = 'overlap';
  else verdict = 'zero-overlap';
  return {
    verdict,
    work_tokens: work,
    files,
    zero_overlap_files: judgeable.filter((f) => f.shared.length === 0).map((f) => f.name),
  };
}
