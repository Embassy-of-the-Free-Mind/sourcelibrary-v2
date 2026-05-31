#!/usr/bin/env node
/**
 * Flag malformed translation_catalogs rows for manual review (issue #2234 #8).
 * The "noise" (translators stuffed in the author field, scrambled name order,
 * non-Latin/non-relevant rows) is too heterogeneous to auto-rewrite safely —
 * auto-extraction would mis-assign translators. So we FLAG, not fix.
 *
 * Flags rows where author/canonical_author embeds a translator marker
 * ("(trans", "(translator)", "(translation"). Sets needs_review + review_reason.
 * Usage: node scripts/maintenance/flag-malformed-catalog-authors.mjs [--apply]
 */
import { MongoClient } from 'mongodb';
const APPLY = process.argv.includes('--apply');
const c=new MongoClient(process.env.MONGODB_URI); await c.connect();
const tc=c.db('bookstore').collection('translation_catalogs');
const filter={$or:[{author:/\(trans/i},{canonical_author:/\(trans/i},{author:/\(translat/i},{canonical_author:/\(translat/i}]};
const n=await tc.countDocuments(filter);
console.log(`${APPLY?'APPLIED':'DRY-RUN'}: ${n} malformed-author rows to flag needs_review`);
if(APPLY){ const r=await tc.updateMany(filter,{$set:{needs_review:true,review_reason:'malformed_author_translator_embedded'}}); console.log(`modified ${r.modifiedCount}`); }
await c.close();
