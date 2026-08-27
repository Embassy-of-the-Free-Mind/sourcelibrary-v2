/**
 * Single source of truth for which source hosts we will fetch page images FROM.
 *
 * WHY THIS MODULE EXISTS (#4163's shape, third occurrence)
 * -------------------------------------------------------
 * Three copies of this list existed and all three disagreed:
 *
 *   archive-cover-pages.mjs        3 hosts
 *   archiving-watchdog.mjs        10 hosts
 *   api/.../archive-images/route   4 hosts
 *
 * The watchdog classifies a book "archivable" using ITS list, then calls the
 * route, which refuses anything outside ITS list — so `diglib.hab.de`,
 * `wellcomecollection`, `cudl.lib.cam` and `digital.bodleian` could each be
 * triggered and archive nothing. A silent no-op that reads as success, which is
 * exactly the CSP/proxy two-list failure that made 2,506 Florentine Codex pages
 * unreadable. When two lists must agree, they must be one list.
 *
 * WHY THE LIST GREW (2026-08-27)
 * ------------------------------
 * The corpus draws page images from 22+ distinct hosts; the route allowed four.
 * Everything else could never be archived at all, which is why ~90,000 pages
 * served from R2 while their only full-resolution master sat on someone else's
 * server (`scripts/audit/pages-served-without-a-master.mjs`).
 *
 * EVERY HOST HERE WAS PROBED FROM A DATACENTER IP (the Hetzner box) with a REAL
 * url taken from the `pages` collection, not a hand-written one. A host that
 * refuses a datacenter IP must NOT be added: allowlisting it converts a stall
 * into a failed fetch, which is worse, because a stall is visible and a failure
 * looks like work. Deliberately excluded on that basis:
 *
 *   mps.lib.harvard.edu          429 rate-limited
 *   iiif.universiteitleiden.nl   403 blocked
 *   iiif.irht.cnrs.fr            301 unresolved redirect
 *   iiif.qdl.qa                  no response
 *
 * Harvard, e-rara and Gallica are additionally listed in the watchdog's
 * MAC_ONLY_PROVIDERS. Note e-rara answered 200 with a real 493KB image from
 * Hetzner on 2026-08-27, so that classification looks stale for e-rara at least
 * — but one probe is not a sustained crawl, so it is allowlisted here (the route
 * may fetch it) while the MAC_ONLY routing is left alone pending real evidence.
 *
 * ADDING A HOST: probe a REAL url from `pages` against a datacenter IP first.
 * `scripts/lib/archivable-sources.mjs` is this file's twin for `.mjs` callers
 * and `tests/unit/archivable-sources-parity.test.ts` fails if they drift.
 */

export const ARCHIVABLE_SOURCE_HOSTS = [
  // — original four —
  'archive.org',
  'gallica.bnf.fr',
  'digitale-sammlungen.de',
  'dl.ndl.go.jp',
  // — verified 200 from a datacenter IP, 2026-08-27 —
  'digital.slub-dresden.de',
  'e-rara.ch',
  'images.uba.uva.nl',
  'iiif.bdrc.io',
  'bodleian.ox.ac.uk',
  'contentdm.lib.byu.edu',
  'contentdm.oclc.org',
  'imagenes.patrimonionacional.es',
  'hab.de',
  'digi.ub.uni-heidelberg.de',
  'tile.loc.gov',
  'internetculturale.it',
  'images.metmuseum.org',
  'dlc.services',
  'permalinkbnd.bnportugal.gov.pt',
  'cdli.earth',
] as const;

/**
 * Match on a DOT BOUNDARY, never a bare suffix — the same rule
 * `image-proxy-hosts.ts` learned the hard way. `archive.org` must match
 * `archive.org` and `ia1.us.archive.org`, and never `evilarchive.org`.
 */
export function isArchivableSourceUrl(url: string | null | undefined): boolean {
  const raw = String(url || '').trim();
  if (!raw.startsWith('http')) return false;
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ARCHIVABLE_SOURCE_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
}

/**
 * Mongo-side equivalent, for queries that select pages by source. Built from the
 * same array so a host can never be fetchable-but-unselectable.
 */
export const ARCHIVABLE_SOURCES_REGEX = new RegExp(
  ARCHIVABLE_SOURCE_HOSTS.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
);
