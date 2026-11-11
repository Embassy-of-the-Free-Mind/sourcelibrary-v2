// PRIOR ART: scripts/maintenance/em-dash-titles-6215.mjs (rewrites a separator inside a title; it has
// no notion of a holding library or a shelfmark); scripts/iiif-discovery/resolve-heidelberg-manifests.mjs
// (decodes the OAI record's dc:title but stores it as given). Looked in scripts/lib, scripts/iiif-discovery
// and scripts/maintenance for "shelfmark" and "Universitätsbibliothek Heidelberg": nothing reorders a title.
/**
 * Put the WORK first in a catalogue title that starts with the holding library (#7270).
 *
 * Heidelberg's OAI records title every manuscript "<City>, <Repository>, <shelfmark>: <work>":
 *   "Heidelberg, Universitätsbibliothek Heidelberg, Cod. Pal. germ. 311: Konrad von Megenberg: Buch der Natur ; …"
 * A card cut to ~60 characters then shows only the library and the shelfmark. The reader wants the work:
 *   "Konrad von Megenberg: Buch der Natur; Johannes Hartlieb: Kräuterbuch (Cod. Pal. germ. 311)"
 *
 * The host library (UB Heidelberg) is dropped from the title, since the book's provider already credits
 * it. Any other repository in the list is KEPT inside the parentheses, because the scan is served by the
 * Heidelberg portal and a reader would otherwise take Heidelberg for the holder:
 *   "Oxford, Bodleian Library, MS. Laud Or. 12: Divan" → "Divan (Oxford, Bodleian Library, MS. Laud Or. 12)"
 *
 * Only titles that start with a listed repository are touched: a printed book's own title can contain
 * ", …: " ("Von Gottes Gnaden Wir Carl Philipp, Pfaltz-Graff bey Rhein: …"), so the head of the title is
 * never guessed to be a library. Pure; no I/O.
 */

/** Repositories that name the holding library first, measured on the Heidelberg candidates 2026-10-25. */
export const HOST_REPOSITORY = 'Heidelberg, Universitätsbibliothek Heidelberg';
export const OTHER_REPOSITORIES = [
  'Heidelberg, Universitätsarchiv',
  'Heidelberg, Stadtarchiv',
  'Universität Heidelberg, Musikwissenschaftliches Seminar',
  'Oxford, Bodleian Library',
  'London, British Library',
  'Basel, Universitätsbibliothek',
  'Darmstadt, Hessisches Staatsarchiv',
  'Karlsruhe, Generallandesarchiv',
  'München, Bayerisches Hauptstaatsarchiv',
  'Nürnberg, Germanisches Nationalmuseum',
  'Nürnberg, Stadtbibliothek im Bildungscampus Nürnberg',
  'Würzburg, Staatsarchiv',
  'Worms, Stadtarchiv',
  'Speyer, Landesarchiv',
  'Bensheim, Pfarrarchiv St. Georg',
  'Bensheim, Stadtarchiv',
  // Measured 2026-10-26 (#7270): repositories whose name is not "<City>, <Repository>", or that
  // the first list did not reach. 1,318 of the 1,383 titles below are the first two.
  'Universitätsarchiv Heidelberg',
  'Wissenschaftliche Stadtbibliothek Mainz',
  'Berlin, Staatsbibliothek zu Berlin – Preußischer Kulturbesitz',
  'Herzog August Bibliothek Wolfenbüttel',
  'Dresden, Sächsische Landesbibliothek – Staats- und Universitätsbibliothek',
  'Stadtbibliothek im Bildungscampus Nürnberg',
  "Scheurl'sches Familienarchiv Nürnberg",
  'Wien, Österreichische Nationalbibliothek',
  'Wien, Österreichisches Staatsarchiv',
  'Deutsches Literaturarchiv in Marbach (DLA)',
  'Deutsches Literaturarchiv Marbach (DLA)',
  'Wiesbaden, Hessisches Hauptstaatsarchiv',
  'Germanisches Nationalmuseum Nürnberg',
  'Staatsbibliothek Bamberg',
  'Staatsarchiv Nürnberg',
  'Bad Mergentheim, Deutschordensmuseum',
  'München, Bayerische Staatsbibliothek',
  'Duisburg, Landesarchiv Nordrhein-Westfalen Abteilung Rheinland',
  'Forschungsbibliothek Gotha',
  'Hamburg, Staats- und Universitätsbibliothek',
  'Fürstlich Waldeckschen Hofbibliothek Arolsen',
  'Michelstadt, Nikolaus-Matz-Bibliothek (Kirchenbibliothek)',
];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decode the XML entities a harvested dc:title can still carry ("&apos;König Rother&apos;"). */
export function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]);
}

/** "Buch der Natur ; Kräuterbuch" → "Buch der Natur; Kräuterbuch"; collapse runs of whitespace. */
function tidy(s) {
  return s.replace(/\s+;\s*/g, '; ').replace(/\s+/g, ' ').trim();
}

/** Index of the first ": " outside brackets: "Heid. Hs. 631 (alte Signatur: Batt 515): Exerzitienheft". */
function firstTopLevelColon(s) {
  let depth = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    else if (ch === ':' && s[i + 1] === ' ' && depth === 0) return i;
  }
  return -1;
}

/**
 * @param {string} title
 * @returns {string} the title with the work first and the shelfmark in parentheses, or the title
 *   unchanged when it does not start with a listed repository.
 */
export function workFirstTitle(title) {
  if (typeof title !== 'string') return title;
  const decoded = decodeEntities(title);
  const repo = [HOST_REPOSITORY, ...OTHER_REPOSITORIES].find((r) => decoded.startsWith(`${r}, `));
  if (!repo) return title;
  const rest = decoded.slice(repo.length + 2);
  const cut = firstTopLevelColon(rest);
  const shelfmark = tidy(cut < 0 ? rest : rest.slice(0, cut));
  if (!shelfmark) return title;
  let work = cut < 0 ? '' : tidy(rest.slice(cut + 2));
  // "Andachtsbuch - Cod. Pal. germ. 624" repeats the shelfmark; "Sīrat ʿAntar: Sīrat ʿAntar" repeats the work.
  if (work.endsWith(` - ${shelfmark}`)) work = work.slice(0, -(shelfmark.length + 3)).trim();
  const twice = work.match(/^(.+): (.+)$/);
  if (twice && twice[1] === twice[2]) work = twice[1];
  const where = repo === HOST_REPOSITORY ? shelfmark : `${repo}, ${shelfmark}`;
  return work ? `${work} (${where})` : where;
}
