import { MongoClient } from 'mongodb';

const options = {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  maxPoolSize: 5,
  minPoolSize: 0,
};

function createClientPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    // Return a promise that rejects at call time, not at import time.
    // This prevents build-time crashes when env vars aren't available.
    return Promise.reject(new Error('MONGODB_URI environment variable is not set'));
  }
  const client = new MongoClient(uri, options);
  return client.connect();
}

// Singleton MongoClient promise for NextAuth MongoDB adapter
let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === 'development') {
  // In development, use a global variable to preserve the client across HMR
  const globalWithMongo = global as typeof globalThis & {
    _mongoClientPromise?: Promise<MongoClient>;
  };
  if (!globalWithMongo._mongoClientPromise) {
    globalWithMongo._mongoClientPromise = createClientPromise();
  }
  clientPromise = globalWithMongo._mongoClientPromise;
} else {
  clientPromise = createClientPromise();
}

export default clientPromise;
