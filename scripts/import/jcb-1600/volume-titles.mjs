#!/usr/bin/env node
/**
 * JCB pre-1600 (#8049): give each imported volume of a multi-volume set its volume in the title, from IA's
 * `volume` field, and recompute its identity fields, so volumes 2..n stop keying onto volume 1.
 *
 * PRIOR ART: ia-manifest-direct.mjs now does this at insert (same rule, same "(vol. N)" form); this repairs
 * the books it inserted before that fix. scripts/workers/identity-worker.mjs --restamp recomputes identity
 * corpus-wide but never changes a title. Campaign books only.
 *
 *   node --env-file=.env.production.local scripts/import/jcb-1600/volume-titles.mjs [--apply]
 */
import { MongoClient } from 'mongodb';
import { computeIdentityFields } from '../../lib/identity-fields.mjs';

const APPLY = process.argv.includes('--apply');
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; #8049)';
const HAS_VOL = /\b(vol(ume)?|tom(us|o|e)?|band|teil|deel|pt|part|liber)\b\.?\s*\(?\s*[\divxlcdm]/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const books = mc.db('bookstore').collection('books');
const docs = await books.find({ acquisition_campaign: 'jcb-1600-8049' }, { projection: { id: 1, title: 1, author: 1, year: 1, published: 1, ia_identifier: 1 } }).toArray();
let n = 0;
for (const b of docs) {
  if (HAS_VOL.test(b.title)) continue;
  const r = await fetch(`https://archive.org/metadata/${b.ia_identifier}/metadata/volume`, { headers: { 'User-Agent': UA } }).then((x) => x.json()).catch(() => ({}));
  await sleep(400);
  const vol = Array.isArray(r.result) ? r.result[0] : r.result;
  if (!vol) continue;
  const title = `${b.title} (vol. ${String(vol).trim()})`;
  const ident = computeIdentityFields({ ...b, title });
  n++;
  console.log(`${APPLY ? 'SET ' : 'DRY '} ${b.ia_identifier.padEnd(28)} vol ${String(vol).padEnd(8)} ${ident.edition_key}`);
  if (APPLY) await books.updateOne({ _id: b._id }, { $set: { title, ...ident, updated_at: new Date() } });
}
console.log(`${n} of ${docs.length} books ${APPLY ? 'retitled' : 'would be retitled'}`);
await mc.close();
