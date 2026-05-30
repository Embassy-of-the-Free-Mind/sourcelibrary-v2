/**
 * Lazy Wikidata enrichment for author/artist `entities`.
 *
 * Given an entity that carries a `wikidata_id`, this resolves three display
 * fields and caches them back on the entity so subsequent renders are free:
 *   - `portrait_url`        — P18 image, resolved to a CSP-safe CDN URL
 *   - `wikidata_birth_date` — P569
 *   - `wikidata_death_date` — P570
 *
 * Two non-obvious constraints drove the implementation:
 *
 * 1. **CSP.** The site's `img-src` whitelists `upload.wikimedia.org` (the
 *    Wikimedia CDN) but NOT `commons.wikimedia.org`. The old code cached
 *    `commons.wikimedia.org/w/thumb.php?...` URLs, which load fine via curl
 *    but are blocked by the browser — every portrait silently broke. We must
 *    resolve P18 to an `upload.wikimedia.org` URL. The Commons `imageinfo`
 *    API does this (and snaps to a renderable thumbnail bucket — hand-built
 *    `/thumb/.../800px-` URLs 400 unless that exact width was pre-rendered).
 *
 * 2. **Lazy backfill.** ~6.7k entities have a `wikidata_id` but no dates, and
 *    ~1k have a stale `commons.*` portrait. Rather than gate everything on a
 *    batch job, we re-resolve on first render when a field is missing or the
 *    cached portrait points at the blocked domain, then persist.
 */

import type { Db, ObjectId } from 'mongodb';

export interface EnrichableEntity {
  _id: ObjectId;
  wikidata_id?: string;
  portrait_url?: string;
  wikidata_birth_date?: string;
  wikidata_death_date?: string;
}

export interface WikidataEnrichment {
  portraitUrl: string | null;
  birthDate: string | null;
  deathDate: string | null;
}

/** 24h revalidate — Wikidata/Commons facts for historical figures rarely move. */
const REVALIDATE = 60 * 60 * 24;

/** A cached portrait on the blocked Commons domain must be re-resolved. */
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
    const res = await fetch(url, { next: { revalidate: REVALIDATE } });
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
 * Return portrait + life dates for an entity, resolving anything missing from
 * Wikidata and caching it back on the entity (fire-and-forget). Safe to call
 * on every render — it only hits the network when a field is absent or the
 * cached portrait points at the CSP-blocked domain.
 */
export async function enrichEntityFromWikidata(
  db: Db,
  entity: EnrichableEntity | null,
): Promise<WikidataEnrichment> {
  if (!entity) return { portraitUrl: null, birthDate: null, deathDate: null };

  const cachedPortrait = isCspSafePortrait(entity.portrait_url) ? entity.portrait_url : null;
  const cachedBirth = entity.wikidata_birth_date ?? null;
  const cachedDeath = entity.wikidata_death_date ?? null;

  const needsPortrait = !cachedPortrait;
  const needsBirth = !cachedBirth;
  const needsDeath = !cachedDeath;

  // Nothing to do, or nothing we *can* do.
  if ((!needsPortrait && !needsBirth && !needsDeath) || !entity.wikidata_id) {
    return { portraitUrl: cachedPortrait, birthDate: cachedBirth, deathDate: cachedDeath };
  }

  try {
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity.wikidata_id}&props=claims&format=json`,
      { next: { revalidate: REVALIDATE } },
    );
    if (!res.ok) {
      return { portraitUrl: cachedPortrait, birthDate: cachedBirth, deathDate: cachedDeath };
    }
    const data = await res.json();
    const claims = data?.entities?.[entity.wikidata_id]?.claims;

    let portraitUrl = cachedPortrait;
    if (needsPortrait) {
      const filename = claims?.P18?.[0]?.mainsnak?.datavalue?.value as string | undefined;
      if (filename) portraitUrl = await resolveCommonsPortrait(filename);
    }

    const birthDate = needsBirth
      ? normaliseWikidataTime(claims?.P569?.[0]?.mainsnak?.datavalue?.value?.time)
      : cachedBirth;
    const deathDate = needsDeath
      ? normaliseWikidataTime(claims?.P570?.[0]?.mainsnak?.datavalue?.value?.time)
      : cachedDeath;

    // Persist whatever we newly resolved (don't overwrite with null).
    const set: Record<string, string> = {};
    if (portraitUrl && portraitUrl !== entity.portrait_url) set.portrait_url = portraitUrl;
    if (birthDate && birthDate !== entity.wikidata_birth_date) set.wikidata_birth_date = birthDate;
    if (deathDate && deathDate !== entity.wikidata_death_date) set.wikidata_death_date = deathDate;
    if (Object.keys(set).length > 0) {
      db.collection('entities').updateOne({ _id: entity._id }, { $set: set }).catch(() => {});
    }

    return { portraitUrl, birthDate, deathDate };
  } catch {
    return { portraitUrl: cachedPortrait, birthDate: cachedBirth, deathDate: cachedDeath };
  }
}
