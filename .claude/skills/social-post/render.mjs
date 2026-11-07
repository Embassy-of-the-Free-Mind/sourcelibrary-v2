#!/usr/bin/env node
// PRIOR ART: ~/sourcelibrary-ops/social/2026-11-noetic-world-carousel (its render script lived only in a
// session scratchpad, so it could not be rebuilt) and .claude/skills/card-deck-creation (Puppeteer cards, a
// different product). Neither is a reusable 4:5 slide renderer in the house style; this is.
//
// Render Facebook/Instagram slides (1080x1350, 4:5) from a JSON spec, in the Source Library house style.
//
//   node .claude/skills/social-post/render.mjs <spec.json> [outDir]
//
// The spec's directory holds its images; paths in the spec are relative to it. Slide kinds:
//   { "name": "s1", "kind": "cover", "kicker": "…", "title": "…", "image": "plate.jpg", "note": "…" }
//   { "name": "s2", "kind": "image", "kicker": "…", "image": "x.jpg", "who": "…", "quote": "…", "note": "…" }
//   { "name": "s3", "kind": "quote", "quote": "…", "who": "…", "source": "…" }
//   { "name": "s4", "kind": "end",   "kicker": "…", "title": "…", "note": "…", "link": "sourcelibrary.org" }
// Every slide also takes "foot" (bottom-right: a page count like "2 / 6" or a /q/ shortlink) and "imageHeight".
// Images are cropped to the printed plate by default ("crop": "auto", see crop.mjs): a whole leaf at feed size is
// mostly beige paper. Give "crop": "WxH+X+Y" for a detail, or "crop": "none" for an image you already cropped.
// Text is inserted as HTML: escape &, < and > yourself if a quote contains them.
//
// Type is sized for a phone feed, where a 1080 px slide shows about 390 pt wide (a third of its size):
// captions at 40 px read as about 14 pt. Smaller defaults read as 9-11 pt and could not be read in the feed.
//
// Uses the system Chrome through Playwright (no browser download). Fonts and the logo come from public/.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { autoCrop } from './crop.mjs';

const [specPath, outArg] = process.argv.slice(2);
if (!specPath) { console.error('usage: render.mjs <spec.json> [outDir]'); process.exit(2); }
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const specDir = dirname(resolve(specPath));
const out = resolve(outArg || join(specDir, 'out'));
mkdirSync(out, { recursive: true });
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

// Fonts and logo sit next to the HTML so file:// pages can load them.
for (const f of ['EBGaramond-latin.woff2', 'EBGaramond-latin-italic.woff2'])
  copyFileSync(join(repo, 'public/fonts/eb-garamond', f), join(specDir, f));
copyFileSync(join(repo, 'public/brand/png/icon-only--white-on-transparent--128h.png'), join(specDir, 'sl-icon.png'));

const css = `
@font-face{font-family:G;src:url(EBGaramond-latin.woff2)}
@font-face{font-family:G;font-style:italic;src:url(EBGaramond-latin-italic.woff2)}
*{margin:0;box-sizing:border-box}
body{width:1080px;height:1350px;background:#1a1612;color:#f3ead8;font-family:G,serif;display:flex;flex-direction:column;
 align-items:center;padding:70px 80px 56px;position:relative;overflow:hidden}
.kicker{font-size:34px;letter-spacing:.22em;text-transform:uppercase;color:#c9a96a;text-align:center}
.img{margin-top:34px;border-radius:4px;box-shadow:0 20px 60px rgba(0,0,0,.6);max-width:920px;object-fit:contain}
.who{font-size:36px;letter-spacing:.12em;text-transform:uppercase;color:#c9a96a;margin-top:40px;text-align:center}
.q{font-size:58px;line-height:1.18;text-align:center;font-style:italic;margin-top:18px}
.note{font-size:40px;line-height:1.3;text-align:center;color:#cbbfa8;margin-top:22px}
h1{font-weight:400;font-size:84px;line-height:1.08;text-align:center;margin-top:36px}
.foot{position:absolute;bottom:44px;left:80px;right:80px;display:flex;justify-content:space-between;align-items:center;
 font-size:30px;color:#9d917c;letter-spacing:.06em}
.foot img{height:40px;vertical-align:middle;margin-right:12px;opacity:.85}`;

const opt = (cond, html) => (cond ? html : '');
const foot = (s) => `<div class="foot"><span><img src="sl-icon.png">SOURCE LIBRARY</span><span>${s.foot || ''}</span></div>`;
const kinds = {
  cover: (s) => `${opt(s.kicker, `<div class="kicker">${s.kicker}</div>`)}<h1>${s.title}</h1>
    ${opt(s.image, `<img class="img" src="${s.image}" style="height:${s.imageHeight || 700}px">`)}
    ${opt(s.note, `<div class="note">${s.note}</div>`)}`,
  image: (s) => `${opt(s.kicker, `<div class="kicker">${s.kicker}</div>`)}
    <img class="img" src="${s.image}" style="height:${s.imageHeight || (s.quote ? 700 : 820)}px">
    ${opt(s.who, `<div class="who">${s.who}</div>`)}${opt(s.quote, `<div class="q">“${s.quote}”</div>`)}
    ${opt(s.note, `<div class="note">${s.note}</div>`)}`,
  quote: (s) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;width:100%">
    <div style="font-size:200px;line-height:.6;color:#c9a96a;height:110px">“</div>
    <div class="q" style="font-size:${s.size || 64}px;font-style:normal;line-height:1.2">${s.quote}</div>
    <div style="width:80px;height:2px;background:#c9a96a;margin:56px 0 34px"></div>
    <div class="who" style="margin-top:0">${s.who}</div>
    ${opt(s.source, `<div class="note" style="margin-top:10px;font-style:italic">${s.source}</div>`)}</div>`,
  end: (s) => `<div class="kicker" style="margin-top:250px">${s.kicker || ''}</div><h1 style="font-size:88px">${s.title}</h1>
    ${opt(s.note, `<div class="note" style="font-size:40px;margin-top:40px">${s.note}</div>`)}
    <div class="who" style="font-size:38px;margin-top:70px;letter-spacing:.08em;text-transform:none">${s.link || 'sourcelibrary.org'}</div>`,
};

// Crop each slide's image into the spec dir (<name>.crop.jpg) and point the slide at the crop.
for (const s of spec.slides) {
  if (!s.image || s.crop === 'none') continue;
  const src = join(specDir, s.image), dst = join(specDir, `${s.name}.crop.jpg`);
  if (!s.crop || s.crop === 'auto') {
    const box = await autoCrop(src, dst);
    console.log(`${s.name}: auto-cropped ${s.image} to ${box.width}x${box.height}+${box.left}+${box.top}`);
  } else {
    const m = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(s.crop);
    if (!m) throw new Error(`slide ${s.name}: crop must be auto, none or WxH+X+Y`);
    const [, width, height, left, top] = m.map(Number);
    await sharp(src).extract({ left, top, width, height }).jpeg({ quality: 92 }).toFile(dst);
  }
  s.image = `${s.name}.crop.jpg`;
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
for (const s of spec.slides) {
  if (!kinds[s.kind]) throw new Error(`slide ${s.name}: unknown kind ${s.kind}`);
  const htmlPath = join(specDir, `${s.name}.html`);
  writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${kinds[s.kind](s)}${foot(s)}</body></html>`);
  await page.goto(`file://${htmlPath}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, `${s.name}.jpg`), type: 'jpeg', quality: 92 });
}
await browser.close();
console.log(`rendered ${spec.slides.length} slide(s) to ${out}`);
