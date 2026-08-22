/**
 * Single source of truth for which image hosts the browser may load.
 *
 * The CSP `img-src` directive in `next.config.ts` is BUILT from this list, and
 * `isBrowserRenderableImageUrl()` screens stored image URLs against the same
 * list — so the two can never drift. Before this module existed they did:
 * ~1,550 visible books carried cover URLs on hosts the CSP blocked (or that
 * redirect off-allowlist), and every one of them rendered as a permanently
 * blank card — the browser's load failure fires before React hydrates, so the
 * typographic placeholder never swapped in. Readers that screen with
 * `isBrowserRenderableImageUrl()` render the placeholder immediately instead.
 *
 * Entries use the CSP source syntax: `https://host` or `https://*.domain`.
 * Adding a host here both allowlists it in the CSP and makes stored URLs on it
 * render again — one edit, both layers (cf. the three-layer crawler gate
 * lesson: changing one layer alone is silently defeated by the others).
 */

export const CSP_IMG_HOSTS = [
  'https://images.sourcelibrary.org',
  // Google OAuth profile photos (users.image for Google sign-ins). Every
  // avatar surface (UserMenu, /account, WelcomeForm) fell back to initials
  // because this host was CSP-blocked — UserMenu.tsx documents the symptom.
  'https://lh3.googleusercontent.com',
  'https://*.r2.dev',
  'https://*.public.blob.vercel-storage.com',
  'https://*.amazonaws.com',
  'https://iiif.archive.org',
  'https://archive.org',
  'https://dl.ndl.go.jp',
  'https://gallica.bnf.fr',
  'https://api.digitale-sammlungen.de',
  'https://www.e-rara.ch',
  'https://digi.vatlib.it',
  'https://*.bodleian.ox.ac.uk',
  'https://cudl.lib.cam.ac.uk',
  'https://diglib.hab.de',
  'https://iiif.hab.de',
  'https://iiif.wellcomecollection.org',
  'https://upload.wikimedia.org',
  'https://*.loc.gov',
  'https://babel.hathitrust.org',
  'https://bl.digirati.io',
  'https://images.lib.cam.ac.uk',
  'https://www.e-codices.unifr.ch',
  'https://cdm21059.contentdm.oclc.org',
  'https://iiif.universiteitleiden.nl',
  'https://image.digitalcollections.manchester.ac.uk',
  'https://digi.ub.uni-heidelberg.de',
  'https://iiif.qdl.qa',
  'https://permalinkbnd.bnportugal.gov.pt',
  'https://cdli.earth',
  'https://images.uba.uva.nl',
  'https://imagenes.patrimonionacional.es',
  'https://images.eap.bl.uk',
  'https://*.basemaps.cartocdn.com',
  // Library IIIF hosts that hold live cover URLs for visible books but were
  // missing from the CSP (measured 2026-08-04: ~570 blank cards between them).
  'https://mps.lib.harvard.edu',
  'https://digital.slub-dresden.de',
  'https://iiif-images.library.upenn.edu',
  'https://content.staatsbibliothek-berlin.de',
  'https://images.sub.uni-goettingen.de',
] as const;

/** The full img-src directive value, consumed by next.config.ts. */
export const CSP_IMG_SRC = `img-src 'self' data: blob: ${CSP_IMG_HOSTS.join(' ')}`;

const EXACT_HOSTS = new Set<string>();
const WILDCARD_SUFFIXES: string[] = [];
for (const entry of CSP_IMG_HOSTS) {
  const host = entry.replace(/^https:\/\//, '');
  if (host.startsWith('*.')) WILDCARD_SUFFIXES.push(host.slice(1)); // keep leading '.'
  else EXACT_HOSTS.add(host);
}

/**
 * Can the BROWSER actually display this image URL?
 *
 * True only for https URLs whose host the CSP `img-src` allows. One deliberate
 * exception: `archive.org/download/...` is on an allowlisted host but 302s to
 * `ia*.us.archive.org`, which is not — the browser follows the redirect and
 * blocks the final load, so those URLs must be treated as non-renderable even
 * though a server-side fetch of them succeeds (a fetch success is a claim about
 * the server's view, not the browser's).
 *
 * Note the dot-anchored wildcard match: `evil-r2.dev` must not pass `*.r2.dev`
 * (cf. the #3508 suffix-match lesson).
 */
export function isBrowserRenderableImageUrl(url?: string | null): boolean {
  const trimmed = String(url || '').trim();
  if (!trimmed.startsWith('https://')) return false;
  let host: string;
  try {
    host = new URL(trimmed).hostname;
  } catch {
    return false;
  }
  if (host === 'archive.org' && new URL(trimmed).pathname.startsWith('/download/')) return false;
  if (EXACT_HOSTS.has(host)) return true;
  return WILDCARD_SUFFIXES.some(suffix => host.endsWith(suffix));
}
