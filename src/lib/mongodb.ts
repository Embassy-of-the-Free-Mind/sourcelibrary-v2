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

export async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  if (!uri || !dbName) {
    throw new Error('MongoDB environment variables not configured');
  }

  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  try {
    console.log('[MongoDB] Initializing connection...');
    const client = new MongoClient(uri, {
      // Lambda-optimized timeouts: fail fast instead of hanging
      serverSelectionTimeoutMS: 5000, // 5 sec to find a server
      connectTimeoutMS: 10000, // 10 sec to establish connection
      socketTimeoutMS: 45000, // 45 sec for queries (OCR pages are large)

      // CRITICAL for Lambda: Only 1 connection per instance
      // 255 concurrent Lambdas × 1 connection = 255 total (well under Atlas limits)
      maxPoolSize: 1,
      minPoolSize: 0, // Don't maintain idle connections in Lambda
    });

    console.log('[MongoDB] Attempting connection...');
    await client.connect();
    console.log('[MongoDB] Getting database...');
    const db = client.db(dbName);

    cachedClient = client;
    cachedDb = db;

    console.log('[MongoDB] ✓ Connected to:', dbName);
    return { client, db };
  } catch (error) {
    console.error('[MongoDB] ✗ Connection failed:', error);
    throw error;
  }
}

export async function getDb(): Promise<Db> {
  const { db } = await connectToDatabase();
  return db;
}
