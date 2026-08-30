/**
 * Source fingerprints — .mjs twin of the fingerprint half of `src/lib/dedup.ts`.
 *
 * Exists for the same reason `scripts/lib/identity-fields.mjs` does: the direct
 * importers and the Hetzner workers run under plain node and cannot import
 * TypeScript. Twin convention as in r2-key / identity-fields: **the TS side is
 * canonical, this file is a port**, and `tests/unit/source-fingerprints-parity.test.ts`
 * fails CI if the two ever disagree on the fixture corpus. Change BOTH or neither.
 *
 * Read the TS header for WHY the set exists and, more importantly, for what is
 * deliberately excluded from it (bare `dc:` values, scraped numeric path
 * segments) — those exclusions are load-bearing, not oversights.
 */

/** `dublin_core.dc_identifier` normalised to an array — it is a bare STRING on
 * 89,772 books, where `.length`/`[0]` silently yield a character. */
export function dcIdentifiers(book) {
  const raw = book?.dublin_core?.dc_identifier;
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return arr.filter((d) => typeof d === 'string' && d.trim().length > 0);
}

/** Canonical form of a source URL: scheme-case, `www.`, trailing slash, and
 *  IIIF's `/manifest` vs `/manifest.json` all collapse. */
export function normalizeSourceUrl(url) {
  if (typeof url !== 'string') return null;
  const t = url.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  let u;
  try { u = new URL(t); } catch { return null; }
  const path = u.pathname.replace(/\/+$/, '').replace(/\/manifest\.json$/i, '/manifest');
  return `${u.host.toLowerCase().replace(/^www\./, '')}${path}${u.search || ''}`;
}

/** Provider-native identifiers pulled back OUT of a URL — the cross-form catch. */
export function deriveSourceIdentifiers(url) {
  if (typeof url !== 'string' || !url) return [];
  let host;
  try { host = new URL(url).host.toLowerCase(); } catch { return []; }
  const out = [];
  const unusable = (s) => !s || s.length < 5 || /^\d{1,3}$/.test(s) || /^manifest(\.json)?$/i.test(s);

  if (host === 'archive.org' || host.endsWith('.archive.org')) {
    let m = url.match(/\/iiif\/(?:[23]\/)?([^/?#]+)\/manifest/);
    if (!m) m = url.match(/\/(?:details|download|stream|metadata)\/([^/?#]+)/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (!unusable(id)) out.push(`ia:${id}`);
    }
  }
  const bsb = url.match(/\b(bsb[0-9]{6,})\b/i);
  if (bsb) out.push(`mdz:${bsb[1].toLowerCase()}`);
  const ark = url.match(/ark:\/(\d{4,6})\/([A-Za-z0-9._-]{5,})/);
  if (ark && ark[1] === '12148') out.push(`gallica:ark:/12148/${ark[2]}`);
  const ppn = url.match(/\b(PPN[0-9]{6,}[0-9X]?)\b/);
  if (ppn) out.push(`ppn:${ppn[1]}`);
  if (host.endsWith('google.com')) {
    const m = url.match(/[?&]id=([A-Za-z0-9_-]{8,})/);
    if (m) out.push(`gbooks:${m[1]}`);
  }
  return out;
}

/** The discriminator separating two books cut from ONE source object. */
export function sourceSubrange(book) {
  const is = book?.image_source || {};
  if (typeof is.page_range === 'string' && is.page_range.trim()) return is.page_range.trim();
  const id = typeof is.identifier === 'string' ? is.identifier : '';
  if (id.includes('#')) return id.slice(id.indexOf('#') + 1).trim() || null;
  const bare = id.split('#')[0];
  if (bare) {
    for (const d of dcIdentifiers(book)) {
      const m = d.match(/^[A-Za-z][A-Za-z0-9_-]*:(.+)$/);
      if (!m) continue;
      const rest = m[1];
      if (rest.startsWith(`${bare}/`)) {
        const tail = rest.slice(bare.length + 1).trim();
        if (tail) return tail;
      }
    }
  }
  return null;
}

/** Every digital-object identifier a record carries — the tier-1 key. */
export function sourceFingerprints(book) {
  if (!book || typeof book !== 'object') return [];
  const sr = sourceSubrange(book);
  const suffix = sr ? `#${sr}` : '';
  const out = new Set();
  const add = (v) => { if (typeof v === 'string' && v.trim()) out.add(v.trim() + suffix); };

  if (book.ia_identifier) add(`ia:${book.ia_identifier}`);
  if (book.gallica_ark) add(`gallica:${book.gallica_ark}`);
  if (book.bodleian_uuid) add(`bodleian:${book.bodleian_uuid}`);
  if (book.mdz_id) add(`mdz:${String(book.mdz_id).toLowerCase()}`);
  if (book.bsb_id) add(`mdz:${String(book.bsb_id).toLowerCase()}`);
  if (book.google_books_id) add(`gbooks:${book.google_books_id}`);

  const is = book.image_source || {};
  if (is.identifier && is.provider) {
    const bare = String(is.identifier).split('#')[0];
    if (bare) add(`${is.provider}:${bare}`);
  }
  const manifestKey = normalizeSourceUrl(is.iiif_manifest);
  if (manifestKey) add(`iiif:${manifestKey}`);
  const pdfKey = normalizeSourceUrl(is.pdf_url);
  if (pdfKey) add(`pdf:${pdfKey}`);

  for (const url of [is.iiif_manifest, is.source_url, is.pdf_url, ...dcIdentifiers(book)]) {
    for (const derived of deriveSourceIdentifiers(url)) add(derived);
  }

  return [...out].sort();
}

/**
 * The legacy SCALAR fingerprint — one identifier chosen by priority.
 * Unchanged from `src/lib/dedup.ts`; still written on every import because
 * indexes, the warehouse and several audits read it. `sourceFingerprints()`
 * above is what tier 1 now matches on.
 */
export function sourceFingerprint(book) {
  if (!book || typeof book !== 'object') return null;
  if (book.ia_identifier) return `ia:${book.ia_identifier}`;
  if (book.gallica_ark) return `gallica:${book.gallica_ark}`;
  if (book.bodleian_uuid) return `bodleian:${book.bodleian_uuid}`;
  if (book.mdz_id) return `mdz:${book.mdz_id}`;
  if (book.bsb_id) return `mdz:${book.bsb_id}`;
  if (book.google_books_id) return `gbooks:${book.google_books_id}`;
  if (book.image_source?.identifier && book.image_source?.provider) {
    return `${book.image_source.provider}:${book.image_source.identifier}`;
  }
  if (book.image_source?.iiif_manifest) return `iiif:${book.image_source.iiif_manifest}`;
  if (book.image_source?.pdf_url) return `pdf:${book.image_source.pdf_url}`;
  if (book.dublin_core?.dc_identifier?.length) return `dc:${book.dublin_core.dc_identifier[0]}`;
  return null;
}
