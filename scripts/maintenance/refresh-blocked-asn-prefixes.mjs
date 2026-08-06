#!/usr/bin/env node
/**
 * Regenerate src/lib/blocked-asn-prefixes.json from BGP data.
 *
 * Why this exists rather than a hand-written list of the ranges we measured:
 *
 * On 2026-08-06 the block list was first drafted from the allocations the fleet
 * had actually been seen in — 74 prefixes, resolved per /24 through Team Cymru.
 * Replaying it against the traffic showed 94.6% coverage, which looked fine.
 * Then the same measurement at /16 granularity turned up 119.8.0.0/21 and a
 * scatter of /24s inside 49.232, 152.136, 159.138, 154.8 and 188.239 that were
 * ALREADY being read from and were not in the list — because a four-day sample
 * of a rotating fleet shows you where it has been, never where it can go next.
 *
 * The operators here announce far more space than they had used at the moment
 * we looked. Blocking the sample is therefore a block with a published escape
 * route, and this file's own history says the fleet takes it: AS132203 was
 * refused in July and the traffic reappeared on AS45090 in August.
 *
 * So the unit of blocking is the OPERATOR, and the source of truth is what that
 * operator announces to the global routing table. Re-run this when the anomaly
 * detector reports a blocked network still reaching the app, or every few
 * months — allocations move.
 *
 * Usage:
 *   node scripts/maintenance/refresh-blocked-asn-prefixes.mjs           # write
 *   node scripts/maintenance/refresh-blocked-asn-prefixes.mjs --check   # CI: diff only
 */

import { writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../src/lib/blocked-asn-prefixes.json');

/**
 * Cloud operators whose networks are refused, with the measurement that put
 * them here. Adding an ASN is a real decision — it refuses everything that
 * operator hosts, forever, on every route. See src/lib/blocked-networks.ts for
 * the test an entry has to pass (enumeration shape, not merely volume).
 */
const ASNS = [
  { asn: 55990, name: 'Huawei Cloud', evidence: '61,439 reads / 164 rotating /24s over 4 days, ~1.0 pages per book' },
  { asn: 136907, name: 'Huawei Clouds Hong Kong', evidence: '17,919 reads / 50 rotating /24s over 4 days' },
  { asn: 150436, name: 'Byteplus (ByteDance)', evidence: '22,997 reads / 27 rotating /24s over 4 days' },
  { asn: 45090, name: 'Tencent Cloud', evidence: '34,522 reads / 371 rotating /24s over 4 days' },
  { asn: 132203, name: 'Tencent Cloud Singapore', evidence: '354,997 reads / 7 days / 8,047 books (July 2026, #3438)' },
];

/**
 * Ranges that must never appear in the output, checked after generation.
 * A BGP feed is third-party input on the hot path of every request: if a bad
 * or hijacked announcement ever put one of these in the list, the block would
 * take the site down. Cheap to assert; catastrophic to skip.
 */
const NEVER_BLOCK = [
  // Cloudflare — we are behind it; blocking it blocks everyone.
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  // Private, loopback, link-local — never a caller, and a sign of bad data.
  '10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16',
];

function ipToInt(ip) {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const o of p) {
    const v = Number(o);
    if (!/^\d{1,3}$/.test(o) || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function toRange(cidr) {
  const [base, bits] = cidr.split('/');
  const start = ipToInt(base);
  const w = Number(bits);
  if (start === null || !Number.isInteger(w) || w < 0 || w > 32) return null;
  return { start, end: start + 2 ** (32 - w) - 1 };
}

function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** Merge overlapping/adjacent ranges, then re-emit as minimal CIDR blocks. */
function collapse(cidrs) {
  const ranges = cidrs.map(toRange).filter(Boolean).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  const out = [];
  for (const { start, end } of merged) {
    let s = start;
    while (s <= end) {
      // Largest block that both aligns on `s` and fits inside the range.
      let size = s === 0 ? 2 ** 32 : (s & -s) >>> 0;
      while (s + size - 1 > end) size /= 2;
      out.push(`${intToIp(s)}/${32 - Math.log2(size)}`);
      s += size;
    }
  }
  return out;
}

async function announcedPrefixes(asn) {
  const url = `https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS${asn}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'sourcelibrary-abuse-response' } });
  if (!res.ok) throw new Error(`RIPEstat AS${asn}: HTTP ${res.status}`);
  const body = await res.json();
  const list = body?.data?.prefixes;
  if (!Array.isArray(list) || list.length === 0) throw new Error(`RIPEstat AS${asn}: no prefixes returned`);
  return list.map((p) => p.prefix).filter((p) => p && !p.includes(':'));
}

async function main() {
  const groups = [];
  for (const entry of ASNS) {
    const raw = await announcedPrefixes(entry.asn);
    const prefixes = collapse(raw);
    groups.push({ ...entry, announced: raw.length, prefixes });
    console.log(`AS${entry.asn} ${entry.name}: ${raw.length} announced -> ${prefixes.length} after collapsing`);
  }

  const all = groups.flatMap((g) => g.prefixes);

  // Guard 1: nothing in NEVER_BLOCK may overlap the output.
  const forbidden = NEVER_BLOCK.map(toRange);
  const bad = all.filter((c) => {
    const r = toRange(c);
    return forbidden.some((f) => r.start <= f.end && f.start <= r.end);
  });
  if (bad.length) {
    console.error(`REFUSING TO WRITE: output overlaps a protected range: ${bad.join(' ')}`);
    process.exit(1);
  }

  // Guard 2: no absurdly large aggregate. A /8 from a BGP feed is bad data,
  // and 16.7M addresses is not a block anyone reviewed.
  const huge = all.filter((c) => Number(c.split('/')[1]) < 9);
  if (huge.length) {
    console.error(`REFUSING TO WRITE: implausibly large prefix in output: ${huge.join(' ')}`);
    process.exit(1);
  }

  const payload = {
    _comment: 'GENERATED by scripts/maintenance/refresh-blocked-asn-prefixes.mjs — do not hand-edit. See src/lib/blocked-networks.ts.',
    generated_from: 'RIPEstat announced-prefixes',
    groups: groups.map((g) => ({ asn: g.asn, name: g.name, evidence: g.evidence, prefixes: g.prefixes })),
  };
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  if (process.argv.includes('--check')) {
    const current = readFileSync(OUT, 'utf8');
    if (current !== json) {
      console.error('blocked-asn-prefixes.json is out of date — re-run without --check.');
      process.exit(1);
    }
    console.log('blocked-asn-prefixes.json is up to date.');
    return;
  }

  writeFileSync(OUT, json);
  console.log(`\nwrote ${OUT}: ${all.length} prefixes across ${groups.length} operators`);
}

main().catch((err) => { console.error(err); process.exit(1); });
