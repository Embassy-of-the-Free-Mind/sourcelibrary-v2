import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createCronLogger } from '@/lib/cron-logger';

export const maxDuration = 120;
export const preferredRegion = 'fra1';
export const dynamic = 'force-dynamic';

/**
 * Nightly storage stats (issue #2972).
 *
 * Writes a snapshot of "how big is the library?" to system_config
 * (_id: 'storage_stats') and a dated entry to metrics_history:
 *  - Image bytes/objects: exact, from Cloudflare R2 analytics (~1s).
 *  - Text bytes: estimated as pages-collection logical size x a ratio
 *    calibrated against a full scan (scripts/storage-stats-fullscan.mjs
 *    re-measures and updates the seed; exact scan takes ~80 min so it
 *    can't run in a cron).
 *  - Book/page counts: single aggregation over books.
 */

// Fallback calibration from the 2026-07-04 full scan. The live seed is read
// from system_config.storage_stats.text_seed when present (written by
// scripts/storage-stats-fullscan.mjs).
const DEFAULT_TEXT_SEED = {
  measured_at: '2026-07-04T22:00:00Z',
  ocr_bytes: 21_101_759_643,
  translation_bytes: 16_866_086_800,
  pages_logical_bytes: 54_910_000_000,
};

interface TextSeed {
  measured_at: string;
  ocr_bytes: number;
  translation_bytes: number;
  pages_logical_bytes: number;
}

async function fetchR2Analytics(): Promise<
  { bucket: string; bytes: number; objects: number }[]
> {
  const since = new Date(Date.now() - 3 * 86400e3).toISOString();
  const query = `query { viewer { accounts(filter: {accountTag: "${process.env.R2_ACCOUNT_ID}"}) {
    r2StorageAdaptiveGroups(limit: 100, filter: {datetime_geq: "${since}"}) {
      max { payloadSize objectCount } dimensions { bucketName } } } } }`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CF_ANALYTICS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  const groups = json?.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups;
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error(`R2 analytics query failed: ${JSON.stringify(json?.errors || json).slice(0, 300)}`);
  }
  return groups.map((g: { dimensions: { bucketName: string }; max: { payloadSize: number; objectCount: number } }) => ({
    bucket: g.dimensions.bucketName,
    bytes: g.max.payloadSize,
    objects: g.max.objectCount,
  }));
}

export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const log = createCronLogger('storage-stats');
  try {
    const db = await getDb();

    const [r2, existing, bookAgg, collections] = await Promise.all([
      fetchR2Analytics().catch((e: Error) => {
        log.error(e.message, { phase: 'r2-analytics' });
        return null;
      }),
      db.collection('system_config').findOne({ _id: 'storage_stats' } as object),
      // All index-backed — a naive full $group scans 1.8 GB of book docs and
      // exceeds the lambda's 45s socket timeout under pipeline load.
      // Requires indexes: hidden_1, is_fully_translated_1, a visible-leading
      // index, and pages_sums_covered (all present as of 2026-07-05).
      (async () => {
        const books = db.collection('books');
        const [total, notVisible, fully_translated, sums] = await Promise.all([
          books.estimatedDocumentCount(),
          books.countDocuments({ $or: [{ hidden: true }, { visible: false }] }),
          books.countDocuments({ is_fully_translated: true }),
          books
            .aggregate(
              [
                { $project: { _id: 0, pages_count: 1, pages_ocr: 1, pages_translated: 1 } },
                {
                  $group: {
                    _id: null,
                    pages_total: { $sum: { $ifNull: ['$pages_count', 0] } },
                    pages_ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
                    pages_translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
                  },
                },
              ],
              { hint: 'pages_sums_covered' },
            )
            .toArray()
            .then((r) => r[0] as Record<string, number> | undefined),
        ]);
        return {
          total,
          visible: total - notVisible,
          fully_translated,
          pages_total: sums?.pages_total ?? 0,
          pages_ocr: sums?.pages_ocr ?? 0,
          pages_translated: sums?.pages_translated ?? 0,
        };
      })(),
      Promise.all(
        ['pages', 'chapter_texts', 'books'].map(async (c) => {
          const s = await db.command({ collStats: c });
          return [c, { docs: s.count, logical_bytes: s.size, on_disk_bytes: s.storageSize }] as const;
        }),
      ).then(Object.fromEntries),
    ]);

    // Text estimate: scale the seed's exact bytes by pages logical-size growth.
    const seed: TextSeed = existing?.text_seed || DEFAULT_TEXT_SEED;
    const pagesLogical = collections.pages.logical_bytes as number;
    const scale = pagesLogical / seed.pages_logical_bytes;
    const text = {
      ocr_bytes_est: Math.round(seed.ocr_bytes * scale),
      translation_bytes_est: Math.round(seed.translation_bytes * scale),
      method: 'seed-ratio',
      seed_measured_at: seed.measured_at,
    };

    const snapshot = {
      updatedAt: new Date(),
      r2,
      text,
      text_seed: seed,
      collections,
      books: bookAgg
        ? {
            total: bookAgg.total,
            visible: bookAgg.visible,
            fully_translated: bookAgg.fully_translated,
          }
        : null,
      pages: bookAgg
        ? {
            total: bookAgg.pages_total,
            ocr: bookAgg.pages_ocr,
            translated: bookAgg.pages_translated,
          }
        : null,
    };

    await db
      .collection('system_config')
      .updateOne({ _id: 'storage_stats' } as object, { $set: snapshot }, { upsert: true });
    log.action('system_config_updated');

    const date = new Date().toISOString().slice(0, 10);
    await db.collection('metrics_history').updateOne(
      { date },
      {
        $set: {
          date,
          storage: {
            r2_bytes: r2?.reduce((s, b) => s + b.bytes, 0) ?? null,
            r2_objects: r2?.reduce((s, b) => s + b.objects, 0) ?? null,
            text_bytes_est: text.ocr_bytes_est + text.translation_bytes_est,
            books_total: bookAgg?.total ?? null,
            books_visible: bookAgg?.visible ?? null,
            pages_total: bookAgg?.pages_total ?? null,
            pages_translated: bookAgg?.pages_translated ?? null,
          },
          storage_updated_at: new Date(),
        },
      },
      { upsert: true },
    );
    log.action('metrics_history_upserted');

    await log.flush();
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('storage-stats cron error:', error);
    log.error(msg);
    log.setFailed();
    await log.flush();
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
