/**
 * Offline Wikidata enrichment for author/artist/person `entities`.
 *
 * Given an entity that carries a `wikidata_id`, this resolves three display
 * fields and writes them onto the entity so the render path is a pure static
 * read (it never calls Wikidata itself):
 *   - `portrait_url`        — P18 image, resolved to a CSP-safe CDN URL
 *   - `wikidata_birth_date` — P569
 *   - `wikidata_death_date` — P570
 *   - `wikidata_enriched_at`— marker so we don't re-check on every run
 *
 * This runs OFFLINE only — from the `/api/cron/enrich-entities` cron, the
 * `backfill-wikidata-portraits-dates.mjs` script, and once when an author is
 * linked (`linkAuthorToEntity`). It must NOT be called from a page render:
 * birth/death/portrait are effectively immutable facts, so they belong in the
 * DB, not pulled per view. See PR #2187 (the bug that started this) and the
 * follow-up that made render static.
 *
 * Two non-obvious constraints:
 *
 * 1. **CSP.** The site's `img-src` whitelists `upload.wikimedia.org` (the
 *    Wikimedia CDN) but NOT `commons.wikimedia.org`. A `commons.wikimedia.org`
 *    portrait URL loads fine via curl but is blocked by the browser. We resolve
 *    P18 to an `upload.wikimedia.org` URL via the Commons `imageinfo` API
 *    (hand-built `/thumb/.../800px-` URLs 400 unless that width was
 *    pre-rendered, so let the API hand us a renderable thumburl).
 *
 * 2. **Negative caching.** Many people legitimately have no P18/P569/P570 in
 *    Wikidata. We still stamp `wikidata_enriched_at` so the cron treats them as
 *    "checked, nothing there" and stops re-fetching — a staleness window
 *    (cron-side) re-checks them later in case Wikidata gains the data.
 */

import type { Db, ObjectId } from 'mongodb';

export interface EnrichableEntity {
  _id: ObjectId;
  wikidata_id?: string;
  portrait_url?: string;
  wikidata_birth_date?: string;
  wikidata_death_date?: string;
}

export interface EnrichResult {
  /** Fields newly written this run (excludes the always-written marker). */
  updated: Array<'portrait_url' | 'wikidata_birth_date' | 'wikidata_death_date'>;
  /** False when the entity had no wikidata_id or the Wikidata fetch failed. */
  checked: boolean;
}

/** A portrait on the CSP-blocked Commons domain is treated as not-yet-resolved. */
function isCspSafePortrait(url: string | undefined): url is string {
  return !!url && url.includes('upload.wikimedia.org');
}

/** "+1396-06-05T00:00:00Z" → "1396-06-05"; leaves BCE ("-0044-…") intact. */
function normaliseWikidataTime(time: string | undefined): string | null {
  if (!time) return null;
  const m = time.match(/^\+?(-?\d{1,4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Resolve a Commons file name (P18 value, e.g. "Giannozzo manetti.jpg") to a
 * CSP-safe `upload.wikimedia.org` thumbnail URL via the imageinfo API.
 * Returns the full-size CDN URL when the source is smaller than the request.
 */
async function resolveCommonsPortrait(filename: string): Promise<string | null> {
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
    `&titles=${encodeURIComponent(`File:${filename}`)}` +
    `&prop=imageinfo&iiprop=url&iiurlwidth=300`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data?.query?.pages;
    const page = pages && Object.values(pages)[0] as { imageinfo?: Array<{ thumburl?: string; url?: string }> };
    const info = page?.imageinfo?.[0];
    const resolved = info?.thumburl || info?.url || null;
    // Defensive: only return whitelisted CDN URLs.
    return resolved && resolved.includes('upload.wikimedia.org') ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Fetch P18/P569/P570 from Wikidata and write any missing fields onto the
 * entity, then stamp `wikidata_enriched_at`. Only fills gaps — never
 * overwrites an existing value. Returns what changed.
 *
 * OFFLINE ONLY (cron / script / link hook). Do not call from a render path.
 */
export async function enrichEntity(
  db: Db,
  entity: EnrichableEntity,
): Promise<EnrichResult> {
  const set: Record<string, string | Date> = {};

  if (entity.wikidata_id) {
    try {
      const res = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity.wikidata_id}&props=claims&format=json`,
        { cache: 'no-store' },
      );
      if (res.ok) {
        const data = await res.json();
        const claims = data?.entities?.[entity.wikidata_id]?.claims;

        if (!isCspSafePortrait(entity.portrait_url)) {
          const filename = claims?.P18?.[0]?.mainsnak?.datavalue?.value as string | undefined;
          if (filename) {
            const portraitUrl = await resolveCommonsPortrait(filename);
            if (portraitUrl) set.portrait_url = portraitUrl;
          }
        }
        if (!entity.wikidata_birth_date) {
          const b = normaliseWikidataTime(claims?.P569?.[0]?.mainsnak?.datavalue?.value?.time);
          if (b) set.wikidata_birth_date = b;
        }
        if (!entity.wikidata_death_date) {
          const d = normaliseWikidataTime(claims?.P570?.[0]?.mainsnak?.datavalue?.value?.time);
          if (d) set.wikidata_death_date = d;
        }

        // Mark as checked (negative cache) regardless of what we found.
        set.wikidata_enriched_at = new Date();
        await db.collection('entities').updateOne({ _id: entity._id }, { $set: set });
        return {
          updated: Object.keys(set).filter((k) => k !== 'wikidata_enriched_at') as EnrichResult['updated'],
          checked: true,
        };
      }
    } catch {
      // fall through to checked:false (no marker — let the cron retry it)
    }
  }

  return { updated: [], checked: false };
}
