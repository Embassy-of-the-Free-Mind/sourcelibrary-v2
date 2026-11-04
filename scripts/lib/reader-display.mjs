/**
 * PRIOR ART: src/lib/page-image-url.ts resolveSized — the rule itself, but it imports through the `@/`
 * alias, so a node script cannot load it. tests/unit/reader-display.test.ts holds the two together.
 * scripts/lib/deepzoom-own-leaf.mjs lists a page's R2 candidates; it does not say which one a reader gets.
 *
 * Does the reader show this page's display_photo? Marking a variant the reader never loads proves
 * nothing and costs a PUT, and counting one as coverage reports a page as ours when it is not (#4406).
 * A page with a cropped_photo is served as a proxy resize of the crop; a page whose variant names a
 * different image than its source falls through to the source.
 */
import { r2PageIdentity } from '../../src/lib/r2-page-identity.ts';

const usable = (u) => typeof u === 'string' && /^https?:\/\//.test(u);

export const READER_DISPLAY_FIELDS = { display_photo: 1, cropped_photo: 1, split_from_spread: 1, crop: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1, photo: 1, plate_whole: 1 };

function readerSource(p) {
  if (usable(p.cropped_photo)) return p.cropped_photo;
  if (p.split_from_spread && usable(p.photo)) return p.photo;
  return [p.enhanced_photo, p.archived_photo, p.photo_original, p.photo].find(usable) ?? null;
}

export function readerServesDisplay(p) {
  if (!usable(p.display_photo)) return false;
  const plate = p.plate_whole?.display;
  if (plate?.url === p.display_photo && plate.of && plate.of === readerSource(p)) return true;
  if (usable(p.cropped_photo)) return false;
  if (!p.split_from_spread && p.crop?.xStart !== undefined && p.crop?.xEnd !== undefined) return false;
  const source = readerSource(p);
  if (!source) return true;
  const a = r2PageIdentity(p.display_photo), b = r2PageIdentity(source);
  return a === null || b === null || a === b;
}
