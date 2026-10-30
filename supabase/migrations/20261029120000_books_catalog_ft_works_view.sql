-- books_catalog_ft_works: the first-translation browse, one row per WORK (/search?first_translation=true).
--
-- Why: Derek's feedback 2026-10-29, "Hmmm dupes". 6,107 visible first-translation rows held 5,077 works;
-- 385 works showed 2+ editions (1,020 extra rows), e.g. the Latin and German Coelum philosophorum. Typed
-- search already collapses by work_id (src/lib/search/work-grouping.ts); /api/books/browse paginates in
-- Postgres, where an in-page collapse caught only ~50 of the 1,020 (the rest fall on other pages).
--
-- The lead edition of a work is the one with the most translated pages, then the highest quality_score,
-- then the most pages, then id. Rows with no work_id are their own work. Computed per query over ~6K rows,
-- so it is never stale and needs no sync step.
--
-- Scoped to first translations on purpose: one "lead edition" for every filter would hide a work whose
-- lead is German from a Latin-language browse. /api/books/browse reads this view only with
-- first_translation=true and no language filter.
--
-- A view rather than a column: adding a column needs an ACCESS EXCLUSIVE lock on books_catalog, which a
-- long pg_dump (AccessShare held for hours) blocked on 2026-10-29; a view takes no such lock.

CREATE OR REPLACE VIEW books_catalog_ft_works AS
SELECT b.*
FROM books_catalog b
JOIN (
  SELECT id,
         row_number() OVER (
           PARTITION BY COALESCE(work_id, id)
           ORDER BY pages_translated DESC NULLS LAST, quality_score DESC NULLS LAST,
                    pages_count DESC NULLS LAST, id
         ) AS rn
  FROM books_catalog
  WHERE visible = true AND pages_count > 0 AND is_first_translation = true
) lead ON lead.id = b.id AND lead.rn = 1;

GRANT SELECT ON books_catalog_ft_works TO anon, authenticated, service_role;
