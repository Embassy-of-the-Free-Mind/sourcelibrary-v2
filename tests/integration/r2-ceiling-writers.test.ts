/**
 * The two R2 writers v3#94 found outside the storage ceiling must stop when it refuses.
 *
 * Each script runs as a real process against the in-memory Mongo from tests/setup.ts. The
 * ceiling reads `system_config.storage_stats` in the `bookstore` db; we seed a reading and
 * check the exit code. A stale reading must stop the sweep with CEILING_EXIT (4) before it
 * does anything else; a fresh reading well under the ceiling must let it run to its normal
 * end (the positive control: without it, "exit 4" could just mean "the script is broken").
 *
 * Negative control, run by hand when this was written: deleting the checkR2Ceiling block in
 * either script turns its "refuses" test red (exit 0 instead of 4).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { MongoClient } from 'mongodb';

const ROOT = path.resolve(__dirname, '../..');
let client: MongoClient;

function env() {
  return {
    ...process.env,
    MONGODB_URI: process.env.MONGODB_URI!,
    MONGODB_DB: 'bookstore',
    // Dummy credentials: the scripts refuse to start without them, and none of these tests reaches R2.
    R2_ACCOUNT_ID: 'test-no-such-account',
    R2_ACCESS_KEY_ID: 'test',
    R2_SECRET_ACCESS_KEY: 'test',
    PROVENANCE_SECRET_KEY: 'test',
  };
}

async function seed(updatedAt: Date, bytes = 1e12) {
  const db = client.db('bookstore');
  await db.collection('system_config').deleteMany({ _id: 'storage_stats' } as object);
  await db.collection('system_config').insertOne({ _id: 'storage_stats', updatedAt, r2: [{ bucket: 'sourcelibrary', bytes }] } as object);
}

function run(script: string, args: string[]) {
  const r = spawnSync(process.execPath, [path.join(ROOT, script), ...args], { env: env(), encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

beforeAll(async () => {
  client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
});
afterAll(async () => { await client?.close(); });

const STALE = new Date(Date.now() - 72 * 3600e3);

describe('backfill-display-marks asks the R2 ceiling', () => {
  let out: string;
  beforeEach(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'ceiling-backfill-'));
    fs.writeFileSync(path.join(out, 'plan.ndjson.gz'), zlib.gzipSync(''));
  });

  it('refuses a sweep with --apply when the reading is stale', async () => {
    await seed(STALE);
    const r = run('scripts/maintenance/backfill-display-marks.mjs', [`--out=${out}`, '--apply']);
    expect(r.out).toMatch(/meter stale/);
    expect(r.code).toBe(4);
  });

  it('runs to its end when the reading is fresh and under the ceiling', async () => {
    await seed(new Date());
    const r = run('scripts/maintenance/backfill-display-marks.mjs', [`--out=${out}`, '--apply']);
    expect(r.out).toMatch(/TB left/);
    expect(r.code).toBe(0);
  });
});

describe('deepzoom-tile-pages asks the R2 ceiling', () => {
  it('refuses a provider sweep when the reading is stale', async () => {
    await seed(STALE);
    const r = run('scripts/workers/deepzoom-tile-pages.mjs', ['--providers', 'test-provider']);
    expect(r.out).toMatch(/meter stale/);
    expect(r.code).toBe(4);
  });

  it('refuses an --own-leaf sweep when the reading is stale', async () => {
    await seed(STALE);
    const r = run('scripts/workers/deepzoom-tile-pages.mjs', ['--own-leaf', '--tenant', 'test-tenant']);
    expect(r.out).toMatch(/meter stale/);
    expect(r.code).toBe(4);
  });

  it('runs to its end when the reading is fresh and under the ceiling', async () => {
    await seed(new Date());
    const r = run('scripts/workers/deepzoom-tile-pages.mjs', ['--providers', 'test-provider']);
    expect(r.out).toMatch(/TB left/);
    expect(r.code).toBe(0);
  });
});
