#!/usr/bin/env node
// PRIOR ART: none — a throwaway viewer for one call's anchors against its pages' sources (#5021 dry run); looked in
// scripts/eval/block-guard-5021/ (this job's) and scripts/audit/leaf-shift-*.
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { splitBlockReply } from '../../batch/claude-translate.mjs';
import { takeAnchors, anchorFold, anchorVerdicts } from '../../lib/block-page-guard.mjs';
const [raw, bookId] = process.argv.slice(2);
const text = fs.readFileSync(raw, 'utf8');
const nums = [...text.matchAll(/<translation\s+page="(\d+)">/g)].map((m) => Number(m[1]));
const c = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const db = c.db('bookstore');
const pages = await db.collection('pages').find({ book_id: bookId, page_number: { $gte: nums[0] - 1, $lte: nums[nums.length - 1] + 1 } }, { projection: { page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
const tr = splitBlockReply(text, nums);
const anchors = takeAnchors(tr);
const inCall = pages.filter((p) => nums.includes(p.page_number));
const prev = pages.find((p) => p.page_number === nums[0] - 1), next = pages.find((p) => p.page_number === nums[nums.length - 1] + 1);
for (const v of anchorVerdicts(inCall, anchors, { prevOcr: prev?.ocr?.data ?? null, nextOcr: next?.ocr?.data ?? null })) {
  const a = anchors.get(v.page_number);
  const f = anchorFold(pages.find((p) => p.page_number === v.page_number).ocr.data);
  console.log(v.page_number, v.verdict, `own ${v.own} prev ${v.prev} next ${v.next}`, '\n  anchor', JSON.stringify(a), '\n  fold head', f.slice(0, 40), '\n  fold tail', f.slice(-40), '\n  tr head', tr.get(v.page_number).slice(0, 120).replace(/\n/g, ' '));
}
await c.close();
