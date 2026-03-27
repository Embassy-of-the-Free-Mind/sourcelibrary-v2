import { NextResponse } from 'next/server';
import { getJwks } from '@/lib/oidc/provider';

/**
 * GET /api/auth/oidc/jwks
 * JSON Web Key Set — Synapse uses this to verify ID token signatures.
 */
export async function GET() {
  return NextResponse.json(getJwks());
}
