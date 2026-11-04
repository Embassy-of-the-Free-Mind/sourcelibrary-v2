#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/repair-author-links-8035.mjs (a literal list, logged first), normalize-sancai-tuhui-4394.mjs
 * (one work's titles, but a rule, not a list of corrections). Neither covers these volumes.
 *
 * fix-histories-juan-labels-8053 — Internet Archive's juan labels on six volumes of the Four Histories are wrong (#8053).
 * The stored title came from IA's label, not from the leaf. Each correction was checked against the volume's own running
 * headers in the OCR (漢書卷N / 史記卷N counted across its pages, 2026-11-04). Reads as text evidence, not by eye.
 *
 * Vol 25 also says what is missing. It ends at leaf 36a of juan 36, the Kanripo WYG text has 52, and no volume holds
 * juan 37. The set is short; #7546 had left this open.
 *
 *   node --env-file=.env.production.local scripts/maintenance/fix-histories-juan-labels-8053.mjs        dry run
 *   ... --apply
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SWEEP = 'fix-histories-juan-labels-8053';
const APPLY = process.argv.includes('--apply');

const FIXES = [
  { id: '6ae0be694adf2ffb52f72c72', before: '前漢書·卷十五下 (Hanshu, Siku Quanshu, vol. 8 of 57)', after: '前漢書·卷十六 (Hanshu, Siku Quanshu, vol. 8 of 57)', evidence: 'headers 十六×2' },
  { id: '6ae0beb34adf2ffb52f72f36', before: '前漢書·卷二十上~卷二十下 (Hanshu, Siku Quanshu, vol. 12 of 57)', after: '前漢書·卷二十一上~卷二十一下 (Hanshu, Siku Quanshu, vol. 12 of 57)', evidence: 'headers 二十一上×4 二十一下×3' },
  { id: '6ae0bf3b4adf2ffb52f731bb', before: '前漢書·卷二十五六 (Hanshu, Siku Quanshu, vol. 17 of 57)', after: '前漢書·卷二十五下~卷二十六 (Hanshu, Siku Quanshu, vol. 17 of 57)', evidence: 'headers 二十五下×2 二十六×2' },
  { id: '6ae0bf904adf2ffb52f735d1', before: '前漢書·卷三十一~卷三十二 (Hanshu, Siku Quanshu, vol. 24 of 57)', after: '前漢書·卷三十三~卷三十五 (Hanshu, Siku Quanshu, vol. 24 of 57)', evidence: 'headers 三十五×5 三十三×4 三十四×3' },
  { id: '6ae0bf9a4adf2ffb52f73668', before: '前漢書·卷三十三~卷三十五 (Hanshu, Siku Quanshu, vol. 25 of 57)', after: '前漢書·卷三十六（至第三十六葉；卷三十七未收）(Hanshu, Siku Quanshu, vol. 25 of 57)', evidence: 'header 三十六×1; ends at leaf 36a of 52 per job zh-held-quality-8053' },
  { id: '6ae0bd884adf2ffb52f72549', before: '史記·卷一百七 (Shiji, Siku Quanshu, vol. 40 of 44)', after: '史記·卷一百十七 (Shiji, Siku Quanshu, vol. 40 of 44)', evidence: 'headers 一百一十七×2 一百十七×1; 50 page-centre headers per job zh-held-quality-8053' },
];

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
let written = 0;
for (const f of FIXES) {
  const b = await books.findOne({ id: f.id }, { projection: { title: 1, visible: 1 } });
  if (!b) { console.log(`NOT FOUND ${f.id}`); continue; }
  if (b.title === f.after) { console.log(`already ${f.after}`); continue; }
  if (b.title !== f.before) { console.log(`REFUSED ${f.id}: title is "${b.title}"`); continue; }
  console.log(`${f.before}\n  -> ${f.after}`);
  if (!APPLY) continue;
  await recordSweepAction(db, { sweep: SWEEP, book_id: f.id, action: 'correct-juan-label', detail: { before: f.before, after: f.after, evidence: f.evidence }, script: 'scripts/maintenance/fix-histories-juan-labels-8053.mjs' });
  written += (await books.updateOne({ id: f.id, title: f.before }, { $set: { title: f.after } })).modifiedCount;
}
console.log({ apply: APPLY, written, of: FIXES.length });
await client.close();
