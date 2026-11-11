// The EPUB's cover, 1600×2560 (Kindle's recommended size): the article's picture framed on a dark ground,
// SOURCE LIBRARY above it, the title and subtitle set below. A bare landscape engraving sat in Apple Books'
// shelf as an untitled strip beside the library's own book covers (Derek, 2026-11-11).
// Type is P052 (URW's Palatino), rendered by librsvg through fontconfig, so it must be installed where this runs.
import sharp from 'sharp';

const W = 1600, H = 2560, M = 120;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Greedy line breaking at roughly `max` characters a line. */
function lines(text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > max) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

export async function makeCover(picture: Buffer, title: string, subtitle: string, footer: string): Promise<Buffer> {
  const frameW = W - 2 * M, frameTop = 380, frameMaxH = 1260;
  const img = await sharp(picture).resize(frameW, frameMaxH, { fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
  const { width: iw = frameW, height: ih = frameMaxH } = await sharp(img).metadata();
  const left = Math.round((W - iw) / 2), top = frameTop + Math.round((frameMaxH - ih) / 2);

  const titleLines = lines(title, 22), subLines = lines(subtitle, 40);
  let y = top + ih + 190;
  const titleSvg = titleLines.map((l) => { const t = `<text x="${W / 2}" y="${y}" class="title">${esc(l)}</text>`; y += 128; return t; }).join('');
  y += 30;
  const subSvg = subLines.slice(0, 4).map((l) => { const t = `<text x="${W / 2}" y="${y}" class="sub">${esc(l)}</text>`; y += 70; return t; }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <style>
    text { font-family: P052, 'Nimbus Roman', serif; text-anchor: middle; }
    .house { font-size: 44px; letter-spacing: 18px; fill: #c9a96b; }
    .title { font-size: 112px; fill: #f3ead8; }
    .sub { font-size: 52px; font-style: italic; fill: #d8cdb6; }
    .foot { font-size: 38px; letter-spacing: 6px; fill: #a8977a; }
  </style>
  <text x="${W / 2}" y="190" class="house">SOURCE LIBRARY</text>
  <rect x="${left - 14}" y="${top - 14}" width="${iw + 28}" height="${ih + 28}" fill="none" stroke="#c9a96b" stroke-width="3"/>
  <line x1="${W / 2 - 90}" y1="${top + ih + 80}" x2="${W / 2 + 90}" y2="${top + ih + 80}" stroke="#c9a96b" stroke-width="3"/>
  ${titleSvg}${subSvg}
  <text x="${W / 2}" y="${H - 130}" class="foot">${esc(footer.toUpperCase())}</text>
</svg>`;

  return sharp({ create: { width: W, height: H, channels: 3, background: '#1b1814' } })
    .composite([{ input: img, left, top }, { input: Buffer.from(svg), left: 0, top: 0 }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}
