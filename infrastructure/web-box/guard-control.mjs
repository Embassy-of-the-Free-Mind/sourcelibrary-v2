#!/usr/bin/env node
// Positive control for the box's write guard (#8384). Run on the box after every change to
// guard.cjs or /etc/sl-web/env, BEFORE serving anything:
//
//   cd /srv/sl-web/current && sl-web-guard-control
//
// (setup.sh installs it as /usr/local/bin/sl-web-guard-control, which loads the box env
// and the guard exactly as the Next processes do.)
//
// Every write below must be REFUSED by the guard, and one indexed read must SUCCEED (so a
// guard that refuses everything, or a dead connection, cannot pass). The writes all match
// nothing, so even a broken guard changes no row. Exit 0 only if every check holds.
import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(`${process.env.GUARD_APP_DIR || process.cwd()}/package.json`);
const { MongoClient } = require('mongodb');
const results = [];
const refused = (e) => /SL-WEB-GUARD refused/.test(String(e?.message)) || /SL-WEB-GUARD refused/.test(String(e?.cause?.message));

async function expectRefused(name, fn) {
  try { await fn(); results.push([name, false, 'was ALLOWED']); }
  catch (e) { results.push([name, refused(e), refused(e) ? 'refused' : `other error: ${String(e?.message).slice(0, 80)}`]); }
}
async function expectAllowed(name, fn) {
  try { const v = await fn(); results.push([name, true, `allowed (${v})`]); }
  catch (e) { results.push([name, false, `failed: ${String(e?.message).slice(0, 100)}`]); }
}

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
const db = client.db(process.env.MONGODB_DB);
const none = { _id: '__sl_web_guard_control_8384__' };

await expectAllowed('mongo read (books, by _id)', async () => (await db.collection('books').findOne(none, { projection: { _id: 1 } })) === null ? 'no row, as expected' : 'row?');
await expectRefused('mongo updateOne books', () => db.collection('books').updateOne(none, { $set: { x: 1 } }));
await expectRefused('mongo deleteOne books', () => db.collection('books').deleteOne(none));
await expectRefused('mongo findOneAndUpdate pages', () => db.collection('pages').findOneAndUpdate(none, { $set: { x: 1 } }));
await expectRefused('mongo insertOne api_usage', () => db.collection('api_usage').insertOne({ ...none, control: true }));
await expectRefused('mongo createIndex api_usage', () => db.collection('api_usage').createIndex({ ts: 1 }));
await expectRefused('mongo aggregate $merge', () => db.collection('books').aggregate([{ $match: none }, { $merge: { into: 'sl_web_guard_control' } }]).toArray());
await client.close();

await expectRefused('POST https://sourcelibrary.org/api/health', () => fetch('https://sourcelibrary.org/api/health', { method: 'POST' }));
await expectRefused('GET https://example.com/', () => fetch('https://example.com/'));
await expectRefused('POST loopback', () => fetch('http://localhost:3999/api/x', { method: 'POST' }));
await expectRefused('raw socket api.openai.com:443', () => new Promise((res, rej) => { try { const s = net.connect(443, 'api.openai.com'); s.on('connect', () => { s.destroy(); res(); }); s.on('error', rej); } catch (e) { rej(e); } }));
const supa = process.env.SUPABASE_URL;
await expectRefused('Supabase table insert', () => fetch(`${supa}/rest/v1/page_translations`, { method: 'POST', body: '{}' }));
await expectRefused('Supabase write RPC (sync_health)', () => fetch(`${supa}/rest/v1/rpc/sync_health`, { method: 'POST', body: '{}' }));

let ok = true;
for (const [name, pass, why] of results) { ok &&= pass; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${why}`); }
console.log(ok ? 'guard control: all checks hold' : 'guard control: FAILED — do not serve');
process.exit(ok ? 0 : 1);
