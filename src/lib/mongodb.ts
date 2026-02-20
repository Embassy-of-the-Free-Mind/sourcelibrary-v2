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
let lastValidated = 0;
const VALIDATION_INTERVAL_MS = 30_000;

function clearCache() {
  cachedClient = null;
  cachedDb = null;
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

  try {
    const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

    console.log('[MongoDB] Initializing connection...');
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: isLambda ? 10000 : 5000,
      socketTimeoutMS: 45000,

      // Close idle connections after 1 minute to prevent pool exhaustion
      maxIdleTimeMS: 60000,

      // Lambda: 1 connection per instance (255 Lambdas × 1 = 255 total)
      // Vercel: reduced pool for cron jobs (3 instead of 5 to prevent exhaustion)
      maxPoolSize: isLambda ? 1 : 3,
      minPoolSize: 0,
    });

    console.log('[MongoDB] Attempting connection...');
    await client.connect();
    console.log('[MongoDB] Getting database...');
    const db = client.db(dbName);

    cachedClient = client;
    cachedDb = db;
    lastValidated = Date.now();

    console.log('[MongoDB] ✓ Connected to:', dbName);
    return { client, db };
  } catch (error) {
    console.error('[MongoDB] ✗ Connection failed:', error);
    clearCache();
    throw error;
  }
}

export async function getDb(): Promise<Db> {
  const { db } = await connectToDatabase();
  return db;
}
