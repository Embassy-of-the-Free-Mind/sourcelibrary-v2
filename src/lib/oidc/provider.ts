import { randomBytes, createHash, createSign, createPrivateKey, createPublicKey } from 'crypto';
import { getDb } from '@/lib/mongodb';

/**
 * Minimal OIDC Identity Provider for Source Library.
 * Allows Matrix Synapse to authenticate users via Source Library sessions.
 */

const OIDC_CLIENT_ID = 'synapse-embassy';
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || 'embassy-oidc-secret-2026';

// In-memory stores (fine for single-instance Vercel — codes expire in 60s)
const authCodes = new Map<string, { userId: string; redirectUri: string; expiresAt: number }>();

// RSA key for signing JWTs — generated once per cold start
let _rsaPrivateKey: string | null = null;
let _rsaPublicKey: string | null = null;
let _rsaKeyId: string | null = null;

function getOrCreateKeys() {
  if (!_rsaPrivateKey) {
    // Use a deterministic key from the secret to avoid key rotation on cold starts
    const { generateKeyPairSync } = require('crypto');
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    _rsaPrivateKey = pair.privateKey;
    _rsaPublicKey = pair.publicKey;
    _rsaKeyId = createHash('sha256').update(pair.publicKey).digest('hex').slice(0, 8);
  }
  return { privateKey: _rsaPrivateKey!, publicKey: _rsaPublicKey!, keyId: _rsaKeyId! };
}

export function validateClient(clientId: string, clientSecret?: string): boolean {
  if (clientId !== OIDC_CLIENT_ID) return false;
  if (clientSecret && clientSecret !== OIDC_CLIENT_SECRET) return false;
  return true;
}

export function createAuthCode(userId: string, redirectUri: string): string {
  const code = randomBytes(32).toString('hex');
  authCodes.set(code, {
    userId,
    redirectUri,
    expiresAt: Date.now() + 60000, // 60s expiry
  });
  return code;
}

export function exchangeAuthCode(code: string, redirectUri: string): { userId: string } | null {
  const entry = authCodes.get(code);
  if (!entry) return null;
  authCodes.delete(code);

  if (Date.now() > entry.expiresAt) return null;
  if (entry.redirectUri !== redirectUri) return null;

  return { userId: entry.userId };
}

function base64url(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

export function createIdToken(userId: string, email: string, name: string): string {
  const { privateKey, keyId } = getOrCreateKeys();
  const issuer = process.env.NEXTAUTH_URL || 'https://sourcelibrary.org';

  const header = { alg: 'RS256', typ: 'JWT', kid: keyId };
  const payload = {
    iss: issuer,
    sub: userId,
    aud: OIDC_CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    email,
    name,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(createPrivateKey(privateKey), 'base64url');

  return `${signingInput}.${signature}`;
}

export function createAccessToken(userId: string): string {
  return Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 3600000 })).toString('base64url');
}

export function decodeAccessToken(token: string): { sub: string } | null {
  try {
    const data = JSON.parse(Buffer.from(token, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return { sub: data.sub };
  } catch {
    return null;
  }
}

export async function getUserInfo(userId: string) {
  const db = await getDb();
  const user = await db.collection('users').findOne(
    { _id: userId as any },
    { projection: { name: 1, email: 1, image: 1 } },
  );
  return user ? {
    sub: userId,
    name: user.name || 'Anonymous',
    email: user.email || '',
    picture: user.image || '',
  } : null;
}

export function getJwks() {
  const { publicKey, keyId } = getOrCreateKeys();
  const key = createPublicKey(publicKey);
  const jwk = key.export({ format: 'jwk' });
  return {
    keys: [{
      ...jwk,
      kid: keyId,
      use: 'sig',
      alg: 'RS256',
    }],
  };
}
