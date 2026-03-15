import { getDb } from '@/lib/mongodb';
import { DatasetAccessLog } from './types';

const COLLECTION = 'dataset_access_log';
const DAILY_COLLECTION = 'dataset_usage_daily';

/** Log a dataset API access event (EU AI Act compliance) */
export async function logAccess(entry: DatasetAccessLog): Promise<void> {
  const db = await getDb();

  // Fire-and-forget — don't block the API response
  Promise.all([
    db.collection(COLLECTION).insertOne(entry),
    incrementDailyUsage(
      entry.api_key_id,
      entry.records_returned
    ),
  ]).catch(err => console.error('[dataset] access log failed:', err));
}

/** Check daily page usage for rate limiting */
export async function getDailyPageCount(apiKeyId: string): Promise<number> {
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const doc = await db.collection(DAILY_COLLECTION).findOne({
    _id: `${apiKeyId}:${today}` as any,
  });
  return doc?.pages_served ?? 0;
}

async function incrementDailyUsage(
  apiKeyId: any,
  pagesServed: number
): Promise<void> {
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);

  await db.collection(DAILY_COLLECTION).updateOne(
    { _id: `${apiKeyId}:${today}` as any },
    {
      $inc: { requests: 1, pages_served: pagesServed },
      $setOnInsert: {
        api_key_id: apiKeyId,
        date: new Date(today),
      },
    },
    { upsert: true }
  );
}
