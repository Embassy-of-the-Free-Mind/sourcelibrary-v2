import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

/**
 * Shared in-memory MongoDB instance for integration tests.
 * Start once per test file, clean up after.
 */
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = 'test';

  client = new MongoClient(uri);
  await client.connect();
  db = client.db('test');
});

afterAll(async () => {
  await client?.close();
  await mongod?.stop();
});

/** Get the test database instance for seeding data in tests. */
export function getTestDb(): Db {
  return db;
}

/** Drop all collections between tests for isolation. */
export async function cleanDb(): Promise<void> {
  const collections = await db.listCollections().toArray();
  await Promise.all(collections.map(c => db.collection(c.name).deleteMany({})));
}
