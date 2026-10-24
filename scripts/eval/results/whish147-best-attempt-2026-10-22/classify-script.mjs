// SCRIPT MAP (#7119, spot check of 2026-10-23 06:08Z: leaf p150 is not Malayalam script). One sealed Opus call per
// leaf page: the whole leaf downscaled to 2,000 px wide (p01) plus a full-resolution crop of its left third (p02), and
// the question "which script, which hand". The answers group the pages into hands/scripts (classify-script.json);
// the IA record (raswhish145-147: ONE manuscript, RAS South Indian Sanskrit MS 145 = Whish MS 147, six texts) says
// which works to expect.
//   node --env-file=/root/sourcelibrary/.env.production.local classify-script.mjs [--pages=2-315] [--concurrency=3]
// PRIOR ART: probe.mjs (one sealed call per scan for invocations/colophons; asks about text, not script) and fresh.mjs
// (column crops for reading); lib.mjs sealedCall is reused as is.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
import { HERE, BOOK, SCRATCH, sealedCall, pool } from './lib.mjs';

const args = process.argv.slice(2);
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const CONC = Number(arg('concurrency') || 3);
const [P0, P1] = (arg('pages') || '1-316').split('-').map(Number);
const IMG = path.join(SCRATCH, 'classify-img');
fs.mkdirSync(IMG, { recursive: true });

export const SCRIPTS = ['Malayalam', 'Grantha', 'Tamil', 'Telugu', 'Kannada', 'Tigalari', 'Nandinagari', 'Devanagari', 'other', 'no writing'];
export const PROMPT = `p01.jpg is one whole palm leaf from a South Indian manuscript bundle (Royal Asiatic Society, Whish collection; Sanskrit texts, Kerala, c. 1822), downscaled; p02.jpg is the left third of the same leaf at full resolution. Open both with the Read tool.

Identify the SCRIPT the main text of this leaf is written in, from the letter shapes alone (do not try to read the text). Choose one of: ${SCRIPTS.join(', ')}. Note distinctive shapes that decide it (e.g. Malayalam's round, open loops and dot-reph ൎ; Telugu's check-mark tick ✓ heads; Kannada's flat hooked heads; Grantha's angular Tamil-like forms with conjuncts; Tigalari's slanted Kannada-like letters). Also describe the hand (letter size relative to the leaf, rows per leaf, dense or open) and anything in another script (a marginal number, a note).

Answer only with one JSON object on one line:
{"script": "<one of the list>", "confidence": "high|medium|low", "second_choice": "<one of the list or null>", "evidence": "<the shapes that decide it, one sentence>", "rows": <number of text rows, or 0>, "hand": "<small/medium/large letters, dense/open>", "other_marks": "<marginal numbers or notes and their script, or none>"}`;

async function main() {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const pages = await c.db('bookstore').collection('pages').find({ book_id: BOOK, page_number: { $gte: P0, $lte: P1 } }, { projection: { id: 1, page_number: 1, archived_photo: 1 } }).sort({ page_number: 1 }).toArray();
  await c.close();
  const out = path.join(HERE, 'classify-script.json');
  const res = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
  await pool(pages, CONC, async (p) => {
    const files = [path.join(IMG, `${p.page_number}-w.jpg`), path.join(IMG, `${p.page_number}-l.jpg`)];
    if (!fs.existsSync(files[1])) {
      const buf = Buffer.from(await (await fetch(p.archived_photo)).arrayBuffer());
      const m = await sharp(buf).metadata();
      await sharp(buf).resize({ width: Math.min(2000, m.width) }).jpeg({ quality: 85 }).toFile(files[0]);
      const w = Math.min(Math.round(m.width / 3), 1800);
      await sharp(buf).extract({ left: 0, top: 0, width: w, height: m.height }).jpeg({ quality: 90 }).toFile(files[1]);
    }
    const r = await sealedCall({ stage: 'classify', id: `p${p.page_number}`, model: 'opus', prompt: PROMPT, images: files });
    let j = null;
    try { j = JSON.parse((r.text.match(/\{[\s\S]*\}/) || [''])[0]); } catch { /* recorded as unparsed */ }
    res[p.page_number] = { id: p.id, ok: r.meta.ok, model: r.meta.model, ...(j || { unparsed: r.text.slice(0, 300) }) };
    console.log(`p${p.page_number}: ${j ? `${j.script} (${j.confidence}; 2nd ${j.second_choice}) rows=${j.rows} — ${j.evidence}` : `unparsed ${r.meta.error_class || ''}`}`);
    save(out, res);
  });
  save(out, res);
}
const save = (f, res) => fs.writeFileSync(f, JSON.stringify(Object.fromEntries(Object.entries(res).sort((a, b) => a[0] - b[0])), null, 0).replace(/\},"/g, '},\n"'));
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main();
