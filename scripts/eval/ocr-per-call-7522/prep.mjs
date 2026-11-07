#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/prep.mjs `packets` (PR #7518) — the same blind packet (versions under
// shuffled letters, the key kept out of the packet, a tampered CTL read on control pages), but for English versions of
// a text; here the versions are transcriptions of an IMAGE, so the packet carries the page's image and its neighbours'
// images, and the tamper drops or adds a LINE.
/**
 * #7522 blind judge packets.
 *
 *   node --env-file=... scripts/eval/ocr-per-call-7522/prep.mjs --scratch=DIR
 *
 * Per drawn page: its image and the previous and next pages' images (downloaded to DIR/judge/img), and the four arms'
 * transcriptions (plus the tampered CTL read on a control page) under shuffled letters. The letter -> arm key goes to
 * DIR/judge/key.json, the tampers to DIR/judge/tamper.json; neither is in a packet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = arg('scratch');
const J = path.join(S, 'judge');
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
const controls = new Map(JSON.parse(fs.readFileSync(path.join(HERE, 'controls.json'), 'utf8')).controls.map((c) => [c.page_id, c]));
export const ARMS = ['A1', 'A1b', 'B2', 'C4'];
const shuffle = (a, rng) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const read = (arm, id) => { try { return fs.readFileSync(path.join(S, arm, `${id}.txt`), 'utf8').trim(); } catch { return ''; } };
// Body lines long enough to be missed: not a tag line, not a running head.
const bodyLines = (t) => t.split('\n').map((l, i) => ({ l, i })).filter(({ l }) => l.trim().length >= 40 && !/^\s*</.test(l) && !/<[a-z-]+>/.test(l));

fs.mkdirSync(path.join(J, 'img'), { recursive: true });
fs.mkdirSync(path.join(J, 'packets'), { recursive: true });
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const pages = client.db('bookstore').collection('pages');
const PROJ = { id: 1, page_number: 1, archived_photo: 1, display_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1 };
const fetchTo = async (url, f) => {
  if (fs.existsSync(f)) return f;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  return f;
};
const rng = makeRng(75222);
const key = {}, tamper = {};
for (const b of draw.books) {
  for (const pg of b.pages) {
    const near = await pages.find({ book_id: b.book_id, page_number: { $in: [pg.page_number - 1, pg.page_number + 1] } }, { projection: PROJ }).toArray();
    const img = await fetchTo(pg.image, path.join(J, 'img', `${pg.page_id}.jpg`));
    const nb = {};
    for (const [k, n] of [['prev', pg.page_number - 1], ['next', pg.page_number + 1]]) {
      const p = near.find((x) => x.page_number === n);
      nb[k] = p && getPageSource(p) ? await fetchTo(getPageSource(p), path.join(J, 'img', `${p.id}.jpg`)) : null;
    }
    const versions = ARMS.map((arm) => ({ arm, text: read(arm, pg.page_id) || '(no transcription returned)' }));
    const c = controls.get(pg.page_id);
    if (c) {
      let t = read('CTL', pg.page_id);
      const lines = t.split('\n');
      if (c.kind === 'drop') {
        const body = bodyLines(t);
        const victim = body[Math.floor(body.length / 2)];
        lines.splice(victim.i, 1);
        tamper[pg.page_id] = { kind: 'drop', line: victim.l };
      } else {
        // The first body line of the NEXT page's A1b read, set after this page's last body line.
        const moved = bodyLines(read('A1b', c.neighbour_id))[0].l;
        const last = bodyLines(t).pop();
        lines.splice(last.i + 1, 0, moved);
        tamper[pg.page_id] = { kind: 'bleed', line: moved };
      }
      versions.push({ arm: 'CTL', text: lines.join('\n') });
    }
    const letters = versions.length === 5 ? ['V', 'W', 'X', 'Y', 'Z'] : ['W', 'X', 'Y', 'Z'];
    const order = shuffle(versions, rng);
    key[pg.page_id] = Object.fromEntries(order.map((v, i) => [letters[i], v.arm]));
    fs.writeFileSync(path.join(J, 'packets', `${pg.page_id}.json`), JSON.stringify({
      page_id: pg.page_id, book_id: b.book_id, book_title: b.title, published: b.published, language: b.language, page_number: pg.page_number,
      image: img, prev_image: nb.prev, next_image: nb.next, versions: order.map((v, i) => ({ label: letters[i], text: v.text })),
    }, null, 1));
  }
}
await client.close();
fs.writeFileSync(path.join(J, 'key.json'), JSON.stringify(key, null, 1));
fs.writeFileSync(path.join(J, 'tamper.json'), JSON.stringify(tamper, null, 1));
console.log(`${Object.keys(key).length} packets, ${Object.keys(tamper).length} controls; key in ${J}/key.json`);
for (const [id, t] of Object.entries(tamper)) console.log(`  ${id} ${t.kind}: ${t.line.slice(0, 100)}`);
