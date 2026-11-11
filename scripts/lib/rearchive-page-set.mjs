// PRIOR ART: scripts/lib/iiif-utils.mjs dimensionFields — the field names an archiver writes beside
// archived_photo; used here, not duplicated. This module only assembles the whole page `$set` for
// rearchive-iiif-fullres.mjs so it can be tested without that script's Mongo/R2 connection.
/**
 * The `$set` rearchive-iiif-fullres.mjs writes on a page whose archive it replaced with the master.
 *
 * It wrote `image_metadata.width/height` and left the top-level `image_width`/`image_height` at the
 * old size. The IIIF manifest sizes canvases from the top-level pair and `--max-held-width` selects
 * on it, so a manifest described a 766 px canvas over a 2298 px image, and a re-run fetched the
 * same pages again (#3186). Both pairs come from the dimensions of the bytes actually stored.
 */
import { dimensionFields } from './iiif-utils.mjs';

/**
 * @param {object} o
 * @param {string} o.newUrl          the R2 URL just written
 * @param {{width:number,height:number}} o.dims  dimensions of the stored bytes
 * @param {number} o.masterWidth     the source master's width (book-level measure)
 * @param {string|null} [o.keepSource] the source URL to keep as photo_original, if the page has none
 * @param {Date} [o.now]
 */
export function upgradedPageSet({ newUrl, dims, masterWidth, keepSource = null, now = new Date() }) {
  return {
    archived_photo: newUrl,
    photo: newUrl,
    ...(keepSource ? { photo_original: keepSource } : {}),
    ...dimensionFields(dims, null),
    'image_metadata.width': dims?.width,
    'image_metadata.height': dims?.height,
    'image_metadata.source_max_width': masterWidth,
    'image_metadata.upgraded_at': now,
    updated_at: now,
  };
}
