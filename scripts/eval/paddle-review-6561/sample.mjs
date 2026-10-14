// PRIOR ART: scripts/eval/paddle-table-pilot-6388/{sample,mkreview}.mjs — the pilot's sample (one page per book) and its
// review-request builder. Changed here: the candidates are the Opus-corrected bodies in the staging collection
// paddle_table_corrections_6561 (no sentinels to strip), and the 5 planted controls are a DUPLICATED printed row
// inserted directly after itself (the #6561 brief), not an invented line from another book.
//
// #6561 review, step 0 + 1: assert the staging collection's shape against `pages`, download the images, draw the
// seeded 100-page gate sample (seed 6561, one page per book) plus 5 control pages, and write the review requests.
// Reads Mongo only. Usage (cwd = $JOB_SCRATCH): node --env-file=… sample.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPT = fs.readFileSync(path.join(HERE, '../paddle-table-pilot-6388/review-prompt-pilot.txt'), 'utf8');
const REASON = 'paddle_table_6388';
const sha16 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const h = (s) => crypto.createHash('sha256').update('6561:' + s).digest('hex');
const han = (s) => (s.match(/\p{Script=Han}/gu) || []).length;
const hanOnly = (s) => (s.match(/\p{Script=Han}/gu) || []).join('');

export const reviewPrompt = (text) => PROMPT.replace('{{TEXT}}', text) + '\n\nThe page image is attached:';

export async function fetchImage(url, dir) {
  const f = path.join(dir, crypto.createHash('sha1').update(url).digest('hex').slice(0, 20) + (path.extname(new URL(url).pathname) || '.jpg'));
  if (!fs.existsSync(f)) {
    for (let i = 0; ; i++) {
      try { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); fs.writeFileSync(f + '.part', Buffer.from(await r.arrayBuffer())); fs.renameSync(f + '.part', f); break; } catch (e) { if (i >= 2) throw e; await new Promise((x) => setTimeout(x, 2000)); }
    }
  }
  const b = fs.readFileSync(f);
  return { file: f, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') };
}

