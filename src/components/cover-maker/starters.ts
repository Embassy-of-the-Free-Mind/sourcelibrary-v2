import { clothColorFrom, findInkArea, findTitleBlock, loadImage, surfaceStats, type SurfaceStats } from './analyze';
import { fillLayer, imageLayer, shapeLayer, shortAuthor, shortTitle, textLayer, yearOf } from './layers';
import { H, W, uid, type Cover, type Crop, type CutImage, type Layer, type Leaf, type Materials } from './types';

/**
 * Starting points for a book's cover, each built only from that book's own
 * scans and catalogue record. A starter is skipped when the book doesn't have
 * what it needs (no marbled paper, no plates…), except "Cloth and gilt", which
 * needs nothing but the title and so always exists.
 */

/** The middle of a board or endpaper, clear of the scanner bed and the gutter. */
const BOARD_CROP: Crop = { x: 0.07, y: 0.05, w: 0.86, h: 0.9 };

interface Found {
  leaf: Leaf;
  img: HTMLImageElement;
  stats: SurfaceStats;
}

async function load(leaf: Leaf): Promise<HTMLImageElement | null> {
  try { return await loadImage(leaf.display); } catch { return null; }
}

function cover(name: string, layers: Layer[]): Cover {
  return { id: uid(), name, layers };
}

