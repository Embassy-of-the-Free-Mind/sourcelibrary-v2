import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { generateApiKey, listApiKeys, revokeApiKey } from '@/lib/dataset/api-keys';
import { DatasetTier, DATASET_TIERS } from '@/lib/dataset/types';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/admin/api-keys — List all API keys (admin view)
 *
 * Query params:
 *   ?user_id=... — filter by user
 *   ?status=active|revoked — filter by status
 */
export const GET = withAdminAuth(async (request: NextRequest) => {
  const db = await getDb();
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  const status = url.searchParams.get('status');

  const filter: Record<string, any> = {};
  if (userId) filter.user_id = userId;
  if (status) filter.status = status;

  const keys = await db.collection('api_keys')
    .find(filter)
    .project({ key_hash: 0 })
    .sort({ created_at: -1 })
    .toArray();

  return NextResponse.json({ keys, count: keys.length });
});

/**
 * POST /api/admin/api-keys — Mint an API key for a partner
 *
 * Body: {
 *   name: string,          // e.g. "Paul Dijstelberge — Embassy of the Free Mind"
 *   user_id: string,       // identifier for the partner (email or slug)
 *   tier: DatasetTier,     // "explorer" | "language" | "domain" | "full" | "enterprise"
 *   languages?: string[],  // for "language" tier — which languages
 *   clusters?: string[],   // for "domain" tier — which clusters
 * }
 */
export const POST = withAdminAuth(async (request: NextRequest) => {
  const body = await request.json();
  const { name, user_id, tier, languages, clusters } = body;

  if (!name || !user_id) {
    return NextResponse.json(
      { error: 'name and user_id are required' },
      { status: 400 }
    );
  }

  const selectedTier: DatasetTier = tier || 'full';
  if (!DATASET_TIERS[selectedTier]) {
    return NextResponse.json(
      { error: `Invalid tier. Valid: ${Object.keys(DATASET_TIERS).join(', ')}` },
      { status: 400 }
    );
  }

  const { key, doc } = await generateApiKey(user_id, selectedTier, name, {
    languages,
    clusters,
  });

  return NextResponse.json({
    key, // Only shown once — save it now
    id: doc._id,
    prefix: doc.key_prefix,
    name: doc.name,
    user_id: doc.user_id,
    tier: doc.tier,
    permissions: doc.permissions,
    rate_limit: doc.rate_limit,
    created_at: doc.created_at,
    message: 'Save this key — it will not be shown again.',
  }, { status: 201 });
});

/**
 * DELETE /api/admin/api-keys — Revoke any API key (admin override)
 *
 * Body: { key_id: string }
 */
export const DELETE = withAdminAuth(async (request: NextRequest) => {
  const body = await request.json();
  if (!body.key_id) {
    return NextResponse.json({ error: 'key_id required' }, { status: 400 });
  }

  const db = await getDb();
  const result = await db.collection('api_keys').updateOne(
    { _id: body.key_id as any },
    { $set: { status: 'revoked' } }
  );

  if (result.modifiedCount === 0) {
    return NextResponse.json(
      { error: 'Key not found or already revoked' },
      { status: 404 }
    );
  }

  return NextResponse.json({ revoked: true });
});
