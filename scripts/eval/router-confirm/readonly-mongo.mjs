// PRIOR ART: none — searched scripts/lib and scripts/eval for a read-only Mongo guard (`git grep -n "prototype.updateOne"`,
// "readonly", "read-only" in scripts/lib/*mongo*): every eval relies on the writer's own dry-run flag. cli-ocr.mjs
// `read` still records the job's book list (lane_job_books, #7301) and has no flag to skip it.
//
// Preloaded into every reader the V4 harness spawns (`node --import=<this>`): each Collection write method throws, so a
// confirmation run writes nothing to the database whatever the reader it runs. A reader that treats a write as best
// effort (recordLaneBooks) logs the refusal and goes on; one that needs the write fails loudly, never silently.
import { Collection, Db } from 'mongodb';

const WRITES = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'bulkWrite',
  'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'createIndex', 'createIndexes', 'dropIndex', 'drop', 'rename'];
for (const m of WRITES) {
  Collection.prototype[m] = function refused() { throw new Error(`read-only (router-confirm): ${this.collectionName}.${m} refused`); };
}
for (const m of ['createCollection', 'dropDatabase', 'dropCollection', 'renameCollection']) {
  Db.prototype[m] = function refused() { throw new Error(`read-only (router-confirm): db.${m} refused`); };
}
