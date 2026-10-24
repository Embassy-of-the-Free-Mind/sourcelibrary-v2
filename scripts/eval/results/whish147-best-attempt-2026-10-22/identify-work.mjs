// WHICH WORK, IN WHICH ORDER, in the dense hand of pp. 131–221 (scans 66–111; #7119 manuscript map). The probe
// (probe.mjs) found the Tattvakaumudī colophon at 66b and the scribe's closing verse at 67t, but no opening anywhere
// in 66–111, and the fresh reads of this hand are too poor to place. One sealed Opus call per sampled leaf: the top
// rows of the leaf at full resolution in three overlapping pieces, asking for an opening formula and for the
// kārikā the commentary is on (its pratīka), so the leaves can be ordered against the Sāṅkhyakārikā.
//   node --env-file=/root/sourcelibrary/.env.production.local identify-work.mjs --pages=134,150,170 [--concurrency=3]
// PRIOR ART: probe.mjs (whole-scan, invocations/colophons only) and classify-script.mjs (script, not text).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
import { HERE, BOOK, SCRATCH, sealedCall, pool } from './lib.mjs';

const args = process.argv.slice(2);
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const CONC = Number(arg('concurrency') || 3);
const PAGES = (arg('pages') || '').split(',').map(Number).filter(Boolean);
const IMG = path.join(SCRATCH, 'identify-img');
fs.mkdirSync(IMG, { recursive: true });

export const PROMPT = `p01.jpg, p02.jpg and p03.jpg are the top rows of ONE palm leaf (left, middle, right; the pieces overlap slightly), at full resolution. The leaf is from a Kerala bundle of Sanskrit texts in Malayalam script (Royal Asiatic Society, Whish MS 147, 1822); this part of the bundle is in a small, dense hand. The bundle holds the Sāṅkhyakārikā, two commentaries on it (Śaṅkara's Jayamaṅgalā and Vācaspati Miśra's Tattvakaumudī), an unidentified Sāṅkhya fragment, and Annambhaṭṭa's Tarkasaṃgraha with its Dīpikā. Open all three files with the Read tool.

1. Transcribe the first three rows as well as you can, in IAST, with [?] for what you cannot read. Write only what the strokes show.
2. Is there an opening formula (hariḥ śrīgaṇapataye namaḥ, avighnam astu) or a colophon (iti … samāptā)?
3. If a verse of the Sāṅkhyakārikā is quoted or commented on here (a pratīka, or technical words that belong to one verse), which verse number? Say what words tell you; say "cannot tell" if nothing does. Do not guess from what you expect this part of the bundle to hold.

Answer only with one JSON object on one line:
{"rows": "<your IAST, rows separated by ' / '>", "formula": "opening|colophon|none", "karika": <number or null>, "karika_evidence": "<the words that place it, or 'cannot tell'>", "work_guess": "Tattvakaumudi|Jayamangala|fragment|Malayalam note|other|cannot tell", "legible_share": "<about how much of the three rows you could read: none/little/half/most>"}`;

async function main() {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const pages = await c.db('bookstore').collection('pages').find({ book_id: BOOK, page_number: { $in: PAGES } }, { projection: { id: 1, page_number: 1, archived_photo: 1 } }).toArray();
  await c.close();
  const out = path.join(HERE, 'identify-work.json');
  const res = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
  await pool(pages, CONC, async (p) => {
    const files = [1, 2, 3].map((i) => path.join(IMG, `${p.page_number}-${i}.jpg`));
    if (!fs.existsSync(files[2])) {
      const buf = Buffer.from(await (await fetch(p.archived_photo)).arrayBuffer());
      const m = await sharp(buf).metadata();
      // the writing starts about a fifth of the way down a leaf image; three rows of this hand fill about a quarter
      const top = Math.round(m.height * 0.17), height = Math.round(m.height * 0.3);
      const w = Math.round(m.width / 3), ov = 80;
      for (let i = 0; i < 3; i++) {
        const left = Math.max(0, i * w - ov), right = Math.min(m.width, (i + 1) * w + ov);
        await sharp(buf).extract({ left, top, width: right - left, height }).jpeg({ quality: 92 }).toFile(files[i]);
      }
    }
    const r = await sealedCall({ stage: 'identify', id: `p${p.page_number}`, model: 'opus', prompt: PROMPT, images: files });
    let j = null;
    try { j = JSON.parse((r.text.match(/\{[\s\S]*\}/) || [''])[0]); } catch { /* kept as unparsed */ }
    res[p.page_number] = { id: p.id, ok: r.meta.ok, ...(j || { unparsed: r.text.slice(0, 600) }) };
    console.log(`p${p.page_number}: ${j ? `${j.formula} kārikā=${j.karika} (${j.karika_evidence}) ${j.work_guess} legible=${j.legible_share} | ${String(j.rows).slice(0, 160)}` : 'unparsed'}`);
    fs.writeFileSync(out, JSON.stringify(res, null, 1));
  });
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main();
