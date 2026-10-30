// Shared pieces of the keyword page service's Node half (#6852): paths, the Mongo client, and the page row
// the pull and the delta send. The index, the analyzer and the queries are the Python half (kwindex.py,
// server.py): tantivy, after SQLite FTS5 was measured too slow on common words (README.md).
//
// PRIOR ART: scripts/workers/vector-search/lib.mjs — the same layout (paths, client, atomic state writes);
// sourcelibrary-atlas scripts/local-corpus/mirror-pages.mjs — the page projection.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const ROOT = process.env.KEYWORD_SEARCH_ROOT || '/data/keyword-search';
export const SHARD_DIR = path.join(ROOT, 'shards');
export const LOG_DIR = path.join(ROOT, 'logs');

// ---------------------------------------------------------------------------------------------------
// Mongo + small helpers
// ---------------------------------------------------------------------------------------------------

/**
 * Read-only Mongo client with zlib wire compression: page text is the bulk of every byte this service
 * reads, and compression cuts Atlas egress 3.5–14× for text (measured for the dump tooling).
 */
export async function mongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set (run with node --env-file=/root/sourcelibrary/.env.production.local)');
  let mod;
  try { mod = require('mongodb'); } catch { mod = createRequire('/root/sourcelibrary/package.json')('mongodb'); }
  const client = new mod.MongoClient(uri, { compressors: ['zlib'], zlibCompressionLevel: 6, maxPoolSize: 16, readPreference: 'secondaryPreferred' });
  await client.connect();
  return { client, db: client.db(process.env.MONGODB_DB || 'bookstore') };
}

/** tmp + rename: state.json is the commit point, so it is never half-written. */
export function writeJsonAtomic(p, obj) {
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

export const log = (...a) => console.log(new Date().toISOString(), ...a);

/** The page fields every reader of `pages` here projects. */
export const PAGE_PROJECTION = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, repeat_of: 1, 'translation.data': 1, 'ocr.data': 1, 'translation.updated_at': 1, 'ocr.updated_at': 1 };

/** A page document → the row this service stores, or null when it has nothing the Atlas lane can match (or is a hidden repeat). */
export function pageRow(p) {
  const tr = p.translation?.data || '';
  const ocr = p.ocr?.data || '';
  if (!(p.page_number > 0) || (!tr && !ocr) || !p.id || !p.book_id) return null;
  if (p.repeat_of != null) return null; // a hidden repeat capture: its leaf is indexed already (#5056); the delta removes it
  const tu = p.translation?.updated_at ? +new Date(p.translation.updated_at) : 0;
  const ou = p.ocr?.updated_at ? +new Date(p.ocr.updated_at) : 0;
  return { i: String(p.id), b: String(p.book_id), n: p.page_number, t: p.page_type || '', tr, o: ocr, u: Math.max(tu, ou) || 0 };
}
