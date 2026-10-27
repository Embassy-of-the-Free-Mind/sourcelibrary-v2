#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-per-call-7522/prep.mjs — the same blind packet (the page and its neighbours' images, the
// versions under shuffled letters, the key out of the packet). It hard-codes #7522's four arms, its 60-page draw and its
// separately read CTL controls; this A/B has four other arms on 20 of those pages, and plants its controls in a copy
// of one arm's read. The judge is #7522's judge.mjs, unchanged (it reads DIR/judge/packets).
/**
 * #7558 step 2: blind judge packets for the prompt A/B (sentinels-6523 vs read-file-7558, 1 and 4 pages a call).
 *
 *   node --env-file=... scripts/eval/agy-read-file-7558/prep.mjs --scratch=DIR [--draw=draw-arabic.json --ids=arabic-ids.json]
 *   node scripts/eval/ocr-per-call-7522/judge.mjs --scratch=DIR --jobs=3
 *   node scripts/eval/agy-read-file-7558/score.mjs --scratch=DIR > results.json
 *
 * DIR/<arm>/<page_id>.txt are cli-ocr.mjs reads (arms old1 new1 old4 new4). On 4 control pages a fifth version is
 * planted: a copy of the new1 read with one body line dropped (2 pages) or with the next page's first body line
 * appended (2 pages). DIR/judge/key.json maps letters to arms; DIR/judge/tamper.json the plants.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

export const ARMS = ['old1', 'new1', 'old4', 'new4'];
const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = arg('scratch');
const J = path.join(S, 'judge');
// Default: the German/Latin set (#7522's draw, page-ids.json); --draw/--ids (relative to this folder) for the Arabic one.
const draw = JSON.parse(fs.readFileSync(path.join(HERE, arg('draw') || '../ocr-per-call-7522/draw.json'), 'utf8'));
const ids = new Set(JSON.parse(fs.readFileSync(path.join(HERE, arg('ids') || 'page-ids.json'), 'utf8')));
const shuffle = (a, rng) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const read = (arm, id) => { try { return fs.readFileSync(path.join(S, arm, `${id}.txt`), 'utf8').trim(); } catch { return ''; } };
const linesOver = (t, n) => t.split('\n').map((l, i) => ({ l, i })).filter(({ l }) => l.trim().length >= n && !/^\s*</.test(l) && !/<[a-z-]+>/.test(l));
// 40 characters as #7522; a manuscript page of short lines (the Arabic set) falls back to 15.
const bodyLines = (t) => { const b = linesOver(t, 40); return b.length ? b : linesOver(t, 15); };

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
const rng = makeRng(7558);
const books = draw.books.filter((b) => b.pages.some((p) => ids.has(p.page_id)));
// One control per book on its first or third page (drop on books 0, 2; bleed on 1, 3), the next page's read in the set.
const controlFor = new Map(books.slice(0, 4).map((b, i) => [b.pages[i % 2 ? 0 : 2].page_id, { kind: i % 2 ? 'bleed' : 'drop', next: b.pages[(i % 2 ? 0 : 2) + 1].page_id }]));
const key = {}, tamper = {};
for (const b of books) {
  for (const pg of b.pages) {
    const near = await pages.find({ book_id: b.book_id, page_number: { $in: [pg.page_number - 1, pg.page_number + 1] } }, { projection: PROJ }).toArray();
    const self = pg.image ? null : await pages.findOne({ id: pg.page_id }, { projection: PROJ });
    const img = await fetchTo(pg.image || getPageSource(self), path.join(J, 'img', `${pg.page_id}.jpg`));
    const nb = {};
    for (const [k, n] of [['prev', pg.page_number - 1], ['next', pg.page_number + 1]]) {
      const p = near.find((x) => x.page_number === n);
      nb[k] = p && getPageSource(p) ? await fetchTo(getPageSource(p), path.join(J, 'img', `${p.id}.jpg`)) : null;
    }
    const versions = ARMS.map((arm) => ({ arm, text: read(arm, pg.page_id) || '(no transcription returned)' }));
    const c = controlFor.get(pg.page_id);
    if (c) {
      const t = read('new1', pg.page_id);
      const lines = t.split('\n');
      if (c.kind === 'drop') {
        const body = bodyLines(t);
        const victim = body[Math.floor(body.length / 2)];
        lines.splice(victim.i, 1);
        tamper[pg.page_id] = { kind: 'drop', line: victim.l };
      } else {
        const moved = bodyLines(read('old1', c.next))[0].l;
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
