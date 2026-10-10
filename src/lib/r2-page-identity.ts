/**
 * Identity of the page-image an R2 URL names, or null when the URL does not
 * follow that convention (IIIF, external hosts, anything unparseable).
 *
 * Normalises the two things that make one page look like two URLs:
 *   - variant suffix — `x.jpg`, `x-thumb.jpg`, `x-full.jpg`, `x-card.avif` are one image
 *   - zero padding across path families — `/archived/{b}/5.jpg` is the same
 *     page as `/pages/{b}/0005.jpg`
 *
 * Dependency-free so scripts can import it (moved out of page-image-url.ts
 * unchanged for #6010, where a book's cover has to be matched to its page).
 *
 * PRIOR ART: src/lib/page-image-url.ts r2PageIdentity — this IS that function,
 * moved so cover-frame.ts and node scripts can share it; cardUrlForCover in
 * src/lib/utils.ts maps a cover to its card URL, not to an identity.
 */
export function r2PageIdentity(url: string): string | null {
  const q = url.split('?')[0];
  if (!q.includes('images.sourcelibrary.org/')) return null;
  const file = (q.split('/').pop() || '').replace(/-(?:thumb|full|card)(?=\.[a-z0-9]+$)/i, '').replace(/\.[a-z0-9]+$/i, '');
  if (!file) return null;
  const book = q.match(/\/(?:pages|archived|thumbnails|cropped)\/([^/]+)\//)?.[1];
  if (!book) return null;
  // Numeric page filenames compare by value so 5 and 0005 agree; named ones
  // (`sp<id>`, a cropped image id) compare literally.
  return `${book}/${/^\d+$/.test(file) ? String(parseInt(file, 10)) : file}`;
}
