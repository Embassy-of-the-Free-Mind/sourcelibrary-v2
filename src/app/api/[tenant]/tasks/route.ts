import { NextRequest, NextResponse } from 'next/server';
import { withContributorAuth } from '@/lib/auth-helpers';
import { effectiveCatalogRole, normalizeCatalogRole, canReviewCatalog } from '@/lib/catalog-role';
import { listTasks, createTask } from '@/lib/bph-tasks';
import { isTaskList, isTaskStatus } from '@/lib/bph-task-status';

/**
 * GET  /api/[tenant]/tasks — the board.
 * POST /api/[tenant]/tasks — add a card, optionally promoted from feedback.
 *
 * Editor+ only, re-resolved against this tenant. `withContributorAuth` is the
 * outer gate (signed in at all); the per-tenant check is the one that matters,
 * because a contributor on the global site is not a BPH librarian.
 */

async function tenantRole(session: unknown, tenant: string) {
  const user = (session as { user?: { email?: string | null; role?: unknown } } | null)?.user;
  return effectiveCatalogRole(user?.email, normalizeCatalogRole(user?.role), tenant);
}

export const GET = withContributorAuth(async (_request: NextRequest, session, context) => {
  const params = await context?.params;
  const tenant = typeof params?.tenant === 'string' ? params.tenant : null;
  if (!tenant) return NextResponse.json({ error: 'Unknown tenant' }, { status: 404 });

  const role = await tenantRole(session, tenant);
  if (!canReviewCatalog(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    return NextResponse.json({ tasks: await listTasks(tenant) });
  } catch (error) {
    console.error('[tasks] list failed:', error);
    return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 });
  }
});

export const POST = withContributorAuth(async (request: NextRequest, session, context) => {
  const params = await context?.params;
  const tenant = typeof params?.tenant === 'string' ? params.tenant : null;
  if (!tenant) return NextResponse.json({ error: 'Unknown tenant' }, { status: 404 });

  const role = await tenantRole(session, tenant);
  if (!canReviewCatalog(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return NextResponse.json({ error: 'A title is required' }, { status: 400 });
    }

    const task = await createTask({
      tenant,
      title,
      body: typeof body.body === 'string' ? body.body : null,
      list: isTaskList(body.list) ? body.list : undefined,
      status: isTaskStatus(body.status) ? body.status : undefined,
      feedbackId: typeof body.feedbackId === 'string' ? body.feedbackId : null,
      createdBy: session.user?.email || 'unknown',
    });
    return NextResponse.json({ task });
  } catch (error) {
    console.error('[tasks] create failed:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
});
