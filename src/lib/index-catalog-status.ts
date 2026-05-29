import { supabase } from './supabase';

/**
 * Reverse lookup: was this book (or its author) condemned by the Index
 * Librorum Prohibitorum? Powers the "Banned by the Index" chip on the book
 * page. Two signals, distinct:
 *   - workBanned  — an Index entry is linked to THIS book (sl_book_id)
 *   - authorBanned — the book's author (author_entity_id) appears in the Index,
 *                    even if this exact work isn't separately listed
 *
 * Data lives in Supabase `index_catalog_entries` (see project_ilp_catalog).
 * Returns null when neither applies, so the caller renders nothing.
 */
export interface IndexCatalogStatus {
  workBanned: boolean;
  authorBanned: boolean;
  editionCount: number;        // distinct Index editions involved
  scopes: string[];            // 'opera_omnia' | 'expurgated' | 'donec_corrigatur' | 'single_work'
  firstYear: number | null;
  lastYear: number | null;
  collectionSlug: string;
}

const COLLECTION_SLUG = 'index-librorum-prohibitorum';
const COLS = 'index_id,scope,condemnation_year,sl_book_id';

export async function getIndexCatalogStatus(
  bookIds: (string | null | undefined)[],
  authorEntityId: string | null | undefined,
): Promise<IndexCatalogStatus | null> {
  const ids = [...new Set(bookIds.filter((x): x is string => !!x))];

  // Two cheap reads in parallel: this exact work, and anything by this author.
  // The author read is capped — distinct editions/scopes saturate well under
  // the cap (there are only ~10 editions), so the aggregate stays accurate.
  const [workRes, authorRes] = await Promise.all([
    ids.length
      ? supabase.from('index_catalog_entries').select(COLS).in('sl_book_id', ids)
      : Promise.resolve({ data: [] as Row[] }),
    authorEntityId
      ? supabase.from('index_catalog_entries').select(COLS).eq('author_entity_id', authorEntityId).limit(1000)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const workRows = (workRes.data || []) as Row[];
  const authorRows = (authorRes.data || []) as Row[];
  if (!workRows.length && !authorRows.length) return null;

  // Lead with the WORK's own status when this exact work is linked (so we say
  // "expurgated" for a work that was only expurgated, even if the author was
  // more broadly banned). Otherwise describe the author-level signal.
  const lead = workRows.length ? workRows : authorRows;
  const editions = new Set<string>();
  const scopes = new Set<string>();
  let firstYear: number | null = null;
  let lastYear: number | null = null;
  for (const r of lead) {
    if (r.index_id) editions.add(r.index_id);
    if (r.scope) scopes.add(r.scope);
    if (typeof r.condemnation_year === 'number') {
      firstYear = firstYear === null ? r.condemnation_year : Math.min(firstYear, r.condemnation_year);
      lastYear = lastYear === null ? r.condemnation_year : Math.max(lastYear, r.condemnation_year);
    }
  }

  return {
    workBanned: workRows.length > 0,
    authorBanned: authorRows.length > 0,
    editionCount: editions.size,
    scopes: [...scopes],
    firstYear,
    lastYear,
    collectionSlug: COLLECTION_SLUG,
  };
}

interface Row {
  index_id: string | null;
  scope: string | null;
  condemnation_year: number | null;
  sl_book_id: string | null;
}
