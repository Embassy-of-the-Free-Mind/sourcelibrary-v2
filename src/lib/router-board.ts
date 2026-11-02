/**
 * PRIOR ART: src/lib/work-board.ts / src/lib/pipeline-now.ts — read ops_reports documents pushed from a box for an
 * admin page (the pattern followed). Neither knows the router table.
 *
 * Router board (/admin/router, #7913): per router cell, the route production runs against the route the router
 * decided, with the evidence behind the decision. The one document is written hourly by
 * scripts/maintenance/router-board-push.mjs (router-table-drift.mjs's data plus each cell's evidence). Read-only:
 * nothing but the page consumes it.
 */
import { getDb } from '@/lib/mongodb';

export const ROUTER_BOARD_TYPE = 'router-board';
export const ROUTER_BOARD_ID = 'router-board:latest';
/** The pusher runs hourly; older than this and the page says so in red: a dead pusher must not look like a calm table. */
export const ROUTER_BOARD_STALE_MIN = 150;

export type CellStatus = 'mismatch' | 'unshipped' | 'waived' | 'served' | 'stored' | 'undecided' | 'idle';

export interface CellLane {
  box: string; lane: string; runs: string; runs_kn: string | null; status: string;
  schedule: string; comment: string; waiver_until?: string;
}
export interface CellEvidence {
  route: string; k_of_n: string | null; n: number | null; n_eff: number | null; accept_mean: number | null;
  wrong_text_pages: string | null;
  defects: { books: number; words: number; misleads_per_1k: number | null; wrong_text_per_1k: number | null } | null;
}
export interface RouterCell {
  cell: string; title: string | null; status: CellStatus;
  decision: string; decision_label: string; route: string; table: string; decided_set: string | null;
  evidence: CellEvidence | null;
  judge: { stratum: string; valid: boolean | null } | null;
  pages_waiting: number;
  lanes: CellLane[]; production: string[];
  waivers: { lane: string | null; set: string; until: string; live: boolean; reason: string }[];
  routing_row: boolean;
}
export interface RouterBoardDoc {
  _id: string; type: typeof ROUTER_BOARD_TYPE; generated_at: Date | string; commit: string | null;
  as_of: string; table: string; pointer_set: string | null; crontabs: string[];
  tally: Partial<Record<CellStatus, { cells: number; pages_waiting: number }>>;
  routing_tables: { file: string; as_of: string | null; changed: string | null; days_behind_pointer: number | null }[];
  cells: RouterCell[];
}

export async function getRouterBoard(): Promise<RouterBoardDoc | null> {
  const db = await getDb();
  return (await db.collection('ops_reports').findOne({ _id: ROUTER_BOARD_ID as never })) as unknown as RouterBoardDoc | null;
}

/** Minutes since the push, or null without one. */
export function ageMin(doc: Pick<RouterBoardDoc, 'generated_at'> | null, now: Date = new Date()): number | null {
  if (!doc?.generated_at) return null;
  const t = new Date(doc.generated_at).getTime();
  return Number.isFinite(t) ? Math.round((now.getTime() - t) / 60000) : null;
}

/** The decided cells (what the drift audit grades) and the rest (undecided, with lanes or pages waiting). */
export function splitCells(cells: RouterCell[]): { decided: RouterCell[]; undecided: RouterCell[] } {
  return { decided: cells.filter((c) => c.status !== 'undecided'), undecided: cells.filter((c) => c.status === 'undecided') };
}

/** Days from `today` (YYYY-MM-DD) to a waiver's `until`; negative = expired. */
export function daysLeft(until: string, today: string): number {
  return Math.round((Date.parse(until) - Date.parse(today)) / 864e5);
}
