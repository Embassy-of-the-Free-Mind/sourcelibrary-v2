import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { SUPABASE_URL } from '@/lib/supabase';
import { verifyCronAuth } from '@/lib/cron-auth';

export const maxDuration = 120;
export const preferredRegion = 'fra1';
export const dynamic = 'force-dynamic';

/**
 * Keep `bph_works.sl_book_id` (+ `sl_book_slug`) in sync with MongoDB.
 *
 * Background: the BPH catalogue UI's "Show digitised & translated" filter
 * relies on `bph_works.sl_book_id IS NOT NULL`. The link from a BPH UBN to a
 * Source Library book lives in MongoDB (`image_source.provider === 'bph'`
 * + `dublin_core.dc_identifier` == UBN). New digitised BPH books would
 * otherwise never appear in the filtered view until someone re-ran the
 * one-shot backfill script.
 *
 * This cron is the recurring half of that pair — see `scripts/backfill-bph-sl-book-ids.mjs`
 * (PR #1681) for the manual / first-time-backfill version. The logic here is
 * identical: PATCH bph_works SET sl_book_id=…, sl_book_slug=… WHERE ubn=UBN.
 * The PATCH is a no-op when the row is already linked correctly, so running
 * every 6 hours is cheap.
 *
 * Out of scope: BPH books imported via IIIF where `dc_identifier` is a manifest
 * URL rather than a numeric UBN. Those need a separate IIIF-URL → UBN resolver.
 *
 * Opt-out: setting `bph_catalog_link: false` on a book's MongoDB doc removes
 * it from the linkable set, so an unlink in Supabase persists across cron
 * runs. Used to set books aside for partner review without losing the
 * MongoDB record. Clear the flag to resume linking.
 */

const PARALLEL = 10;
// Bail out if we're close to the serverless timeout — better to log a partial
// run than to die mid-batch. The MongoDB read takes a few seconds and each
// chunk of 10 PATCH calls takes <1s in practice, so 2k books fits easily.
const TIME_BUDGET_MS = 110_000;

interface LinkableRow {
  ubn: string;
  id: string;
  slug: string;
}

function extractUbn(dcIdentifier: unknown): string | null {
  if (typeof dcIdentifier === 'string' && /^\d+$/.test(dcIdentifier)) return dcIdentifier;
  if (Array.isArray(dcIdentifier)) {
    for (const v of dcIdentifier) {
      if (typeof v === 'string' && /^\d+$/.test(v)) return v;
    }
  }
  return null;
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

  const db = await getDb();

  // Read all BPH books with a dc_identifier and project just the fields we need.
  // `bph_catalog_link: false` opts a book out of the sync (see header comment).
  // `visible: { $ne: false }` excludes hidden duplicates — otherwise dedupe
  // hides bounce back within 6h as the cron re-PATCHes their sl_book_id.
  const docs = await db
    .collection('books')
    .find(
      {
        'image_source.provider': 'bph',
        'dublin_core.dc_identifier': { $exists: true, $ne: '' },
        bph_catalog_link: { $ne: false },
        visible: { $ne: false },
      },
      { projection: { id: 1, slug: 1, 'dublin_core.dc_identifier': 1 }, maxTimeMS: 30_000 },
    )
    .toArray();

  const linkable: LinkableRow[] = [];
  let skippedNoUbn = 0;
  for (const d of docs) {
    const ubn = extractUbn((d as { dublin_core?: { dc_identifier?: unknown } }).dublin_core?.dc_identifier);
    if (!ubn) {
      skippedNoUbn++;
      continue;
    }
    const id = (d as { id?: string; _id?: unknown }).id;
    if (!id) continue;
    linkable.push({ ubn, id, slug: ((d as { slug?: string }).slug) || id });
  }

  let updated = 0;
  let notFound = 0;
  let failed = 0;
  let processed = 0;
  let timedOut = false;
  const errors: string[] = [];

  for (let i = 0; i < linkable.length; i += PARALLEL) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    const chunk = linkable.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      chunk.map(async (row) => {
        const url = `${SUPABASE_URL}/rest/v1/bph_works?ubn=eq.${encodeURIComponent(row.ubn)}`;
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
      processed++;
      if (r.status === 'fulfilled') {
        if (r.value > 0) updated++;
        else notFound++;
      } else {
        failed++;
        if (errors.length < 10) {
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          errors.push(`ubn=${chunk[j].ubn}: ${msg}`);
        }
      }
    }
  }

  const summary = {
    ok: true,
    total_bph_books: docs.length,
    linkable_count: linkable.length,
    skipped_no_ubn: skippedNoUbn,
    processed,
    updated,
    not_in_bph_works: notFound,
    failed,
    timed_out: timedOut,
    duration_ms: Date.now() - startedAt,
    errors: errors.length > 0 ? errors : undefined,
  };

  // Best-effort logging to cron_runs for dashboard visibility.
  try {
    await db.collection('cron_runs').insertOne({
      cron: 'sync-bph-sl-book-ids',
      timestamp: new Date(),
      duration_ms: summary.duration_ms,
      status: failed > 0 ? 'partial' : 'success',
      failed: false,
      actions: {
        total_bph_books: summary.total_bph_books,
        linkable: summary.linkable_count,
        updated,
        not_in_bph_works: notFound,
        failed,
        skipped_no_ubn: skippedNoUbn,
      },
      errors: errors.map((e) => ({ message: e })),
      error_count: errors.length,
      summary: timedOut
        ? `timed-out after ${processed}/${linkable.length} (updated=${updated})`
        : `synced ${linkable.length} BPH books (updated=${updated}, not-in-bph_works=${notFound}, failed=${failed})`,
    });
  } catch {
    // Non-critical — never let logging break the cron response.
  }

  return NextResponse.json(summary);
}
