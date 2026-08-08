-- #3726 Tier 3: project the graded FT verdict into books_catalog so card
-- surfaces can render the earned claim register without an Atlas fetch.
-- Pure projections of books.first_translation.* and the two #3524 screens;
-- all nullable, so the add is non-breaking and pre-rebuild rows simply
-- render the candidate register (the fail-toward direction).
ALTER TABLE books_catalog
  ADD COLUMN IF NOT EXISTS ft_verdict text,
  ADD COLUMN IF NOT EXISTS ft_evidence_strength text,
  ADD COLUMN IF NOT EXISTS ft_our_completeness text,
  ADD COLUMN IF NOT EXISTS ft_source_screen text,
  ADD COLUMN IF NOT EXISTS ft_translator_screen text;
