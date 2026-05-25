// MARC / OAI Dublin Core records use conventional placeholder strings when a
// field is genuinely absent on the source object. Importers must treat these
// as `null` rather than store the placeholder as if it were real metadata.
//
// Background: a regression in the e-rara importer (see PR #1965-adjacent
// backfill) was writing `[s.n.]` into book.author for any record where the
// OAI feed used the MARC "sine nomine" sigil, producing 124 books with
// `author: "[s.n.]"` in the catalog.

const MARC_SIGILS_NO_NAME = new Set([
  '[s.n.]', '[S.N.]', 's.n.', 'S.N.', '[s.n]', '[S.n.]',
]);

const MARC_SIGILS_NO_PLACE = new Set([
  '[s.l.]', '[S.L.]', 's.l.', 'S.L.', '[s.l]',
]);

export function normalizeMarcAuthor(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (MARC_SIGILS_NO_NAME.has(trimmed)) return null;
  return trimmed;
}

export function normalizeMarcPlace(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (MARC_SIGILS_NO_PLACE.has(trimmed)) return null;
  return trimmed;
}
