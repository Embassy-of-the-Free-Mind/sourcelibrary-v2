import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { acceptApiTerms, generateApiKey, listApiKeys, revokeApiKey } from '@/lib/dataset/api-keys';
import { DatasetTier, DATASET_TIERS } from '@/lib/dataset/types';
import { API_TERMS_URL, API_TERMS_VERSION, API_TERMS_DEADLINE, keyHasCurrentTerms } from '@/lib/api-terms-version';

/**
 * GET /api/dataset/v1/keys — List API keys for the authenticated user
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const keys = await listApiKeys(session.user.id);
  return NextResponse.json({
    keys: keys.map(k => ({ ...k, has_current_terms: keyHasCurrentTerms(k) })),
    terms_version: API_TERMS_VERSION,
    terms_deadline: API_TERMS_DEADLINE,
  });
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

  // A key opens more than a browser gets, so it is issued on an agreement.
  if (body.accept_terms !== API_TERMS_VERSION) {
    return NextResponse.json(
      { error: 'Agree to the terms of use to create a key.', terms_required: true, terms_version: API_TERMS_VERSION, terms_url: API_TERMS_URL },
      { status: 400 },
    );
  }

  // For now, anyone authenticated can create an explorer key.
  // Paid tiers will be gated by Stripe subscription (handled in webhook).
  const tier: DatasetTier = 'explorer';

  if (!DATASET_TIERS[tier]) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
  }

  // One active free key per account: the daily page cap is per key, so unlimited
  // self-serve keys would be an uncapped bulk route around it.
  const existing = await listApiKeys(session.user.id);
  if (existing.some((k) => k.tier === 'explorer' && k.status === 'active')) {
    return NextResponse.json(
      { error: 'This account already has a free key. Revoke it to make a new one, or write to team@sourcelibrary.org if you need more.' },
      { status: 409 },
    );
  }

  const { key, doc } = await generateApiKey(session.user.id, tier, name, { termsVersion: API_TERMS_VERSION });

  return NextResponse.json({
    key, // Only returned once — user must save it
    id: doc._id,
    prefix: doc.key_prefix,
    tier: doc.tier,
    permissions: doc.permissions,
    rate_limit: doc.rate_limit,
    created_at: doc.created_at,
    message: 'Save this key. It will not be shown again.',
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

/**
 * PATCH /api/dataset/v1/keys — agree to the current API terms for every active
 * key this account holds (#8235). Body: { accept_terms: API_TERMS_VERSION }.
 * Keys made before the terms keep working until API_TERMS_DEADLINE; after it
 * they are refused until this is called. The key itself does not change.
 */
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (body.accept_terms !== API_TERMS_VERSION) {
    return NextResponse.json(
      { error: 'Agree to the terms of use to keep using your key.', terms_required: true, terms_version: API_TERMS_VERSION, terms_url: API_TERMS_URL },
      { status: 400 },
    );
  }
  const updated = await acceptApiTerms(session.user.id);
  return NextResponse.json({ updated, terms_version: API_TERMS_VERSION });
}
