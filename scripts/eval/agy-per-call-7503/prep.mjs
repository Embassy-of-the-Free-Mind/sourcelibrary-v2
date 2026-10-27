#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/sampling.mjs getPage (one page's OCR, no neighbours, no blinding);
// scripts/eval/lib/paired-stats.mjs makeRng. The judge packets of earlier evals (e.g. scripts/eval/pareto-6182) hold
// OCR reads of an image, not four English versions of one text with planted controls.
/**
 * #7503 blind judge packets. Two stages:
 *
 *   controls  node scripts/eval/agy-per-call-7503/prep.mjs controls
 *             Seeded: 5 pages from 5 different books (3 `drop`, 2 `bleed`), each followed in the draw by its next page.
 *             Writes controls.json and control-ids.json (fed to a fresh one-per-call read, the CTL arm, that is then
 *             tampered: a judge that has another arm's text beside a copy of it could find the planted fault by diffing).
 *   packets   node --env-file=... scripts/eval/agy-per-call-7503/prep.mjs packets --scratch=DIR
 *             Per page: the image (downloaded to DIR/judge/img), the OCR of the page and of its neighbours, and the four
 *             arms' English (plus the tampered CTL read on a control page) under shuffled letters. <summary> and
 *             <keywords> are cut from every version (the judge reads the translation). The letter -> arm key goes
 *             to DIR/judge/key.json, never into a packet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
const ARMS = ['A1', 'A1b', 'B2', 'C4'];

function shuffle(a, rng) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export const body = (t) => String(t || '').replace(/<summary>[\s\S]*?<\/summary>/g, '').replace(/<keywords>[\s\S]*?<\/keywords>/g, '').trim();

/** Sentences of the translation body that are long enough to be missed, outside notes and tags. */
function sentences(t) {
  const plain = t.replace(/<note>[\s\S]*?<\/note>/g, '');
  return (plain.match(/[^.!?。]+[.!?]["”’)]*/g) || []).map((s) => s.trim()).filter((s) => s.length >= 80 && !/[<>]/.test(s));
}

if (process.argv[2] === 'controls') {
  const rng = makeRng(75031);
  const books = shuffle(draw.books, rng).slice(0, 5);
  const controls = books.map((b, i) => { const k = Math.floor(rng() * 3); return { page_id: b.pages[k].page_id, book_id: b.book_id, page_number: b.pages[k].page_number, kind: i < 3 ? 'drop' : 'bleed', neighbour_id: b.pages[k + 1].page_id }; });
  fs.writeFileSync(path.join(HERE, 'controls.json'), JSON.stringify({ seed: 75031, controls }, null, 1) + '\n');
  fs.writeFileSync(path.join(HERE, 'control-ids.json'), JSON.stringify(controls.map((c) => c.page_id)) + '\n');
  console.log(controls);
} else if (process.argv[2] === 'packets') {
  const S = arg('scratch');
  const J = path.join(S, 'judge');
  fs.mkdirSync(path.join(J, 'img'), { recursive: true });
  fs.mkdirSync(path.join(J, 'packets'), { recursive: true });
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const pages = client.db('bookstore').collection('pages');
  const controls = new Map(JSON.parse(fs.readFileSync(path.join(HERE, 'controls.json'), 'utf8')).controls.map((c) => [c.page_id, c]));
  const read = (arm, id) => fs.readFileSync(path.join(S, arm, `${id}.txt`), 'utf8');
  const rng = makeRng(75032);
  const key = {}, tamper = {};
  for (const b of draw.books) {
    for (const pg of b.pages) {
      const near = await pages.find({ book_id: b.book_id, page_number: { $in: [pg.page_number - 1, pg.page_number, pg.page_number + 1] } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
      const ocrOf = (n) => near.find((p) => p.page_number === n)?.ocr?.data ?? null;
      const img = path.join(J, 'img', `${pg.page_id}.jpg`);
      if (!fs.existsSync(img)) {
        const r = await fetch(pg.image);
        if (!r.ok) throw new Error(`${pg.page_id}: image ${r.status}`);
        fs.writeFileSync(img, Buffer.from(await r.arrayBuffer()));
      }
      const versions = ARMS.map((arm) => ({ arm, text: body(read(arm, pg.page_id)) }));
      const c = controls.get(pg.page_id);
      if (c) {
        let t = body(read('CTL', pg.page_id));
        if (c.kind === 'drop') {
          const s = sentences(t);
          const victim = s[Math.floor(s.length / 2)];
          t = t.replace(victim, '').replace(/ {2,}/g, ' ');
          tamper[pg.page_id] = { kind: 'drop', sentence: victim };
        } else {
          // A sentence of the NEXT page's English (its CTL-free A1b read), set at the end of this page's body.
          const s = sentences(body(read('A1b', c.neighbour_id)));
          const moved = s[0];
          t = `${t}\n\n${moved}`;
          tamper[pg.page_id] = { kind: 'bleed', sentence: moved };
        }
        versions.push({ arm: 'CTL', text: t });
      }
      const letters = versions.length === 5 ? ['V', 'W', 'X', 'Y', 'Z'] : ['W', 'X', 'Y', 'Z'];
      const order = shuffle(versions, rng);
      key[pg.page_id] = Object.fromEntries(order.map((v, i) => [letters[i], v.arm]));
      fs.writeFileSync(path.join(J, 'packets', `${pg.page_id}.json`), JSON.stringify({
        page_id: pg.page_id, book_title: b.title, page_number: pg.page_number, image: img,
        ocr: ocrOf(pg.page_number), prev_ocr: ocrOf(pg.page_number - 1), next_ocr: ocrOf(pg.page_number + 1),
        versions: order.map((v, i) => ({ label: letters[i], text: v.text })),
      }, null, 1));
    }
  }
  await client.close();
  fs.writeFileSync(path.join(J, 'key.json'), JSON.stringify(key, null, 1));
  fs.writeFileSync(path.join(J, 'tamper.json'), JSON.stringify(tamper, null, 1));
  console.log(`${Object.keys(key).length} packets, ${Object.keys(tamper).length} controls; key in ${J}/key.json`);
  for (const [id, t] of Object.entries(tamper)) console.log(`  ${id} ${t.kind}: ${t.sentence?.slice(0, 100)}`);
} else {
  console.error('usage: prep.mjs controls | packets --scratch=DIR'); process.exit(2);
}
