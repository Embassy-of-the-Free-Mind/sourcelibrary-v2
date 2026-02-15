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
    const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

    console.log('[MongoDB] Initializing connection...');
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: isLambda ? 10000 : 5000,
      socketTimeoutMS: 45000,

      // Lambda: 1 connection per instance (255 Lambdas × 1 = 255 total)
      // Vercel: small pool for concurrent requests within same instance
      maxPoolSize: isLambda ? 1 : 5,
      minPoolSize: 0,
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
