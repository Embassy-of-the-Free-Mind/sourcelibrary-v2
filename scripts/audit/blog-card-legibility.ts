/**
 * Detector + contact sheet for the blog's lead cards (#6049).
 *
 * PRIOR ART: .claude/skills/quote-background-image — the rules for CHOOSING an
 * image to set text on; it has no measurement, so this script is the check that
 * follows a choice. scripts/audit/card-thumbnail-weight.mjs — book-card byte
 * weight, not legibility. none other — searched scripts/audit, scripts/lib and
 * src for contrast/luminance/legibility.
 *
 * Every post can become a lead or the Latest card, where its title is set on the
 * picture over CARD_SCRIM (src/app/blog/card-scrim.ts). For every post, at both
 * card shapes (phone 4:5, desktop 2:1), with the post's imagePosition, this:
 *   1. crops the image as `object-fit: cover` would,
 *   2. composites the real gradient over the text block,
 *   3. measures white-on-image contrast at the brightest pixels where text lands
 *      (FAIL under WCAG AA 4.5:1 — the scrim should make that impossible),
 *   4. flags a source too small for the desktop card (blurry when stretched),
 *   5. flags a crop whose visible picture (above the text) is nearly blank —
 *      paper margin or empty sky: the "boring card" — so imagePosition can move it,
 *   6. writes a contact sheet of every card with its title drawn on, to look at.
 *
 * Usage:  npx tsx scripts/audit/blog-card-legibility.ts [--out=scripts/output/blog-cards] [--only=slug,slug]
 * Exit 1 when any card FAILs contrast or cannot be fetched; WARN rows are for a person to look at.
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { posts, type BlogPost } from '../../src/app/blog/posts';
import { SCRIM_RGB, SCRIM_MIN_ALPHA, SCRIM_MAX_ALPHA, FADE_PX } from '../../src/app/blog/card-scrim';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const OUT = arg('out') || 'scripts/output/blog-cards';
const ONLY = arg('only')?.split(',');

// Card shapes as rendered (BlogIndex LeadCard): width in CSS px, aspect, and
// the text block's height for a title of `lines` lines (meta 16+8, title lines
// at the breakpoint's line height, bottom padding) — measured off the preview.
const SHAPES = [
  { name: 'phone', w: 342, h: 428, titlePx: 30, charsPerLine: 22, pad: 24 },
  { name: 'desktop', w: 928, h: 464, titlePx: 45, charsPerLine: 38, pad: 32 },
] as const;
const MIN_SOURCE_WIDTH = 900; // desktop card is 928 CSS px wide; a source narrower than that is upscaled and soft
const BLANK_STDEV = 18; // luminance std-dev (0–255) under which the visible area reads as blank

const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (r: number, g: number, b: number) =>
  0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
const contrastWithWhite = (L: number) => 1.05 / (L + 0.05);

// object-position "x y" (keywords or %), as CSS resolves it for object-fit: cover.
function cropBox(srcW: number, srcH: number, w: number, h: number, position = 'center') {
  const scale = Math.max(w / srcW, h / srcH);
  const cw = Math.round(w / scale), ch = Math.round(h / scale);
  const word: Record<string, number> = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };
  const parts = position.trim().split(/\s+/);
  const pct = (p: string | undefined) => (p === undefined ? 50 : p.endsWith('%') ? parseFloat(p) : word[p] ?? 50);
  let px = pct(parts[0]), py = pct(parts[1] ?? (parts[0] === 'top' || parts[0] === 'bottom' ? undefined : parts[0]));
  if (parts[0] === 'top' || parts[0] === 'bottom') { py = word[parts[0]]; px = pct(parts[1]); }
  return {
    left: Math.round(((srcW - cw) * px) / 100),
    top: Math.round(((srcH - ch) * py) / 100),
    width: cw,
    height: ch,
  };
}

async function fetchImage(url: string): Promise<Buffer> {
  const full = url.startsWith('/') ? `https://sourcelibrary.org${url}` : url;
  const res = await fetch(full);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

type Row = { slug: string; shape: string; contrast: number; srcWidth: number; visibleStdev: number; flags: string[] };

async function auditCard(post: BlogPost, src: Buffer, shape: (typeof SHAPES)[number]) {
  const meta = await sharp(src).metadata();
  const box = cropBox(meta.width!, meta.height!, shape.w, shape.h, post.imagePosition);
  const crop = await sharp(src).extract(box).resize(shape.w, shape.h).removeAlpha().raw().toBuffer();

  const lines = Math.min(3, Math.ceil(post.title.length / shape.charsPerLine));
  const textH = 24 + lines * shape.titlePx + shape.pad; // meta + title + bottom padding
  const blockH = textH + FADE_PX;
  const blockTop = shape.h - blockH;
  // Alpha at a row, exactly as the CSS gradient: max at the bottom, min at the
  // top of the text, fading to 0 across the FADE_PX above it.
  const alphaAt = (y: number) => {
    if (y < blockTop) return 0;
    const fromBottom = shape.h - y;
    if (fromBottom <= textH) return SCRIM_MAX_ALPHA + (SCRIM_MIN_ALPHA - SCRIM_MAX_ALPHA) * (fromBottom / textH);
    return SCRIM_MIN_ALPHA * (1 - (fromBottom - textH) / FADE_PX);
  };

  // 3. contrast over the text rows (left 80%, where a left-aligned title sits)
  const lum: number[] = [];
  for (let y = shape.h - textH; y < shape.h - shape.pad; y++) {
    const a = alphaAt(y);
    for (let x = 0; x < shape.w * 0.8; x++) {
      const i = (y * shape.w + x) * 3;
      const mix = (c: number, k: number) => a * SCRIM_RGB[k] + (1 - a) * c;
      lum.push(luminance(mix(crop[i], 0), mix(crop[i + 1], 1), mix(crop[i + 2], 2)));
    }
  }
  lum.sort((a, b) => a - b);
  const brightest = lum[Math.floor(lum.length * 0.995)]; // ignore a few stray pixels
  const contrast = contrastWithWhite(brightest);

  // 5. how much picture shows above the text block
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 0; y < blockTop; y++) for (let x = 0; x < shape.w; x++) {
    const i = (y * shape.w + x) * 3;
    const v = 0.299 * crop[i] + 0.587 * crop[i + 1] + 0.114 * crop[i + 2];
    sum += v; sum2 += v * v; n++;
  }
  const visibleStdev = n ? Math.sqrt(sum2 / n - (sum / n) ** 2) : 0;

  const flags: string[] = [];
  if (contrast < 4.5) flags.push(`FAIL contrast ${contrast.toFixed(1)}:1`);
  if (shape.name === 'desktop' && meta.width! < MIN_SOURCE_WIDTH) flags.push(`WARN source ${meta.width}px wide`);
  if (visibleStdev < BLANK_STDEV) flags.push(`WARN visible area nearly blank (σ ${visibleStdev.toFixed(0)}) — move imagePosition`);

  // 6. the card as a reader would see it, for the contact sheet
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const words = post.title.split(' ');
  const titleLines: string[] = [''];
  for (const w of words) {
    const cur = titleLines[titleLines.length - 1];
    if ((cur + ' ' + w).trim().length > shape.charsPerLine && cur) titleLines.push(w);
    else titleLines[titleLines.length - 1] = (cur + ' ' + w).trim();
  }
  const shown = titleLines.slice(0, 3);
  const titleTop = shape.h - shape.pad - shown.length * shape.titlePx;
  const svg = `<svg width="${shape.w}" height="${shape.h}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0">
      ${[0, textH, blockH].map((d, k) => `<stop offset="${(d / blockH).toFixed(3)}" stop-color="rgb(${SCRIM_RGB.join(',')})" stop-opacity="${[SCRIM_MAX_ALPHA, SCRIM_MIN_ALPHA, 0][k]}"/>`).join('')}
    </linearGradient></defs>
    <rect x="0" y="${blockTop}" width="${shape.w}" height="${blockH}" fill="url(#g)"/>
    <text x="24" y="${titleTop - 10}" font-family="Helvetica" font-size="12" fill="#d6d3d1">${esc(post.date.toUpperCase())}</text>
    ${shown.map((l, k) => `<text x="24" y="${titleTop + (k + 0.8) * shape.titlePx}" font-family="Georgia" font-size="${shape.titlePx * 0.8}" fill="#fff">${esc(l)}</text>`).join('')}
    ${flags.length ? `<text x="8" y="18" font-family="Helvetica" font-size="13" fill="#fff" stroke="#b00" stroke-width="3" paint-order="stroke">${esc(flags.join(' · '))}</text>` : ''}
  </svg>`;
  const card = await sharp(crop, { raw: { width: shape.w, height: shape.h, channels: 3 } })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
  return { row: { slug: post.slug, shape: shape.name, contrast, srcWidth: meta.width!, visibleStdev, flags } as Row, card };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const list = ONLY ? posts.filter((p) => ONLY.includes(p.slug)) : posts;
  const rows: Row[] = [];
  const cards: Record<string, Buffer[]> = { phone: [], desktop: [] };
  let failed = 0;
  for (const post of list) {
    let src: Buffer;
    try {
      src = await fetchImage(post.image);
    } catch (e) {
      console.log(`FAIL ${post.slug}: cannot fetch ${post.image} (${(e as Error).message})`);
      failed++;
      continue;
    }
    for (const shape of SHAPES) {
      const { row, card } = await auditCard(post, src, shape);
      rows.push(row);
      cards[shape.name].push(card);
      if (row.flags.some((f) => f.startsWith('FAIL'))) failed++;
    }
  }

  // contact sheets: phone cards 6 across, desktop cards 3 across
  for (const shape of SHAPES) {
    const per = shape.name === 'phone' ? 6 : 3, gap = 12;
    const list = cards[shape.name];
    const rowsN = Math.ceil(list.length / per);
    const sheet = sharp({
      create: { width: per * (shape.w + gap) + gap, height: rowsN * (shape.h + gap) + gap, channels: 3, background: '#fdfcf9' },
    }).composite(list.map((input, k) => ({ input, left: gap + (k % per) * (shape.w + gap), top: gap + Math.floor(k / per) * (shape.h + gap) })));
    await sheet.jpeg({ quality: 82 }).toFile(path.join(OUT, `sheet-${shape.name}.jpg`));
  }
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(rows, null, 2));

  const minContrast = Math.min(...rows.map((r) => r.contrast));
  const flagged = rows.filter((r) => r.flags.length);
  console.log(`${list.length} posts, ${rows.length} cards. Lowest text contrast: ${minContrast.toFixed(1)}:1 (AA needs 4.5).`);
  for (const r of flagged) console.log(`${r.slug} [${r.shape}]: ${r.flags.join('; ')}`);
  console.log(`Contact sheets: ${OUT}/sheet-phone.jpg, ${OUT}/sheet-desktop.jpg`);
  process.exit(failed ? 1 : 0);
}

main();
