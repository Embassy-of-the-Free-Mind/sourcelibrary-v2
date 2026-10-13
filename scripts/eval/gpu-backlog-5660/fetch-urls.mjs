// #5660 job gpu-resume-5660 — run from /root/gpu-backlog-5660/resume (paths are that working dir's).
// fetch 2000px images for Tibetan stems from shard-0 urls: node fetch-urls.mjs stems.json outdir
import fs from 'node:fs'; import sharp from 'sharp';
const urls = {}; for (const l of fs.readFileSync('../bo/shard-0.jsonl', 'utf8').trim().split('\n')) { const r = JSON.parse(l); urls[`${r.book}_${String(r.page).padStart(5, '0')}`] = r.url; }
const stems = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const out = process.argv[3]; fs.mkdirSync(out, { recursive: true });
const q = [...stems]; await Promise.all(Array.from({ length: 6 }, async () => { while (q.length) { const s = q.shift(); const f = `${out}/${s}.jpg`; if (fs.existsSync(f)) continue; const r = await fetch(urls[s]); await sharp(Buffer.from(await r.arrayBuffer()), { failOn: 'none' }).resize(2400, 2400, { fit: 'inside' }).jpeg({ quality: 88 }).toFile(f); fs.copyFileSync(`../bo/stripped/${s}.txt`, `${out}/${s}.txt`); } }));
