import { MongoClient, Db } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

if (!uri) {
  console.error('MONGODB_URI environment variable is not set');
}
if (!dbName) {
  console.error('MONGODB_DB environment variable is not set');
}

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;
let connectingPromise: Promise<{ client: MongoClient; db: Db }> | null = null;
let lastValidated = 0;
const VALIDATION_INTERVAL_MS = 30_000;

/** Returns true if the error is a MongoDB connection/socket timeout */
export function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('timed out') || msg.includes('ECONNREFUSED') ||
    msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') ||
    msg.includes('topology was destroyed') || msg.includes('pool was cleared');
}

function clearCache() {
  cachedClient = null;
  cachedDb = null;
  connectingPromise = null;
  lastValidated = 0;
}

export async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  if (!uri || !dbName) {
    throw new Error('MongoDB environment variables not configured');
  }

  // Validate cached connection periodically to detect stale/dead connections
  if (cachedClient && cachedDb) {
    const now = Date.now();
    if (now - lastValidated > VALIDATION_INTERVAL_MS) {
      try {
        await cachedClient.db('admin').command({ ping: 1 });
        lastValidated = now;
      } catch {
        console.warn('[MongoDB] Cached connection stale, reconnecting...');
        try { await cachedClient.close(); } catch { /* ignore close errors */ }
        clearCache();
      }
    }
    if (cachedClient && cachedDb) {
      return { client: cachedClient, db: cachedDb };
    }
  }

  // Prevent concurrent connection attempts — reuse in-flight promise
  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = (async () => {
    try {
      // Detect actual AWS Lambda workers (NOT Vercel functions).
      // AWS_LAMBDA_FUNCTION_NAME is set by AWS on real Lambda invocations.
      // SQS_PAGE_OCR_QUEUE_URL is also set on Vercel (for queueing), so can't use that.
      const isOurLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

      console.log('[MongoDB] Initializing connection...');
      const client = new MongoClient(uri!, {
        // Atlas cluster is in eu-central-1 (Frankfurt), Vercel in iad1 (Virginia).
        // Cross-region latency needs generous timeouts.
        serverSelectionTimeoutMS: isOurLambda ? 5000 : 30000,
        connectTimeoutMS: isOurLambda ? 10000 : 30000,
        socketTimeoutMS: isOurLambda ? 45000 : 30000,

        // Close idle connections after 1 minute to prevent pool exhaustion
        maxIdleTimeMS: 60000,

        // Lambda: 1 connection per instance (255 Lambdas × 1 = 255 total)
        // Vercel: reduced pool for cron jobs (3 instead of 5 to prevent exhaustion)
        maxPoolSize: isOurLambda ? 1 : 3,
        minPoolSize: 0,
      });

      console.log('[MongoDB] Attempting connection...');
      await client.connect();
      console.log('[MongoDB] Getting database...');
      const db = client.db(dbName!);

      cachedClient = client;
      cachedDb = db;
      lastValidated = Date.now();

      console.log('[MongoDB] ✓ Connected to:', dbName);
      return { client, db };
    } catch (error) {
      console.error('[MongoDB] ✗ Connection failed:', error);
      clearCache();
      throw error;
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
}

// Stub Db that returns empty results — used during build when Atlas is unavailable
function buildStubDb(): Db {
  const emptyCursor = { toArray: async () => [], sort: () => emptyCursor, limit: () => emptyCursor, skip: () => emptyCursor, project: () => emptyCursor, next: async () => null, hasNext: async () => false, count: async () => 0 };
  const emptyCollection = { find: () => emptyCursor, findOne: async () => null, countDocuments: async () => 0, estimatedDocumentCount: async () => 0, aggregate: () => emptyCursor, distinct: async () => [] };
  return new Proxy({} as Db, { get: (_t, prop) => prop === 'collection' ? () => emptyCollection : prop === 'command' ? async () => ({ ok: 1 }) : undefined });
}

export async function getDb(): Promise<Db> {
  // Skip DB during build only — pages render with empty data and populate via ISR.
  // Bracket notation prevents Next.js from inlining the value at build time.
  // At runtime, SKIP_DB_AT_BUILD should be removed from Vercel env vars.
  const skipKey = 'SKIP_DB_AT_BUILD';
  if (process.env[skipKey] === '1') {
    console.log('[MongoDB] SKIP_DB_AT_BUILD=1, returning stub');
    return buildStubDb();
  }
  // Race against a timeout to prevent build workers from hanging indefinitely
  // when Atlas is slow from Vercel's DC (Virginia → Mumbai cross-region).
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('DB connection timeout')), 60000)
  );
  const { db } = await Promise.race([connectToDatabase(), timeout]);
  return db;
}

/** Force-close cached connection and reconnect. Use after catching a connection timeout. */
export async function forceReconnect(): Promise<Db> {
  if (cachedClient) {
    try { await cachedClient.close(); } catch { /* ignore close errors */ }
  }
  clearCache();
  const { db } = await connectToDatabase();
  return db;
}
