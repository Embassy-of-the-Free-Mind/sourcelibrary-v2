#!/usr/bin/env node
/**
 * Seed and promote OCR prompt v19.1 as the default (#4195).
 *
 * PRIOR ART: scripts/maintenance/ocr-prompt-v17-lacuna.mjs — it BUILDS a prompt
 * by patching v15 in place; v19.1 is a finished file that was measured as-is,
 * so this script loads that exact file and refuses if its hash has drifted.
 *
 * Why v19.1: the pre-registered confirmatory run (scripts/eval/RESULTS-ocr-v19-1-stamps.md,
 * PR #5655) passed all five clauses. Invented text on blank + show-through
 * leaves fell from .754 (v16, same week) to .304; loop rate was the lowest of
 * any arm. Known cost vs v18: real pages called blank rose .299 -> .360 on the
 * 88-page S3 stratum, mostly library stamps/pockets filed in <insert>.
 * Derek chose v19.1 on 2026-10-02.
 *
 * The prompt uses no <lacuna> tag, so it has no translation-prompt dependency.
 * Every OCR caller reads { type:'ocr', is_default:true } per call — no restart.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/ocr-prompt-v19-1-promote.mjs            # dry run
 *   node --env-file=.env.production.local scripts/maintenance/ocr-prompt-v19-1-promote.mjs --apply    # seed + promote
 *   node --env-file=.env.production.local scripts/maintenance/ocr-prompt-v19-1-promote.mjs --demote   # rollback to v16
 */
import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const APPLY = process.argv.includes('--apply');
const DEMOTE = process.argv.includes('--demote');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hash = (s) => createHash('md5').update(s).digest('hex');

const VERSION = 19.1;
const ROLLBACK_VERSION = 16;
const FILE = path.join(__dirname, '../../prompts/ocr/standard-ocr-v19-1-candidate.md');
const MEASURED_MD5 = '9d8f959e053491362b2c4acec1e20c9a'; // the file the eval sent (RESULTS-ocr-v19-1-stamps.md)

const content = readFileSync(FILE, 'utf8');
if (hash(content) !== MEASURED_MD5) {
  throw new Error(`${FILE} md5 ${hash(content)} != measured ${MEASURED_MD5}: the file changed after the eval; re-measure before promoting`);
}

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const col = c.db('bookstore').collection('prompts');

/** One default per type (unique index uniq_default_per_type): demote the old, then promote the new. */
async function makeDefault(row) {
  await col.updateMany({ type: 'ocr', is_default: true, _id: { $ne: row._id } }, { $set: { is_default: false } });
  await col.updateOne({ _id: row._id }, { $set: { is_default: true } });
  const now = await col.findOne({ type: 'ocr', is_default: true });
  console.log(`ocr: default is now v${now.version} (${now._id}, hash ${now.content_hash})`);
}

try {
  if (DEMOTE) {
    const row = await col.findOne({ type: 'ocr', version: ROLLBACK_VERSION });
    if (!row) throw new Error(`ocr v${ROLLBACK_VERSION} not found`);
    await makeDefault(row);
  } else {
    const current = await col.findOne({ type: 'ocr', is_default: true });
    console.log(`ocr: current default v${current?.version} (${current?._id})`);
    let row = await col.findOne({ type: 'ocr', version: VERSION });
    if (row && row.content_hash !== MEASURED_MD5) throw new Error(`existing ocr v${VERSION} row has hash ${row.content_hash}; refusing to promote it`);
    if (!APPLY) {
      console.log(`(dry run) would ${row ? 'reuse' : 'insert'} ocr v${VERSION} (${content.length} chars) and make it the default — pass --apply`);
    } else {
      if (!row) {
        const base = await col.findOne({ type: 'ocr', version: ROLLBACK_VERSION });
        const doc = {
          name: base?.name ?? 'Standard OCR', type: 'ocr', version: VERSION, is_default: false,
          content, content_hash: MEASURED_MD5, created_at: new Date().toISOString(),
          notes: 'v19.1 from prompts/ocr/standard-ocr-v19-1-candidate.md, measured as-is (#4195, PR #5655). Show-through leaves are blank; a right-reading stamp/shelfmark on one is text. Rollback: --demote restores v16.',
        };
        const { insertedId } = await col.insertOne(doc);
        row = { ...doc, _id: insertedId };
        console.log(`inserted ocr v${VERSION} ${insertedId}`);
      }
      await makeDefault(row);
    }
  }
} finally {
  await c.close();
}
