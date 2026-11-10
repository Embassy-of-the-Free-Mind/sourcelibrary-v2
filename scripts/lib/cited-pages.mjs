/**
 * Book pages we link to from our own writing: articles (English and Spanish),
 * authored content, and newsletter letters.
 *
 * PRIOR ART: scripts/seo/flag-indexable-pages.mjs opens pages by readership,
 * first-translation and quality, never by "we cited it"; scripts/email/qa-letter.mjs
 * checks one letter's links at send time. Neither lists the pages our writing
 * points readers at, which the metered reader (#4357) must leave open: an
 * article quoting page 62 of a 69-page book showed signed-out readers a scan
 * with no English (265 of 456 cited pages, measured 2026-11-11).
 *
 * Returns raw references; resolving them to page documents is the caller's job.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const CITING_PATHS = [
  'src/app/articles',
  'src/app/es/articles',
  'src/content',
  'scripts/email',
];

const LINK = /\/book\/([A-Za-z0-9_-]+)(?:\/page\/([A-Za-z0-9_-]+)|\?page=(\d+))/g;

/**
 * @returns {{ bookKey: string, pageKey?: string, pageNumber?: number, source: string }[]}
 *   one entry per distinct (book, page) reference, with the first file that cites it.
 */
export function citedPageRefs(cwd = process.cwd()) {
  const files = execFileSync('git', ['ls-files', '--', ...CITING_PATHS], { cwd, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(tsx?|mdx?|json|html)$/.test(f));
  const seen = new Map();
  for (const file of files) {
    const text = readFileSync(`${cwd}/${file}`, 'utf8');
    for (const m of text.matchAll(LINK)) {
      const [, bookKey, pageKey, num] = m;
      const key = `${bookKey}|${pageKey || `#${num}`}`;
      if (seen.has(key)) continue;
      // /page/62 is a page NUMBER (the reader accepts both); ids are 24-hex or longer.
      const asNumber = num ?? (/^\d{1,5}$/.test(pageKey) ? pageKey : null);
      seen.set(key, asNumber != null ? { bookKey, pageNumber: Number(asNumber), source: file } : { bookKey, pageKey, source: file });
    }
  }
  return [...seen.values()];
}
