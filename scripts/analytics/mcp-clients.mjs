#!/usr/bin/env node
/**
 * Who is connecting to the MCP server?
 *
 * `mcp_tool_calls` answers "which tools get used"; it cannot answer "how many
 * clients / which ones", because the server is stateless (a tool call carries
 * no client identity) and `Claude-User` traffic all leaves Anthropic's egress
 * IPs, so distinct ip_hash is not a client count in either direction.
 *
 * `mcp_clients` fixes that: one row per `initialize` handshake, carrying the
 * client's self-reported `clientInfo.name` / `.version` (src/lib/mcp-usage.ts).
 *
 * READ IT AS: distinct client_name = who has this installed / integrated.
 * Raw row counts are mostly discovery noise — MCP registry crawlers and uptime
 * monitors handshake continuously and never call a tool. The `--engaged` view
 * separates the two by cross-referencing ip_hash against `mcp_tool_calls`.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/analytics/mcp-clients.mjs [--days 30]
 */

import { MongoClient } from 'mongodb';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const eq = argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return fallback;
};

const DAYS = Number(flag('days', 30));
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set. Run: set -a; source .env.production.local; set +a');
  process.exit(1);
}

const since = new Date(Date.now() - DAYS * 86400_000);
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const clients = db.collection('mcp_clients');
const calls = db.collection('mcp_tool_calls');

const total = await clients.countDocuments({ ts: { $gte: since } });
if (total === 0) {
  const ever = await clients.estimatedDocumentCount();
  console.log(`No initialize handshakes logged in the last ${DAYS}d (${ever} rows all-time).`);
  console.log('If this is right after the deploy that added logMcpInitialize, wait for traffic.');
  await client.close();
  process.exit(0);
}

console.log(`\nMCP clients — last ${DAYS} days (${total} handshakes)\n`);

const byClient = await clients.aggregate([
  { $match: { ts: { $gte: since } } },
  {
    $group: {
      _id: { $ifNull: ['$client_name', '(none reported)'] },
      n: { $sum: 1 },
      versions: { $addToSet: '$client_version' },
      ips: { $addToSet: '$ip_hash' },
      days: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } } },
      last: { $max: '$ts' },
    },
  },
  { $sort: { n: -1 } },
]).toArray();

console.log('BY CLIENT NAME');
console.log('handshakes  ips  days  last         client (versions)');
for (const c of byClient) {
  const versions = c.versions.filter(Boolean).sort();
  const vs = versions.length > 3
    ? `${versions.slice(0, 3).join(', ')} +${versions.length - 3}`
    : versions.join(', ');
  console.log(
    String(c.n).padStart(10),
    String(c.ips.length).padStart(4),
    String(c.days.length).padStart(5),
    ' ' + c.last.toISOString().slice(0, 10),
    ` ${c._id}${vs ? ` (${vs})` : ''}`,
  );
}

// Engaged = handshaked AND actually invoked a tool from the same ip_hash.
// Crawlers and liveness probes handshake and stop; that gap is the point.
const callIps = new Set(await calls.distinct('ip_hash', { ts: { $gte: since } }));
console.log('\nENGAGED vs PROBING (client IPs that went on to call a tool)');
console.log('  engaged  probed  client');
for (const c of byClient) {
  const engaged = c.ips.filter(ip => callIps.has(ip)).length;
  console.log(
    String(engaged).padStart(9),
    String(c.ips.length - engaged).padStart(7),
    ` ${c._id}`,
  );
}

const weekly = await clients.aggregate([
  { $match: { ts: { $gte: since } } },
  {
    $group: {
      _id: { $dateToString: { format: '%G-W%V', date: '$ts' } },
      n: { $sum: 1 },
      names: { $addToSet: { $ifNull: ['$client_name', '(none reported)'] } },
    },
  },
  { $project: { n: 1, names: { $size: '$names' } } },
  { $sort: { _id: 1 } },
]).toArray();

console.log('\nWEEKLY');
console.log('week      handshakes  distinct clients');
for (const w of weekly) {
  console.log(w._id.padEnd(10), String(w.n).padStart(10), String(w.names).padStart(17));
}

const protocols = await clients.aggregate([
  { $match: { ts: { $gte: since } } },
  { $group: { _id: '$protocol_version', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]).toArray();
console.log('\nPROTOCOL VERSIONS');
for (const p of protocols) console.log(String(p.n).padStart(8), ' ', p._id || '(none)');

// The funnel per client, joined on session_id. A row only counts from the deploy
// that added session_id, and only for clients that echo the id back: the "calls
// with no session" line says how much traffic this view cannot see.
const sessions = await clients.aggregate([
  { $match: { ts: { $gte: since }, session_id: { $type: 'string' } } },
  { $group: { _id: { $ifNull: ['$client_name', '(none reported)'] }, ids: { $addToSet: '$session_id' } } },
]).toArray();
const usedBySession = new Map((await calls.aggregate([
  { $match: { ts: { $gte: since }, session_id: { $type: 'string' }, user_agent: { $not: /^sl-/ } } },
  { $group: { _id: '$session_id', n: { $sum: 1 } } },
]).toArray()).map(s => [s._id, s.n]));

console.log('\nFUNNEL (sessions that went on to call a tool; internal sl-* probes excluded)');
if (sessions.length === 0) {
  console.log('  No session ids logged yet in this window.');
} else {
  console.log('  sessions    used    rate  calls/used  client');
  for (const s of sessions.sort((a, b) => b.ids.length - a.ids.length).slice(0, 25)) {
    const counts = s.ids.map(id => usedBySession.get(id)).filter(Boolean);
    const sum = counts.reduce((a, b) => a + b, 0);
    console.log(
      String(s.ids.length).padStart(10),
      String(counts.length).padStart(7),
      `${((100 * counts.length) / s.ids.length).toFixed(1)}%`.padStart(7),
      (counts.length ? (sum / counts.length).toFixed(1) : '-').padStart(11),
      ` ${s._id}`,
    );
  }
}
const noSession = await calls.countDocuments({
  ts: { $gte: since }, session_id: null, user_agent: { $not: /^sl-/ },
});
console.log(`  calls with no session id, not joinable: ${noSession}`);

// Empty results: result_count is null when the tool's shape does not say, which
// is not the same as zero, so the denominator is only the calls that report one.
const empties = await calls.aggregate([
  { $match: { ts: { $gte: since }, result_count: { $type: 'number' }, user_agent: { $not: /^sl-/ } } },
  { $group: { _id: '$tool', n: { $sum: 1 }, empty: { $sum: { $cond: [{ $eq: ['$result_count', 0] }, 1, 0] } } } },
  { $sort: { n: -1 } },
]).toArray();
console.log('\nEMPTY RESULTS BY TOOL');
if (empties.length === 0) console.log('  No result counts logged yet in this window.');
for (const t of empties) {
  console.log(String(t.n).padStart(8), `${((100 * t.empty) / t.n).toFixed(1)}%`.padStart(7), ` ${t._id}`);
}

console.log('');
await client.close();
