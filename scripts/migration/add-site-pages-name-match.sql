-- match_site_pages_by_name: the pages whose NAME contains every query token (#5945).
--
-- PRIOR ART: match_site_pages (add-site-pages-table.sql) ranks by embedding
-- similarity, which answers "what is this about" and misses "take me to the
-- timeline". This is the lexical twin: candidates only, ranked in
-- src/lib/search/site-nav.ts where the rule can be unit-tested.
--
-- name_tokens is GIN-indexed (add-site-pages-names.sql), so `@>` is an index
-- lookup that does not grow with the table. Author rows (6.8K) sort last and by
-- weight, so a common token ("john") cannot crowd the few hundred real pages
-- out of the candidate window.
--
-- filter_tenant NULL = the main site; tenant rows never leak onto it.
-- Idempotent.

CREATE OR REPLACE FUNCTION match_site_pages_by_name(
  query_tokens TEXT[],
  match_count INT DEFAULT 80,
  filter_tenant TEXT DEFAULT NULL
)
RETURNS TABLE (
  url TEXT,
  page_type TEXT,
  title TEXT,
  text TEXT,
  names TEXT[],
  weight INT
)
LANGUAGE sql STABLE
AS $$
  SELECT s.url, s.page_type, s.title, s.text, s.names, s.weight
  FROM site_pages s
  WHERE s.chunk = 0
    AND cardinality(query_tokens) > 0
    AND s.name_tokens @> query_tokens
    AND ((filter_tenant IS NULL AND s.tenant_id IS NULL) OR s.tenant_id = filter_tenant)
  ORDER BY (s.page_type = 'author'), s.weight DESC, s.url
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION match_site_pages_by_name(TEXT[], INT, TEXT) TO anon, authenticated;
