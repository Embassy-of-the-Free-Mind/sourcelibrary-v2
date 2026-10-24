#!/usr/bin/env npx tsx
// PRIOR ART: src/lib/provenance.ts verifyExport — the library call this wraps;
// no script exposed it (checked scripts/audit, scripts/maintenance, scripts/lib
// for verifyExport/verifyProvenance/readProvenance). This adds the one thing
// the library cannot do on its own: resolve a recovered ref back to who took it.
/**
 * Decode a found passage: is it ours, which edition, and who extracted it?
 *
 * Give it text that turned up somewhere else (a website, a dataset, a
 * model's output). It verifies the invisible imprimatur under
 * PROVENANCE_SECRET_KEY and, if the mark carries an extraction ref, resolves it:
 *
 *   SLP-…  a flagged residential proxy pool (#6950). Matched by recomputing
 *          poolRef() for every string in suspected_pool_fingerprints × every
 *          month it was active. No other store is needed.
 *   SLK-…  an API key: the suffix is the start of the api_keys _id.
 *   SL-…   a bot-classified client (extractionRef over IP+UA hash + month).
 *          Not reversible from the ref alone; printed for a manual api_usage hunt.
 *
 * Copy-paste often keeps the zero-width characters, but some pipelines strip
 * them. "No mark" proves nothing about origin: compare against the book text.
 *
 * Usage:
 *   npx tsx --env-file=.env.production.local scripts/audit/decode-provenance.ts found.txt
 *   pbpaste | npx tsx --env-file=.env.production.local scripts/audit/decode-provenance.ts -
 */
import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';
import { verifyExport } from '../../src/lib/provenance';
import { poolRef } from '../../src/lib/bot-attribution';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: decode-provenance.ts <file | ->');
  process.exit(2);
}
const text = readFileSync(arg === '-' ? 0 : arg, 'utf8');
const zw = (text.match(/[​-‏⁠-⁤﻿]/g) || []).length;

const res = verifyExport(text);
if (!res) {
  console.error('PROVENANCE_SECRET_KEY is not set: cannot verify. Run with --env-file=.env.production.local.');
  process.exit(2);
}
console.log(`zero-width chars: ${zw}`);
if (!res.editionId) {
  console.log('No Source Library mark found. (Absence proves nothing: marks can be stripped.)');
  process.exit(1);
}
console.log(`edition: ${res.editionId}…  authentic: ${res.authentic}`);
if (res.message) console.log(`colophon: ${res.message}`);
if (!res.authentic) {
  console.log('Mark present but the MAC does not verify under our key: forged, legacy, or a different key.');
}

const ref = res.message?.match(/\bSL[PK]?-[0-9a-zA-Z]+(?:-\d{4}-\d{2})?/)?.[0];
if (!ref) {
  console.log('No extraction ref: this was served on an ordinary reader or export path.');
  process.exit(0);
}
console.log(`extraction ref: ${ref}`);

const monthsBetween = (from: Date, to: Date): Date[] => {
  const out: Date[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 15));
  while (d <= to) {
    out.push(new Date(d));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
};

async function resolvePoolRef(ref: string): Promise<void> {
  const client = await MongoClient.connect(process.env.MONGODB_URI!);
  const rows = await client
    .db('bookstore')
    .collection<{ _id: string; first_seen?: Date; last_seen?: Date }>('suspected_pool_fingerprints')
    .find({})
    .toArray();
  await client.close();
  const now = new Date();
  for (const r of rows) {
    // The detector's first_seen lags a pool's arrival; search from the year start.
    const from = new Date(Date.UTC((r.first_seen ?? now).getUTCFullYear(), 0, 1));
    for (const m of monthsBetween(from, now)) {
      if (poolRef(r._id, m) === ref) {
        console.log(`MATCH: proxy pool with user agent\n  ${r._id}\n  month ${ref.slice(-7)}; detector first_seen ${r.first_seen?.toISOString?.() ?? '?'}, last_seen ${r.last_seen?.toISOString?.() ?? '?'}`);
        console.log('  Network detail for that string: #4476 and the Cloudflare firewall rules naming it.');
        process.exit(0);
      }
    }
  }
  console.log(`No stored pool string reproduces ${ref} (checked ${rows.length}). Wrong key, or the string was removed from suspected_pool_fingerprints.`);
  process.exit(1);
}

if (ref.startsWith('SLP-')) {
  resolvePoolRef(ref).catch((e) => { console.error(e); process.exit(2); });
} else if (ref.startsWith('SLK-')) {
  console.log(`API key: api_keys._id starts with ${ref.slice(4)}`);
} else {
  console.log('Bot-classified client ref (IP+UA hash + month): search api_usage rows for that month with bot != null on /api/books/*/text.');
}
