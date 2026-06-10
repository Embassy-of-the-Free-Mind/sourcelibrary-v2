import { Book, TranslationEdition } from '@/lib/types';
import { getShortUrl } from '@/lib/shortlinks';

export interface Citation {
  inline: string;           // (Drebbel 1628, p. 15)
  footnote: string;         // Full footnote citation
  bibliography: string;     // Bibliography entry
  bibtex: string;           // BibTeX format
  chicago: string;          // Chicago style
  mla: string;              // MLA style
  url: string;              // Direct link to page in Source Library
  short_url: string;        // Shortlink for sharing (e.g., Twitter)
  doi_url?: string;         // Clickable DOI URL
}

function formatAccessedDate(): string {
  const d = new Date();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Original imprint for citation use: "Hamburg: Frobenius" / "Hamburg" / "Frobenius".
 * Empty string when neither place nor publisher is recorded.
 */
export function formatImprint(place?: string | null, publisher?: string | null): string {
  const p = place?.trim();
  const pub = publisher?.trim();
  if (p && pub) return `${p}: ${pub}`;
  return p || pub || '';
}

export function generateCitations(
  book: Book,
  pageNumber: number,
  bookId: string,
  pageId: string,
  baseUrl: string,
  edition?: TranslationEdition
): Citation {
  const year = book.published || 'n.d.';
  const author = book.author || 'Unknown';
  const title = book.display_title || book.title;
  const doi = edition?.doi || book.doi;
  const doiUrl = doi ? `https://doi.org/${doi}` : undefined;
  const accessed = formatAccessedDate();
  const translationYear = edition?.published_at
    ? new Date(edition.published_at).getFullYear()
    : new Date().getFullYear();
  const imprint = formatImprint(book.place_published, book.publisher);

  // Clean author name (remove extra spaces, handle "Lastname, Firstname")
  const authorParts = author.split(',').map(s => s.trim());
  const authorLastFirst = authorParts.length === 2
    ? `${authorParts[0]}, ${authorParts[1]}`
    : author;
  const authorFirstLast = authorParts.length === 2
    ? `${authorParts[1]} ${authorParts[0]}`
    : author;

  // Inline citation
  const inline = `(${authorParts[0]} ${year}, p. ${pageNumber})`;

  // Footnote (Chicago style note) — original imprint in parentheses
  const footnote = imprint
    ? `${authorFirstLast}, ${title} (${imprint}, ${year}), trans. Source Library (${translationYear}), ${pageNumber}${doi ? `. DOI: ${doi}` : ''}.`
    : `${authorFirstLast}, ${title}, trans. Source Library (${translationYear}), ${pageNumber}${doi ? `. DOI: ${doi}` : ''}.`;

  // Bibliography entry
  const bibliography = imprint
    ? `${authorLastFirst}. ${title}. ${imprint}, ${year}. Translated by Source Library. ${translationYear}.${doi ? ` DOI: ${doi}.` : ` Accessed ${accessed}.`}`
    : `${authorLastFirst}. ${title}. Translated by Source Library. ${translationYear}.${doi ? ` DOI: ${doi}.` : ` Accessed ${accessed}.`}`;

  // BibTeX — original imprint in publisher/address, Source Library as translator
  const bibtexKey = `${authorParts[0].toLowerCase().replace(/[^a-z]/g, '')}${year}`;
  const bibtex = `@book{${bibtexKey},
  author = {${authorLastFirst}},
  title = {${title}},
  year = {${year}},${book.publisher ? `
  publisher = {${book.publisher}},` : ''}${book.place_published ? `
  address = {${book.place_published}},` : ''}
  translator = {Source Library},
  note = {Translation published ${translationYear}}${doi ? `,
  doi = {${doi}},
  url = {${doiUrl}}` : ''}
}`;

  // Chicago (Author-Date)
  const chicago = imprint
    ? `${authorLastFirst}. ${year}. ${title}. ${imprint}. Translated by Source Library. ${translationYear}.${doi ? ` ${doiUrl}.` : ` Accessed ${accessed}.`}`
    : `${authorLastFirst}. ${year}. ${title}. Translated by Source Library. ${translationYear}.${doi ? ` ${doiUrl}.` : ` Accessed ${accessed}.`}`;

  // MLA
  const mla = imprint
    ? `${authorLastFirst}. ${title}. ${imprint}, ${year}. Translated by Source Library, ${translationYear}.${doi ? ` DOI: ${doi}.` : ''} Accessed ${accessed}.`
    : `${authorLastFirst}. ${title}. Translated by Source Library, ${translationYear}.${doi ? ` DOI: ${doi}.` : ''} Accessed ${accessed}.`;

  // Direct URL to page in Source Library (pinned to edition version).
  // baseUrl is derived from the request host so quotes returned from
  // tenant subdomains link back to the same subdomain.
  const editionVersion = edition?.version;
  const vParam = editionVersion ? `?v=${editionVersion}` : '';
  const url = `${baseUrl}/book/${bookId}/page/${pageId}${vParam}`;

  // Short URL for sharing
  const short_url = getShortUrl(bookId, pageNumber, pageId, baseUrl);

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
