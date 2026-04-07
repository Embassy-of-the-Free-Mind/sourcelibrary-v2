-- Source Library: Supabase Entities Schema
-- Run this in the Supabase SQL Editor with service role permissions.
-- Issue: #868 — Migrate entities to Supabase for fast reads + materialized stats

-- ============================================================
-- Table: entities (synced from MongoDB entities collection)
-- ============================================================

CREATE TABLE IF NOT EXISTS entities (
  id text PRIMARY KEY,               -- MongoDB _id as string
  name text NOT NULL,
  canonical_name text,
  type text NOT NULL DEFAULT 'concept', -- person, place, concept
  book_count integer DEFAULT 0,
  total_mentions integer DEFAULT 0,
  description text,
  aliases text[],

  -- Wikidata enrichment
  wikidata_id text,
  wikipedia_url text,
  wikidata_birth_date text,
  wikidata_death_date text,
  wikidata_coordinates jsonb,         -- {lat, lon}

  -- Authority IDs
  gnd_id text,
  lcnaf_id text,
  viaf_id text,

  -- Person-specific
  portrait_url text,
  birth_place text,
  death_place text,

  -- Book references (lightweight — just book_ids, not full page arrays)
  book_ids text[] DEFAULT '{}',

  -- Timestamps
  created_at timestamptz,
  updated_at timestamptz,
  synced_at timestamptz DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

-- Trigram for ILIKE search on name
CREATE INDEX IF NOT EXISTS idx_entities_name_trgm
  ON entities USING GIN (name gin_trgm_ops);

-- Type filtering
CREATE INDEX IF NOT EXISTS idx_entities_type
  ON entities (type);

-- Wikidata lookups
CREATE INDEX IF NOT EXISTS idx_entities_wikidata_id
  ON entities (wikidata_id) WHERE wikidata_id IS NOT NULL;

-- Sort by book_count (most referenced entities)
CREATE INDEX IF NOT EXISTS idx_entities_book_count
  ON entities (book_count DESC);

-- Incremental sync (find recently updated)
CREATE INDEX IF NOT EXISTS idx_entities_updated_at
  ON entities (updated_at DESC);

-- ============================================================
-- Materialized view: explore_stats
-- Replaces the system_config snapshot + seeding script
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS explore_stats AS
SELECT
  count(*) AS total_entities,
  count(*) FILTER (WHERE wikidata_id IS NOT NULL) AS with_wikidata,
  count(*) FILTER (WHERE wikidata_birth_date IS NOT NULL OR wikidata_death_date IS NOT NULL) AS with_dates,
  count(*) FILTER (WHERE wikidata_coordinates IS NOT NULL) AS with_coordinates,
  (SELECT count(*) FROM books_catalog WHERE visible = true AND pages_count > 0) AS total_books
FROM entities;

CREATE UNIQUE INDEX IF NOT EXISTS idx_explore_stats_singleton ON explore_stats (total_entities);

-- ============================================================
-- Materialized view: entity_type_distribution
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS entity_type_distribution AS
SELECT type, count(*) AS count
FROM entities
GROUP BY type;

CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_type_dist_type ON entity_type_distribution (type);

-- ============================================================
-- Materialized view: entity_heatmap (century x type)
-- Uses book_ids array + books_catalog join
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS entity_heatmap AS
SELECT
  floor((b.year - 1) / 100) + 1 AS century,
  e.type,
  count(DISTINCT e.id) AS count
FROM entities e
CROSS JOIN LATERAL unnest(e.book_ids) AS bid(book_id)
JOIN books_catalog b ON b.id = bid.book_id
WHERE b.year IS NOT NULL AND b.year > 0
GROUP BY 1, 2
ORDER BY 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_heatmap_key ON entity_heatmap (century, type);

-- ============================================================
-- Materialized view: top_entities_by_era
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS top_entities_by_era AS
WITH entity_centuries AS (
  SELECT DISTINCT
    e.id, e.name, e.type, e.book_count,
    floor((b.year - 1) / 100) + 1 AS century
  FROM entities e
  CROSS JOIN LATERAL unnest(e.book_ids) AS bid(book_id)
  JOIN books_catalog b ON b.id = bid.book_id
  WHERE b.year IS NOT NULL AND b.year > 0 AND e.book_count >= 2
),
ranked AS (
  SELECT *, row_number() OVER (PARTITION BY century ORDER BY book_count DESC) AS rn
  FROM entity_centuries
)
SELECT century, name, type, book_count
FROM ranked
WHERE rn <= 5
ORDER BY century, rn;

CREATE UNIQUE INDEX IF NOT EXISTS idx_top_entities_era_key ON top_entities_by_era (century, name);

-- ============================================================
-- Refresh schedule (via pg_cron, daily at 4am UTC)
-- ============================================================

SELECT cron.schedule('sl-refresh-explore-stats', '0 4 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY explore_stats$$);

SELECT cron.schedule('sl-refresh-entity-type-dist', '0 4 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY entity_type_distribution$$);

SELECT cron.schedule('sl-refresh-entity-heatmap', '5 4 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY entity_heatmap$$);

SELECT cron.schedule('sl-refresh-top-entities', '10 4 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY top_entities_by_era$$);
