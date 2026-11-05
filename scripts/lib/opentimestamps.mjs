/**
 * opentimestamps.mjs — stamp, upgrade and verify an OpenTimestamps (.ots) proof for one SHA-256 digest,
 * with no dependency beyond node:crypto and fetch (#8150 slice 10).
 *
 * PRIOR ART: none — `git grep -i opentimestamps` is empty; the npm `javascript-opentimestamps` package
 * would be a new third-party dependency (and npm install is off-limits on the job boxes), and the Python
 * `opentimestamps-client` is not on the boxes. The format is small and stable, so it is implemented here
 * and checked against the reference client's byte layout in tests/unit/hash-snapshot.test.ts.
 *
 * Why OpenTimestamps: a snapshot root has to sit somewhere we cannot quietly edit later. OTS aggregates
 * digests into a Bitcoin transaction through public calendars (free, run by independent operators), and the
 * resulting .ots file is checkable by anyone against any copy of the Bitcoin chain — no account, no server
 * of ours. A pending stamp becomes complete after a block confirms (~hours); `upgradeOts` fetches that.
 *
 * File format (python-opentimestamps, opentimestamps/core/timestamp.py + notary.py):
 *   MAGIC, varuint major=1, file-hash op tag (0x08 sha256), digest, timestamp
 *   timestamp := ( 0xff item )* item
 *   item      := 0x00 TAG(8) varbytes(payload)      — an attestation
 *              | op [varbytes arg] timestamp        — an operation on the message, then its subtree
 */
import { createHash } from 'node:crypto';

export const OTS_MAGIC = Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex');
const TAG_PENDING = '83dfe30d2ef90c8e';
const TAG_BITCOIN = '0588960d73d71901';

export const DEFAULT_CALENDARS = [
  'https://alice.btc.calendar.opentimestamps.org',
  'https://bob.btc.calendar.opentimestamps.org',
  'https://finney.calendar.eternitywall.com',
];

const UNARY = { 0x08: 'sha256', 0x02: 'sha1', 0x03: 'ripemd160', 0xf2: 'reverse', 0xf3: 'hexlify' };
const BINARY = { 0xf0: 'append', 0xf1: 'prepend' };
const OP_TAG = { sha256: 0x08, sha1: 0x02, ripemd160: 0x03, reverse: 0xf2, hexlify: 0xf3, append: 0xf0, prepend: 0xf1 };

function applyOp(op, arg, msg) {
  switch (op) {
    case 'append': return Buffer.concat([msg, arg]);
    case 'prepend': return Buffer.concat([arg, msg]);
    case 'reverse': return Buffer.from(msg).reverse();
    case 'hexlify': return Buffer.from(msg.toString('hex'), 'ascii');
    case 'sha256': case 'sha1': case 'ripemd160': return createHash(op).update(msg).digest();
    default: throw new Error(`ots: unknown op ${op}`);
  }
}

// ── bytes ────────────────────────────────────────────────────────────────────

class Cursor {
  constructor(buf) { this.buf = buf; this.i = 0; }
  byte() { if (this.i >= this.buf.length) throw new Error('ots: truncated'); return this.buf[this.i++]; }
  bytes(n) { if (this.i + n > this.buf.length) throw new Error('ots: truncated'); const b = this.buf.subarray(this.i, this.i + n); this.i += n; return b; }
  varuint() { let v = 0, shift = 0, b; do { b = this.byte(); v += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80); return v; }
  varbytes(max = 8192) { const n = this.varuint(); if (n > max) throw new Error('ots: varbytes too long'); return this.bytes(n); }
}

function varuint(n) {
  const out = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}
const varbytes = (b) => Buffer.concat([varuint(b.length), b]);

// ── timestamp tree ───────────────────────────────────────────────────────────
// node = { msg: Buffer, attestations: [{ kind, uri?, height?, tag, payload }], ops: [{ op, arg?, child: node }] }

export function parseTimestamp(cur, msg, depth = 0) {
  if (depth > 256) throw new Error('ots: too deep');
  const node = { msg, attestations: [], ops: [] };
  const item = (tag) => {
    if (tag === 0x00) {
      const t = cur.bytes(8).toString('hex');
      const payload = Buffer.from(cur.varbytes());
      const a = { tag: t, payload };
      if (t === TAG_PENDING) { a.kind = 'pending'; a.uri = new Cursor(payload).varbytes(1000).toString('utf8'); }
      else if (t === TAG_BITCOIN) { a.kind = 'bitcoin'; a.height = new Cursor(payload).varuint(); }
      else a.kind = 'unknown';
      node.attestations.push(a);
    } else if (UNARY[tag]) {
      const op = UNARY[tag];
      node.ops.push({ op, child: parseTimestamp(cur, applyOp(op, null, msg), depth + 1) });
    } else if (BINARY[tag]) {
      const op = BINARY[tag];
      const arg = Buffer.from(cur.varbytes(4096));
      node.ops.push({ op, arg, child: parseTimestamp(cur, applyOp(op, arg, msg), depth + 1) });
    } else throw new Error(`ots: unknown tag 0x${tag.toString(16)}`);
  };
  let tag = cur.byte();
  while (tag === 0xff) { item(cur.byte()); tag = cur.byte(); }
  item(tag);
  return node;
}

export function serializeTimestamp(node) {
  const items = [
    ...node.attestations.map((a) => Buffer.concat([Buffer.from([0]), Buffer.from(a.tag, 'hex'), varbytes(a.payload)])),
    ...node.ops.map((o) => Buffer.concat([Buffer.from([OP_TAG[o.op]]), o.arg ? varbytes(o.arg) : Buffer.alloc(0), serializeTimestamp(o.child)])),
  ];
  if (!items.length) throw new Error('ots: empty timestamp');
  return Buffer.concat(items.map((b, i) => (i < items.length - 1 ? Buffer.concat([Buffer.from([0xff]), b]) : b)));
}

