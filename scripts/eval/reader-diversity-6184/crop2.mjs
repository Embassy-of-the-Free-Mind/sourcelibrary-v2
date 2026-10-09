// PRIOR ART: /root/tattva-6184/crop.mjs + decide.mjs (#6184 tie-break, not in the repo) — single-pair majority, no per-slot print scoring; copied and extended here.
// Crop the printed line band holding each slot's token (line located in the Pro read), upscaled for reading by eye.
import sharp from 'sharp';
import fs from 'node:fs';
const slots = JSON.parse(fs.readFileSync('slots.json', 'utf8'));
const T = JSON.parse(fs.readFileSync('texts.json', 'utf8'));
const only = process.argv.slice(2);
const imgs = new Map();
for (const s of slots) {
  if (only.length && !only.includes(s.id)) continue;
  const t = T.find((x) => x.page_id === s.page_id);
  const lines = t.pro.split('\n').filter((l) => l.trim());
  const grams = []; for (let i = 0; i + 4 <= s.flash.length; i += 2) grams.push(s.flash.slice(i, i + 4));
  let best = -1, li = 0; lines.forEach((l, i) => { const h = grams.filter((g) => l.includes(g)).length; if (h > best) { best = h; li = i; } });
  const url = `https://images.sourcelibrary.org/archived/${s.book_id}/${s.page}.jpg`;
  if (!imgs.has(url)) imgs.set(url, Buffer.from(await (await fetch(url)).arrayBuffer()));
  const buf = imgs.get(url); const m = await sharp(buf).metadata();
  const top0 = 0.06, bot0 = 0.95; const y = m.height * (top0 + (bot0 - top0) * (li + 0.5) / lines.length);
  const h = m.height / lines.length * 2.2;
  const top = Math.max(0, Math.round(y - h)), height = Math.min(m.height - top, Math.round(2 * h));
  const scale = m.width < 1200 ? 2.0 : 0.85;
  await sharp(buf).extract({ left: 0, top, width: m.width, height }).resize(Math.round(m.width * scale)).png().toFile(`crops/${s.id}.png`);
  console.log(s.id, 'line', li, '/', lines.length, m.width + 'x' + m.height, lines[li].slice(0, 70));
}
