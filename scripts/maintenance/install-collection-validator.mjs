#!/usr/bin/env node

/**
 * Install a $jsonSchema validator on a MongoDB collection (issue #3969, Track A).
 *
 * WHY THIS EXISTS
 * `books` accreted 476 top-level fields, ~140 of them written by a single sweep
 * and then abandoned, because nothing ever refused a new field. A query against
 * a field that exists but is 2%-populated returns a confident, well-formed,
 * WRONG answer. The validator is the only layer a future sweep cannot route
 * around — see `.claude/docs/invariants/field-sprawl.md`.
 *
 * WHY IT NEEDS A SEPARATE CREDENTIAL
 * `collMod` requires dbAdmin. The application user is `readWriteAnyDatabase`,
 * which does NOT include it. That privilege split is the whole point: a sweep
 * running as the app user can neither add a field past the validator nor remove
 * the validator. Use a throwaway dbAdmin user and delete it afterwards.
 *
 * USAGE
 *   # 1. generate the schema (read-only, full scan — NOT sampled)
 *   node --env-file=.env.production.local scripts/audit/field-sprawl.mjs \
 *     --collection books --emit-validator /tmp/books-validator.json
 *
 *   # 2. install it in warn mode
 *   ADMIN_MONGODB_URI='mongodb+srv://USER:PASS@HOST/' \
 *     node scripts/maintenance/install-collection-validator.mjs --file /tmp/books-validator.json
 *
 *   # 3. after a quiet week of Atlas logs, and only once every writer is clean:
 *   ADMIN_MONGODB_URI=... node scripts/maintenance/install-collection-validator.mjs \
 *     --file /tmp/books-validator.json --action error --force-error
 *
 * `warn` + `moderate` is the safe landing: violations are logged, writes still
 * succeed, and a legacy document outside the schema stays repairable rather
 * than becoming unwritable.
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = { file: null, action: 'warn', forceError: false, dbName: process.env.DB_NAME || 'bookstore' };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--file' && next) { args.file = next; i += 1; }
    else if (a === '--action' && next) { args.action = next.trim(); i += 1; }
    else if (a === '--db' && next) { args.dbName = next.trim(); i += 1; }
    else if (a === '--force-error') { args.forceError = true; }
  }
  return args;
}

async function main() {
  const { file, action, forceError, dbName } = parseArgs(process.argv);

  const uri = process.env.ADMIN_MONGODB_URI;
  if (!uri) {
    console.error('Set ADMIN_MONGODB_URI to a dbAdmin credential.');
    console.error('The app user (readWriteAnyDatabase) cannot run collMod — that is deliberate.');
    process.exit(1);
  }
  if (!file) {
    console.error('Pass --file <validator.json> (produced by field-sprawl.mjs --emit-validator).');
    process.exit(1);
  }
  if (!['warn', 'error'].includes(action)) {
    console.error(`--action must be "warn" or "error", got "${action}".`);
    process.exit(1);
  }

  // `error` mode makes any unblessed write FAIL. Before flipping, every writer
  // must be clean — including the ones nobody thinks of as writers, like the
  // book restore path (#3997), which spreads the drifted deleted_books shape
  // back into books.
  if (action === 'error' && !forceError) {
    console.error('REFUSING --action error without --force-error.');
    console.error('Preconditions, all of which must actually hold:');
    console.error('  1. The Atlas violation log has been quiet for a week in warn mode.');
    console.error('  2. Every writer is clean — including restore/import paths (#3997).');
    console.error('  3. You have re-emitted the schema since the last field was added.');
    console.error('An unblessed write in error mode is a 500, not a log line.');
    process.exit(1);
  }

  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const collection = spec.collMod;
  const validator = spec.validator;
  if (!collection || !validator) {
    console.error(`${file} is not a validator spec (needs "collMod" and "validator" keys).`);
    process.exit(1);
  }

  const blessed = Object.keys(validator.$jsonSchema?.properties || {}).length;
  const retired = spec._retired || [];

  console.log(`collection      : ${dbName}.${collection}`);
  console.log(`fields blessed  : ${blessed}`);
  console.log(`retired         : ${retired.length ? retired.join(', ') : '(none listed)'}`);
  console.log(`validationLevel : ${spec.validationLevel || 'moderate'}`);
  console.log(`validationAction: ${action}${action === 'error' ? '  ** ENFORCING — unblessed writes will FAIL **' : '  (violations logged, writes still succeed)'}`);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db(dbName);

  const res = await db.command({
    collMod: collection,
    validator,
    validationLevel: spec.validationLevel || 'moderate',
    validationAction: action,
  });
  console.log(`\ncollMod result  : ${JSON.stringify(res)}`);

  // Read it back — "no error" is not proof the validator is attached.
  const info = await db.listCollections({ name: collection }).toArray();
  const opts = info[0]?.options || {};
  const installed = Object.keys(opts.validator?.$jsonSchema?.properties || {}).length;
  console.log(
    `VERIFIED        : action=${opts.validationAction} level=${opts.validationLevel} ` +
    `validator=${opts.validator ? `present (${installed} fields)` : 'MISSING'}`
  );

  const ok = Boolean(opts.validator) && opts.validationAction === action && installed === blessed;
  console.log(ok ? '\nInstalled and verified.' : '\n!! Read-back does NOT match what was sent. Investigate before trusting it.');

  await client.close();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
