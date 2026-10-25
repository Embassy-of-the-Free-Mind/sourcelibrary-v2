#!/usr/bin/env node
// PRIOR ART: scripts/eval/opus-tib-sa-6948/audit.mjs `packet` — this is that command with two inputs swapped: the
// TRANSCRIPTION is the split-leaf re-read (the leaves joined by <leaf-break/>, as a leaf-mode read is stored) instead of
// the stored ocr.data, and the ENGLISH is the per-leaf Opus translation joined the same way. The page image, the
// full-resolution tiles (fetchImage / iiifTiles / tile), the prompt (auditPrompt), the 15 planted controls (#6948
// plants.json, re-sent exactly as before: stored transcription + planted English) and the key format are #6948's, so
// `audit.mjs score` and `audit.mjs attribute` run on the output unchanged and before/after differ only in the text.
/**
 * packet.mjs — no model call. Job split-leaves-5771 (#5771) step 4.
 *   node --env-file=.env.production.local scripts/eval/split-leaf-5771/packet.mjs --frames=frames.jsonl \
 *        --arms=cut:TXTDIR:ENDIR,reread:TXTDIR:ENDIR --plants=<6948>/audit/plants.json --req=REQ.jsonl --key=KEY.json [--seed=5771]
 * Every arm's 80 frames and the 15 controls go in ONE shuffled request set with opaque uids (s001…), so the auditor
 * cannot tell arms apart. key[uid] carries frame (the #6948 uid), arm, and stratum (SEAM / RECUT / SAME, fixed in the
 * pre-registration from the stored read metadata and the contact-sheet recuts).
 * Images are cached under $JOB_SCRATCH/images/<page_id>/ as in #6948.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { auditPrompt, fetchImage, iiifTiles, tile } from '../opus-tib-sa-6948/audit.mjs';
import { rng, shuffle } from '../opus-tib-sa-6948/sample.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = process.env.JOB_SCRATCH;
const frames = fs.readFileSync(arg('frames'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const plants = Object.values(JSON.parse(fs.readFileSync(arg('plants'), 'utf8'))).filter((p) => p.english);
const ARMS = arg('arms').split(',').map((a) => { const [name, txt, en] = a.split(':'); return { name, txt, en }; });
const stratumOf = (f) => (f.stored.read_mode === 'page' ? 'SEAM' : f.ledger_cut ? 'RECUT' : 'SAME');

/** The split-leaf transcription of a frame: its leaf reads in frame order, joined as a leaf-mode read is stored. */
export function leafTranscription(dir, uid) {
  const fs_ = fs.readdirSync(dir).filter((x) => x.startsWith(`${uid}-L`) && x.endsWith('.txt')).sort((a, b) => Number(a.match(/-L(\d+)/)[1]) - Number(b.match(/-L(\d+)/)[1]));
  return fs_.map((x) => fs.readFileSync(path.join(dir, x), 'utf8').trim()).join('\n<leaf-break/>\n');
}

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const ids = [...frames.map((f) => f.page_id), ...plants.map((p) => p.page_id)];
const pages = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, photo: 1, photo_original: 1, archived_photo: 1 } }).toArray()).map((p) => [p.id, p]));
await c.close();

const items = [
  ...ARMS.flatMap((a) => frames.map((f) => ({ frame: f.uid, page_id: f.page_id, lang: 'bo', stratum: stratumOf(f), canon: f.stratum, arm: a.name, ocr: leafTranscription(a.txt, f.uid), english: fs.existsSync(path.join(a.en, `${f.uid}.txt`)) ? fs.readFileSync(path.join(a.en, `${f.uid}.txt`), 'utf8').trim() : null }))),
  ...plants.map((p) => ({ ...p, control: p.kind, ocr: pages.get(p.page_id)?.ocr?.data })),
];
// Opaque uids: controls keep their #6948 uids' role but are renumbered with the rest, in a seeded random order.
const order = shuffle(items.map((_, i) => i), rng(Number(arg('seed') || 5771) + 1));
order.forEach((ix, n) => { items[ix].uid = `s${String(n + 1).padStart(3, '0')}`; });
const reqs = [], key = {};
for (const it of items) {
  const p = pages.get(it.page_id);
  if (!p || !it.ocr || !it.english) { console.log(`  ${it.uid}: ${!p ? 'page not found' : !it.ocr ? 'no transcription' : 'no English'}; not audited`); continue; }
  const dir = path.join(S, 'images', it.page_id);
  fs.mkdirSync(dir, { recursive: true });
  const got = await fetchImage(p, path.join(dir, 'raw.img'));
  if (!got) { console.log(`  ${it.uid}: no image`); key[it.uid] = { uid: it.uid, page_id: it.page_id, no_image: true }; continue; }
  let t;
  try {
    const it3 = await iiifTiles(p.photo_original || p.photo, dir);
    t = await tile(path.join(dir, 'raw.img'), dir, { pageOnly: !!it3 });
    if (it3) t = it3;
  } catch (e) { console.log(`  ${it.uid}: tile failed ${e.message}`); key[it.uid] = { uid: it.uid, page_id: it.page_id, no_image: true }; continue; }
  reqs.push({ uid: it.uid, prompt: auditPrompt(it.lang, t.tiles, it.ocr, it.english), image: path.join(dir, 'page.jpg'), extra_images: t.tiles.map((x) => path.join(dir, x)) });
  key[it.uid] = { uid: it.uid, frame: it.frame || null, canon: it.canon || null, page_id: it.page_id, book_id: p.book_id, page_number: p.page_number, lang: it.lang, arm: it.arm || null, stratum: it.stratum || null, control: it.control || null, anchor: it.anchor || null, planted: it.planted || null, image_from: got, W: t.W, H: t.H, tiles: t.tiles.length, ocr_chars: it.ocr.length, english_chars: it.english.length };
}
shuffle(reqs, rng(Number(arg('seed') || 5771)));
fs.writeFileSync(arg('req'), reqs.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(arg('key'), JSON.stringify(key, null, 1));
console.log(`${reqs.length} requests (${reqs.filter((r) => key[r.uid].control).length} controls); ${Object.values(key).filter((k) => k.no_image).length} with no image`);
