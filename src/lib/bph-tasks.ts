import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { isTaskStatus, isTaskList, type TaskStatus, type TaskList } from '@/lib/bph-task-status';

/**
 * The BPH task board.
 *
 * Lives in Mongo, in `bph_feedback_tasks`, next to `feedback` rather than
 * beside the catalogue in Supabase. The only join that matters is task →
 * feedback, and both sides being Mongo keeps that a single lookup. It also
 * needs no SQL migration: an index creation is the whole schema change.
 *
 * A task is NEVER the feedback row itself. Feedback is an append-only record
 * of what someone said, and it is untrusted input (CLAUDE.md, "User
 * Feedback"); a task is our decision about it. Promoting feedback copies a
 * title across and keeps `feedback_id` as a link, mirroring how
 * `bph_works_pending_changes` proposes against a record without mutating it.
 */

export const TASKS_COLLECTION = 'bph_feedback_tasks';

export interface BphTask {
  id: string;
  tenant_slug: string;
  feedback_id: string | null;
  title: string;
  body: string | null;
  list: TaskList;
  status: TaskStatus;
  position: number;
  created_by: string;
  created_at: string | null;
  updated_at: string | null;
  shipped_at: string | null;
}

function toTask(row: Record<string, unknown>): BphTask {
  const iso = (v: unknown) =>
    v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null;
  return {
    id: String(row._id ?? ''),
    tenant_slug: typeof row.tenant_slug === 'string' ? row.tenant_slug : '',
    feedback_id: row.feedback_id ? String(row.feedback_id) : null,
    title: typeof row.title === 'string' ? row.title : '',
    body: typeof row.body === 'string' ? row.body : null,
    list: isTaskList(row.list) ? row.list : 'librarian',
    status: isTaskStatus(row.status) ? row.status : 'new',
    position: typeof row.position === 'number' ? row.position : 0,
    created_by: typeof row.created_by === 'string' ? row.created_by : '',
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    shipped_at: iso(row.shipped_at),
  };
}

/**
 * Every read is scoped to a tenant. There is no unscoped list function on
 * purpose — a missing filter here would show one partner another's board.
 */
export async function listTasks(tenant: string): Promise<BphTask[]> {
  const db = await getDb();
  const rows = await db
    .collection(TASKS_COLLECTION)
    .find({ tenant_slug: tenant })
    .sort({ position: 1, created_at: 1 })
    .limit(500)
    .toArray();
  return rows.map(toTask);
}

export async function createTask(input: {
  tenant: string;
  title: string;
  body?: string | null;
  list?: TaskList;
  status?: TaskStatus;
  feedbackId?: string | null;
  createdBy: string;
}): Promise<BphTask> {
  const db = await getDb();
  const col = db.collection(TASKS_COLLECTION);

  // New cards land at the top of their column. Reading the current minimum is
  // cheaper than renumbering, and matches the fractional scheme.
  const lowest = await col
    .find({ tenant_slug: input.tenant })
    .sort({ position: 1 })
    .limit(1)
    .toArray();
  const position = lowest.length ? Number(lowest[0].position ?? 0) - 1000 : 1000;

  const now = new Date();
  const doc = {
    tenant_slug: input.tenant,
    feedback_id: input.feedbackId ? new ObjectId(input.feedbackId) : null,
    title: input.title.trim().slice(0, 300),
    body: input.body?.trim() ? input.body.trim().slice(0, 5000) : null,
    list: input.list ?? 'librarian',
    status: input.status ?? 'new',
    position,
    created_by: input.createdBy,
    created_at: now,
    updated_at: now,
    shipped_at: null as Date | null,
  };
  const res = await col.insertOne(doc);
  return toTask({ ...doc, _id: res.insertedId });
}

export async function updateTask(
  tenant: string,
  id: string,
  patch: {
    title?: string;
    body?: string | null;
    list?: TaskList;
    status?: TaskStatus;
    position?: number;
  }
): Promise<BphTask | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();

  const set: Record<string, unknown> = { updated_at: new Date() };
  if (typeof patch.title === 'string') set.title = patch.title.trim().slice(0, 300);
  if (patch.body !== undefined) set.body = patch.body?.trim() ? patch.body.trim().slice(0, 5000) : null;
  if (patch.list) set.list = patch.list;
  if (typeof patch.position === 'number') set.position = patch.position;
  if (patch.status) {
    set.status = patch.status;
    // shipped_at is set on the way in and cleared on the way out, so a card
    // moved back out of Done doesn't keep a completion date.
    set.shipped_at = patch.status === 'shipped' ? new Date() : null;
  }

  const res = await db
    .collection(TASKS_COLLECTION)
    // tenant is part of the filter, not just the lookup: an id from another
    // tenant must not be updatable by guessing it.
    .findOneAndUpdate(
      { _id: new ObjectId(id), tenant_slug: tenant },
      { $set: set },
      { returnDocument: 'after' }
    );
  return res ? toTask(res as Record<string, unknown>) : null;
}

export async function deleteTask(tenant: string, id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDb();
  const res = await db
    .collection(TASKS_COLLECTION)
    .deleteOne({ _id: new ObjectId(id), tenant_slug: tenant });
  return res.deletedCount === 1;
}

/** Feedback ids that already have a card, so the UI can say "on the board". */
export async function promotedFeedbackIds(tenant: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .collection(TASKS_COLLECTION)
    .find({ tenant_slug: tenant, feedback_id: { $ne: null } })
    .project({ feedback_id: 1 })
    .toArray();
  return rows.map((r) => String(r.feedback_id));
}
