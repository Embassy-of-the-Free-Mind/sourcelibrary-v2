/**
 * TWIN of `src/lib/archivable-sources.ts` — these two change together.
 *
 * `.mjs` scripts cannot import the TS module, so the list is duplicated, which
 * is the arrangement `translate-core.mjs` <-> `ai-models.ts` and
 * `sync-es-collection.mjs` <-> `localized.ts` already live with. The difference
 * is that this pair is GUARDED: `tests/unit/archivable-sources-parity.test.ts`
 * reads both files and fails if the host lists differ.
 *
 * Read the TS file for why the list exists, why each host is on it, and which
 * hosts are deliberately excluded (Harvard 429, Leiden 403, IRHT 301, QDL none).
 * Do not add a host here without adding it there — and not without probing a
 * REAL url from the `pages` collection against a datacenter IP first.
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
];

/** Dot-boundary match: `archive.org` matches `ia1.us.archive.org`, never `evilarchive.org`. */
export function isArchivableSourceUrl(url) {
  const raw = String(url || '').trim();
  if (!raw.startsWith('http')) return false;
  let host;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ARCHIVABLE_SOURCE_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
}

/** Mongo-side equivalent, built from the same array. */
export const ARCHIVABLE_SOURCES_REGEX = new RegExp(
  ARCHIVABLE_SOURCE_HOSTS.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
);
