/**
 * The journey film's paper-and-ink 3D scene (#5861). Imported dynamically by
 * JourneyFilm, so three.js loads only on the routes that show the film.
 *
 * A port of the approved prototype's scene (feat/journey-film-prototype),
 * with every image and line of text taken from `JourneyData` instead of
 * baked files. Stretches the prototype had already cut (spread splitting,
 * the search cloud, the 3D reader) are left out. `update(t)` is a pure
 * function of scene time, so scrubbing works.
 */
import * as THREE from 'three';
import type { JourneyData } from '@/lib/journey/types';
import { clamp, S, lerp } from './journey-timeline';
import { trimImage } from '@/lib/journey/page-trim';

/** A loaded scene image, already trimmed of any dark scanner bed around the page. */
export type SceneImage = HTMLImageElement | HTMLCanvasElement;
const arOf = (im: SceneImage) => im.width / im.height;

type V3 = THREE.Vector3;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const lerpV = (a: V3, b: V3, s: number) => a.clone().lerp(b, s);
const bez = (a: V3, c: V3, b: V3, s: number) => {
  const u = 1 - s;
  return a.clone().multiplyScalar(u * u).add(c.clone().multiplyScalar(2 * u * s)).add(b.clone().multiplyScalar(s * s));
};

const PAPER = 0xece3cf;
const INK = '#2b2219';
const RUBRIC = '#9a2f1f';
const LAPIS = '#2f4a72';

export interface SceneFonts {
  /** CSS font-family for the original-language lines. */
  original: string;
  label: string;
  body: string;
}

export interface JourneyScene {
  update(t: number): void;
  resize(w: number, h: number): void;
  render(): void;
  dispose(): void;
  canvas: HTMLCanvasElement;
}

function loadImage(url: string): Promise<SceneImage | null> {
  return new Promise(res => {
    const im = new Image();
    // A slow image must not hold the whole film; it is drawn as plain paper instead.
    const timer = setTimeout(() => res(null), 10000);
    im.crossOrigin = 'anonymous';
    im.decoding = 'async';
    im.onload = () => { clearTimeout(timer); res(trimImage(im)); };
    im.onerror = () => { clearTimeout(timer); res(null); };
    im.src = url;
  });
}

export async function loadSceneImages(d: JourneyData): Promise<{
  scan: SceneImage | null;
  cover: SceneImage | null;
  vault: (SceneImage | null)[];
  shelf: (SceneImage | null)[];
}> {
  const [scan, cover, vault, shelf] = await Promise.all([
    loadImage(d.scan.url),
    d.cover ? loadImage(d.cover.url) : Promise.resolve(null),
    Promise.all(d.vault.map(v => loadImage(v.url))),
    Promise.all(d.shelf.map(v => loadImage(v.url))),
  ]);
  return { scan, cover, vault, shelf };
}

