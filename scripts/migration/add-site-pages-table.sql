-- site_pages: the site's OWN writing, searchable by meaning (#1180).
--
-- Every other embedding store is about books (pages, book summaries) or images.
-- The blog, collection intros and editorial pages had no vectors and only a
-- substring match on collection names, so a reader asking "how do you measure
-- OCR quality?" or "botanical gardens" never met the essay or the collection
-- written for exactly that question.
--
-- One row per CHUNK of a page (a long essay is several rows); the read RPC
-- returns the best chunk per URL. Written by scripts/workers/embed-site-pages.mjs.
-- Small (low thousands of rows), so the HNSW index is a nicety, not a need.

CREATE TABLE IF NOT EXISTS site_pages (
  id             TEXT PRIMARY KEY,          -- `${url}#${chunk}`
  url            TEXT NOT NULL,             -- path, e.g. /blog/philosophers-stone
  chunk          INT  NOT NULL,
  page_type      TEXT NOT NULL,             -- 'blog' | 'collection' | 'page'
  title          TEXT NOT NULL,
  text           TEXT NOT NULL,             -- the chunk as embedded; shown as the snippet
  tenant_id      TEXT,                      -- NULL = main site; else the tenant's collection
  content_hash   TEXT NOT NULL,             -- sha256 of the chunk text; unchanged → not re-embedded
  embedding      vector(768),
  embedding_model TEXT,
  indexed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_pages_url_idx ON site_pages (url);
CREATE INDEX IF NOT EXISTS site_pages_embedding_idx ON site_pages USING hnsw (embedding vector_cosine_ops);

-- Best chunk per page. filter_tenant NULL = the main site (tenant rows never
-- leak onto it); a tenant id = that tenant's rows only (no blog, no main-site
-- pages — tenant-lockdown.md).
CREATE OR REPLACE FUNCTION match_site_pages(
  query_embedding vector(768),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 5,
  filter_tenant TEXT DEFAULT NULL
)
RETURNS TABLE (
  url TEXT,
  page_type TEXT,
  title TEXT,
  text TEXT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT url, page_type, title, text, similarity FROM (
    SELECT DISTINCT ON (s.url)
      s.url, s.page_type, s.title, s.text,
      1 - (s.embedding <=> query_embedding) AS similarity
    FROM site_pages s
    WHERE s.embedding IS NOT NULL
      AND ((filter_tenant IS NULL AND s.tenant_id IS NULL) OR s.tenant_id = filter_tenant)
    ORDER BY s.url, s.embedding <=> query_embedding
  ) best
  WHERE similarity > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

-- Public content, read-only for browser roles; the writer is the direct
-- postgres connection. RLS on so a grant can never widen to writes, and
-- TRUNCATE (which RLS does not cover) revoked explicitly.
ALTER TABLE site_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_pages_read ON site_pages;
CREATE POLICY site_pages_read ON site_pages FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON site_pages TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON site_pages FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION match_site_pages(vector, FLOAT, INT, TEXT) TO anon, authenticated;
