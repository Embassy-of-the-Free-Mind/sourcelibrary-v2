import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { enrichEntity, type EnrichableEntity } from '@/lib/wikidata-enrichment';

export const maxDuration = 300;
export const preferredRegion = 'fra1';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/enrich-entities
 *
 * Offline Wikidata enrichment for person `entities` — keeps `portrait_url`,
 * `wikidata_birth_date`, and `wikidata_death_date` populated so author /
 * artist / encyclopedia pages stay a pure static read (they never call
 * Wikidata at render time).
 *
 * Each run processes a bounded batch (fits in maxDuration), preferring:
 *   1. never-enriched entities (no `wikidata_enriched_at`)
 *   2. then the stalest (refreshes the ~thousands with no P18/P569/P570 yet,
 *      in case Wikidata has since gained the data)
 *
 * Steady state is cheap — new entities arrive a few per day (and are also
 * enriched inline when an author is linked). The staleness sweep is what
 * slowly re-checks the long tail. Scheduled daily via vercel.json crons.
 */

const BATCH = 150;
const STALE_DAYS = 90;
const POLITE_DELAY_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET() {
  const db = await getDb();
  const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  const batch = (await db
    .collection('entities')
    .find(
      {
        type: 'person',
        wikidata_id: { $exists: true, $ne: null },
        $or: [
          { wikidata_enriched_at: { $exists: false } },
          { wikidata_enriched_at: { $lt: staleCutoff } },
        ],
      },
      {
        projection: {
          wikidata_id: 1,
          portrait_url: 1,
          wikidata_birth_date: 1,
          wikidata_death_date: 1,
          wikidata_enriched_at: 1,
        },
      },
    )
    // Missing field sorts first in ascending order → never-enriched go first.
    .sort({ wikidata_enriched_at: 1 })
    .limit(BATCH)
    .toArray()) as unknown as EnrichableEntity[];

  let checked = 0;
  let portraitsFixed = 0;
  let datesFixed = 0;
  let failed = 0;

  for (const entity of batch) {
    const result = await enrichEntity(db, entity);
    if (result.checked) {
      checked++;
      if (result.updated.includes('portrait_url')) portraitsFixed++;
      if (result.updated.includes('wikidata_birth_date')) datesFixed++;
    } else {
      failed++;
    }
    await sleep(POLITE_DELAY_MS);
  }

  return NextResponse.json({
    scanned: batch.length,
    checked,
    portraitsFixed,
    datesFixed,
    failed,
    note: batch.length < BATCH ? 'queue drained' : 'more remaining; next run continues',
  });
}
