/**
 * Do we already hold this? — the command-line door to `checkHoldings()` (#6019).
 *
 * PRIOR ART: scripts/import/enumerate-dedupe-source.ts — bulk enumeration of an
 * IA collection against the scalar fingerprint; this is the single-item look a
 * person (or a Claude session) runs before importing one book, over hidden
 * books and the warehouse too. The logic lives in src/lib/holdings-check.ts.
 *
 * Read-only. Writes nothing to the database.
 *
 * Usage (from the repo root):
 *   npx tsx --env-file=.env.production.local scripts/import/check-holdings.ts <url-or-identifier>
 *   npx tsx --env-file=.env.production.local scripts/import/check-holdings.ts --title "Närrische Weißheit" --author Becher --year 1682
 *   … --json        machine-readable result
 *
 * Exit code: 0 new, 1 held (same object / same edition / possible), 2 related
 * (other edition or similar title), 3 error — so a shell loop can branch on it.
 */

import { MongoClient } from 'mongodb';
import { checkHoldings, type HoldingsInput } from '../../src/lib/holdings-check';

function parseArgs(argv: string[]): { input: HoldingsInput; json: boolean } {
  const input: HoldingsInput = {};
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--json') json = true;
    else if (a === '--title') input.title = next();
    else if (a === '--author') input.author = next();
    else if (a === '--year') input.year = parseInt(next(), 10) || null;
    else if (a === '--published') input.published = next();
    else if (a === '--url') input.url = next();
    else if (a === '--id') input.identifier = next();
    else if (/^https?:\/\//i.test(a)) input.url = a;
    else if (!a.startsWith('--')) input.identifier = a;
  }
  return { input, json };
}

async function main() {
  const { input, json } = parseArgs(process.argv.slice(2));
  if (!input.url && !input.identifier && !input.title) {
    console.error('Give a URL, an identifier, or --title (with --author/--year). See the header of this file.');
    process.exit(3);
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set — run with --env-file=.env.production.local');
    process.exit(3);
  }
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || 'bookstore');
    const res = await checkHoldings(db, input);
    if (json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(res.summary);
      for (const c of res.candidates) {
        const state = c.collection === 'books_warehouse' ? 'warehouse' : c.visible ? 'visible' : 'HIDDEN';
        const dup = c.duplicate_of ? ` dup-of:${c.duplicate_of}` : '';
        console.log(`  [${c.reason}] ${state}${dup}  ${c.title.slice(0, 70)} — ${c.author ?? '?'} ${c.year ?? ''}  ${c.pages_count}pp/${c.pages_translated}tr  ${c.url}`);
      }
      for (const l of res.limits) console.log(`  note: ${l}`);
    }
    const code = { new: 0, same_object: 1, same_edition: 1, possible_same_edition: 1, other_edition: 2, related_title: 2 }[res.verdict];
    process.exitCode = code;
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(3);
});
