#!/usr/bin/env node
/**
 * Audit: every hidden repeat capture must point at a page a reader can reach (#5056).
 *
 * PRIOR ART: scripts/audit/page-repeat-images.mjs finds repeat PAIRS from the
 * images and writes nothing; scripts/maintenance/hide-repeat-captures.mjs
 * checks the kept page once, at write time. Neither looks again after a later
 * sweep moves the kept page, which is the failure this audit exists for.
 *
 * THE INVARIANT
 *   A page with `repeat_of` is out of every list and counter; the reader
 *   redirects its URL to the kept page (resolveRepeatKeeper,
 *   src/lib/reader-pages.ts). If the kept page later leaves the list too, the
 *   leaf is in NO list and NO count, and nothing errors. Classes:
 *     missing    — no page with that id in the same book (deleted, re-minted, wrong book)
 *     soft-hidden— the kept page has page_number < 0 and no split_into (a dedupe sweep hid it)
 *     chain      — the kept page is itself a repeat (the sweep never writes chains)
 *     self       — repeat_of names the page itself
 *     split      — the kept page was split after the hide (page_number < 0 with
 *                  split_into). The redirect follows split_into[0], so this is
 *                  listed for the record but does not fail the audit.
 *
 * WHY IT MATTERS
 *   batch-split-bph runs on exactly the EFM books whose repeats were hidden,
 *   and the dedupe sweeps soft-hide by negating page_number. PR #7777 review S6.
 *
 * USAGE
 *   node --env-file=.env.production.local scripts/audit/repeat-of-orphans.mjs [--book <id>] [--json out.json]
 *
 * Reads the hidden pages off the partial index pages_book_repeat_of_partial
 * (ensure-indexes.mjs), so it never walks the pages collection. Exits 1 when a
 * failing class is non-empty. READ-ONLY.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';

export const FAILING = ['missing', 'soft-hidden', 'chain', 'self'];

/** Class of one hidden page given its target (or null when the target is missing); 'ok' when it resolves. */
export function classifyRepeatTarget(page, target) {
  if (page.repeat_of === page.id) return 'self';
  if (!target || target.book_id !== page.book_id) return 'missing';
  if (typeof target.page_number !== 'number' || target.page_number < 0) {
    return Array.isArray(target.split_into) && typeof target.split_into[0] === 'string' ? 'split' : 'soft-hidden';
  }
  if (typeof target.repeat_of === 'string') return 'chain';
  return 'ok';
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const BOOK = opt('book');
  const JSON_OUT = opt('json');

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  try {
    const pages = client.db('bookstore').collection('pages');
    const q = { repeat_of: { $type: 'string' }, ...(BOOK && { book_id: BOOK }) };
    const hidden = await pages.find(q, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, repeat_of: 1 }, hint: 'pages_book_repeat_of_partial' }).toArray();
    const targets = new Map();
    const ids = [...new Set(hidden.map((p) => p.repeat_of))];
    for (let i = 0; i < ids.length; i += 1000) {
      for (const t of await pages.find({ id: { $in: ids.slice(i, i + 1000) } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, repeat_of: 1, split_into: 1 } }).toArray()) targets.set(t.id, t);
    }
    const byClass = {};
    const rows = [];
    for (const p of hidden) {
      const cls = classifyRepeatTarget(p, targets.get(p.repeat_of) ?? null);
      byClass[cls] = (byClass[cls] || 0) + 1;
      if (cls !== 'ok') rows.push({ class: cls, book_id: p.book_id, page_id: p.id, page_number: p.page_number, repeat_of: p.repeat_of });
    }
    const books = new Set(hidden.map((p) => p.book_id)).size;
    console.log(`repeat-of-orphans: ${hidden.length} hidden repeat pages in ${books} books`);
    for (const [k, v] of Object.entries(byClass).sort()) console.log(`  ${k.padEnd(12)} ${v}${FAILING.includes(k) ? '  FAIL' : ''}`);
    for (const r of rows.slice(0, 50)) console.log(`  ${r.class}\t${r.book_id}\tp.${r.page_number}\t${r.page_id} -> ${r.repeat_of}`);
    if (rows.length > 50) console.log(`  … ${rows.length - 50} more (--json for all)`);
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), hidden: hidden.length, books, byClass, rows }, null, 2));
    const failing = FAILING.reduce((n, k) => n + (byClass[k] || 0), 0);
    console.log(failing ? `FAIL: ${failing} hidden pages stand for no listed page` : 'PASS');
    process.exitCode = failing ? 1 : 0;
  } finally {
    await client.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
