import { randomBytes, createHash, createHmac, createSign, createPrivateKey, createPublicKey } from 'crypto';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

/**
 * Minimal OIDC Identity Provider for Source Library.
 * Allows Matrix Synapse to authenticate users via Source Library sessions.
 */

const OIDC_CLIENT_ID = 'synapse-embassy';
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
if (!OIDC_CLIENT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('OIDC_CLIENT_SECRET must be set in production');
}

// RSA key for signing JWTs — persisted in MongoDB for consistency across cold starts
let _rsaKeys: { privateKey: string; publicKey: string; keyId: string } | null = null;

async function getOrCreateKeys() {
  if (_rsaKeys) return _rsaKeys;

  const db = await getDb();
  const existing = await db.collection('system_config').findOne({ _id: 'oidc_rsa_keys' as any });

  if (existing) {
    _rsaKeys = {
      privateKey: existing.privateKey,
      publicKey: existing.publicKey,
      keyId: existing.keyId,
    };
    return _rsaKeys;
  }

  // Generate new keypair and persist
  const { generateKeyPairSync } = require('crypto');
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const keyId = createHash('sha256').update(pair.publicKey).digest('hex').slice(0, 8);

  await db.collection('system_config').updateOne(
    { _id: 'oidc_rsa_keys' as any },
    { $set: { privateKey: pair.privateKey, publicKey: pair.publicKey, keyId, createdAt: new Date() } },
    { upsert: true },
  );

  _rsaKeys = { privateKey: pair.privateKey, publicKey: pair.publicKey, keyId };
  return _rsaKeys;
}

export function validateClient(clientId: string, clientSecret?: string): boolean {
  if (clientId !== OIDC_CLIENT_ID) return false;
  if (clientSecret) {
    // In production, OIDC_CLIENT_SECRET must be set (enforced at module load)
    if (!OIDC_CLIENT_SECRET || clientSecret !== OIDC_CLIENT_SECRET) return false;
  }
  return true;
}

export async function createAuthCode(userId: string, redirectUri: string): Promise<string> {
  const code = randomBytes(32).toString('hex');
  const db = await getDb();
  await db.collection('oidc_auth_codes').insertOne({
    code,
    userId,
    redirectUri,
    expiresAt: new Date(Date.now() + 120000), // 2 min expiry
    createdAt: new Date(),
  });
  return code;
}

export async function exchangeAuthCode(code: string, redirectUri: string): Promise<{ userId: string } | null> {
  const db = await getDb();
  const entry = await db.collection('oidc_auth_codes').findOne({ code });

  if (!entry) {
    console.log('[OIDC] No auth code found for:', code.slice(0, 8));
    return null;
  }

  // Delete immediately (one-time use)
  await db.collection('oidc_auth_codes').deleteOne({ _id: entry._id });

  if (new Date() > new Date(entry.expiresAt)) {
    console.log('[OIDC] Auth code expired');
    return null;
  }

  // Compare redirect URIs (URL-decode both for safety)
  const storedUri = decodeURIComponent(entry.redirectUri);
  const providedUri = decodeURIComponent(redirectUri);
  if (storedUri !== providedUri) {
    console.log('[OIDC] Redirect URI mismatch:', storedUri, '!==', providedUri);
    return null;
  }

  return { userId: entry.userId };
}

function base64url(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

export async function createIdToken(userId: string, email: string, name: string): Promise<string> {
  const { privateKey, keyId } = await getOrCreateKeys();
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

function getTokenSecret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'dev-only-secret';
}

export function createAccessToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 3600000 })).toString('base64url');
  const sig = createHmac('sha256', getTokenSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function decodeAccessToken(token: string): { sub: string } | null {
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    // Verify HMAC signature
    const expected = createHmac('sha256', getTokenSecret()).update(payload).digest('base64url');
    if (sig !== expected) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return { sub: data.sub };
  } catch {
    return null;
  }
}

export async function getUserInfo(userId: string) {
  const db = await getDb();
  // NextAuth stores user IDs as ObjectId strings — query with ObjectId
  const oid = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
  const user = await db.collection('users').findOne(
    { _id: oid as any },
    { projection: { name: 1, email: 1, image: 1 } },
  );
  return user ? {
    sub: userId,
    name: user.name || 'Anonymous',
    email: user.email || '',
    picture: user.image || '',
  } : null;
}

export async function getJwks() {
  const { publicKey, keyId } = await getOrCreateKeys();
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
