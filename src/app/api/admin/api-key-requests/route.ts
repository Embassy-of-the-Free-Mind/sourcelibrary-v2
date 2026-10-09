import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { reviewKeyRequest } from '@/lib/dataset/api-key-review';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/admin/api-key-requests — List key requests
 *
 * Query: ?status=pending|approved|denied (default: pending)
 */
export const GET = withAdminAuth(async (request: NextRequest) => {
  const db = await getDb();
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';

  const requests = await db.collection('api_key_requests')
    .find({ status })
    .sort({ created_at: -1 })
    .toArray();

  return NextResponse.json({ requests, count: requests.length });
});

/**
 * POST /api/admin/api-key-requests — Approve or deny a request
 *
 * Body: {
 *   request_id: string,
 *   action: "approve" | "deny",
 *   tier?: DatasetTier,    // override requested tier (default: use what they asked for)
 *   notes?: string,        // optional admin notes
 * }
 *
 * On approve: mints the key and returns it (admin sends to requester).
 */
export const POST = withAdminAuth(async (request: NextRequest, session) => {
  const db = await getDb();
  const body = await request.json();
  const { request_id, action, tier, notes } = body;

  if (!request_id || !action) {
    return NextResponse.json(
      { error: 'request_id and action are required' },
      { status: 400 },
    );
  }

  if (action !== 'approve' && action !== 'deny') {
    return NextResponse.json(
      { error: 'action must be "approve" or "deny"' },
      { status: 400 },
    );
  }

  const result = await reviewKeyRequest(db, request_id, action, session.user?.email || 'admin', { tier, notes });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.code });
  if (result.status === 'denied') return NextResponse.json({ status: 'denied', request_id });

  return NextResponse.json({
    status: 'approved',
    request_id,
    key: result.key,
    prefix: result.prefix,
    tier: result.tier,
    name: result.name,
    email: result.email,
    message: result.emailed
      ? 'Key minted and emailed to the requester.'
      : 'Key minted. The email was NOT sent: copy the key to the requester yourself.',
  });
});
