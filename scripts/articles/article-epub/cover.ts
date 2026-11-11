// The EPUB's cover, 1600×2560 (Kindle's recommended size): the article's picture full bleed, cropped to the
// portrait page, the Source Library logo at the head, the title set over a dark fade at the foot.
// Picture and crop per article in covers.json (a better scan or detail than the web hero, where there is one);
// otherwise the hero, cropped by sharp's attention strategy. Type is P052 (URW's Palatino) through librsvg and
// fontconfig, so it must be installed where this runs; the logo is the brand kit's white PNG (public/brand).
import fs from 'fs';
import sharp from 'sharp';

const W = 1600, H = 2560, M = 130;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Greedy line breaking at roughly `max` characters a line. */
function lines(text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > max) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

export type CoverCrop = { left: number; top: number; width: number; height: number };

export async function makeCover(opts: {
  picture: Buffer; crop?: CoverCrop; title: string; subtitle: string; kicker: string; logo: string;
}): Promise<Buffer> {
  let img = sharp(opts.picture);
  if (opts.crop) img = img.extract(opts.crop);
  const bg = await img.resize(W, H, { fit: 'cover', position: opts.crop ? 'centre' : sharp.strategy.attention }).toBuffer();

  // Type from the foot up: subtitle, title, kicker.
  // Balanced: as many lines as 16 characters a line needs, then broken evenly ("Beyond the / North Wind").
  const n = Math.ceil(opts.title.length / 16);
  const titleLines = lines(opts.title, Math.ceil(opts.title.length / n) + 1), subLines = lines(opts.subtitle, 44).slice(0, 4);
  const TITLE = 150, TITLE_LH = 160, SUB = 50, SUB_LH = 68;
  let y = H - 170 - (subLines.length - 1) * SUB_LH;
  const sub = subLines.map((l, i) => `<text x="${M}" y="${y + i * SUB_LH}" class="sub">${esc(l)}</text>`).join('');
  y -= 70 + SUB_LH * 0.4;
  const ruleY = y; y -= 70;
  const titleTop = y - (titleLines.length - 1) * TITLE_LH;
  const title = titleLines.map((l, i) => `<text x="${M}" y="${titleTop + i * TITLE_LH}" class="title">${esc(l)}</text>`).join('');
  const kickerY = titleTop - TITLE - 40;
  const fadeTop = Math.max(0, kickerY - 520);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="foot" x1="0" y1="${fadeTop}" x2="0" y2="${H}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#110d09" stop-opacity="0"/>
      <stop offset="0.35" stop-color="#110d09" stop-opacity="0.72"/>
      <stop offset="1" stop-color="#110d09" stop-opacity="0.96"/>
    </linearGradient>
    <linearGradient id="head" x1="0" y1="0" x2="0" y2="520" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#110d09" stop-opacity="0.78"/>
      <stop offset="1" stop-color="#110d09" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <style>
    text { font-family: P052, 'Nimbus Roman', serif; }
    .kicker { font-size: 38px; letter-spacing: 9px; fill: #d4b06a; }
    .title { font-size: ${TITLE}px; fill: #fbf6ec; }
    .sub { font-size: ${SUB}px; font-style: italic; fill: #e6dcc8; }
  </style>
  <rect x="0" y="0" width="${W}" height="520" fill="url(#head)"/>
  <rect x="0" y="${fadeTop}" width="${W}" height="${H - fadeTop}" fill="url(#foot)"/>
  <text x="${M}" y="${kickerY}" class="kicker">${esc(opts.kicker.toUpperCase())}</text>
  ${title}
  <line x1="${M}" y1="${ruleY}" x2="${M + 160}" y2="${ruleY}" stroke="#d4b06a" stroke-width="4"/>
  ${sub}
</svg>`;

  const logo = await sharp(fs.readFileSync(opts.logo)).resize({ width: 820 }).toBuffer();
  return sharp(bg)
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }, { input: logo, left: M - 8, top: 130 }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}
