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
      // Vercel functions run on AWS Lambda but aren't our Lambda workers.
      // Our workers set SQS_PAGE_OCR_QUEUE_URL — use that to distinguish.
      const isOurLambda = !!process.env.SQS_PAGE_OCR_QUEUE_URL;

      console.log('[MongoDB] Initializing connection...');
      const client = new MongoClient(uri!, {
        // Atlas cluster is in ap-south-1 (Mumbai), Vercel in iad1 (Virginia).
        // Cross-region latency (~200ms RTT) needs generous timeouts.
        serverSelectionTimeoutMS: isOurLambda ? 5000 : 30000,
        connectTimeoutMS: isOurLambda ? 10000 : 30000,
        socketTimeoutMS: isOurLambda ? 45000 : 90000,

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

export async function getDb(): Promise<Db> {
  const { db } = await connectToDatabase();
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
