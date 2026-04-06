import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/oidc/jwks
 * JSON Web Key Set — Synapse uses this to verify ID token signatures.
 */
export async function GET() {
  const { getJwks } = await import('@/lib/oidc/provider');
  return NextResponse.json(await getJwks());
}
