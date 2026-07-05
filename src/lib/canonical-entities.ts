/**
 * Canonical entities read model (GitHub #2979) — read-path constants + types.
 *
 * `canonical_entities` is a small (~21K docs), fully-indexed materialization of
 * the Wikidata-enriched sliver of the ~1M-doc `entities` collection — one doc
 * per QID (duplicate rows merged; enriched non-QID rows keyed `e:<entities._id>`).
 * Built nightly by scripts/maintenance/build-canonical-entities.mjs (03:45 UTC,
 * Hetzner crontab). Whole-collection rollups for the /explore hub live in
 * `system_config.entity_stats` (written by the same build).
 *
 * READ MODEL, NOT TRUTH: source of truth stays `entities` (mention graph +
 * enrichment) and `authors` (person identity, #2179 — person docs carry
 * `author_slug` pointing there). Staleness bound <= 24h. Never write to it
 * outside the build script; it is derived and droppable.
 *
 * Migration status: page-by-page behind the flag below (/explore surfaces
 * first — they are ISR so risk is low). Until a page is migrated it keeps
 * reading `entities` via the #2973 partial indexes.
 */

export const CANONICAL_ENTITIES_COLLECTION = 'canonical_entities';
export const ENTITY_STATS_CONFIG_ID = 'entity_stats';

/**
 * Whether /explore surfaces read `canonical_entities` instead of `entities`.
 * Read at RUNTIME (per call), not as a module-level const — a const gets baked
 * into the importing page's bundle at build time and flipping the env var
 * would have no effect (same rationale as authorThesaurusReadpathEnabled).
 */
export function canonicalEntitiesReadpathEnabled(): boolean {
  return (
    process.env.CANONICAL_ENTITIES_READPATH === '1' ||
    process.env.CANONICAL_ENTITIES_READPATH === 'true'
  );
}

export interface CanonicalEntityDoc {
  /** Wikidata QID (e.g. "Q76738"), or `e:<entities._id>` for enriched rows without one. */
  _id: string;
  wikidata_id: string | null;
  name: string;
  display_name: string;
  /** All source-row name forms merged into this doc. */
  raw_names: string[];
  aliases: string[];
  /** Majority type; `types` lists all if merged rows disagreed. */
  type: 'person' | 'place' | 'concept';
  types: string[];
  description: string | null;
  wikidata_birth_date: string | null;
  wikidata_death_date: string | null;
  wikidata_coordinates: { lat: number; lng: number } | null;
  birth_place: string | null;
  death_place: string | null;
  portrait_url: string | null;
  wikipedia_url: string | null;
  viaf_id: string | null;
  gnd_id: string | null;
  lcnaf_id: string | null;
  /** authors._id when this person is a book author — identity lives in `authors` (#2179). */
  author_slug: string | null;
  /** Exact count of distinct mentioning books (unioned across merged rows). */
  book_count: number;
  total_mentions: number;
  /** Mentioning book ids, most-mentioned first, capped at 500 (book_count stays exact). */
  book_ids: string[];
  /** Language rollup of mentioning books, e.g. { la: 12, de: 3 } — timeline traditions. */
  languages: Record<string, number>;
  /**
   * [min, max] publication year (>0) across ALL mentioning books, or null —
   * the map's century fallback (added in the read-path phase; docs built
   * before 2026-07-05 lack the field, so readers must guard on presence).
   */
  book_year_range: [number, number] | null;
  /**
   * Entity-level tradition (who the person WAS: religion → native language,
   * from the durable `wikidata_claims` cache) — or null, in which case readers
   * fall back to the `languages` book rollup. Docs built before 2026-07-05
   * lack these three fields; guard on presence.
   */
  tradition: string | null;
  /** Raw P106 occupation labels (English, capped at 10). */
  occupations: string[];
  /** Coarse occupation buckets for the timeline lens (see scripts/lib/wikidata-tradition-occupation.mjs). */
  occupation_groups: string[];
  /** Provenance: `entities._id`s merged into this doc. */
  entity_ids: string[];
  source: 'build-canonical-entities';
  built_at: Date;
}

/** Shape of `system_config.entity_stats` (for the /explore hub counts). */
export interface EntityStatsDoc {
  total: number;
  by_type: Record<string, number>;
  canonical: number;
  canonical_by_type: Record<string, number>;
  with_dates: number;
  with_coordinates: number;
  with_wikidata_id: number;
  updatedAt: Date;
}