export async function buildStarters(m: Materials): Promise<Cover[]> {
  const { book, leaves, images } = m;
  const title = shortTitle(book.title);
  const author = shortAuthor(book.author);
  const year = yearOf(book.published);
  const byPage = new Map(leaves.map(l => [l.n, l]));

  // ── Outside of the book: boards, marbled papers, plain flyleaves ──
  const edgeLeaves = leaves.filter(l => l.role === 'outside' || l.role === 'endpaper').slice(0, 12);
  const found: Found[] = [];
  await Promise.all(edgeLeaves.map(async (leaf) => {
    const img = await load(leaf);
    if (img) found.push({ leaf, img, stats: surfaceStats(img) });
  }));
  found.sort((a, b) => a.leaf.n - b.leaf.n);
  // Marbling: strongly coloured and patterned all over. A page of rubricated
  // text is busy and a little red too, so ask for more colour unless the OCR
  // itself called the leaf marbled.
  const marbled = found.find(f => f.stats.busy > 0.11 && (f.stats.sat > 0.26 || (/marbl|patterned|decorated paper/i.test(f.leaf.note) && f.stats.sat > 0.12)));
  const board = found.find(f => f !== marbled && (f.leaf.role === 'outside' || f.stats.lum < 0.42 || (f.stats.sat > 0.22 && f.stats.lum < 0.7)));
  const paper = found.find(f => f.stats.lum > 0.6 && f.stats.busy < 0.09 && f.stats.sat < 0.2);

  // ── Title page ──
  const titleLeaf = leaves.find(l => l.role === 'title');
  const titleImg = titleLeaf ? await load(titleLeaf) : null;
  const tb = titleImg ? findTitleBlock(titleImg) : null;
  const ia = titleImg ? findInkArea(titleImg) : null;
  const titleBlock = tb?.plausible ? tb : null;
  const inkArea = ia?.plausible ? ia : null;

  // ── Pictures: the best cut-out illustration, else a plate or frontispiece ──
  const pictures = images.filter(i => !['table', 'exlibris', 'bookplate', 'musical_score', 'chart'].includes(i.type));
  const best: CutImage | undefined = pictures[0];
  const plateLeaf = best ? byPage.get(best.page) : leaves.find(l => l.role === 'frontispiece') || leaves.find(l => l.role === 'plate');
  const plateImg = plateLeaf ? await load(plateLeaf) : null;
  const plateCrop: Crop = best ? { x: best.bbox.x, y: best.bbox.y, w: best.bbox.width, h: best.bbox.height } : { x: 0.06, y: 0.05, w: 0.88, h: 0.9 };
  const plateRot = best?.rotation || 0;

  const ornament = images.find(i => ['decorative', 'emblem', 'symbol'].includes(i.type) && byPage.has(i.page));
  const ornLeaf = ornament ? byPage.get(ornament.page)! : null;
  const ornImg = ornLeaf ? await load(ornLeaf) : null;

  const cloth = (plateImg && clothColorFrom(plateImg)) || '#4a2620';
  /** The book's own board when it has one; a cloth in a colour from its plates when not. */
  const boardOrCloth = (texture: 'cloth' | 'leather' = 'cloth') =>
    board ? ground(board, `Board · p. ${board.leaf.n}`) : fillLayer(cloth, { texture, name: texture === 'cloth' ? 'Cloth' : 'Leather' });
  /** Shrink a layer to fit a height, keeping its proportions. */
  const fitH = <T extends { w: number; h: number }>(l: T, max: number): T => {
    if (l.h > max) { l.w *= max / l.h; l.h = max; }
    return l;
  };

  const dims = (img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight] as const;
  const ground = (f: Found, name: string) => imageLayer(f.leaf, ...dims(f.img), { ground: true, crop: BOARD_CROP, name });
  const darkGround = (f?: Found) => !f || f.stats.lum < 0.55;
  const stamp = (f?: Found) => (darkGround(f) ? 'gilt' : 'blind') as 'gilt' | 'blind';
  const titleText = (y: number, finish: 'gilt' | 'blind' | 'ink' = 'gilt', extra = {}) =>
    textLayer(title, { y, finish, size: title.length > 50 ? 46 : title.length > 26 ? 56 : 70, name: 'Title', ...extra });
  const authorText = (y: number, finish: 'gilt' | 'blind' | 'ink' = 'gilt', extra = {}) =>
    textLayer(author, { y, finish, size: 34, tracking: 0.14, name: 'Author', ...extra });
  const yearText = (y: number, finish: 'gilt' | 'blind' | 'ink' = 'gilt', extra = {}) =>
    textLayer(year, { y, finish, size: 30, tracking: 0.2, name: 'Year', ...extra });

  const out: Cover[] = [];

  // 1. Rebind: the book's own board or marbled paper, tooled in gilt.
  const rebindGround = board || marbled;
  if (rebindGround) {
    const f = stamp(rebindGround);
    out.push(cover('Rebound', [
      ground(rebindGround, rebindGround === board ? `Board · p. ${rebindGround.leaf.n}` : `Marbled paper · p. ${rebindGround.leaf.n}`),
      shapeLayer('double-frame', { finish: f }),
      titleText(H * 0.33, f),
      shapeLayer('rule', { y: H * 0.47, finish: f }),
      authorText(H * 0.53, f),
      yearText(H * 0.86, f),
    ]));
  }

  // 2. The title lifted off the title page in its own letterforms, stamped onto the board.
  if (titleLeaf && titleImg && titleBlock) {
    const g = rebindGround;
    const f = stamp(g);
    const lifted = imageLayer(titleLeaf, ...dims(titleImg), {
      crop: titleBlock.crop, treatment: f, threshold: Math.min(0.75, titleBlock.threshold + 0.05), softness: 0.12,
      width: W * 0.74, name: `Title lifted · p. ${titleLeaf.n}`, y: H * 0.38,
    });
    out.push(cover('Lifted title', [
      g ? ground(g, `Ground · p. ${g.leaf.n}`) : fillLayer(cloth, { texture: 'cloth', name: 'Cloth' }),
      shapeLayer('frame', { finish: f, stroke: 4 }),
      lifted,
      yearText(H * 0.86, f),
    ]));
  }

  // 3. A plate set into a sunk panel on cloth.
  if (plateLeaf && plateImg) {
    const pic = fitH(imageLayer(plateLeaf, ...dims(plateImg), {
      crop: plateCrop, srcRot: plateRot, width: W * 0.66, name: `Plate · p. ${plateLeaf.n}`, y: H * 0.55,
    }), H * 0.52);
    out.push(cover('Inset plate', [
      boardOrCloth(),
      shapeLayer('panel', { y: pic.y, w: pic.w + 44, h: pic.h + 44 }),
      pic,
      titleText(H * 0.17, 'gilt', { size: 50 }),
      authorText(H * 0.9, 'gilt', { size: 30 }),
    ]));
  }

  // 4. A detail of an illustration, blown up to the whole board, with a paper label.
  if (plateLeaf && plateImg) {
    const zoom = 0.55;
    const c = plateCrop;
    const detail: Crop = { x: c.x + (c.w * (1 - zoom)) / 2, y: c.y + (c.h * (1 - zoom)) / 2, w: c.w * zoom, h: c.h * zoom };
    out.push(cover('Detail', [
      imageLayer(plateLeaf, ...dims(plateImg), { ground: true, crop: detail, srcRot: plateRot, name: `Detail · p. ${plateLeaf.n}` }),
      shapeLayer('label', { y: H * 0.7, h: H * 0.2 }),
      titleText(H * 0.68, 'ink', { font: 'garamond', caps: false, tracking: 0, size: title.length > 40 ? 38 : 48, w: W * 0.54, color: '#2a2018' }),
      authorText(H * 0.765, 'ink', { font: 'garamond', size: 24, color: '#4a3d2e' }),
    ]));
  }

  // 5. The whole title page reprinted on the book's own flyleaf, like a paper wrapper.
  if (titleLeaf && titleImg && inkArea) {
    const sheet = paper
      ? ground(paper, `Flyleaf · p. ${paper.leaf.n}`)
      : fillLayer('#e6dbc2', { texture: 'paper', name: 'Paper' });
    const page = imageLayer(titleLeaf, ...dims(titleImg), {
      crop: inkArea.crop, treatment: 'ink', threshold: Math.min(0.8, inkArea.threshold + 0.06), color: '#241c14',
      width: W * 0.74, name: `Title page · p. ${titleLeaf.n}`, blend: 'multiply',
    });
    fitH(page, H * 0.82);
    out.push(cover('Printed wrapper', [sheet, shapeLayer('frame', { finish: 'ink', color: '#241c14', stroke: 3, w: W - 90, h: H - 90 }), page]));
  }

  // 6. Half binding: marbled sides, leather spine and corners, a title label.
  if (marbled) {
    const leather = board ? board.stats.color : '#3b2418';
    out.push(cover('Half binding', [
      ground(marbled, `Marbled paper · p. ${marbled.leaf.n}`),
      fillLayer(leather, { texture: 'leather', region: 'spine', name: 'Leather spine' }),
      fillLayer(leather, { texture: 'leather', region: 'corners', name: 'Leather corners' }),
      shapeLayer('label', { x: W * 0.62, y: H * 0.3, w: W * 0.56, h: H * 0.16 }),
      titleText(H * 0.29, 'ink', { x: W * 0.62, w: W * 0.48, font: 'garamond', caps: false, tracking: 0, size: title.length > 40 ? 32 : 42, color: '#2a2018' }),
      authorText(H * 0.355, 'ink', { x: W * 0.62, w: W * 0.48, font: 'garamond', size: 22, color: '#4a3d2e' }),
    ]));
  }

  // 7. The book's own ornament, centred and gilt.
  if (ornament && ornLeaf && ornImg) {
    out.push(cover('Ornament', [
      boardOrCloth('leather'),
      shapeLayer('double-frame', { finish: stamp(board) }),
      imageLayer(ornLeaf, ...dims(ornImg), {
        crop: { x: ornament.bbox.x, y: ornament.bbox.y, w: ornament.bbox.width, h: ornament.bbox.height },
        srcRot: ornament.rotation || 0, treatment: 'gilt', threshold: 0.55, width: W * 0.42, y: H * 0.58, name: `Ornament · p. ${ornLeaf.n}`,
      }),
      titleText(H * 0.24, 'gilt'),
    ]));
  }

  // 8. Plain cloth and gilt lettering, for books whose binding wasn't scanned.
  if (!rebindGround) out.push(cover('Cloth and gilt', [
    fillLayer(cloth, { texture: 'cloth', name: 'Cloth' }),
    shapeLayer('double-frame', {}),
    titleText(H * 0.36),
    shapeLayer('rule', { y: H * 0.5 }),
    authorText(H * 0.56),
    yearText(H * 0.86),
  ]));

  return out;
}
