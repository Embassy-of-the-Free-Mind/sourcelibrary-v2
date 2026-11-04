// Shiji (KR2a0001) OCR vs Kanripo `master` (TLS edition, Zhonghua 1959 base): windowed char-bigram Dice,
// the same measure as paddle-zh-lane's WYG screen, but against a sliding window of the OCR page's length
// (TLS <pb> pages are not Siku leaves). Read-only. Usage: node shiji-master.mjs --dir=<cache> <out.jsonl>
import { MongoClient } from 'mongodb';
import fs from 'fs';
const K = await import('/data/scratch/sl/sourcelibrary/.claude/worktrees/job-zh-held-quality-8053/scripts/eval/zh-skqs-5568-kanripo.mjs');
const OUT = process.argv.at(-1);
const files = ['100', ...Array.from({ length: 10 }, (_, i) => String(201 + i)), '300', '400', '500'];
let M = '';
for (const f of files) { const r = await fetch(`https://raw.githubusercontent.com/kanripo/KR2a0001/master/KR2a0001_${f}.txt`); if (r.ok) M += K.fold((await r.text()).replace(/^#.*$/gm, '')); }
console.error('master folded chars', M.length);
const idx = new Map();
for (let i = 0; i + 1 < M.length; i++) { const g = M.slice(i, i + 2); let a = idx.get(g); if (!a) idx.set(g, a = []); a.push(i); }
const bg = (s) => { const m = new Map(); for (let i = 0; i + 1 < s.length; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
const dm = (a, b) => { let inter = 0, na = 0, nb = 0; for (const v of a.values()) na += v; for (const v of b.values()) nb += v; for (const [g, v] of a) inter += Math.min(v, b.get(g) || 0); return na + nb ? 2 * inter / (na + nb) : 0; };
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const bs = await db.collection('books').find({ 'pipeline_auto.hold.reason': 'zh-histories-7546', work_id: 'kr:KR2a0001' }, { projection: { id: 1, title: 1 } }).toArray();
const out = fs.createWriteStream(OUT);
let n = 0;
for (const b of bs) {
  const pages = await db.collection('pages').find({ book_id: b.id, 'ocr.data': { $exists: true } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
  for (const p of pages) {
    const t = K.fold(String(p.ocr.data).replace(/<header>.*?<\/header>|<page-num>.*?<\/page-num>|<language>.*?<\/language>|<script>.*?<\/script>/gs, ''));
    if (t.length < 20) { out.write(JSON.stringify({ bid: b.id, pn: p.page_number, han: t.length, status: 'short' }) + '\n'); continue; }
    const L = t.length, A = bg(t), votes = new Map();
    for (let i = 0; i + 1 < L; i++) { const pos = idx.get(t.slice(i, i + 2)); if (!pos || pos.length > 40) continue; for (const q of pos) { const k = Math.floor((q - i) / 40); votes.set(k, (votes.get(k) || 0) + 1); } }
    const top = [...votes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
    let best = 0, at = -1;
    for (const [k] of top) for (let s = Math.max(0, k * 40 - 60); s <= k * 40 + 60; s += 5) { const d = dm(A, bg(M.slice(s, s + L))); if (d > best) { best = d; at = s; } }
    out.write(JSON.stringify({ bid: b.id, title: b.title, pn: p.page_number, han: L, dice: +best.toFixed(3), at }) + '\n');
    if (++n % 500 === 0) console.error(n);
  }
}
out.end(); await c.close(); console.error('done', n);