// Shape: string corrected_text whose sha16 is corrected_sha; one doc per page_id; page still withheld for 6388.
export async function loadChecked(db) {
  const docs = await db.collection('paddle_table_corrections_6561').find({}, { projection: { paddle_text: 0 } }).toArray();
  const seen = new Map(); for (const d of docs) seen.set(d.page_id, (seen.get(d.page_id) || 0) + 1);
  const live = new Map();
  const ids = [...seen.keys()];
  for (let i = 0; i < ids.length; i += 1000) {
    for (const p of await db.collection('pages').find({ id: { $in: ids.slice(i, i + 1000) } }, { projection: { id: 1, book_id: 1, 'ocr.unreadable': 1, 'ocr.unreadable_reason': 1 } }).toArray()) live.set(p.id, p);
  }
  const ok = [], bad = [];
  for (const d of docs) {
    const p = live.get(d.page_id);
    const why = typeof d.corrected_text !== 'string' ? 'corrected_text not a string'
      : sha16(d.corrected_text) !== d.corrected_sha ? 'corrected_sha mismatch'
      : seen.get(d.page_id) > 1 ? 'duplicate page_id'
      : !p ? 'page missing'
      : p.book_id !== d.book_id ? 'book_id mismatch'
      : !(p.ocr?.unreadable === true && p.ocr?.unreadable_reason === REASON) ? 'page no longer withheld for 6388'
      : null;
    (why ? bad : ok).push(why ? { page_id: d.page_id, book_id: d.book_id, page_number: d.page_number, why } : d);
  }
  return { docs, ok, bad };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
  const { docs, ok, bad } = await loadChecked(db);
  // Pages the 6388 withhold still holds that have no staging doc (no accepted correction).
  const withheld = await db.collection('pages').distinct('id', { book_id: { $in: [...new Set(docs.map((d) => d.book_id))] }, 'ocr.unreadable_reason': REASON });
  const have = new Set(docs.map((d) => d.page_id));
  const noDoc = withheld.filter((id) => !have.has(id));
  await c.close();
  fs.writeFileSync('shape.json', JSON.stringify({ docs: docs.length, ok: ok.length, bad, withheld_in_books: withheld.length, no_correction: noDoc }, null, 1));
  console.log(`docs ${docs.length}, shape ok ${ok.length}, bad ${bad.length}`, bad.reduce((o, b) => ((o[b.why] = (o[b.why] || 0) + 1), o), {}), `| withheld pages in these books ${withheld.length}, no staging doc ${noDoc.length}`);

  // Seeded draw: pages in hash order; first page of each book until 100; then 5 control pages from further books
  // whose body has >= 3 text rows (a line with >= 3 Han characters that is not a tag line).
  const order = [...ok].sort((a, b) => (h(a.page_id) < h(b.page_id) ? -1 : 1));
  const rowsOf = (t) => t.split('\n').map((l, k) => [l, k]).filter(([l]) => han(l) >= 3 && !/^\s*</.test(l));
  const used = new Set(), sample = [], ctlBase = [];
  for (const d of order) { if (sample.length >= 100) break; if (!used.has(d.book_id)) { used.add(d.book_id); sample.push(d); } }
  for (const d of order) {
    if (ctlBase.length >= 5) break;
    if (used.has(d.book_id) || rowsOf(d.corrected_text).length < 3) continue;
    used.add(d.book_id); ctlBase.push(d);
  }
  fs.mkdirSync('img', { recursive: true });
  const rows = [], meta = [];
  for (const [i, d] of sample.entries()) {
    const im = await fetchImage(d.image_url, 'img');
    rows.push({ uid: `g${String(i + 1).padStart(3, '0')}`, image: im.file, prompt: reviewPrompt(d.corrected_text) });
    meta.push({ uid: rows.at(-1).uid, page_id: d.page_id, book_id: d.book_id, page_number: d.page_number, title: d.title, layout: d.layout, image_url: d.image_url, image_bytes: im.bytes, image_sha256: im.sha256, han: han(d.corrected_text), corrected_sha: d.corrected_sha });
  }
  const controls = [];
  for (const [i, d] of ctlBase.entries()) {
    const lines = d.corrected_text.split('\n'); const body = rowsOf(d.corrected_text);
    // the duplicated row: the middle body row among those with >= 4 Han characters that the text prints only once
    const cand = body.filter(([l]) => han(l) >= 4 && lines.filter((x) => x === l).length === 1);
    const [row, k] = (cand.length ? cand : body)[Math.floor((cand.length ? cand : body).length / 2)];
    const text = [...lines.slice(0, k + 1), row, ...lines.slice(k + 1)].join('\n');
    const im = await fetchImage(d.image_url, 'img');
    const uid = `g${String(101 + i).padStart(3, '0')}`;
    rows.push({ uid, image: im.file, prompt: reviewPrompt(text) });
    controls.push({ uid, page_id: d.page_id, book_id: d.book_id, page_number: d.page_number, image_url: d.image_url, duplicated_row: row, row_line: k, inserted_at_line: k + 1, row_han: hanOnly(row) });
  }
  // mix controls in, unmarked: uids are opaque and the request order is a second seeded shuffle
  rows.sort((a, b) => (h('o' + a.uid) < h('o' + b.uid) ? -1 : 1));
  fs.writeFileSync('gate-req.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync('gate-sample.json', JSON.stringify(meta, null, 1));
  fs.writeFileSync('gate-controls.json', JSON.stringify(controls, null, 1));
  console.log(`sample ${meta.length} pages from ${new Set(meta.map((m) => m.book_id)).size} books; controls ${controls.length}:`, controls.map((c) => `${c.book_id}?page=${c.page_number} row ${c.row_line} "${c.duplicated_row.slice(0, 30)}"`).join(' | '));
}
