import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { getDb } from '@/lib/mongodb';
import TenantCatalogueTable, { type CatalogueRow, type CatalogueSort } from '@/components/libraries/TenantCatalogueTable';

interface Props {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PAGE_SIZE = 100;
const VALID_SORTS: ReadonlySet<CatalogueSort> = new Set([
  'title', 'title_desc',
  'author', 'author_desc',
  'pages', 'pages_desc',
  'translation', 'translation_desc',
  'ocr', 'ocr_desc',
  'shelfmark',
]);

function parseSort(raw: string | undefined): CatalogueSort {
  if (raw && VALID_SORTS.has(raw as CatalogueSort)) return raw as CatalogueSort;
  return 'title';
}

function parsePage(raw: string | undefined): number {
  const n = Math.max(1, parseInt(raw || '1', 10));
  return Number.isFinite(n) ? n : 1;
}

// Supabase column to order by + ascending flag. `pages`, `ocr`, `translation`
// sort on raw counts (pages_count, pages_ocr, pages_translated) rather than
// computed percentages — close enough for sort intent and avoids a generated
// column. `shelfmark` orders by source_url which mirrors the EAP shelfmark
// embedded in the URL (EAP039-1-2-1 sorts naturally).
// Matches the type-loose pattern in src/lib/books-catalog.ts:applySort —
// PostgrestFilterBuilder's generics make a precise signature impractical here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySort(query: any, sort: CatalogueSort): any {
  switch (sort) {
    case 'title':           return query.order('sort_title', { ascending: true });
    case 'title_desc':      return query.order('sort_title', { ascending: false });
    case 'author':          return query.order('author', { ascending: true, nullsFirst: false });
    case 'author_desc':     return query.order('author', { ascending: false, nullsFirst: false });
    case 'pages':           return query.order('pages_count', { ascending: true });
    case 'pages_desc':      return query.order('pages_count', { ascending: false });
    case 'translation':     return query.order('pages_translated', { ascending: true });
    case 'translation_desc':return query.order('pages_translated', { ascending: false });
    case 'ocr':             return query.order('pages_ocr', { ascending: true });
    case 'ocr_desc':        return query.order('pages_ocr', { ascending: false });
    case 'shelfmark':       return query.order('source_url', { ascending: true });
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tenant } = await params;
  const db = await getDb();
  const tenantDoc = await db.collection('tenants').findOne({ slug: tenant });
  const name = tenantDoc?.name || tenant;
  return {
    title: `Catalogue — ${name}`,
    description: `Full catalogue of manuscripts in the ${name} collection.`,
  };
}

export default async function TenantCataloguePage({ params, searchParams }: Props) {
  const { tenant } = await params;
  const sp = await searchParams;
  const sort = parseSort(typeof sp.sort === 'string' ? sp.sort : undefined);
  const page = parsePage(typeof sp.page === 'string' ? sp.page : undefined);
  const offset = (page - 1) * PAGE_SIZE;

  const db = await getDb();
  const tenantDoc = await db.collection('tenants').findOne({ slug: tenant });
  if (!tenantDoc) notFound();

  // For now this page is only meaningful for tenants whose books are mirrored
  // to Supabase books_catalog with a parseable shelfmark in source_url. Today
  // that's bhutan (EAP). When more tenants opt in, generalise the filter via
  // a tenant.catalogueQuery field rather than branching here.
  const isBhutan = tenant === 'bhutan';
  if (!isBhutan) notFound();

  const baseSelect = 'id, slug, title, display_title, author, year, language, pages_count, pages_ocr, pages_translated, source_url';
  const countQuery = supabase.from('books_catalog').select('id', { count: 'exact', head: true })
    .ilike('source_url', '%eap.bl.uk%')
    .eq('visible', true)
    .gt('pages_count', 0);
  const dataQueryBase = supabase.from('books_catalog').select(baseSelect)
    .ilike('source_url', '%eap.bl.uk%')
    .eq('visible', true)
    .gt('pages_count', 0)
    .range(offset, offset + PAGE_SIZE - 1);

  const [{ count, error: countErr }, { data, error: dataErr }] = await Promise.all([
    countQuery,
    applySort(dataQueryBase, sort),
  ]);
  if (countErr) throw new Error(`catalogue count failed: ${countErr.message}`);
  if (dataErr) throw new Error(`catalogue fetch failed: ${dataErr.message}`);

  const rows: CatalogueRow[] = (data || []) as unknown as CatalogueRow[];
  const total = count || 0;
  const basePath = `/catalogue`;

  return (
    <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl text-primary font-display">Catalogue</h1>
        <p className="text-sm text-muted mt-1">
          Complete catalogue of the {tenantDoc.name || tenant} collection. Click any column header to sort.
        </p>
      </div>

      <TenantCatalogueTable
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        sort={sort}
        basePath={basePath}
      />
    </div>
  );
}
