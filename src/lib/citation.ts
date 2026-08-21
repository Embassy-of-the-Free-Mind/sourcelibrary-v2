/**
 * Building the citation apparatus for a served page.
 *
 * Lifted out of `src/app/api/books/[id]/quote/route.ts` so it can be tested.
 * It could not be, sitting in a route file, and that is how it came to assert
 * "Translated by Source Library" over an English book the translator's own
 * work — see the credit logic below and #3724.
 */
import { resolveImprintPlace } from '@/lib/imprint';
import { citationYear, citationYearOrNd } from '@/lib/publication-date';
import { getShortUrl } from '@/lib/shortlinks';
import { readerPageUrl } from '@/lib/slugify';
import type { Book, TranslationEdition } from '@/lib/types';

export interface Citation {
  inline: string;
  footnote: string;
  bibliography: string;
  bibtex: string;
  chicago: string;
  mla: string;
  url: string;
  short_url: string;
  doi_url?: string;
}

function formatAccessedDate(): string {
  const d = new Date();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function generateCitations(
  book: Book,
  pageNumber: number,
  bookId: string,
  pageId: string,
  baseUrl: string,
  edition?: TranslationEdition,
  /**
   * The reading language of the text being cited (#4095). Only the two link
   * fields change: the citation PROSE stays as it is, because the apparatus
   * describes the printed source — author, place, year, the edition being
   * quoted — none of which a translation into Spanish alters. Passing a
   * language whose edition the book does not hold would mint a URL that 307s
   * back to English, so callers pass it only when they served that edition.
   */
  lang?: string,
): Citation {
  // `published` is free text: 23% of the corpus is not a year, and ~1,500 books
  // carry raw Wikidata QuickStatements ("1573date QS:P571,+1573-...Z/9"). That
  // string was landing in the BibTeX `year` field and the inline citation, i.e.
  // straight into scholars' bibliographies. Assert a bare year or `n.d.`.
  const year = citationYearOrNd(book.published);
  // BibTeX keys must stay alphanumeric — 'n.d.' would emit a key with dots.
  const bibtexYearKey = citationYear(book.published) ?? 'nd';
  const author = book.author || 'Unknown';
  const title = book.display_title || book.title;
  const doi = edition?.doi || book.doi;
  const doiUrl = doi ? `https://doi.org/${doi}` : undefined;
  const accessed = formatAccessedDate();
  const translationYear = edition?.published_at
    ? new Date(edition.published_at).getFullYear()
    : new Date().getFullYear();

  // Clean author name (remove extra spaces, handle "Lastname, Firstname")
  const authorParts = author.split(',').map(s => s.trim());
  const authorLastFirst = authorParts.length === 2
    ? `${authorParts[0]}, ${authorParts[1]}`
    : author;
  const authorFirstLast = authorParts.length === 2
    ? `${authorParts[1]} ${authorParts[0]}`
    : author;

  // Original-edition imprint (place, publisher, format, USTC) of the source
  // printing being translated — the bibliographic record of the original work,
  // distinct from the Source Library translation credit. Mirrors the "Cite"
  // dropdown (CiteButton) and the bibliographic panel (BibliographicInfo).
  // Place comes through the family resolver (#4043): four columns hold this
  // fact, and citation surfaces reading only `place_published` left 3,300
  // visible books citing no place while we held one.
  const imprintPlace = resolveImprintPlace(book)?.display;
  const pubImprint = [imprintPlace, book.publisher].filter(Boolean).join(': ');
  const imprint = [pubImprint, book.format, book.ustc_id ? `USTC ${book.ustc_id}` : ''].filter(Boolean).join('. ');
  const imprintStr = imprint ? `${imprint}. ` : '';

  /**
   * WHAT DID WE ACTUALLY DO TO THIS TEXT? The credit has to match, in both
   * directions (#3724).
   *
   * Every format used to assert `Translated by Source Library` unconditionally.
   * On a book that was printed in English that is false twice over: we did not
   * translate Taylor's 1818 Aristotle — Taylor did — so the line claimed his
   * work and erased him in the same breath. Measured on production before this
   * change: `/api/books/6956953e…/quote?page=46` returned "trans. Source
   * Library" over an English page Taylor rendered himself.
   *
   * The inverse error is the one #3724 was opened about: 17,825 of 19,465 live
   * books (91.6%) serve English we produced, and the *inline* form — the one
   * people paste into running prose — said only "(Aristotle 1818, p. 46)".
   *
   * So: name the rendering when it is ours, stay silent when it is not, and
   * never claim a named translator's work.
   */
  const isEnglishOriginal = (book.language || '').trim().toLowerCase().startsWith('english');
  const renderingCredit = isEnglishOriginal
    ? null
    : { short: `trans. Source Library ${translationYear}`, long: `Translated by Source Library. ${translationYear}.` };

  // Inline citation. Carries the rendering credit when the English is ours —
  // this is the form that gets pasted into prose, and it was the only one that
  // said nothing.
  const inline = renderingCredit
    ? `(${authorParts[0]} ${year}, p. ${pageNumber}, ${renderingCredit.short})`
    : `(${authorParts[0]} ${year}, p. ${pageNumber})`;

  // Footnote (Chicago style note)
  const footnote = `${authorFirstLast}, ${title}, ${imprintStr}${renderingCredit ? `${renderingCredit.short.replace(`Source Library ${translationYear}`, `Source Library (${translationYear})`)}, ` : ''}${pageNumber}${doi ? `. DOI: ${doi}` : ''}.`;

  // Bibliography entry
  const bibliography = `${authorLastFirst}. ${title}. ${imprintStr}${renderingCredit ? `${renderingCredit.long} ` : ''}${doi ? `DOI: ${doi}.` : `Accessed ${accessed}.`}`;

  // BibTeX — original imprint (address/publisher) + translation credit (note)
  const bibtexKey = `${authorParts[0].toLowerCase().replace(/[^a-z]/g, '')}${bibtexYearKey}`;
  const bibtexLines = [
    `@book{${bibtexKey},`,
    `  author = {${authorLastFirst}},`,
    `  title = {${title}},`,
    `  year = {${year}},`,
  ];
  if (imprintPlace) bibtexLines.push(`  address = {${imprintPlace}},`);
  bibtexLines.push(`  publisher = {${book.publisher || 'Source Library'}},`);
  if (renderingCredit) bibtexLines.push(`  translator = {Source Library},`);
  if (doi) {
    bibtexLines.push(`  doi = {${doi}},`);
    bibtexLines.push(`  url = {${doiUrl}},`);
  }
  const bibtexNote = renderingCredit
    ? [`Translation published ${translationYear}`]
    : ['Text transcribed from the printed page by Source Library'];
  if (book.format) bibtexNote.push(book.format);
  if (book.ustc_id) bibtexNote.push(`USTC ${book.ustc_id}`);
  bibtexLines.push(`  note = {${bibtexNote.join('; ')}}`);
  bibtexLines.push(`}`);
  const bibtex = bibtexLines.join('\n');

  // Chicago (Author-Date)
  const chicago = `${authorLastFirst}. ${year}. ${title}. ${imprintStr}${renderingCredit ? `${renderingCredit.long} ` : ''}${doi ? `${doiUrl}.` : `Accessed ${accessed}.`}`;

  // MLA
  const mla = `${authorLastFirst}. ${title}. ${imprintStr}${renderingCredit ? `Translated by Source Library, ${translationYear}.` : ''}${doi ? ` DOI: ${doi}.` : ''} Accessed ${accessed}.`;

  // Direct URL to page in Source Library (pinned to edition version).
  // baseUrl is derived from the request host so quotes returned from
  // tenant subdomains link back to the same subdomain.
  //
  // Built from the book's slug, not the requested id: this URL gets printed
  // into papers and footnotes, so it has to say which book it is. Calling the
  // API by id would otherwise mint a permanent citation to /book/<objectid>.
  const editionVersion = edition?.version;
  const vParam = editionVersion ? `?v=${editionVersion}` : '';
  const localePrefix = lang && lang !== 'en' ? `/${lang}` : '';
  const url = `${baseUrl}${localePrefix}${readerPageUrl({ slug: book.slug, id: bookId }, pageId)}${vParam}`;

  // Short URL for sharing
  const short_url = getShortUrl(bookId, pageNumber, pageId, baseUrl, lang);

  return {
    inline,
    footnote,
    bibliography,
    bibtex,
    chicago,
    mla,
    url,
    short_url,
    doi_url: doiUrl,
  };
}
