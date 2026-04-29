import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/tenants/[id]/pending-invite?email=user@example.com
 * Check if an email has a pending membership invitation for this tenant
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase();

  if (!email) {
    return NextResponse.json({ error: 'email parameter required' }, { status: 400 });
  }

  try {
    const db = await getDb();
    // Match both 'pending' (first sign-in) and 'active' (returning member).
    // Checking only 'pending' locked out members whose invite was already
    // activated on their first sign-in.
    const membership = await db.collection('memberships').findOne({
      email,
      tenantId,
      status: { $in: ['pending', 'active'] },
    });

    if (membership) {
      return NextResponse.json({ hasPendingInvite: true });
    }

    return NextResponse.json({ hasPendingInvite: false }, { status: 404 });
  } catch (error) {
    console.error('[pending-invite] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
