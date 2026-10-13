#!/usr/bin/env node
// #5813 stage 2 — the by-eye packet: for N pilot pages, the page image (1600 px) and the word-level
// differences between the old lite read and the new flash read. Read-only.
//   node --env-file=… scripts/batch/greek-reocr-5813/eye-packet.mjs --dir=WORK [--n=20]
// Stage 3 reuses it on its own files: --compare=F --before=F (JSONL from compare.mjs / snapshot.mjs),
// --out=SUBDIR, --seed=S, --low=K lowest-agreement pages in the draw, --min-chars=N (skip near-empty pages).
import fs from 'node:fs';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { stripWrappers } from '../../eval/lib/metrics.mjs';

const DIR = process.argv.find((a) => a.startsWith('--dir='))?.slice(6);
const N = Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4) || 20);
const opt = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const OUT = opt('out', 'eye'), LOW = Number(opt('low', '8')), MIN_CHARS = Number(opt('min-chars', '0'));
fs.mkdirSync(`${DIR}/${OUT}`, { recursive: true });
const h = (s) => createHash('sha256').update(opt('seed', 'eye-5813') + s).digest('hex');
const rows = fs.readFileSync(opt('compare', `${DIR}/pilot-compare.jsonl`), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.outcome === 'reread' && r.old_chars >= MIN_CHARS);
const meta = new Map(opt('compare') ? [] : JSON.parse(fs.readFileSync(`${DIR}/pilot-rows.json`)).map((r) => [r.page_id, r]));
// 12 seeded-random pages + the 8 lowest-agreement pages not already drawn (where an invention would show).
const random = [...rows].sort((a, b) => h(a.page_id).localeCompare(h(b.page_id))).slice(0, N - LOW);
const low = [...rows].sort((a, b) => a.agreement - b.agreement).filter((r) => !random.includes(r)).slice(0, LOW);
const wanted = new Set([...random, ...low].map((r) => r.page_id));
const before = new Map();
for await (const l of readline.createInterface({ input: fs.createReadStream(opt('before', `${DIR}/pilot-before.jsonl`)) })) { const m = /"id":"([^"]+)"/.exec(l); if (m && wanted.has(m[1])) before.set(m[1], JSON.parse(l)); }
const picks = [...random.map((r) => ({ ...r, draw: 'random' })), ...low.map((r) => ({ ...r, draw: 'lowest-agreement' }))];

const words = (t) => stripWrappers(t || '').replace(/->|<-/g, ' ').replace(/<\/?[a-zA-Z][^<>]*>/g, ' ').split(/\s+/).filter(Boolean);
function diffHunks(a, b, max = 30) {
  // LCS over words; hunks of differing runs with two words of context.
  const n = a.length, m = b.length;
  if (n * m > 4e6) return null;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const hunks = []; let i = 0, j = 0, cur = null;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { if (cur) { cur.after = a.slice(i, i + 2).join(' '); hunks.push(cur); cur = null; } i++; j++; continue; }
    cur ??= { before: a.slice(Math.max(0, i - 2), i).join(' '), old: [], new: [] };
    if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) cur.new.push(b[j++]); else cur.old.push(a[i++]);
  }
  if (cur) hunks.push(cur);
  return { total: hunks.length, hunks: hunks.slice(0, max).map((x) => `…${x.before} [OLD: ${x.old.join(' ') || '∅'}] [NEW: ${x.new.join(' ') || '∅'}] ${x.after || ''}…`) };
}

const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await c.connect();
const db = c.db('bookstore');
const packet = [];
for (const [k, r] of picks.entries()) {
  const p = await db.collection('pages').findOne({ id: r.page_id });
  const book = await db.collection('books').findOne({ id: r.book_id }, { projection: { _id: 0, id: 1, title: 1, slug: 1, language: 1, year: 1, published: 1, visible: 1 } });
  const url = getPageSource(p);
  const tag = String(k + 1).padStart(2, '0');
  let img = 'FETCH FAILED';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const s = sharp(buf); const md = await s.metadata();
      await s.resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(`${DIR}/${OUT}/${tag}.jpg`);
      // top and bottom halves at higher zoom, for small type
      const H = md.height, Wd = md.width;
      await sharp(buf).extract({ left: 0, top: 0, width: Wd, height: Math.floor(H * 0.55) }).resize({ width: 1800, withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(`${DIR}/${OUT}/${tag}-top.jpg`);
      await sharp(buf).extract({ left: 0, top: Math.floor(H * 0.45), width: Wd, height: H - Math.floor(H * 0.45) }).resize({ width: 1800, withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(`${DIR}/${OUT}/${tag}-bottom.jpg`);
      img = `${md.width}x${md.height}`;
    } else img = `HTTP ${res.status}`;
  } catch (e) { img = `FETCH FAILED ${e.message}`; }
  const oldT = before.get(r.page_id).ocr.data, newT = p.ocr.data;
  const d = diffHunks(words(oldT), words(newT));
  const m = meta.get(r.page_id);
  const row = { tag, draw: r.draw, page_id: r.page_id, book_id: r.book_id, title: (book.title || '').slice(0, 70), language: book.language, year: book.year ?? book.published, cls: m?.cls, visible: book.visible === true, page_number: p.page_number, agreement: +r.agreement.toFixed(3), old_chars: r.old_chars, new_chars: r.new_chars, old_model: before.get(r.page_id).ocr.model, img, url: `https://sourcelibrary.org/book/${book.slug || book.id}/page/${p.page_number}` };
  packet.push(row);
  fs.writeFileSync(`${DIR}/${OUT}/${tag}.txt`, `${JSON.stringify(row, null, 1)}\n\n=== DIFF (${d ? d.total : 'too large'} hunks) ===\n${d ? d.hunks.join('\n') : ''}\n\n=== OLD (lite) ===\n${oldT}\n\n=== NEW (flash) ===\n${newT}\n`);
  console.log(tag, r.draw, row.cls, row.agreement, row.title, img);
}
fs.writeFileSync(`${DIR}/${OUT}/packet.json`, JSON.stringify(packet, null, 1));
await c.close();