export function createJourneyScene(
  d: JourneyData,
  imgs: Awaited<ReturnType<typeof loadSceneImages>>,
  fonts: SceneFonts,
): JourneyScene {
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAPER);
  scene.fog = new THREE.FogExp2(PAPER, 0.03);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);

  // three ≥ r155 lights in physical units; ×π restores the prototype's (r128) look.
  scene.add(new THREE.HemisphereLight(0xfff6e6, 0x8a7a62, 1.0 * Math.PI));
  const sun = new THREE.DirectionalLight(0xfff1dc, 0.55 * Math.PI);
  sun.position.set(6, 12, 9);
  scene.add(sun);

  // ---------- textures ----------
  function makeCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    draw(g, w, h);
    const tex = keep(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }
  function imgTex(im: SceneImage | null | undefined): THREE.Texture | null {
    if (!im) return null;
    const t = keep(new THREE.Texture(im));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }
  function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines = 99) {
    let line = '';
    let n = 0;
    for (const word of text.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (g.measureText(test).width > maxW && line) {
        if (++n >= maxLines) { g.fillText(line + ' …', x, y); return y + lh; }
        g.fillText(line, x, y); y += lh; line = word;
      } else line = test;
    }
    if (line) g.fillText(line, x, y);
    return y + lh;
  }
  function labelSprite(text: string, { color = RUBRIC, size = 0.45, spacing = 4 } = {}) {
    const font = `600 40px ${fonts.label}`;
    const meas = document.createElement('canvas').getContext('2d')!;
    meas.font = font;
    const t = text.toUpperCase();
    const tw = meas.measureText(t).width + spacing * t.length + 40;
    const tex = makeCanvas(Math.ceil(tw), 72, (g, _w, h) => {
      g.font = font; g.fillStyle = color; g.textBaseline = 'middle';
      let x = 20;
      for (const ch of t) { g.fillText(ch, x, h / 2); x += g.measureText(ch).width + spacing; }
    });
    const m = keep(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    const s = new THREE.Sprite(m);
    s.scale.set(size * tw / 72, size, 1);
    return s;
  }
  const paperCard = (w: number, h: number, head: string, body: string, maxLines = 5) => makeCanvas(w, h, (g, W, H) => {
    g.fillStyle = '#f4edde'; g.fillRect(0, 0, W, H);
    g.strokeStyle = INK; g.lineWidth = 2; g.strokeRect(8, 8, W - 16, H - 16);
    g.lineWidth = .8; g.strokeRect(14, 14, W - 28, H - 28);
    g.fillStyle = RUBRIC; g.font = `600 22px ${fonts.label}`; g.fillText(head.toUpperCase(), 32, 58);
    g.fillStyle = INK; g.font = `28px ${fonts.body}`;
    wrap(g, body, 32, 112, W - 64, 40, maxLines);
  });
  const basic = (o: THREE.MeshBasicMaterialParameters) => keep(new THREE.MeshBasicMaterial(o));
  const geo = <T extends THREE.BufferGeometry>(g: T) => keep(g);

  const scanTex = imgTex(imgs.scan);
  const coverTex = imgTex(imgs.cover) || scanTex;
  const PH = 4;
  const scanAr = imgs.scan ? arOf(imgs.scan) : (d.scan.ar || 0.7);
  const PW = PH * clamp(scanAr, 0.45, 1.6);
  const pageGeo = geo(new THREE.PlaneGeometry(PW, PH));
  const pageMat = (tex: THREE.Texture | null) => keep(new THREE.MeshStandardMaterial({
    map: tex, color: tex ? 0xffffff : 0xf4edde, roughness: .9, side: THREE.DoubleSide, transparent: true,
  }));

  // floor + the thread that runs between stations
  const floor = new THREE.Mesh(geo(new THREE.PlaneGeometry(700, 80)), basic({ color: 0xe2d7bf }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(110, 0, 0); scene.add(floor);
  const threadGeo = geo(new THREE.PlaneGeometry(1, 0.05)); threadGeo.translate(.5, 0, 0);
  const threadBase = new THREE.Mesh(threadGeo, basic({ color: 0xc9bc9f }));
  threadBase.rotation.x = -Math.PI / 2; threadBase.position.set(0, .01, 3); threadBase.scale.x = 160; scene.add(threadBase);
  const thread = new THREE.Mesh(threadGeo, basic({ color: 0x9a2f1f }));
  thread.rotation.x = -Math.PI / 2; thread.position.set(0, .012, 3); scene.add(thread);

  // ---------- Find: a wall of real covers, face out ----------
  const wallCovers: THREE.Mesh[] = [];
  const WALL_Z = -1.4, ROWS = 7, ROW_H = .82, WALL_W = 10.4, HERO_ROW = 3, HERO_GAP = .9;
  const ROW_Y = (r: number) => .9 + r * 1.0;
  {
    const back = new THREE.Mesh(geo(new THREE.PlaneGeometry(11.2, 7.6)), keep(new THREE.MeshStandardMaterial({ color: 0xd6c8aa, roughness: 1 })));
    back.position.set(0, 3.9, WALL_Z - .12); scene.add(back);
    const ledgeMat = keep(new THREE.MeshStandardMaterial({ color: 0x6d553d, roughness: .8 }));
    const ledgeGeo = geo(new THREE.BoxGeometry(10.8, .05, .3));
    for (let r = 0; r < ROWS; r++) {
      const l = new THREE.Mesh(ledgeGeo, ledgeMat);
      l.position.set(0, ROW_Y(r) - ROW_H / 2 - .04, WALL_Z + .05); scene.add(l);
    }
    const covers = imgs.shelf.filter((x): x is SceneImage => !!x);
    let k = 0;
    for (let r = 0; r < ROWS && k < covers.length; r++) {
      const items: { k?: number; tw: number; gap?: boolean }[] = [];
      let w = 0;
      while (k < covers.length) {
        const ar = arOf(covers[k]) || .7;
        const tw = ROW_H * Math.min(ar, 1.6);
        if (w + tw + (items.length ? .08 : 0) + (r === HERO_ROW ? HERO_GAP : 0) > WALL_W) break;
        items.push({ k, tw }); w += tw + (items.length > 1 ? .08 : 0); k++;
      }
      if (r === HERO_ROW) { items.splice(Math.floor(items.length / 2), 0, { gap: true, tw: HERO_GAP - .08 }); w += HERO_GAP; }
      let x = -w / 2;
      for (const it of items) {
        if (!it.gap && it.k !== undefined) {
          const m = new THREE.Mesh(geo(new THREE.PlaneGeometry(it.tw, ROW_H)), keep(new THREE.MeshStandardMaterial({ map: imgTex(covers[it.k]), roughness: .9 })));
          m.position.set(x + it.tw / 2, ROW_Y(r), WALL_Z + .02); m.rotation.x = -.05; scene.add(m); wallCovers.push(m);
        }
        x += it.tw + .08;
      }
    }
    if (d.shelfLabel) {
      const lab = labelSprite(d.shelfLabel, { size: .26, color: INK });
      lab.position.set(0, 7.75, WALL_Z); scene.add(lab);
    }
  }

  // the book (local: covers in xy, thickness along z, spine at x = -1.6)
  const leather = 0xd9d3c4;
  const spineTex = makeCanvas(120, 420, (g, w, h) => {
    g.fillStyle = '#d9d3c4'; g.fillRect(0, 0, w, h);
    g.save(); g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2);
    g.font = `600 22px ${fonts.label}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#5d5143';
    const t = (d.displayTitle || d.title);
    g.fillText(t.length > 30 ? t.slice(0, 29) + '…' : t, 0, 0); g.restore();
  });
  const leatherMat = () => keep(new THREE.MeshStandardMaterial({ color: leather, roughness: .6, transparent: true }));
  const paperEdge = keep(new THREE.MeshStandardMaterial({ color: 0xe8dcbc, roughness: .9, transparent: true }));
  const book = new THREE.Group(); scene.add(book);
  const titleMat = keep(new THREE.MeshStandardMaterial({ map: scanTex, color: scanTex ? 0xffffff : 0xf4edde, roughness: .9, transparent: true }));
  const block = new THREE.Mesh(geo(new THREE.BoxGeometry(3, 4, .8)), [paperEdge, paperEdge, paperEdge, paperEdge, titleMat, paperEdge]);
  book.add(block);
  const backM = leatherMat();
  const back = new THREE.Mesh(geo(new THREE.BoxGeometry(3.2, 4.2, .1)), backM); back.position.set(.1, 0, -.45); book.add(back);
  const spineMats = [leatherMat(), keep(new THREE.MeshStandardMaterial({ map: spineTex, roughness: .55, transparent: true })), leatherMat(), leatherMat(), leatherMat(), leatherMat()];
  const spine = new THREE.Mesh(geo(new THREE.BoxGeometry(.12, 4.2, 1.0)), spineMats); spine.position.set(-1.56, 0, 0); book.add(spine);
  const hinge = new THREE.Group(); hinge.position.set(-1.5, 0, .45); book.add(hinge);
  const endpaper = keep(new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: .8, transparent: true }));
  const coverMats = [leatherMat(), leatherMat(), leatherMat(), leatherMat(),
    keep(new THREE.MeshStandardMaterial({ map: coverTex, color: coverTex ? 0xffffff : leather, roughness: .55, transparent: true })), endpaper];
  const cover = new THREE.Mesh(geo(new THREE.BoxGeometry(3.2, 4.2, .1)), coverMats); cover.position.set(1.6, 0, 0); hinge.add(cover);
  const bookMats: THREE.Material[] = [paperEdge, titleMat, backM, ...spineMats, ...coverMats];

  const SLOT = V(0, ROW_Y(HERO_ROW), WALL_Z - .1);
  const SC0 = (ROW_H + .06) / 4.2;
  const BOOK_AT = V(31, 3.3, 0);

  // ---------- Copy: pages fly into storage ----------
  const VAULT = V(38, 4.3, -1.6);
  const vault = new THREE.LineSegments(geo(new THREE.EdgesGeometry(new THREE.BoxGeometry(8, 8.2, 2.2))), keep(new THREE.LineBasicMaterial({ color: 0x2b2219, transparent: true, opacity: 0 })));
  vault.position.copy(VAULT); scene.add(vault);
  const vaultLabel = labelSprite('Page images, stored', { size: .32, color: INK });
  vaultLabel.position.set(VAULT.x, VAULT.y + 4.6, VAULT.z); scene.add(vaultLabel);
  const vaultImgs = imgs.vault.slice(0, 19);
  const vaultPages: THREE.Mesh[] = [];
  for (let j = 0; j < 20; j++) {
    const tex = j === 19 ? scanTex : imgTex(vaultImgs[j % Math.max(1, vaultImgs.length)]);
    const m = new THREE.Mesh(pageGeo, pageMat(tex));
    const col = j % 5, row = Math.floor(j / 5);
    m.userData.slot = V(VAULT.x + (col - 2) * 1.45, VAULT.y + (1.5 - row) * 1.85, VAULT.z);
    m.visible = false; scene.add(m); vaultPages.push(m);
  }

  // ---------- Read & Translate ----------
  const OCR_AT = V(90, 3.2, 0);
  const SPREAD = V(60, 3.2, 0);
  const pageR = new THREE.Mesh(pageGeo, pageMat(scanTex)); scene.add(pageR);
  const pageRMat = pageR.material as THREE.MeshStandardMaterial;
  const beam = new THREE.Group(); scene.add(beam);
  const beamCore = new THREE.Mesh(geo(new THREE.PlaneGeometry(PW + .6, .04)), basic({ color: 0x9a2f1f, transparent: true, depthWrite: false, fog: false }));
  const beamGlowTex = makeCanvas(32, 128, (g, w, h) => {
    const l = g.createLinearGradient(0, 0, 0, h);
    l.addColorStop(0, 'rgba(154,47,31,0)'); l.addColorStop(.5, 'rgba(154,47,31,.16)'); l.addColorStop(1, 'rgba(154,47,31,0)');
    g.fillStyle = l; g.fillRect(0, 0, w, h);
  });
  const beamGlow = new THREE.Mesh(geo(new THREE.PlaneGeometry(PW + .8, .7)), basic({ map: beamGlowTex, transparent: true, depthWrite: false, fog: false }));
  beam.add(beamGlow, beamCore);
  const ocrLabel = labelSprite(d.readByModel ? `${d.readBy} reads the page` : 'The text of the page', { size: .26 }); scene.add(ocrLabel);
  const TRANS_AT = V(120, 3.2, 0);
  const transLabel = labelSprite(`${d.language} into English`, { size: .28, color: LAPIS });
  transLabel.position.set(TRANS_AT.x - .6, TRANS_AT.y + 2.35, 0); scene.add(transLabel);

  const pos = d.config.linePosition || { x: .14, y0: .22, dy: .045 };
  const LINE_W = 6.8, LINE_H = LINE_W * 80 / 2048;
  const lineGeo = geo(new THREE.PlaneGeometry(LINE_W, LINE_H)); lineGeo.translate(LINE_W / 2, 0, 0);
  const pageTop = OCR_AT.y + 2, pageLeft = OCR_AT.x - PW / 2 + pos.x * PW;
  const lineScale0 = (0.58 - pos.x) * PW / 1.75;
  const flip = d.lines.pairing !== 'opening';
  const drawLine = (text: string, en: boolean) => makeCanvas(2048, 80, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textBaseline = 'middle';
    g.font = en ? `italic 40px ${fonts.body}` : `46px ${fonts.original}`;
    const tw = Math.min(w - 24, g.measureText(text).width);
    g.fillStyle = 'rgba(244,237,222,.94)'; g.fillRect(0, 6, tw + 24, h - 12);
    g.fillStyle = en ? LAPIS : INK;
    g.fillText(text, 8, h / 2, w - 24);
  });
  const lines = d.lines.original.map((la, i) => {
    const g = new THREE.Group();
    const front = new THREE.Mesh(lineGeo, basic({ map: drawLine(la, false), transparent: true, depthWrite: false, fog: false }));
    const backL = new THREE.Mesh(lineGeo, basic({ map: drawLine(d.lines.english[i] || '', true), transparent: true, depthWrite: false, fog: false }));
    if (flip) { backL.rotation.x = Math.PI; backL.position.z = -.005; } else backL.position.z = .005;
    g.add(front, backL); scene.add(g);
    const yi = pageTop - (pos.y0 + i * pos.dy) * PH;
    return { g, front, back: backL, yi, x0: pageLeft - 8 / (2048 / LINE_W) };
  });

  let noteCard: THREE.Mesh | null = null;
  if (d.note) {
    const noteText = `“${d.note.text}”${d.note.attribution ? ` (${d.note.attribution})` : ''}`;
    const tex = makeCanvas(1000, 330, (g, W, H) => {
      g.fillStyle = '#f4edde'; g.fillRect(0, 0, W, H);
      g.strokeStyle = INK; g.lineWidth = 2; g.strokeRect(8, 8, W - 16, H - 16); g.lineWidth = .8; g.strokeRect(14, 14, W - 28, H - 28);
      g.fillStyle = RUBRIC; g.font = `600 24px ${fonts.label}`; g.fillText(d.note!.label.toUpperCase(), 36, 60);
      g.fillStyle = INK; g.font = `30px ${fonts.body}`;
      wrap(g, noteText, 36, 110, W - 72, 42, 5);
    });
    noteCard = new THREE.Mesh(geo(new THREE.PlaneGeometry(3.0, 0.99)), basic({ map: tex, transparent: true, depthWrite: false, fog: false }));
    scene.add(noteCard);
  }

  // ---------- Describe ----------
  const CORE = V(150, 3.4, 0);
  const core = new THREE.Group(); core.position.copy(CORE); scene.add(core);
  const corePage = new THREE.Mesh(geo(new THREE.PlaneGeometry(1.25 * PW / PH * 1.4, 1.25 * 1.4)), basic({ map: scanTex, color: scanTex ? 0xffffff : 0xf4edde, transparent: true }));
  core.add(corePage);
  const cardDefs = [
    d.summary ? { h: 'Summary · machine-written', b: d.summary } : null,
    d.terms.length ? { h: 'Terms', b: d.terms.join(' · ') } : null,
    d.keywords.length ? { h: 'Keywords · machine-written', b: d.keywords.join(' · ') } : null,
    { h: 'Page', b: `${d.citation.locator} of ${d.pagesCount.toLocaleString('en-US')}` },
  ].filter((x): x is { h: string; b: string } => !!x);
  const cardGeo = geo(new THREE.PlaneGeometry(2.6, 1.52));
  const cards = cardDefs.map(c => {
    const m = new THREE.Mesh(cardGeo, basic({ map: paperCard(512, 300, c.h, c.b, 4), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    scene.add(m); return m;
  });

  // ---------- camera ----------
  const K = ([
    [0, [0, 4.7, 17.5], [0, 4.4, 0]], [2.5, [.3, 4.4, 8.6], [0, 4.2, -1.4]], [5, [9, 6, 13], [12, 4.5, 0]],
    [8.5, [29, 4.6, 10.5], [31.5, 3.3, 0]], [11.5, [30.5, 4, 8.5], [32, 3.3, -.5]], [16.5, [36, 5, 15.5], [37, 4, -1.4]],
    [18.5, [50, 5, 13], [56, 3.4, 0]], [21, [60, 3.6, 9], [60, 3.2, 0]], [24.5, [61, 3.6, 9.5], [60.5, 3.2, 0]],
    [27.6, [87, 4, 8], [90, 3.2, 0]], [30.5, [88.6, 3.6, 6.6], [90.2, 3.2, .4]], [33.5, [93, 3.8, 7.5], [90.5, 3.2, 1]],
    [37, [118.5, 3.6, 9.5], [120.3, 3.2, 0]], [43, [121.8, 4.1, 8.8], [120.3, 3.2, 0]],
    [46.5, [146, 5.6, 10.5], [150, 3.4, 0]], [52.5, [154, 4.4, 9.5], [150, 3.4, 0]], [56, [160, 5, 14], [150, 3.4, 0]],
  ] as [number, [number, number, number], [number, number, number]][]).map(([t, p, l]) => ({ t, p: V(...p), l: V(...l) }));
  const cr = (p0: V3, p1: V3, p2: V3, p3: V3, s: number) => {
    const s2 = s * s, s3 = s2 * s;
    return p1.clone().multiplyScalar(2)
      .add(p2.clone().sub(p0).multiplyScalar(s))
      .add(p0.clone().multiplyScalar(2).sub(p1.clone().multiplyScalar(5)).add(p2.clone().multiplyScalar(4)).sub(p3).multiplyScalar(s2))
      .add(p0.clone().negate().add(p1.clone().multiplyScalar(3)).sub(p2.clone().multiplyScalar(3)).add(p3).multiplyScalar(s3))
      .multiplyScalar(.5);
  };
  let distK = 1;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function placeCamera(t: number) {
    let i = 0;
    while (i < K.length - 2 && t >= K[i + 1].t) i++;
    const a = K[i], b = K[i + 1], s = clamp((t - a.t) / (b.t - a.t));
    const p0 = K[i - 1] || a, p3 = K[i + 2] || b;
    const p = cr(p0.p, a.p, b.p, p3.p, s), look = cr(p0.l, a.l, b.l, p3.l, s);
    p.sub(look).multiplyScalar(distK).add(look);
    p.y -= .75; look.y -= .75;
    if (!reduceMotion) { p.x += Math.sin(t * .31) * .08; p.y += Math.sin(t * .23) * .05; }
    camera.position.copy(p); camera.lookAt(look);
    return look;
  }

  const setOp = (obj: THREE.Mesh | THREE.Sprite | THREE.LineSegments, o: number) => {
    (obj.material as THREE.Material).opacity = o;
    obj.visible = o > .003;
  };

  function update(t: number) {
    const look = placeCamera(t);
    thread.scale.x = Math.max(.001, Math.min(160, look.x + 1));

    // book
    let bp: V3, sc = SC0, ry = 0, rz = 0;
    const slide = S(2, 3.5, t), fly = S(3.5, 8.5, t);
    const P1 = SLOT.clone().add(V(0, 0, 1.4));
    if (t < 3.5) bp = SLOT.clone().add(V(0, 0, 1.4 * slide));
    else {
      bp = bez(P1, V(15, 9, 4), BOOK_AT, fly);
      sc = SC0 + (1 - SC0) * S(4, 8.5, t);
      ry = Math.sin(fly * Math.PI) * .5; rz = Math.sin(fly * Math.PI) * .12;
    }
    book.position.copy(bp); book.scale.setScalar(sc); book.rotation.set(0, ry, rz);
    hinge.rotation.y = -.93 * Math.PI * S(10, 12, t);
    const bo = 1 - S(16, 17.5, t);
    bookMats.forEach(m => { m.opacity = bo; });
    book.visible = bo > .003;

    const dimWall = 1 - .55 * S(1, 2.4, t) * (1 - S(7, 9, t));
    wallCovers.forEach(m => (m.material as THREE.MeshStandardMaterial).color.setScalar(dimWall));

    // storage
    const vo = S(10.5, 12.2, t);
    setOp(vault, vo * .55); setOp(vaultLabel, vo);
    vaultPages.forEach((m, j) => {
      const sj = 11.8 + j * .22, e = S(sj, sj + 1.6, t);
      const shown = t > sj && !(j === 19 && t > 18);
      m.visible = shown;
      if (!shown) return;
      const start = BOOK_AT.clone().add(V(0, 0, .5)), slot = m.userData.slot as V3;
      m.position.copy(bez(start, start.clone().lerp(slot, .5).add(V(0, 3, 3)), slot, e));
      m.rotation.set(0, j % 2 ? Math.PI * 2 * e : 0, Math.sin(e * Math.PI) * .2 * (j % 3 - 1));
      m.scale.setScalar(1 - .58 * e);
      (m.material as THREE.Material).opacity = S(sj, sj + .25, t);
    });

    // the page travels from storage to the reading station
    const se = S(18, 20.2, t);
    const center = lerpV(vaultPages[19].userData.slot as V3, SPREAD, se);
    const ssc = .42 + .58 * se;
    const rf = S(24.6, 27.4, t);
    pageR.visible = t > 18;
    pageR.position.copy(lerpV(center, OCR_AT, rf)).add(V(0, 1.6 * Math.sin(Math.PI * rf), 0));
    pageR.scale.setScalar(lerp(ssc, 1, rf));
    pageRMat.opacity = S(18, 18.4, t);
    pageRMat.color.setScalar((scanTex ? 1 : .96) * (1 - .5 * S(32.8, 34.6, t)));

    // reading beam
    const bs = clamp((t - 28.3) / 3.3), by = pageTop + .1 - 4.2 * bs;
    beam.position.set(OCR_AT.x, by, .06);
    const bo2 = S(27.9, 28.4, t) * (1 - S(31.6, 32.2, t));
    (beamCore.material as THREE.Material).opacity = bo2;
    (beamGlow.material as THREE.Material).opacity = bo2 * .9;
    beam.visible = bo2 > .003;
    ocrLabel.position.set(OCR_AT.x, OCR_AT.y + 2.75, .2);
    setOp(ocrLabel, S(28, 29, t) * (1 - S(33, 34, t)));
    setOp(transLabel, S(37.2, 38.2, t) * (1 - S(43.2, 44.2, t)));

    // lines: rise → travel → turn into English → converge
    lines.forEach((L, i) => {
      const tb = 29.0 + i * .45, r = S(tb, tb + .9, t);
      const p3 = lerpV(V(L.x0, L.yi, .02), V(OCR_AT.x - 1.4, OCR_AT.y + .45 - i * .36, 1.4), r);
      const m = S(33.6 + i * .12, 36.6 + i * .12, t);
      const p4 = V(TRANS_AT.x - 3.3, TRANS_AT.y + (2.0 - i) * .8, 0);
      let p = lerpV(p3, p4, m).add(V(0, 0, 1.5 * Math.sin(Math.PI * m)));
      let s = lerp(lerp(lineScale0, .8, r), 1.5, m), o = S(0, .2, r);
      const c = S(43.6 + i * .08, 46.2 + i * .08, t);
      if (c > 0) { p = lerpV(p4, CORE, c); s *= 1 - .9 * c; o *= 1 - S(.7, 1, c); }
      L.g.position.copy(p); L.g.scale.setScalar(Math.max(.001, s));
      const turn = S(38.5 + i * .45, 39.4 + i * .45, t);
      if (flip) {
        L.g.rotation.x = Math.PI * turn;
        (L.front.material as THREE.Material).opacity = o;
        (L.back.material as THREE.Material).opacity = o;
      } else {
        (L.front.material as THREE.Material).opacity = o * (1 - turn);
        (L.back.material as THREE.Material).opacity = o * turn;
      }
      L.g.visible = o > .003;
    });

    if (noteCard) {
      const dr = S(31.2, 32.4, t);
      noteCard.position.copy(lerpV(V(OCR_AT.x, OCR_AT.y - 1.5, .05), V(OCR_AT.x + 1.9, OCR_AT.y - .9, 1.3), dr));
      noteCard.scale.setScalar(Math.max(.001, .3 + .5 * dr));
      setOp(noteCard, S(31.2, 31.5, t) * (1 - S(34.2, 35, t)));
    }

    // description cards orbit the page
    const cs = S(45, 47, t) * (1 - S(52.4, 53.6, t));
    core.visible = cs > .003; core.scale.setScalar(Math.max(.001, cs));
    corePage.quaternion.copy(camera.quaternion);
    const nC = cards.length;
    cards.forEach((m, k) => {
      const a = S(46.4 + k * .5, 47.4 + k * .5, t), gone = S(52, 53.4, t);
      const rad = 3.7 * a * (1 - gone), ang = k * Math.PI * 2 / nC + (t - 46) * .33;
      m.position.set(CORE.x + rad * Math.cos(ang), CORE.y + .55 * Math.sin(ang * 2 + k), CORE.z + rad * Math.sin(ang) * .85);
      m.quaternion.copy(camera.quaternion);
      m.scale.setScalar(Math.max(.001, .6 + .4 * a));
      setOp(m, a * (1 - gone));
    });
  }

  function resize(w: number, h: number) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    distK = Math.max(1, 1.3 / camera.aspect);
  }

  return {
    canvas: renderer.domElement,
    update,
    resize,
    render: () => renderer.render(scene, camera),
    dispose: () => {
      disposables.forEach(x => x.dispose());
      renderer.dispose();
    },
  };
}
