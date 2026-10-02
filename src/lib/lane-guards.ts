/**
 * PRIOR ART: scripts/lib/pipeline-hold.mjs (`NOT_HELD`, `holdViolation`) — the hold marker and the
 * status-writer guard, used by the workers; it has no TS twin and no API route reads it.
 * scripts/workers/lib/selective-unpause.mjs (`shouldBypassPause`) — the workers' pause test. Neither
 * records that an admin click acted on a held book or during a pause.
 *
 * assertLaneGuards — the shared hold/pause check for the API routes that do pipeline work on a click
 * (#5480; registry: scripts/lib/lanes.mjs, lane `admin-api`). OBSERVE MODE: it never refuses. When a
 * call touches a held book, or runs while `processing_control.paused` / `paused_phases` is set, it
 * writes ONE `audit_log` row (`action: 'lane_guard_observed'`) and returns what it saw. Refusing would
 * change which books an admin click acts on, which #5480 rules out; the rows are the evidence for that
 * decision. It never throws: a guard that breaks the click it observes is worse than no guard.
 */
import type { Db } from 'mongodb';

export const LANE_GUARD_ACTION = 'lane_guard_observed';
const MAX_IDS = 500;

export interface LaneGuardObservation {
  held: { id: string; reason: string | null; issue: number | null }[];
  paused: boolean;
  pausedPhases: unknown[];
}

export async function assertLaneGuards(
  db: Db,
  { route, bookIds = [], pageIds = [], actor }: { route: string; bookIds?: string[]; pageIds?: string[]; actor?: string },
): Promise<LaneGuardObservation> {
  const seen: LaneGuardObservation = { held: [], paused: false, pausedPhases: [] };
  try {
    const ids = new Set(bookIds.filter(Boolean).slice(0, MAX_IDS));
    const pages = pageIds.filter(Boolean).slice(0, MAX_IDS);
    if (pages.length) {
      const rows = await db.collection('pages').find({ id: { $in: pages } }, { projection: { book_id: 1 } }).toArray();
      for (const p of rows) if (p.book_id) ids.add(String(p.book_id));
    }
    const [held, control] = await Promise.all([
      ids.size
        ? db.collection('books').find({ id: { $in: [...ids] }, 'pipeline_auto.hold': { $exists: true } },
          { projection: { id: 1, 'pipeline_auto.hold.reason': 1, 'pipeline_auto.hold.issue': 1 } }).toArray()
        : Promise.resolve([]),
      // processing_control is a string _id; the driver's typing wants an ObjectId.
      db.collection('system_config').findOne({ _id: 'processing_control' as never }, { projection: { paused: 1, paused_phases: 1 } }),
    ]);
    seen.held = held.map((b) => ({ id: String(b.id), reason: b.pipeline_auto?.hold?.reason ?? null, issue: b.pipeline_auto?.hold?.issue ?? null }));
    seen.paused = !!control?.paused;
    seen.pausedPhases = Array.isArray(control?.paused_phases) ? control.paused_phases : [];
    if (seen.held.length || seen.paused || seen.pausedPhases.length) {
      await db.collection('audit_log').insertOne({
        timestamp: new Date(),
        action: LANE_GUARD_ACTION,
        route,
        actor: actor ?? null,
        mode: 'observe',
        book_ids: [...ids].slice(0, 50),
        held: seen.held.slice(0, 50),
        held_count: seen.held.length,
        paused: seen.paused,
        paused_phases: seen.pausedPhases,
      });
    }
  } catch (e) {
    console.warn(`[lane-guards] ${route}: observe failed — ${e instanceof Error ? e.message : String(e)}`);
  }
  return seen;
}
