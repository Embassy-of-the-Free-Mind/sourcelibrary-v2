// PRIOR ART: /root/tattva-6184/crop.mjs + decide.mjs (#6184 tie-break, not in the repo) — single-pair majority, no per-slot print scoring; copied and extended here.
// zoom.mjs <book> <page> <x0> <y0> <x1> <y1> <out> [width] : fractional box of the page image, resized to width px
import sharp from 'sharp';
const [b, p, x0, y0, x1, y1, out, w = '1600'] = process.argv.slice(2);
const buf = Buffer.from(await (await fetch(`https://images.sourcelibrary.org/archived/${b}/${p}.jpg`)).arrayBuffer());
const m = await sharp(buf).metadata();
const left = Math.round(m.width * x0), top = Math.round(m.height * y0);
await sharp(buf).extract({ left, top, width: Math.round(m.width * (x1 - x0)), height: Math.round(m.height * (y1 - y0)) }).resize(Number(w)).png().toFile(out);
