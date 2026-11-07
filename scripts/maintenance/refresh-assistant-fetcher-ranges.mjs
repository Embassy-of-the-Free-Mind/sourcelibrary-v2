#!/usr/bin/env node
/**
 * Regenerate src/lib/assistant-fetcher-ranges.json from the lists each operator
 * publishes for the fetchers that read on a person's behalf (#8161).
 *
 * PRIOR ART: scripts/maintenance/refresh-blocked-asn-prefixes.mjs, the same shape
 * for the opposite purpose. It reads BGP data for operators we refuse and cannot
 * read these JSON lists, so it does not fit as it stands.
 *
 * A stale list fails safe: an address that has left the list loses nothing but the
 * larger allowance, and a new one starts on the anonymous tier. Re-run every few
 * months, or when a fetcher reports hitting the anonymous limit.
 *
 * `160.79.104.0/21` is not in claude.com/crawling/bots.json. It is Anthropic's
 * documented API egress range, and it is where the Claude connector calls from:
 * measured 2026-11-05, all 70,155 connector calls in 14 days came from 65 addresses
 * inside it, and none from bots.json. Direct web fetches are expected to use the
 * bots.json list.
 *
 * Usage:
 *   node scripts/maintenance/refresh-assistant-fetcher-ranges.mjs           # write
 *   node scripts/maintenance/refresh-assistant-fetcher-ranges.mjs --check   # diff only
 */
import { readFileSync, writeFileSync } from 'fs';

const OUT = new URL('../../src/lib/assistant-fetcher-ranges.json', import.meta.url);

const SOURCES = {
  anthropic: { url: 'https://claude.com/crawling/bots.json', extra: ['160.79.104.0/21'], min: 2 },
  openai: { url: 'https://openai.com/chatgpt-user.json', extra: [], min: 20 },
  perplexity: { url: 'https://www.perplexity.com/perplexity-user.json', extra: [], min: 2 },
};

const SHORTEST_PREFIX = 16;
const PRIVATE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** Third-party input that widens a limit, so refuse anything that looks wrong. */
function assertSafe(cidr, operator) {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr);
  if (!m) throw new Error(`${operator}: not an IPv4 CIDR: ${cidr}`);
  if (Number(m[2]) < SHORTEST_PREFIX) throw new Error(`${operator}: prefix too wide: ${cidr}`);
  if (PRIVATE.test(m[1])) throw new Error(`${operator}: private address: ${cidr}`);
}

const ranges = {};
for (const [operator, { url, extra, min }] of Object.entries(SOURCES)) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SourceLibrary-maintenance/1.0 (+https://sourcelibrary.org/developers)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${operator}: ${url} answered ${res.status}`);
  const body = await res.json();
  const listed = (body.prefixes ?? []).map((p) => p.ipv4Prefix).filter(Boolean);
  if (listed.length < min) throw new Error(`${operator}: only ${listed.length} prefixes, expected at least ${min}`);
  const prefixes = [...new Set([...listed, ...extra])].sort();
  prefixes.forEach((cidr) => assertSafe(cidr, operator));
  ranges[operator] = { source: url, published: body.creationTime ?? null, prefixes };
  console.log(`${operator}: ${prefixes.length} prefixes (published ${body.creationTime ?? 'undated'})`);
}

const text = `${JSON.stringify(ranges, null, 2)}\n`;
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch { /* absent counts as different */ }
  if (current !== text) {
    console.error('assistant-fetcher-ranges.json is out of date');
    process.exit(1);
  }
  console.log('up to date');
} else {
  writeFileSync(OUT, text);
  console.log('wrote', OUT.pathname);
}
