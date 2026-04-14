-- Add GIN index on books_catalog.collections for fast array containment queries.
-- Without this, `collections @> '["some-slug"]'` does a sequential scan on ~17K rows,
-- causing 30s+ timeouts for large collections like 'miscellany' (2,222 books).
-- Also add GIN on categories for the same reason.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_books_catalog_collections_gin
  ON books_catalog USING GIN (collections);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_books_catalog_categories_gin
  ON books_catalog USING GIN (categories);
