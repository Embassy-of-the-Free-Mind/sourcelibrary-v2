/**
 * Work record (/admin/laura): one person's Source Library work, for the team.
 *
 * Renderer only. This repo is public, so the record itself (unfinished work, local prototypes, open
 * decisions) is NOT in it: it lives in one ops_reports document, the pattern src/lib/work-board.ts and
 * src/lib/quality-report.ts follow. The document is built and pushed from outside the repo, and an
 * update needs no deploy.
 */
import { getDb } from '@/lib/mongodb';

export type WorkStatus = 'live' | 'waiting' | 'shelved' | 'local';

export interface WorkItem {
  title: string;
  status: WorkStatus;
  /** What it is, in words anyone on the team can follow. */
  what: string;
  /** What someone working near this needs to know. */
  team?: string;
  /** Unfinished work: what has to happen next. */
  next?: string;
  when?: string;
  /** ISO date of the last real work, for sorting. */
  date: string;
  tags: string[];
  href?: string;
  prs?: number[];
  /** Screenshot as a data URI, so unreleased work gets no public URL. */
  image?: string;
}

export interface WorkPr {
  n: number;
  title: string;
  state: 'merged' | 'open' | 'closed';
  date: string;
}

export interface WorkRecord {
  name: string;
  updated: string;
  intro: string;
  items: WorkItem[];
  prs: WorkPr[];
  limits: string[];
}

interface WorkRecordDoc {
  _id: string;
  type: 'work-record';
  record: WorkRecord;
}

export const WORK_RECORD_TYPE = 'work-record';

export async function getWorkRecord(person: string): Promise<WorkRecord | null> {
  const db = await getDb();
  const doc = await db
    .collection<WorkRecordDoc>('ops_reports')
    .findOne({ _id: `${WORK_RECORD_TYPE}:${person}`, type: WORK_RECORD_TYPE });
  return doc?.record ?? null;
}
