import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { generateApiKey, listApiKeys, revokeApiKey } from '@/lib/dataset/api-keys';
import { DatasetTier, DATASET_TIERS } from '@/lib/dataset/types';

/**
 * GET /api/dataset/v1/keys — List API keys for the authenticated user
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const keys = await listApiKeys(session.user.id);
  return NextResponse.json({ keys });
}

/**
 * POST /api/dataset/v1/keys — Generate a new API key
 *
 * Body: { name: string, tier?: DatasetTier, languages?: string[], clusters?: string[] }
 *
 * For paid tiers, the tier is determined by the user's active subscription.
 * For the explorer tier, anyone can self-serve.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json();
  const name = body.name || 'Default';

  // For now, anyone authenticated can create an explorer key.
  // Paid tiers will be gated by Stripe subscription (handled in webhook).
  const tier: DatasetTier = 'explorer';

  if (!DATASET_TIERS[tier]) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
  }

  const { key, doc } = await generateApiKey(session.user.id, tier, name);

  return NextResponse.json({
    key, // Only returned once — user must save it
    id: doc._id,
    prefix: doc.key_prefix,
    tier: doc.tier,
    permissions: doc.permissions,
    rate_limit: doc.rate_limit,
    created_at: doc.created_at,
    message: 'Save this key — it will not be shown again.',
  }, { status: 201 });
}

/**
 * DELETE /api/dataset/v1/keys — Revoke an API key
 *
 * Body: { key_id: string }
 */
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json();
  if (!body.key_id) {
    return NextResponse.json({ error: 'key_id required' }, { status: 400 });
  }

  const success = await revokeApiKey(body.key_id, session.user.id);
  if (!success) {
    return NextResponse.json({ error: 'Key not found or already revoked' }, { status: 404 });
  }

  return NextResponse.json({ revoked: true });
}
