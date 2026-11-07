#!/usr/bin/env node
// PRIOR ART: scripts/audit/leaf-shift-gate-controls-5021.mjs scores the number gate on STORED English; an anchor exists
// only in a fresh reply, so this re-reads the raw replies of a claude-translate --cli=agy dry run (DIR/<lang>/raw/*-0.txt,
// the first attempt of each block) and judges each with the guard as it is now. Read-only (#5021).
/**
 *   node --env-file=.env.production.local scripts/eval/block-guard-5021/score.mjs --dir=DRY [--json] [--out=FILE]
 * Per language: blocks scored, anchors missing, pages refused by each check, blocks with any refusal. Every reply is
 * judged with the pages either side of the block as context and k from the book's stored English, as the reader does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { splitBlockReply, splitJsonReply } from '../../batch/claude-translate.mjs';
import { takeAnchors, anchorVerdicts, blockPageRefusals, lengthRatioK } from '../../lib/block-page-guard.mjs';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const DIR = arg('dir');
const JSONR = process.argv.includes('--json');   // the replies are --reply=json blocks
const c = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const db = c.db('bookstore');
const report = {}; const refusals = [];
for (const lang of fs.readdirSync(DIR).filter((d) => fs.existsSync(path.join(DIR, d, 'raw')))) {
  const r = (report[lang] = { blocks: 0, pages: 0, unparsed: 0, anchor_missing: 0, refused_pages: {}, blocks_refused: 0, anchor_verdicts: {} });
  for (const f of fs.readdirSync(path.join(DIR, lang, 'raw')).filter((x) => /-4-0\.txt$/.test(x))) {
    const m = f.match(/-([0-9a-f]{24})-(\d+)-4-0\.txt$/);
    const bookId = m[1], first = Number(m[2]);
    const nums = [first, first + 1, first + 2, first + 3];
    const reply = fs.readFileSync(path.join(DIR, lang, 'raw', f), 'utf8');
    const js = JSONR ? splitJsonReply(reply, nums) : null;
    const texts = JSONR ? js?.texts ?? null : splitBlockReply(reply, nums);
    if (!texts) { r.unparsed++; continue; }
    const all = await db.collection('pages').find({ book_id: bookId }, { projection: { page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
    const by = new Map(all.map((p) => [p.page_number, p]));
    const pages = nums.map((n) => by.get(n));
    const anchors = JSONR ? js.anchors : takeAnchors(texts);
    r.blocks++; r.pages += 4;
    for (const a of anchors.values()) if (!a.first && !a.last) r.anchor_missing++;
    const ctx = { prevOcr: by.get(first - 1)?.ocr?.data ?? null, nextOcr: by.get(first + 4)?.ocr?.data ?? null };
    for (const v of anchorVerdicts(pages, anchors, ctx)) r.anchor_verdicts[v.verdict] = (r.anchor_verdicts[v.verdict] || 0) + 1;
    const k = lengthRatioK(all.map((p) => ({ src: p.ocr?.data, en: p.translation?.data, type: p.page_type })), { min: 5 });
    const ref = blockPageRefusals(pages, texts, { anchors, ...ctx, k });
    if (ref.length) r.blocks_refused++;
    for (const x of ref) { r.refused_pages[x.reason] = (r.refused_pages[x.reason] || 0) + 1; refusals.push({ lang, book_id: bookId, page: x.page_number, reason: x.reason, detail: x.detail, raw: path.join(lang, 'raw', f) }); }
  }
  console.log(lang, JSON.stringify(r));
}
const tot = Object.values(report).reduce((a, r) => ({ blocks: a.blocks + r.blocks, pages: a.pages + r.pages, anchor_refused: a.anchor_refused + Object.entries(r.refused_pages).filter(([k]) => k.startsWith('anchor-')).reduce((s, [, v]) => s + v, 0), refused: a.refused + Object.values(r.refused_pages).reduce((s, v) => s + v, 0), blocks_refused: a.blocks_refused + r.blocks_refused }), { blocks: 0, pages: 0, anchor_refused: 0, refused: 0, blocks_refused: 0 });
console.log('TOTAL', JSON.stringify(tot));
if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify({ report, total: tot, refusals }, null, 1));
await c.close();
