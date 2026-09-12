import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rotateApiKey } from '@/lib/dataset/api-keys';

/**
 * POST /api/dataset/v1/keys/rotate — revoke a key and mint a replacement with
 * the same tier/permissions. Body: { key_id: string }.
 *
 * rotateApiKey existed since launch with no caller (#4366); this is its
 * surface. The new plaintext key is returned exactly once.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json();
  if (!body.key_id) {
    return NextResponse.json({ error: 'key_id required' }, { status: 400 });
  }

  const rotated = await rotateApiKey(body.key_id, session.user.id);
  if (!rotated) {
    return NextResponse.json({ error: 'Key not found, not yours, or not active' }, { status: 404 });
  }

  return NextResponse.json({
    key: rotated.key, // shown once
    id: rotated.doc._id,
    prefix: rotated.doc.key_prefix,
    tier: rotated.doc.tier,
    message: 'Old key revoked. Save this new key — it will not be shown again.',
  }, { status: 201 });
}
