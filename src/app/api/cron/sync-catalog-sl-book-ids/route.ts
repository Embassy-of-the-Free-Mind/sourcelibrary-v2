import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { SUPABASE_URL } from '@/lib/supabase';
import { verifyCronAuth } from '@/lib/cron-auth';
import { LIBRARY_PARTNERS } from '@/lib/library-partners';

export const maxDuration = 120;
export const preferredRegion = 'fra1';
export const dynamic = 'force-dynamic';

/**
 * Keep `library_catalog_records.sl_book_id` (+ `sl_book_slug`) in sync with
 * MongoDB for every tenant whose partner record has `hasUnifiedCatalogue:
 * true`. The catalogue UI's digitised filter depends on `sl_book_id IS NOT
 * NULL`, so newly digitised books would otherwise only show up after a
 * manual ETL re-run.
 *
 * Per tenant, the join key is the catalogue record's `catalog_id` matched
 * against `books.image_source.identifier` (e.g. priref for Kloss). The
 * PATCH is a no-op when the row is already linked, so the 6-hourly schedule
 * is cheap.
 *
 * BPH stays on `/api/cron/sync-bph-sl-book-ids` — it has its own `bph_works`
 * table and different join key (`dublin_core.dc_identifier`).
 */

const PARALLEL = 10;
const TIME_BUDGET_MS = 110_000;

interface LinkableRow {
  tenant: string;
  catalog_id: string;
  id: string;
  slug: string;
}

interface TenantSummary {
  tenant: string;
  provider: string;
  total_books: number;
  linkable: number;
  updated: number;
  not_in_catalog: number;
  failed: number;
}

export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const startedAt = Date.now();
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseKey) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' },
      { status: 500 },
    );
  }

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  // All tenants opted into the unified catalogue. BPH stays out — it has its
  // own bph_works table and its own cron.
  const tenants = Object.values(LIBRARY_PARTNERS).filter(
    p => p.hasUnifiedCatalogue && p.providerKey !== 'bph',
  );

  const db = await getDb();
  const tenantSummaries: TenantSummary[] = [];
  const errors: string[] = [];
  let timedOut = false;

  for (const partner of tenants) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    // Pull every book scoped to this tenant's provider, projecting just what
    // we need to join + PATCH. `catalog_link: false` is the opt-out flag
    // (parallels BPH's `bph_catalog_link`) — set on a book doc to keep an
    // unlink from getting reapplied on the next cron run.
    const docs = await db
      .collection('books')
      .find(
        {
          'image_source.provider': partner.providerKey,
          'image_source.identifier': { $exists: true, $ne: '' },
          catalog_link: { $ne: false },
          visible: { $ne: false },
        },
        { projection: { id: 1, slug: 1, 'image_source.identifier': 1 }, maxTimeMS: 30_000 },
      )
      .toArray();

    const linkable: LinkableRow[] = [];
    for (const d of docs as unknown as Array<{
      id?: string;
      slug?: string;
      image_source?: { identifier?: string | number };
    }>) {
      const ident = d.image_source?.identifier;
      const id = d.id;
      if (ident === undefined || ident === null || !id) continue;
      linkable.push({
        tenant: partner.slug,
        catalog_id: String(ident),
        id,
        slug: d.slug || id,
      });
    }

    let updated = 0;
    let notFound = 0;
    let failed = 0;

    for (let i = 0; i < linkable.length; i += PARALLEL) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        timedOut = true;
        break;
      }
      const chunk = linkable.slice(i, i + PARALLEL);
      const results = await Promise.allSettled(
        chunk.map(async (row) => {
          const url = `${SUPABASE_URL}/rest/v1/library_catalog_records` +
            `?tenant_id=eq.${encodeURIComponent(row.tenant)}` +
            `&catalog_id=eq.${encodeURIComponent(row.catalog_id)}`;
          const res = await fetch(url, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ sl_book_id: row.id, sl_book_slug: row.slug }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) {
            throw new Error(`${res.status} ${await res.text()}`);
          }
          const body = (await res.json()) as unknown;
          return Array.isArray(body) ? body.length : 0;
        }),
      );

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === 'fulfilled') {
          if (r.value > 0) updated++;
          else notFound++;
        } else {
          failed++;
          if (errors.length < 10) {
            const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
            errors.push(`${partner.slug}/${chunk[j].catalog_id}: ${msg}`);
          }
        }
      }
    }

    tenantSummaries.push({
      tenant: partner.slug,
      provider: partner.providerKey,
      total_books: docs.length,
      linkable: linkable.length,
      updated,
      not_in_catalog: notFound,
      failed,
    });

    if (timedOut) break;
  }

  const totals = tenantSummaries.reduce(
    (acc, t) => ({
      total_books: acc.total_books + t.total_books,
      linkable: acc.linkable + t.linkable,
      updated: acc.updated + t.updated,
      not_in_catalog: acc.not_in_catalog + t.not_in_catalog,
      failed: acc.failed + t.failed,
    }),
    { total_books: 0, linkable: 0, updated: 0, not_in_catalog: 0, failed: 0 },
  );

  const summary = {
    ok: true,
    tenants: tenantSummaries,
    ...totals,
    timed_out: timedOut,
    duration_ms: Date.now() - startedAt,
    errors: errors.length > 0 ? errors : undefined,
  };

  try {
    await db.collection('cron_runs').insertOne({
      cron: 'sync-catalog-sl-book-ids',
      timestamp: new Date(),
      duration_ms: summary.duration_ms,
      status: totals.failed > 0 ? 'partial' : 'success',
      failed: false,
      actions: {
        tenants: tenantSummaries.length,
        ...totals,
      },
      errors: errors.map((e) => ({ message: e })),
      error_count: errors.length,
      summary: timedOut
        ? `timed-out (updated=${totals.updated})`
        : `synced ${tenantSummaries.length} tenants (linkable=${totals.linkable}, updated=${totals.updated}, not-in-catalog=${totals.not_in_catalog}, failed=${totals.failed})`,
    });
  } catch {
    // Non-critical.
  }

  return NextResponse.json(summary);
}
