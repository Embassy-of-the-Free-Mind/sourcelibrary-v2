/**
 * Server-side read for /admin/tokens (#8201). Kept apart from token-usage.ts so the client charts
 * can import the pure rules without pulling the database driver into the browser bundle.
 *
 * PRIOR ART: src/lib/token-usage.ts — the pure rules this feeds, and it must stay free of this import.
 */
import { getDb } from '@/lib/mongodb';
import { OPS_REPORTS_COLLECTION } from '@/lib/spend-report';
import type { MeterDoc, UsageDoc } from '@/lib/token-usage';

export async function getTokenUsage(): Promise<{ docs: UsageDoc[]; meters: MeterDoc[] }> {
  const reports = (await getDb()).collection(OPS_REPORTS_COLLECTION);
  const [docs, meters] = await Promise.all([
    reports.find({ type: 'token-usage' }).toArray(),
    reports.find({ type: 'token-usage-meter' }).toArray(),
  ]);
  return { docs: docs as unknown as UsageDoc[], meters: meters as unknown as MeterDoc[] };
}
