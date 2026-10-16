#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate.mjs (read stage) — the prompt is built exactly as it builds it
// (loadTranslationPrompts, buildTranslationPrompt with PAGE_BREAK_SCOPED, the page before as seed, the neighbours' OCR,
// + agy-cli's TRANSLATE_SUFFIX); scripts/eval/pro-translate-6545/build-requests.py writes the same {uid, prompt} rows for
// the #6545 panel, but from #6182's units prompt, which has no seed and no page-break devices.
/**
 * #6728 — $0, read-only. Request files for the two prompts on the #6545 panel (132 pages, one per work):
 *   $W/req/CUR.jsonl    the live default prompt, as cli-translate.mjs sends it (the stored previous page as seed)
 *   $W/req/PLAIN.jsonl  the same with prompts.mjs PLAIN_EDITS applied, the seed through plainSeed()
 * The page text is the #6182 record's OCR (what the reference was cut against and what the judge sees as source).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/plain-6728/build-requests.mjs
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, loadTranslationPrompts } from '../../lib/translate-core.mjs';
import { TRANSLATE_SUFFIX } from '../../lib/agy-cli.mjs';
import { plainPrompt, plainSeed, md5 } from './prompts.mjs';

const W = process.env.W6728 || `${process.env.JOB_SCRATCH}/w`;
const panel = JSON.parse(fs.readFileSync(`${W}/panel.json`, 'utf8'));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const live = await loadTranslationPrompts(db);
if (live.translation.ref.name !== 'Standard Translation' || live.translation.ref.version !== 13) throw new Error(`live default is ${live.translation.ref.name} v${live.translation.ref.version}, not v13: re-check PLAIN_EDITS`);
const plainText = plainPrompt(live.translation.text);
const P = {
  CUR: live,
  PLAIN: { translation: { text: plainText, ref: { id: null, name: 'Standard Translation v13, interpretive instructions removed [in memory, #6728]', version: 13, content_hash: md5(plainText) } }, english: live.english },
};
fs.writeFileSync(`${W}/prompt-plain.txt`, plainText);
fs.writeFileSync(`${W}/prompt-current.txt`, live.translation.text);
const PROJ = { id: 1, book_id: 1, page_number: 1, ocr: 1, translation: 1 };
const out = { CUR: [], PLAIN: [] };
const stats = { seed: 0, noSeed: 0, deviceFired: 0 };
for (const r of panel) {
  const book = await db.collection('books').findOne({ id: r.book_id });
  if (!book) throw new Error(`book ${r.book_id} not found`);
  const near = await db.collection('pages').find({ book_id: r.book_id, page_number: { $in: [r.page_number - 1, r.page_number + 1] } }, { projection: PROJ }).toArray();
  const prev = near.find((n) => n.page_number === r.page_number - 1), next = near.find((n) => n.page_number === r.page_number + 1);
  const seed = prev?.translation?.data || null;
  stats[seed ? 'seed' : 'noSeed']++;
  for (const arm of ['CUR', 'PLAIN']) {
    const built = buildTranslationPrompt({ prompts: P[arm], book, ocrText: r.ocr_text, previousTranslation: arm === 'PLAIN' ? plainSeed(seed) : seed, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined, pageBreak: PAGE_BREAK_SCOPED });
    if (arm === 'CUR' && built.pageBreak?.applied) stats.deviceFired++;
    const prompt = built.prompt + TRANSLATE_SUFFIX;
    out[arm].push({ uid: r.uid, lang: r.lang, book_id: r.book_id, page_number: r.page_number, prompt, prompt_hash: md5(prompt), prompt_ref: built.promptRef, seeded: !!seed, page_break: built.pageBreak });
  }
}
await c.close();
fs.mkdirSync(`${W}/req`, { recursive: true });
for (const [arm, rows] of Object.entries(out)) fs.writeFileSync(`${W}/req/${arm}.jsonl`, rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
const mean = (a) => Math.round(a.reduce((s, x) => s + x.prompt.length, 0) / a.length);
console.log(`CUR ${md5(live.translation.text)} PLAIN ${md5(plainText)}; ${panel.length} pages; seeded ${stats.seed}, unseeded ${stats.noSeed}; page-break devices applied ${stats.deviceFired}; mean prompt chars CUR ${mean(out.CUR)} PLAIN ${mean(out.PLAIN)}`);
