import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { generateApiKey } from '@/lib/dataset/api-keys';
import { DatasetTier, DATASET_TIERS } from '@/lib/dataset/types';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

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

  let objectId: ObjectId;
  try {
    objectId = new ObjectId(request_id);
  } catch {
    return NextResponse.json({ error: 'Invalid request_id' }, { status: 400 });
  }

  const keyRequest = await db.collection('api_key_requests').findOne({
    _id: objectId,
    status: 'pending',
  });

  if (!keyRequest) {
    return NextResponse.json(
      { error: 'Request not found or already reviewed' },
      { status: 404 },
    );
  }

  const reviewedBy = session.user?.email || 'admin';

  if (action === 'deny') {
    await db.collection('api_key_requests').updateOne(
      { _id: objectId },
      {
        $set: {
          status: 'denied',
          reviewed_at: new Date(),
          reviewed_by: reviewedBy,
          notes: notes || null,
        },
      },
    );
    return NextResponse.json({ status: 'denied', request_id });
  }

  // Approve — mint the key
  const selectedTier: DatasetTier = tier || keyRequest.requested_tier || 'full';
  if (!DATASET_TIERS[selectedTier]) {
    return NextResponse.json(
      { error: `Invalid tier: ${selectedTier}` },
      { status: 400 },
    );
  }

  const keyName = keyRequest.organization
    ? `${keyRequest.name} — ${keyRequest.organization}`
    : keyRequest.name;

  const { key, doc } = await generateApiKey(
    keyRequest.email,
    selectedTier,
    keyName,
  );

  await db.collection('api_key_requests').updateOne(
    { _id: objectId },
    {
      $set: {
        status: 'approved',
        reviewed_at: new Date(),
        reviewed_by: reviewedBy,
        approved_tier: selectedTier,
        api_key_prefix: doc.key_prefix,
        notes: notes || null,
      },
    },
  );

  return NextResponse.json({
    status: 'approved',
    request_id,
    key, // Admin copies this and sends to the requester
    prefix: doc.key_prefix,
    tier: selectedTier,
    name: keyName,
    email: keyRequest.email,
    message: 'Key minted. Send it to the requester — it cannot be retrieved again.',
  });
});
