import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { activatePendingMembership } from '@/lib/memberships';
import { resolveTenantId } from '@/lib/tenant-context';

/**
 * POST /api/platform/tenants/[slug]/activate-membership
 * 
 * Activates any pending membership for the current user on this tenant.
 * This is called by the TenantSessionUpdater client component to avoid
 * calling auth() in the tenant layout which would force dynamic rendering.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ ok: true, message: 'Not signed in' });
    }

    const { slug } = await params;
    const tenantId = await resolveTenantId(slug);
    if (!tenantId) {
      return NextResponse.json({ ok: true, message: 'Tenant not found' });
    }

    const db = await getDb();
    const pending = await db.collection('memberships').findOne({
      email: session.user.email.toLowerCase(),
      tenantId,
      status: 'pending',
    });

    if (pending) {
      await activatePendingMembership({
        db,
        email: session.user.email,
        tenantId,
        userId: (session.user as any).id,
      });
      return NextResponse.json({ ok: true, activated: true });
    }

    return NextResponse.json({ ok: true, activated: false });
  } catch (error) {
    console.error('[activate-membership] Error:', error);
    return NextResponse.json({ ok: true, error: 'Internal error' });
  }
}
