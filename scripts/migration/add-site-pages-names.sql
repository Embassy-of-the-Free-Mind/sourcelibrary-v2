-- site_pages: the NAMES a page answers to (#5945).
--
-- PRIOR ART: scripts/migration/add-site-pages-table.sql — the table and its
-- semantic RPC. That lane finds a page by meaning and misses a visitor who
-- types the page's name: "timeline", "check pages", "Huygens".
--
-- names        what the page is called: its title, the words of its URL, the
--              aliases in src/lib/site-features.json, an author's catalogue forms.
--              Set on chunk 0 only; other chunks carry '{}'.
-- name_tokens  every folded token of `names` (scripts/lib/site-nav-names.mjs),
--              GIN-indexed: a query's tokens must all be contained.
-- weight       tie-break among equal name matches (books by an author, books
--              in a collection). Never shown to a reader.
--
-- Author rows (page_type 'author') have no embedding: an author page has no
-- prose of its own, and match_site_pages already skips NULL embeddings.
--
-- Additive and idempotent.

ALTER TABLE site_pages ADD COLUMN IF NOT EXISTS names TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE site_pages ADD COLUMN IF NOT EXISTS name_tokens TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE site_pages ADD COLUMN IF NOT EXISTS weight INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS site_pages_name_tokens_idx ON site_pages USING gin (name_tokens);
