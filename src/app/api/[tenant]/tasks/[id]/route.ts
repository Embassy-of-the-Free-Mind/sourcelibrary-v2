import { NextRequest, NextResponse } from 'next/server';
import { withContributorAuth } from '@/lib/auth-helpers';
import { effectiveCatalogRole, normalizeCatalogRole, canReviewCatalog } from '@/lib/catalog-role';
import { updateTask, deleteTask } from '@/lib/bph-tasks';
import { isTaskList, isTaskStatus } from '@/lib/bph-task-status';

/**
 * PATCH  /api/[tenant]/tasks/[id] — move a card, rename it, or change its list.
 * DELETE /api/[tenant]/tasks/[id] — remove a card.
 *
 * Deleting a card never touches the feedback it came from. The message stays
 * on the record; only our decision about it goes away.
 */

async function guard(session: unknown, context: { params?: Promise<Record<string, string>> } | undefined) {
  const params = await context?.params;
  const tenant = typeof params?.tenant === 'string' ? params.tenant : null;
  const id = typeof params?.id === 'string' ? params.id : null;
  if (!tenant || !id) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };

  const user = (session as { user?: { email?: string | null; role?: unknown } } | null)?.user;
  const role = await effectiveCatalogRole(user?.email, normalizeCatalogRole(user?.role), tenant);
  if (!canReviewCatalog(role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { tenant, id };
}

export const PATCH = withContributorAuth(async (request: NextRequest, session, context) => {
  const g = await guard(session, context);
  if (g.error) return g.error;

  try {
    const body = await request.json();
    const patch: Parameters<typeof updateTask>[2] = {};
    if (typeof body.title === 'string') patch.title = body.title;
    if (body.body !== undefined) patch.body = typeof body.body === 'string' ? body.body : null;
    if (isTaskList(body.list)) patch.list = body.list;
    if (isTaskStatus(body.status)) patch.status = body.status;
    if (typeof body.position === 'number' && Number.isFinite(body.position)) {
      patch.position = body.position;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const task = await updateTask(g.tenant!, g.id!, patch);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json({ task });
  } catch (error) {
    console.error('[tasks] update failed:', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
});

export const DELETE = withContributorAuth(async (_request: NextRequest, session, context) => {
  const g = await guard(session, context);
  if (g.error) return g.error;

  try {
    const ok = await deleteTask(g.tenant!, g.id!);
    if (!ok) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[tasks] delete failed:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
});
