/**
 * PRIOR ART: src/lib/pipeline-now.ts / src/lib/work-board.ts — read one ops_reports document a box pushes and hand it
 * to an admin page; copied here. The stage arithmetic and the blocker words are scripts/lib/batches.mjs, shared with
 * the pusher and its tests.
 *
 * Batches (v3#269): the document scripts/maintenance/batches-push.mjs writes hourly to ops_reports `batches:latest`.
 * /admin/pipeline/batches renders it and nothing else reads it. No query here but one findOne by _id.
 */
import { getDb } from '@/lib/mongodb';

export const BATCHES_DOC_ID = 'batches:latest';

export interface BatchLane { name: string; kind: 'gpu-route' | 'cron'; box: string | null; issue: number | null; state: 'on' | 'off' | 'queued'; why: string }
export interface BatchBook { id: string; title: string; pages: number; read: number; translated: number; live: boolean }
export interface BatchRow {
  key: string; kind: 'hold' | 'campaign' | 'contained'; name: string;
  books: number; pages: number; read: number; translated: number; public_books: number;
  images: { pages: number | null; as_of?: string; ms?: number; why?: string } | null;
  moved_24h: { read: number; translated: number };
  not_acquired: boolean;
  hold: {
    reason: string; issue: number | null; issue_repo: 'v2' | 'v3' | null; held_since: string | Date | null; release: string | null;
    release_when: { kind: string; ref: string | number; note?: string | null } | null; release_issue_state: string | null;
  } | null;
  issue: { repo: 'v2' | 'v3'; number: number; state: string | null } | null;
  /** First lines of the last three comments on the hold's issue, newest first. */
  recent: { at: string; url: string; first_line: string }[];
  campaigns: string[];
  lanes: BatchLane[];
  frames: { route: string; rule: string; books: number; pages_owed: number }[];
  decisions: { text: string; default: string | null; url: string | null; source: string; at?: string }[];
  members?: { reason: string; books: number; pages: number; issue: number | null; issue_repo: 'v2' | 'v3' | null }[];
  books_list: BatchBook[];
}
export interface BatchesDoc {
  _id: string; type: 'batches'; generated_at: string | Date; host: string; run_seconds: number;
  timings: Record<string, number>;
  sources: { routes: string; images_measured_this_run: number; image_budget_sec: number | null; held_books: number; hold_reasons: number };
  batches: BatchRow[]; errors: string[];
}

export async function getBatches(): Promise<BatchesDoc | null> {
  const db = await getDb();
  return (await db.collection('ops_reports').findOne({ _id: BATCHES_DOC_ID as never }, { projection: { image_cache: 0 } })) as unknown as BatchesDoc | null;
}
