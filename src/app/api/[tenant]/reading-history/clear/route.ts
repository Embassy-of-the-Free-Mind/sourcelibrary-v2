import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { resolveTenantId } from '@/lib/tenant-context';

/**
 * POST /api/[tenant]/reading-history/clear — clear reading history
 * Body: { book_id?: string } — clear one book or all
 */
export const POST = withAuth(async (request, session, context) => {
  const { tenant } = await context.params;
  const tenantId = await resolveTenantId(tenant);

  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
  }

  const userId = session.user!.id as string;
  const body = await request.json().catch(() => ({}));
  const { book_id } = body as { book_id?: string };

  const db = await getDb();
  const filter: Record<string, string> = { user_id: userId, tenantId };
  if (book_id) filter.book_id = book_id;

  const result = await db.collection('reading_history').deleteMany(filter);

  return NextResponse.json({
    success: true,
    deleted: result.deletedCount,
  });
});
