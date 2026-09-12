/**
 * PRIOR ART: src/app/api/import/ia/route.ts — has the correct four-step chain, but
 * inline in a Vercel route handler, so no script can import it. The ~12 scripts that
 * need a page count (`git grep -l imagecount -- scripts`) each re-derive it, and every
 * one of them trusts `imagecount` alone. This module is that chain, extracted, so the
 * script side stops guessing. The route is deliberately NOT changed here.
 *
 * WHY THIS EXISTS. An IA item whose page images ship inside a `Single Page Processed
 * JP2 ZIP` or a DjVu container reports **no** `imagecount`, and the obvious fallback —
 * count `.jp2` entries in the file listing — sees the container as ONE file. The item
 * then looks like a 1-page book, i.e. like a PDF-only item with no page images at all.
 *
 * That is not hypothetical. On 2026-09-07 al-Maqrizi's *Khiṭaṭ* (MIFAO 30/33) was set
 * aside as "PDF-only" on exactly that reading. It has 207 and 127 IIIF canvases, and it
 * carries Ibn Sulaym al-Aswani's eyewitness account of medieval Nubia. Three more
 * pre-1930 acquisitions were nearly dropped the same way in the same session.
 *
 * The rule: **a missing `imagecount` is a missing FIELD, not a missing BOOK.** Ask the
 * IIIF manifest, which counts actual canvases and does not care how the images are
 * packaged.
 *
 * Precedence here is manual → IIIF → imagecount → loose .jp2. Note this differs from
 * the route, where step 1 assigns unconditionally and therefore silently overwrites an
 * explicit `pages_count` whenever a manifest exists — contradicting its own comment
 * ("prefer manual override, then IIIF"). Harmless today because manual override is only
 * used for items that have no manifest, but it is a real discrepancy; see the PR.
 */

const IIIF_TIMEOUT_MS = 15000;
const UA = 'SourceLibrary/1.0 (+https://sourcelibrary.org)';

/**
 * Count the pages of an Internet Archive item.
 *
 * @param {string} identifier                  IA identifier
 * @param {object} [opts]
 * @param {object} [opts.metadata]             pre-fetched https://archive.org/metadata/<id> body
 * @param {number} [opts.manual]               explicit override; wins outright when > 0
 * @param {typeof fetch} [opts.fetchImpl]      injectable for tests
 * @returns {Promise<{pages:number, source:string}>} source ∈ manual|iiif_v3|iiif_v2|imagecount|jp2_files|none
 */
export async function iaPageCount(identifier, opts = {}) {
  const { metadata, manual, fetchImpl = fetch } = opts;

  // 0. Explicit override wins. The caller knows something we do not.
  if (Number.isInteger(manual) && manual > 0) return { pages: manual, source: 'manual' };

  // 1. IIIF manifest — counts canvases, so packaging (zip, DjVu, loose files) is irrelevant.
  try {
    for (const url of [
      `https://iiif.archive.org/iiif/3/${identifier}/manifest.json`,
      `https://iiif.archive.org/iiif/${identifier}/manifest.json`,
    ]) {
      const res = await fetchImpl(url, {
        signal: AbortSignal.timeout(IIIF_TIMEOUT_MS),
        headers: { 'User-Agent': UA },
      });
      if (!res.ok) continue;
      const manifest = await res.json();
      if (Array.isArray(manifest.items) && manifest.items.length) {
        return { pages: manifest.items.length, source: 'iiif_v3' };
      }
      const canvases = manifest.sequences?.[0]?.canvases;
      if (Array.isArray(canvases) && canvases.length) {
        return { pages: canvases.length, source: 'iiif_v2' };
      }
    }
  } catch {
    // fall through — a dead manifest must not stop the acquisition
  }

  // 2. imagecount, when present. Absent for container-packaged items — that is the whole point.
  const raw = metadata?.metadata?.imagecount;
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return { pages: n, source: 'imagecount' };
  }

  // 3. Loose .jp2 files, only when they are genuinely listed one-per-page.
  //    `> 1` is load-bearing: a lone .jp2 is almost always a container or a thumbnail.
  const files = metadata?.files || [];
  const jp2 = files.filter((f) => typeof f?.name === 'string' && f.name.endsWith('.jp2') && !f.name.includes('thumb'));
  if (jp2.length > 1) return { pages: jp2.length, source: 'jp2_files' };

  return { pages: 0, source: 'none' };
}