export function parseOts(buf) {
  if (!buf.subarray(0, OTS_MAGIC.length).equals(OTS_MAGIC)) throw new Error('ots: not an OpenTimestamps proof');
  const cur = new Cursor(buf); cur.i = OTS_MAGIC.length;
  const major = cur.varuint();
  if (major !== 1) throw new Error(`ots: unsupported major version ${major}`);
  const hashTag = cur.byte();
  if (hashTag !== 0x08) throw new Error('ots: only sha256 file digests are supported');
  const digest = Buffer.from(cur.bytes(32));
  const timestamp = parseTimestamp(cur, digest);
  if (cur.i !== buf.length) throw new Error('ots: trailing bytes');
  return { digest, timestamp };
}

export function serializeOts({ digest, timestamp }) {
  return Buffer.concat([OTS_MAGIC, varuint(1), Buffer.from([0x08]), digest, serializeTimestamp(timestamp)]);
}

/** Every attestation in the tree, with the message it attests. */
export function attestations(node, out = []) {
  for (const a of node.attestations) out.push({ ...a, msg: node.msg });
  for (const o of node.ops) attestations(o.child, out);
  return out;
}

// ── network ──────────────────────────────────────────────────────────────────

const OTS_HEADERS = { Accept: 'application/vnd.opentimestamps.v1', 'User-Agent': 'sourcelibrary-hash-snapshot/1' };

/** Submit a 32-byte digest to calendars; returns the .ots bytes (pending until a block confirms). */
export async function stampDigest(digest, { calendars = DEFAULT_CALENDARS, minResponses = 2, fetchImpl = fetch } = {}) {
  if (!Buffer.isBuffer(digest) || digest.length !== 32) throw new Error('stampDigest: digest must be 32 bytes');
  const root = { msg: digest, attestations: [], ops: [] };
  const errors = [];
  for (const cal of calendars) {
    try {
      const res = await fetchImpl(`${cal}/digest`, { method: 'POST', headers: OTS_HEADERS, body: digest, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const sub = parseTimestamp(new Cursor(Buffer.from(await res.arrayBuffer())), digest);
      root.attestations.push(...sub.attestations); root.ops.push(...sub.ops);
    } catch (e) { errors.push(`${cal}: ${e.message}`); }
  }
  const got = calendars.length - errors.length;
  if (got < minResponses) throw new Error(`stampDigest: only ${got} calendar(s) answered (need ${minResponses}): ${errors.join('; ')}`);
  return { ots: serializeOts({ digest, timestamp: root }), calendars: got, errors };
}

/** Replace pending attestations with the calendar's completed path where one exists. */
export async function upgradeOts(buf, { fetchImpl = fetch } = {}) {
  const parsed = parseOts(buf);
  let upgraded = 0, pending = 0;
  const walk = async (node) => {
    for (const a of [...node.attestations]) {
      if (a.kind !== 'pending') continue;
      if (!/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(a.uri)) { pending++; continue; }
      try {
        const res = await fetchImpl(`${a.uri}/timestamp/${node.msg.toString('hex')}`, { headers: OTS_HEADERS, signal: AbortSignal.timeout(20000) });
        if (res.status !== 200) { pending++; continue; }
        const sub = parseTimestamp(new Cursor(Buffer.from(await res.arrayBuffer())), node.msg);
        if (!attestations(sub).some((x) => x.kind === 'bitcoin')) { pending++; continue; }
        node.attestations = node.attestations.filter((x) => x !== a);
        node.attestations.push(...sub.attestations); node.ops.push(...sub.ops);
        upgraded++;
      } catch { pending++; }
    }
    for (const o of node.ops) await walk(o.child);
  };
  await walk(parsed.timestamp);
  return { ots: serializeOts(parsed), upgraded, pending };
}

/**
 * Check every Bitcoin attestation in the proof against a public block explorer (Esplora API). The OTS
 * message at a Bitcoin attestation must equal the block's merkle root (internal byte order; explorers
 * print it reversed). Returns the earliest confirmed block, or null when the stamp is still pending.
 * Anyone can repeat this with their own node: `ots verify` (python-opentimestamps) does the same check.
 */
export async function verifyOtsBitcoin(buf, { explorer = 'https://blockstream.info/api', fetchImpl = fetch } = {}) {
  const { digest, timestamp } = parseOts(buf);
  const results = [];
  for (const a of attestations(timestamp)) {
    if (a.kind !== 'bitcoin') continue;
    try {
      const hash = (await (await fetchImpl(`${explorer}/block-height/${a.height}`, { signal: AbortSignal.timeout(20000) })).text()).trim();
      const block = await (await fetchImpl(`${explorer}/block/${hash}`, { signal: AbortSignal.timeout(20000) })).json();
      const ok = Buffer.from(a.msg).reverse().toString('hex') === block.merkle_root;
      results.push({ height: a.height, block_hash: hash, time: new Date(block.timestamp * 1000).toISOString(), ok });
    } catch (e) {
      // An explorer outage is not a mismatch: report it as unchecked, never as "does not match".
      results.push({ height: a.height, ok: null, error: e.message });
    }
  }
  const good = results.filter((r) => r.ok).sort((x, y) => x.height - y.height);
  return { digest: digest.toString('hex'), confirmed: good[0] || null, checked: results, mismatched: results.filter((r) => r.ok === false).length, unreachable: results.filter((r) => r.ok === null).length, pending: attestations(timestamp).filter((a) => a.kind === 'pending').map((a) => a.uri) };
}
