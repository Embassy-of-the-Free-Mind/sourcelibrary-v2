/**
 * Record or read a relation between two books — the command-line door to
 * src/lib/book-relations.ts (#3102, #6019 decision 5). There is no UI.
 *
 * PRIOR ART: scripts/maintenance/mark-bncf-aldine-copy-duplicates.mjs and
 * hide-efm-duplicates.mjs — they write `duplicate_of`, which HIDES the copy;
 * this records "another copy of the same edition" / "bound with" / "contains"
 * and changes nothing about either book. scripts/maintenance/
 * duplicate-integrity-check.mjs audits `duplicate_of` and does not write
 * relations. The logic lives in the lib; this only parses arguments.
 *
 * `add` is a DRY RUN unless --apply is given. It writes one row to
 * `book_relations` and never touches `books`. Nothing automated reads the
 * collection; `checkHoldings()` lists the related book on a lookup.
 *
 * Usage (from the repo root):
 *   npx tsx --env-file=.env.production.local scripts/maintenance/book-relation.ts list <book>
 *   npx tsx --env-file=.env.production.local scripts/maintenance/book-relation.ts add <book-a> <book-b> \
 *       --type other_copy_of_edition|bound_with|contains --evidence "what was compared" --by <who> [--apply]
 *   … add --file pairs.json --by <who> [--apply]     # [{ a, b, type, evidence }]
 *
 * <book> is a book id, an _id, a slug or a sourcelibrary.org book URL. For
 * `contains`, <book-a> is the volume and <book-b> the part inside it.
 */

import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { addRelation, relationsOf, resolveBookId, orderPair, isRelationType, BOOK_RELATIONS, RELATION_TYPES, type AddRelationInput } from '../../src/lib/book-relations';
import { ourBookRef } from '../../src/lib/holdings-check';

const ref = (s: string) => ourBookRef(s) ?? s;

function parse(argv: string[]) {
  const pos: string[] = [];
  const opt: Record<string, string> = {};
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a.startsWith('--')) opt[a.slice(2)] = argv[++i] ?? '';
    else pos.push(a);
  }
  return { cmd: pos[0], args: pos.slice(1), opt, apply };
}

async function main() {
  const { cmd, args, opt, apply } = parse(process.argv.slice(2));
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set — run with --env-file=.env.production.local');
  if (cmd !== 'list' && cmd !== 'add') throw new Error('Usage: book-relation.ts list <book> | add <a> <b> --type … --evidence … --by … [--apply]. See the header of this file.');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || 'bookstore');

    if (cmd === 'list') {
      if (!args[0]) throw new Error('list needs a book');
      const rels = await relationsOf(db, ref(args[0]));
      if (rels.length === 0) console.log('No relations recorded.');
      for (const r of rels) console.log(`${r.of}  ${r.role}  ${r.book_id}  — ${r.evidence}  (${r.created_by}, ${r.created_at?.toISOString().slice(0, 10) ?? 'no date'})`);
      return;
    }

    const by = opt.by;
    const inputs: AddRelationInput[] = opt.file
      ? (JSON.parse(readFileSync(opt.file, 'utf8')) as AddRelationInput[]).map((p) => ({ ...p, created_by: by }))
      : [{ a: args[0], b: args[1], type: opt.type as AddRelationInput['type'], evidence: opt.evidence, created_by: by }];
    if (!by) throw new Error('--by is required: who is recording this');

    let failed = 0;
    for (const input of inputs) {
      const pair = { ...input, a: ref(String(input.a ?? '')), b: ref(String(input.b ?? '')) };
      try {
        if (apply) {
          const { relation, created } = await addRelation(db, pair);
          console.log(`${created ? 'ADDED ' : 'EXISTS'} ${relation.a}  ${relation.type}  ${relation.b}`);
          continue;
        }
        // Dry run: the same checks, no write.
        if (!isRelationType(pair.type)) throw new Error(`unknown type "${pair.type}" (one of ${RELATION_TYPES.join(', ')})`);
        if (!String(pair.evidence ?? '').trim()) throw new Error('evidence is required');
        const [a, b] = await Promise.all([resolveBookId(db, pair.a), resolveBookId(db, pair.b)]);
        if (!a || !b) throw new Error(`no book resolves from "${a ? pair.b : pair.a}"`);
        if (a === b) throw new Error(`both ends are the same book (${a})`);
        const key = { ...orderPair(a, b, pair.type), type: pair.type };
        const exists = await db.collection(BOOK_RELATIONS).findOne(key);
        console.log(`[dry-run] ${exists ? 'exists   ' : 'would add'} ${key.a}  ${key.type}  ${key.b}`);
      } catch (err) {
        failed++;
        console.error(`REFUSED ${pair.a} / ${pair.b}: ${(err as Error).message}`);
      }
    }
    if (!apply) console.log('Dry run — nothing written. Re-run with --apply.');
    if (failed) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(2);
});
