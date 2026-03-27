import { NextResponse } from 'next/server';

/**
 * GET /api/auth/oidc/.well-known
 * OpenID Connect Discovery — tells Synapse where all the OIDC endpoints are.
 */
export async function GET() {
  const issuer = process.env.NEXTAUTH_URL || 'https://sourcelibrary.org';

  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/api/auth/oidc/authorize`,
    token_endpoint: `${issuer}/api/auth/oidc/token`,
    userinfo_endpoint: `${issuer}/api/auth/oidc/userinfo`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    jwks_uri: `${issuer}/api/auth/oidc/jwks`,
    claims_supported: ['sub', 'name', 'email', 'picture'],
  });
}
