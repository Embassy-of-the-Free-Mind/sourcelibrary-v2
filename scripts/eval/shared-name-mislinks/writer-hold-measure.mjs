#!/usr/bin/env node
// PRIOR ART: scripts/eval/shared-name-mislinks/draw-sample.mjs + score.mjs — sample and score
// mentions already ON a bare record. tests/unit/entity-page-attribution.test.ts — greps the five
// writers. Neither runs a writer to see which records it would touch.
/**
 * Which `entities` records does an index writer touch for a book, with and without the
 * shared-surname hold? (#5950) READ-ONLY: no model call, no write.
 *
 * It runs the entity sync of scripts/batch/batch-generate-indexes.mjs — the function's own source,
 * cut out of the file given by --source — on the people/places/concepts each book's stored index
 * already holds, against a database stand-in that records every `entities` write instead of
 * making it. Run it once on main's copy of the writer and once on the branch's:
 *
 *   git show origin/main:scripts/batch/batch-generate-indexes.mjs > /tmp/before.mjs
 *   node --env-file=.env.production.local scripts/eval/shared-name-mislinks/writer-hold-measure.mjs --source /tmp/before.mjs
 *   node --env-file=.env.production.local scripts/eval/shared-name-mislinks/writer-hold-measure.mjs --source scripts/batch/batch-generate-indexes.mjs
 *
 * Books: the first --per (default 3) books on each held surname's bare record, by book id.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { entityCounters } from '../../lib/entity-page-match.mjs';
import { HELD_SURNAMES, isHeldSurname } from '../../lib/shared-surname-hold.mjs';

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : dflt; };
const source = arg('--source', 'scripts/batch/batch-generate-indexes.mjs');
const per = Number(arg('--per', 3));

/** The writer's own `syncBookEntities`, cut from its file and given the two helpers it imports. */
function loadSync(file) {
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf('async function syncBookEntities');
  const end = text.indexOf('\n}\n', start);
  if (start < 0 || end < 0) throw new Error(`no syncBookEntities in ${file}`);
  return new Function('entityCounters', 'isHeldSurname', `${text.slice(start, end + 2)}\nreturn syncBookEntities;`)(entityCounters, isHeldSurname);
}

/** Stands in for `db`: records the name and type of every entities write, performs none. */
function recorder() {
  const touched = new Map();
  const entities = {
    updateOne: async (filter, update) => {
      if (update.$push?.books) touched.set(`${filter.type}:${filter.name}`, { name: filter.name, type: filter.type });
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    },
    findOne: async () => null,
  };
  return { db: { collection: () => entities }, touched };
}

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000, readPreference: 'secondaryPreferred' });
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const sync = loadSync(source);
  const surnames = Object.keys(HELD_SURNAMES);
  let books = 0, personTerms = 0, attached = 0, onHeldBare = 0;
  for (const surname of surnames) {
    const bare = await db.collection('entities').findOne({ name: surname, type: 'person' }, { projection: { 'books.book_id': 1 } });
    const ids = (bare?.books || []).map(b => b.book_id).sort();
    let done = 0;
    for (const id of ids) {
      if (done >= per) break;
      const book = await db.collection('books').findOne({ id }, { projection: { id: 1, title: 1, author: 1 } });
      // The full index is in `book_indexes`; `books.index` keeps a part of it at most.
      const index = await db.collection('book_indexes').findOne({ book_id: id }, { projection: { people: 1, places: 1, concepts: 1 } });
      const people = index?.people || [];
      // Only a book whose stored index still has the bare term shows what a re-index would do.
      if (!book || !people.some(p => p.term === surname)) continue;
      done++;
      const rec = recorder();
      await sync(rec.db, book.id, book.title, book.author, { people, places: index.places || [], concepts: index.concepts || [] });
      const persons = [...rec.touched.values()].filter(t => t.type === 'person');
      const held = persons.filter(t => isHeldSurname(t.name, 'person')).map(t => t.name);
      books++; personTerms += people.filter(p => p.term).length; attached += persons.length; onHeldBare += held.length;
      console.log(`${surname}\t${book.id}\tperson terms ${people.filter(p => p.term).length}\tperson records written ${persons.length}\tof them a held bare record: ${held.join(', ') || 'none'}`);
    }
  }
  console.log(`\n${source}\n${books} books, ${personTerms} person terms in their indexes: ${attached} person records written, ${onHeldBare} of them a held bare-surname record.`);
} finally {
  await client.close();
}
