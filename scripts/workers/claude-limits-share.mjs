#!/usr/bin/env node
// Share the main box's Claude usage poll with the guest job boxes (#6395).
//
// Only the main box runs climits (it holds the OAuth grants for all four accounts). The
// guest boxes (cloudlayer, l7a) run the spare lane for their own accounts but cannot reach
// main over ssh, and main cannot reach them; all three can reach Mongo. So spare-lane.py on
// main pushes ~/.claude-limits/latest.json into ops_reports, and the guests pull it.
//
//   node --env-file=.env.production.local scripts/workers/claude-limits-share.mjs push <latest.json>
//   node --env-file=.env.production.local scripts/workers/claude-limits-share.mjs pull   # prints the JSON
//
// PRIOR ART: scripts/maintenance/work-board-push.mjs — same ops_reports upsert, but it pushes job and
// lease state for /admin/work, not the climits poll; this is the read side it has no counterpart for.
import fs from 'node:fs';
import os from 'node:os';
import { MongoClient } from 'mongodb';

const ID = 'claude-limits:latest';
const [cmd, file] = process.argv.slice(2);
if (!['push', 'pull'].includes(cmd) || (cmd === 'push' && !file)) {
  console.error('usage: claude-limits-share.mjs push <latest.json> | pull');
  process.exit(2);
}

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
try {
  await client.connect();
  const reports = client.db('bookstore').collection('ops_reports');
  if (cmd === 'push') {
    const latest = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Only the limits travel: no credentials live in latest.json, and spend fields are dropped.
    const accounts = latest.accounts.map(({ email, ok, error, limits }) => ({ email, ok, error, limits }));
    await reports.replaceOne({ _id: ID },
      { _id: ID, checked_at: latest.checked_at, accounts, pushed_at: new Date().toISOString(), from: os.hostname() },
      { upsert: true });
  } else {
    const doc = await reports.findOne({ _id: ID });
    if (!doc) { console.error('no shared limits yet'); process.exit(1); }
    delete doc._id;
    process.stdout.write(JSON.stringify(doc));
  }
} finally {
  await client.close();
}
