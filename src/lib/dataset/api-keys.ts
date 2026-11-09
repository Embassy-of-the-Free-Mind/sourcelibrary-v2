import { API_TERMS_VERSION, keyBlockedForTerms } from '@/lib/api-terms-version';
import { randomBytes, createHash } from 'crypto';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { checkRateLimit } from '@/lib/rate-limit';
import { keyRequestsPerMinute } from '@/lib/api-limits';
import { ApiKeyDoc, DatasetTier, DATASET_TIERS } from './types';

const COLLECTION = 'api_keys';
const KEY_PREFIX = 'sl_data_';

/**
 * Key ids arrive as strings from route bodies but are stored as ObjectIds
 * (insertOne generates them). Matching `{ _id: keyId }` with the raw string
 * silently matched NOTHING — self-serve revoke/rotate returned "not found"
 * for every real key (#4366 finding). Resolve to ObjectId when possible.
 */
function keyIdFilter(keyId: string): { _id: ObjectId } {
  // Non-hex ids can't exist in this collection (driver-generated ObjectIds);
  // map them to a well-formed id that matches nothing rather than widening
  // the filter type to string.
  return { _id: ObjectId.isValid(keyId) ? new ObjectId(keyId) : new ObjectId('000000000000000000000000') };
}

/** Generate a new API key. Returns the plaintext key (shown once) and the doc. */
export async function generateApiKey(
  userId: string,
  tier: DatasetTier,
  name: string,
  options?: {
    languages?: string[];
    clusters?: string[];
    stripeSubscriptionId?: string;
    /** Grant visible-mark-free image serving regardless of tier. */
    cleanImages?: boolean;
    /** The terms version the holder agreed to when asking for this key. */
    termsVersion?: string;
  }
): Promise<{ key: string; doc: ApiKeyDoc }> {
  const db = await getDb();
  const raw = randomBytes(32).toString('hex');
  const key = `${KEY_PREFIX}${raw}`;
  const keyHash = hashKey(key);
  const tierConfig = DATASET_TIERS[tier];

  const doc: ApiKeyDoc = {
    key_hash: keyHash,
    key_prefix: key.slice(0, 16) + '...',
    user_id: userId,
    name,
    tier,
    permissions: {
      languages: options?.languages || (tier === 'language' ? [] : '*'),
      clusters: options?.clusters || (tier === 'domain' ? [] : '*'),
      ...(options?.cleanImages ? { clean_images: true } : {}),
    },
    rate_limit: {
      requests_per_minute: tierConfig.requestsPerMinute,
      pages_per_day: tierConfig.pagesPerDay,
    },
    status: 'active',
    stripe_subscription_id: options?.stripeSubscriptionId,
    ...(options?.termsVersion ? { terms_version: options.termsVersion, terms_accepted_at: new Date() } : {}),
    created_at: new Date(),
    last_used_at: null,
    expires_at: null,
  };

  await db.collection(COLLECTION).insertOne(doc);
  return { key, doc };
}

/** Validate an API key from the Authorization header. Returns the key doc or null. */
export async function validateApiKey(authHeader: string | null): Promise<ApiKeyDoc | null> {
  const { doc, termsRequired } = await resolveApiKey(authHeader);
  return termsRequired ? null : doc;
}

/**
 * The key behind a header, and whether it must agree to the API terms before it
 * is served (#8235). validateApiKey answers null for such a key, so every gate
 * that trusts a key (bot-gate, image-gate, preview) stops trusting it at the
 * deadline; the API routes call this instead so they can say why.
 */
export async function resolveApiKey(authHeader: string | null): Promise<{ doc: ApiKeyDoc | null; termsRequired: boolean }> {
  const doc = await lookupApiKey(authHeader);
  return { doc, termsRequired: !!doc && keyBlockedForTerms(doc) };
}

async function lookupApiKey(authHeader: string | null): Promise<ApiKeyDoc | null> {
  if (!authHeader) return null;

  const key = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (!key.startsWith(KEY_PREFIX)) return null;

  const db = await getDb();
  const keyHash = hashKey(key);
  const doc = await db.collection<ApiKeyDoc>(COLLECTION).findOneAndUpdate(
    {
      key_hash: keyHash,
      status: 'active',
      // Honour expiry: null/missing = perpetual; a past date = dead key.
      // (This field was written since day one but never read — #4366.)
      $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }],
    },
    { $set: { last_used_at: new Date() } },
    { returnDocument: 'after' }
  );

  return doc || null;
}

/**
 * Per-key requests-per-minute limiter. The number has been WRITTEN on every
 * key and DISPLAYED on the signup form since launch, but enforced nowhere
 * (#4366). In-memory per instance, so it is a soft ceiling — the daily page
 * budgets remain the hard anti-bulk control.
 */
export function checkKeyRequestRate(doc: ApiKeyDoc): { allowed: boolean; retryAfter?: number } {
  const limit = keyRequestsPerMinute(doc);
  const rl = checkRateLimit(
    { name: 'api:key-rpm', limit, windowSeconds: 60 },
    String(doc._id),
  );
  return rl.allowed ? { allowed: true } : { allowed: false, retryAfter: rl.retryAfter };
}

/** Revoke a key */
export async function revokeApiKey(keyId: string, userId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.collection(COLLECTION).updateOne(
    { ...keyIdFilter(keyId), user_id: userId },
    { $set: { status: 'revoked' } }
  );
  return result.modifiedCount > 0;
}

/** List keys for a user (never returns the hash) */
export async function listApiKeys(userId: string): Promise<ApiKeyDoc[]> {
  const db = await getDb();
  return db.collection<ApiKeyDoc>(COLLECTION)
    .find({ user_id: userId })
    .project({ key_hash: 0 })
    .sort({ created_at: -1 })
    .toArray() as Promise<ApiKeyDoc[]>;
}

/**
 * Record that a holder agreed to the current API terms, on every active key they
 * own (#8235). Keys made before the terms keep their value; only the agreement
 * is added. Returns how many keys were updated.
 */
export async function acceptApiTerms(userId: string): Promise<number> {
  const db = await getDb();
  const res = await db.collection<ApiKeyDoc>(COLLECTION).updateMany(
    { user_id: userId, status: 'active' },
    { $set: { terms_version: API_TERMS_VERSION, terms_accepted_at: new Date() } },
  );
  return res.modifiedCount;
}

/** Rotate: revoke old key, generate new one with same config */
export async function rotateApiKey(
  keyId: string,
  userId: string
): Promise<{ key: string; doc: ApiKeyDoc } | null> {
  const db = await getDb();
  const old = await db.collection<ApiKeyDoc>(COLLECTION).findOne({
    ...keyIdFilter(keyId),
    user_id: userId,
    status: 'active',
  });
  if (!old) return null;

  await db.collection(COLLECTION).updateOne(
    keyIdFilter(keyId),
    { $set: { status: 'revoked' } }
  );

  return generateApiKey(userId, old.tier, old.name, {
    languages: old.permissions.languages === '*' ? undefined : old.permissions.languages,
    clusters: old.permissions.clusters === '*' ? undefined : old.permissions.clusters,
    stripeSubscriptionId: old.stripe_subscription_id,
    cleanImages: old.permissions.clean_images === true,
    termsVersion: old.terms_version,
  });
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
