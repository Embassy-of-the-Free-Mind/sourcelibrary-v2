/**
 * The 3D library hall for /prototype/shelf (#6855). Imported dynamically by
 * ShelfViewer, so three.js loads only on this route.
 *
 * One collection becomes a hall lined with bookcases: one bay per century,
 * oldest at the entrance, newest at the far end, alternating left and right
 * walls, with a brass sign on top of each case. A century that outgrows its
 * case gets another, so no shelf ever overflows. Spines are canvas textures
 * (title, author). Clicking a book brings it to the reader and turns its
 * tooled cover toward them; the HTML card is the viewer's job, the scene only
 * reports which book was picked.
 *
 * The reader walks: WASD or arrows, the wheel, or a click on the floor (the
 * phone path); dragging looks around. One unit is roughly 30 cm.
 */
import * as THREE from 'three';

export interface ShelfBook {
  id: string;
  title: string;
  author?: string;
  year?: number | null;
  language?: string;
  pages_count?: number;
  thumbnail?: string | null;
}

export interface ShelfScene {
  canvas: HTMLCanvasElement;
  resize(width: number, height: number): void;
  /** Bring a book to the reader (or put the current one back with null). */
  select(id: string | null): void;
  dispose(): void;
}

interface Callbacks {
  onPick(id: string | null): void;
  onHover(book: ShelfBook | null, x: number, y: number): void;
}

/**
 * 'stacked' lays books flat in piles, spine out, as libraries kept them before
 * upright shelving became usual (roughly the 16th century); the spine titles
 * then read horizontally. 'upright' is the modern shelf.
 */
export type ShelfLayout = 'stacked' | 'upright';

const SHELF_H = 1.45;        // height of one shelf bay
const BOARD = 0.06;          // shelf board thickness
const SIDE = 0.12;           // case side panel thickness
const CASE_DEPTH = 1.05;
const GAP = 0.006;           // air between neighbouring books

// Leather by language: the colour tells you, at a glance, where on the shelf the Arabic or the German is.
const LANGUAGE_LEATHER: Record<string, string> = {
  Latin: '#6e1f1a',
  German: '#24402e',
  English: '#5a3a22',
  French: '#22395a',
  Italian: '#7a4a1c',
  Spanish: '#6b2c3e',
  Dutch: '#3f4a1f',
  Greek: '#1f4d4d',
  Arabic: '#173a5e',
  Hebrew: '#4a2f5c',
  Persian: '#1d5a52',
  Chinese: '#7a1f1f',
  Japanese: '#2b2b38',
  Sanskrit: '#8a5a12',
  Tibetan: '#8a3412',
  Syriac: '#3b2d52',
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

function leatherFor(book: ShelfBook): THREE.Color {
  const base = LANGUAGE_LEATHER[book.language ?? ''];
  const c = new THREE.Color(base ?? new THREE.Color().setHSL(hash(book.language ?? 'x'), 0.35, 0.22).getStyle());
  const r = hash(book.id);
  c.offsetHSL((r - 0.5) * 0.03, (r - 0.5) * 0.1, (r - 0.5) * 0.08);
  return c;
}

/** Book dimensions in case units: height, thickness, depth. */
function sizeOf(book: ShelfBook): { h: number; t: number; d: number } {
  const r = hash(book.id + 'h');
  const h = 0.82 + r * 0.42;                 // octavo .. folio-ish
  const pages = book.pages_count ?? 200;
  const t = Math.min(0.24, Math.max(0.055, 0.04 + pages * 0.00032));
  return { h: Math.min(h, SHELF_H - BOARD - 0.12), t, d: h * 0.72 };
}

function centuryOf(year: number | null | undefined): number | null {
  return typeof year === 'number' && year > 0 ? Math.floor(year / 100) : null;
}

function centuryLabel(c: number): string {
  const n = c + 1;
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${suffix} c.`;
}

/** Fit text to a width by shrinking, then by truncating. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, min: number, family: string): string {
  let s = size;
  ctx.font = `${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > min) { s -= 1; ctx.font = `${s}px ${family}`; }
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 4 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

const SERIF = '"EB Garamond", "Cormorant Garamond", Georgia, serif';

function spineTexture(book: ShelfBook, leather: THREE.Color, h: number, t: number): THREE.CanvasTexture {
  // Canvas is laid out lengthwise (x = along the spine), then mapped rotated.
  const L = 512;
  const W = Math.max(40, Math.round((L * t) / h));
  const c = document.createElement('canvas');
  c.width = L; c.height = W;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = leather.getStyle();
  ctx.fillRect(0, 0, L, W);
  // Grain: a few hundred faint flecks, deterministic per book.
  let seed = hash(book.id + 'g') * 1e6;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(rnd() * L, rnd() * W, 1 + rnd() * 3, 1);
  }
  // Rounded-spine shading.
  const g = ctx.createLinearGradient(0, 0, 0, W);
  g.addColorStop(0, 'rgba(0,0,0,0.35)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.06)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L, W);
  // Raised bands.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (const x of [22, 30, L - 34, L - 26]) ctx.fillRect(x, 0, 3, W);
  const gold = '#d9b45a';
  ctx.fillStyle = gold;
  ctx.textBaseline = 'middle';
  // Title runs down the spine (English convention), author after it, date at the foot.
  const showAuthor = !!book.author && W >= 30;
  const title = fitText(ctx, book.title, L - 88 - (showAuthor ? 130 : 0), Math.min(30, W * 0.55), 11, SERIF);
  ctx.textAlign = 'left';
  ctx.fillText(title, 44, W / 2);
  if (showAuthor) {
    ctx.globalAlpha = 0.8;
    const author = fitText(ctx, book.author!.split(',')[0], 110, Math.min(18, W * 0.38), 9, SERIF);
    ctx.textAlign = 'right';
    ctx.fillText(author, L - 44, W / 2);
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Rotate so the canvas's long axis runs top-to-bottom on the spine face.
  tex.center.set(0.5, 0.5);
  tex.rotation = -Math.PI / 2;
  return tex;
}

/** Front board: blind-tooled frame and a gilt title, the way a bound book shows itself face-on. */
function coverTexture(book: ShelfBook, leather: THREE.Color, h: number, d: number): THREE.CanvasTexture {
  const H = 512;
  const W = Math.round((H * d) / h);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = leather.getStyle();
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W * 0.4, H * 0.35, 10, W / 2, H / 2, H * 0.7);
  g.addColorStop(0, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, W - 36, H - 36);
  ctx.strokeStyle = 'rgba(217,180,90,0.75)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(26, 26, W - 52, H - 52);
  // Corner fleurons.
  ctx.fillStyle = 'rgba(217,180,90,0.8)';
  for (const [x, y] of [[26, 26], [W - 26, 26], [26, H - 26], [W - 26, H - 26]]) {
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
  }
  // Title, wrapped into at most five lines inside a gilt panel.
  ctx.fillStyle = '#e2c27a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const maxW = W - 90;
  let size = 26;
  let lines: string[] = [];
  for (; size >= 14; size -= 2) {
    ctx.font = `${size}px ${SERIF}`;
    lines = [];
    let line = '';
    for (const word of book.title.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    if (lines.length <= 5) break;
  }
  if (lines.length > 5) { lines = lines.slice(0, 5); lines[4] = lines[4].replace(/\s*\S*$/, '…'); }
  const lh = size * 1.25;
  const top = H * 0.36 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, top + i * lh));
  if (book.author) {
    ctx.font = `italic ${Math.max(13, size - 6)}px ${SERIF}`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(fitText(ctx, book.author.split(',')[0], maxW, Math.max(13, size - 6), 11, `italic ${SERIF}`), W / 2, top + lines.length * lh + 18);
    ctx.globalAlpha = 1;
  }
  if (book.year) {
    ctx.font = `${16}px ${SERIF}`;
    ctx.fillText(String(book.year), W / 2, H - 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function plaqueTexture(label: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 96);
  g.addColorStop(0, '#e2c27a'); g.addColorStop(0.5, '#b8913f'); g.addColorStop(1, '#8a6a26');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = 'rgba(60,40,10,0.6)'; ctx.lineWidth = 4; ctx.strokeRect(6, 6, 244, 84);
  ctx.fillStyle = '#3a2810'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `600 44px ${SERIF}`;
  ctx.fillText(label, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function woodTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#4a2e1a'; ctx.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 60; i++) {
    const y = Math.random() * 64;
    ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? '20,10,4' : '110,70,40'},${0.1 + Math.random() * 0.15})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.5;
    ctx.beginPath(); ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, y + Math.sin(x / 70 + i) * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}


type Slot = { books: ShelfBook[]; w: number };
interface RowSpec { label: string; slots: Slot[] }
interface CaseSpec { rows: RowSpec[] }

/** "13th c." for one century, "9th–13th c." when sparse centuries share a case. */
function caseLabel(spec: CaseSpec): string {
  const labels = [...new Set(spec.rows.map(r => r.label))];
  if (labels.length === 1) return labels[0];
  return `${labels[0].replace(' c.', '')}–${labels[labels.length - 1]}`;
}

const ROWS = 4;
const INNER_W = 4.4;
const CASE_W = INNER_W + SIDE * 2;
const CASE_H = ROWS * SHELF_H + BOARD;
const HALL_W = 9.5;          // wall to wall
const BAY_GAP = 0.5;         // between neighbouring cases on one wall
const EYE = 4.9;             // eye height, about 1.5 m
const ENTRANCE_Z = 5;
const WALK_SPEED = 7;
const PILE_MAX = 7;
const PILE_GAP = 0.07;

function plankTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    const shade = 34 + Math.floor(Math.random() * 14);
    ctx.fillStyle = `rgb(${shade + 22},${shade + 8},${shade - 6})`;
    ctx.fillRect(0, i * 32, 256, 32);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, i * 32, 256, 2);
    ctx.fillRect(Math.random() * 256, i * 32, 2, 32);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Group books into cases: a bay per century (undated last), piles or upright, wrapped so nothing overflows. */
function planCases(books: ShelfBook[], layout: ShelfLayout): CaseSpec[] {
  const byCentury = new Map<string, ShelfBook[]>();
  for (const b of books) {
    const c = centuryOf(b.year);
    const key = c === null ? 'Undated' : centuryLabel(c);
    if (!byCentury.has(key)) byCentury.set(key, []);
    byCentury.get(key)!.push(b);
  }
  // Undated books go to the far end rather than wherever the API sorted them.
  const keys = [...byCentury.keys()].filter(k => k !== 'Undated');
  if (byCentury.has('Undated')) keys.push('Undated');

  const clearance = SHELF_H - BOARD - 0.12;
  const usable = INNER_W - 0.2;
  const cases: CaseSpec[] = [];
  for (const label of keys) {
    const slots: Slot[] = [];
    let pile: Slot | null = null;
    let pileH = 0;
    for (const b of byCentury.get(label)!) {
      const size = sizeOf(b);
      if (layout === 'upright') { slots.push({ books: [b], w: size.t + GAP }); continue; }
      if (!pile || pile.books.length >= PILE_MAX || pileH + size.t > clearance) {
        pile = { books: [], w: 0 };
        pileH = 0;
        slots.push(pile);
      }
      pile.books.push(b);
      pileH += size.t;
      pile.w = Math.max(pile.w, size.h + PILE_GAP);
    }
    // A sparse century takes the next free shelf of the case before it rather than a whole case of
    // its own, so the early, thin centuries don't greet the reader with empty furniture.
    let cur: CaseSpec | null = cases[cases.length - 1] ?? null;
    if (cur && (cur.rows.length >= ROWS || label === 'Undated')) cur = null;
    if (cur) cur.rows.push({ label, slots: [] });
    let rowW = 0;
    for (const slot of slots) {
      if (!cur || (rowW + slot.w > usable && cur.rows.length >= ROWS)) {
        cur = { rows: [{ label, slots: [] }] };
        cases.push(cur);
        rowW = 0;
      } else if (rowW + slot.w > usable) {
        cur.rows.push({ label, slots: [] });
        rowW = 0;
      }
      cur.rows[cur.rows.length - 1].slots.push(slot);
      rowW += slot.w;
    }
  }
  return cases;
}

export function createShelfScene(books: ShelfBook[], cb: Callbacks, layout: ShelfLayout = 'stacked'): ShelfScene {
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  canvas.style.display = 'block';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#140d08');
  scene.fog = new THREE.Fog('#140d08', 14, 55);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 120);
  camera.rotation.order = 'YXZ';

  scene.add(new THREE.HemisphereLight('#ffe7c4', '#3a2616', 1.7));
  const key = new THREE.DirectionalLight('#fff1d8', 1.1);
  key.position.set(2, 12, 6);
  scene.add(key);
  // A reading lamp carried by the reader: whatever you walk up to is lit.
  const lamp = new THREE.PointLight('#ffcf8a', 45, 18, 1.3);
  scene.add(lamp);

  const cases = planCases(books, layout);
  const pairs = Math.ceil(cases.length / 2);
  const hallLen = Math.max(1, pairs) * (CASE_W + BAY_GAP);
  // Hanging lamps down the middle of the hall, one per pair of cases (capped: each costs every pixel).
  for (let k = 0; k < Math.min(pairs, 6); k++) {
    const hanging = new THREE.PointLight('#ffd49a', 30, 12, 1.5);
    const step = pairs / Math.min(pairs, 6);
    hanging.position.set(0, 9, ENTRANCE_Z - 2 - (k + 0.5) * step * (CASE_W + BAY_GAP));
    scene.add(hanging);
  }

  // ── The room ──────────────────────────────────────────────────────────
  const planks = keep(plankTexture());
  planks.repeat.set(HALL_W / 3, (hallLen + 12) / 3);
  const floor = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(HALL_W, hallLen + 12)),
    keep(new THREE.MeshStandardMaterial({ map: planks, roughness: 0.85 })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, ENTRANCE_Z + 3 - (hallLen + 12) / 2);
  scene.add(floor);
  const plaster = keep(new THREE.MeshStandardMaterial({ color: '#5a4430', roughness: 1 }));
  const wallGeo = keep(new THREE.PlaneGeometry(hallLen + 12, 12));
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(wallGeo, plaster);
    wall.rotation.y = -side * Math.PI / 2;
    wall.position.set(side * HALL_W / 2, 6, floor.position.z);
    scene.add(wall);
  }
  const endWall = new THREE.Mesh(keep(new THREE.PlaneGeometry(HALL_W, 12)), plaster);
  endWall.position.set(0, 6, -hallLen - 3);
  scene.add(endWall);
  const ceiling = new THREE.Mesh(keep(new THREE.PlaneGeometry(HALL_W, hallLen + 12)), keep(new THREE.MeshStandardMaterial({ color: '#1e140d', roughness: 1 })));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 11, floor.position.z);
  scene.add(ceiling);

  const wood = keep(woodTexture());
  const woodMat = keep(new THREE.MeshStandardMaterial({ map: wood, color: '#b07a4c', roughness: 0.7 }));
  const backMat = keep(new THREE.MeshStandardMaterial({ color: '#2a1a10', roughness: 0.95 }));
  for (let z = ENTRANCE_Z; z > -hallLen - 3; z -= 4) {
    const beam = new THREE.Mesh(keep(new THREE.BoxGeometry(HALL_W, 0.35, 0.4)), woodMat);
    beam.position.set(0, 10.8, z);
    scene.add(beam);
  }

  const pageMat = keep(new THREE.MeshStandardMaterial({ color: '#e9dcc0', roughness: 0.9 }));
  const signGeo = keep(new THREE.BoxGeometry(1.5, 0.5, 0.05));
  const tagGeo = keep(new THREE.BoxGeometry(0.42, 0.14, 0.02));

  interface BookObj {
    book: ShelfBook; mesh: THREE.Mesh; size: { h: number; t: number; d: number };
    home: THREE.Vector3; homeQuat: THREE.Quaternion; outDir: THREE.Vector3;
    coverMat: THREE.MeshStandardMaterial; coverLoaded: boolean;
  }
  const bookObjs: BookObj[] = [];
  const byId = new Map<string, BookObj>();
  const walkable: THREE.Object3D[] = [floor];

  cases.forEach((spec, i) => {
    const left = i % 2 === 0;
    const zNear = ENTRANCE_Z - 2 - Math.floor(i / 2) * (CASE_W + BAY_GAP);
    // Case-local frame: x along the shelves, y up, +z out of the case toward the reader.
    const g = new THREE.Group();
    if (left) {
      g.rotation.y = Math.PI / 2;
      g.position.set(-HALL_W / 2 + CASE_DEPTH + 0.05, 0, zNear - SIDE);
    } else {
      g.rotation.y = -Math.PI / 2;
      g.position.set(HALL_W / 2 - CASE_DEPTH - 0.05, 0, zNear - CASE_W + SIDE);
    }
    scene.add(g);
    g.updateMatrixWorld(true);
    walkable.push(g);

    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), mat);
      m.position.set(x, y, z);
      g.add(m);
    };
    box(CASE_W, CASE_H + 0.2, 0.04, INNER_W / 2, CASE_H / 2, -CASE_DEPTH, backMat);
    box(SIDE, CASE_H + 0.2, CASE_DEPTH + 0.06, -SIDE / 2, CASE_H / 2, -CASE_DEPTH / 2, woodMat);
    box(SIDE, CASE_H + 0.2, CASE_DEPTH + 0.06, INNER_W + SIDE / 2, CASE_H / 2, -CASE_DEPTH / 2, woodMat);
    box(CASE_W + 0.12, 0.16, CASE_DEPTH + 0.14, INNER_W / 2, CASE_H + 0.14, -CASE_DEPTH / 2, woodMat);
    for (let r = 0; r <= ROWS; r++) box(INNER_W, BOARD, CASE_DEPTH, INNER_W / 2, r * SHELF_H + BOARD / 2, -CASE_DEPTH / 2, woodMat);
    const sign = new THREE.Mesh(signGeo, keep(new THREE.MeshStandardMaterial({ map: keep(plaqueTexture(caseLabel(spec))), metalness: 0.6, roughness: 0.35 })));
    sign.position.set(INNER_W / 2, CASE_H + 0.55, 0.05);
    g.add(sign);
    g.updateMatrixWorld(true);

    const outDir = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
    const shared = new Set(spec.rows.map(r => r.label)).size > 1;
    spec.rows.forEach((row, r) => {
      // Top shelf first: at this scale it sits at eye level, so a sparse century is still easy to read.
      const baseY = (ROWS - 1 - r) * SHELF_H + BOARD;
      if (shared && (r === 0 || spec.rows[r - 1].label !== row.label)) {
        // Where centuries share a case, each one's first shelf carries its own small plaque.
        const tag = new THREE.Mesh(tagGeo, keep(new THREE.MeshStandardMaterial({ map: keep(plaqueTexture(row.label)), metalness: 0.6, roughness: 0.35 })));
        tag.position.set(0.3, baseY - BOARD / 2, 0.012);
        g.add(tag);
      }
      // A shelf that isn't full keeps its books in the middle rather than huddled at one end.
      const rowW = row.slots.reduce((sum, sl) => sum + sl.w, 0);
      let x = 0.1 + Math.max(0, (INNER_W - 0.2 - rowW) / 2);
      for (const slot of row.slots) {
        // Heaviest at the bottom of a pile, as anyone stacking books would.
        const ordered = layout === 'stacked' ? [...slot.books].sort((a, b) => sizeOf(b).h - sizeOf(a).h) : slot.books;
        let y = baseY;
        for (const book of ordered) {
          const size = sizeOf(book);
          const leather = leatherFor(book);
          const leatherMat = keep(new THREE.MeshStandardMaterial({ color: leather, roughness: 0.7 }));
          const spineMat = keep(new THREE.MeshStandardMaterial({ map: keep(spineTexture(book, leather, size.h, size.t)), roughness: 0.6, metalness: 0.05 }));
          const coverMat = keep(new THREE.MeshStandardMaterial({ color: leather, roughness: 0.7 }));
          // Faces: +x front cover, -x back cover, +y/-y page block, +z spine, -z fore-edge.
          const mesh = new THREE.Mesh(keep(new THREE.BoxGeometry(size.t, size.h, size.d)), [coverMat, leatherMat, pageMat, pageMat, spineMat, pageMat]);
          const jz = (hash(book.id + 'z') - 0.5) * 0.05;
          const local = new THREE.Vector3();
          const rot = new THREE.Euler();
          if (layout === 'stacked') {
            // Lying on its back cover, head to the left, so the spine title reads left to right.
            const jx = (hash(book.id + 'x') - 0.5) * 0.06;
            local.set(x + slot.w / 2 + jx, y + size.t / 2, -size.d / 2 + jz);
            rot.set(0, (hash(book.id + 'r') - 0.5) * 0.08, Math.PI / 2);
            y += size.t + 0.002;
          } else {
            local.set(x + size.t / 2, baseY + size.h / 2, -size.d / 2 + jz);
          }
          const home = local.applyMatrix4(g.matrixWorld);
          const homeQuat = g.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(rot));
          mesh.position.copy(home);
          mesh.quaternion.copy(homeQuat);
          mesh.userData.id = book.id;
          scene.add(mesh);
          const obj: BookObj = { book, mesh, size, home, homeQuat, outDir, coverMat, coverLoaded: false };
          bookObjs.push(obj);
          byId.set(book.id, obj);
        }
        x += slot.w;
      }
    });
  });

  // ── The reader ────────────────────────────────────────────────────────
  const xLimit = HALL_W / 2 - CASE_DEPTH - 1.2;
  const zMin = -hallLen + 1;
  const zMax = ENTRANCE_Z + 1;
  const pos = new THREE.Vector3(0, EYE, ENTRANCE_Z);
  const goal = pos.clone();
  let yaw = 0;
  let pitch = -0.06;
  let aspect = 1;
  const clampGoal = () => {
    goal.x = Math.min(xLimit, Math.max(-xLimit, goal.x));
    goal.z = Math.min(zMax, Math.max(zMin, goal.z));
  };
  const forward = () => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const rightward = () => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  // ── Selection ─────────────────────────────────────────────────────────
  let selected: BookObj | null = null;
  let hovered: BookObj | null = null;
  const anim = new Map<BookObj, { pos: THREE.Vector3; quat: THREE.Quaternion }>();
  const coverTurn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2 + 0.2, 0));

  // Covers are drawn on first pull rather than up front: most books are never taken off the shelf.
  function loadCover(o: BookObj) {
    if (o.coverLoaded) return;
    o.coverLoaded = true;
    o.coverMat.map = keep(coverTexture(o.book, o.coverMat.color, o.size.h, o.size.d));
    o.coverMat.color.set('#ffffff');
    o.coverMat.needsUpdate = true;
  }

  function select(id: string | null) {
    const next = id ? byId.get(id) ?? null : null;
    if (next === selected) return;
    if (selected) anim.set(selected, { pos: selected.home.clone(), quat: selected.homeQuat });
    selected = next;
    if (!next) return;
    loadCover(next);
    // Bring it to the reader: in front of the eyes, upright, front cover turned toward them.
    // On a wide screen the card sits on the right, so the book hangs left of centre.
    goal.copy(pos);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const out = pos.clone()
      .addScaledVector(look, aspect < 1 ? 3.4 : 2.6)
      .addScaledVector(camRight, aspect > 1.2 ? -0.7 : 0)
      .addScaledVector(camUp, aspect < 1 ? 0.55 : 0);
    anim.set(next, { pos: out, quat: camera.quaternion.clone().multiply(coverTurn) });
  }

  // ── Input ─────────────────────────────────────────────────────────────
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const aim = (cx: number, cy: number) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const pickBook = (cx: number, cy: number): BookObj | null => {
    aim(cx, cy);
    const hit = ray.intersectObjects(bookObjs.map(o => o.mesh), false)[0];
    return hit ? byId.get(hit.object.userData.id) ?? null : null;
  };
  /** Click on the floor or a case: walk to (just in front of) that spot. */
  const walkTo = (cx: number, cy: number) => {
    aim(cx, cy);
    const hit = ray.intersectObjects(walkable, true)[0];
    if (!hit) return;
    goal.set(hit.point.x, EYE, hit.point.z);
    clampGoal();
  };

  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      keys.add(k);
      e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());

  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0;
  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) moved = 0;
  };
  const onMove = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === 'mouse') {
        const o = pickBook(e.clientX, e.clientY);
        if (o !== hovered) { hovered = o; canvas.style.cursor = o ? 'pointer' : 'grab'; }
        cb.onHover(o && o !== selected ? o.book : null, e.clientX, e.clientY);
      }
      return;
    }
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 6) {
      // Grab the world: dragging right turns you left, as if pulling the room past you.
      yaw += dx * 0.0042;
      pitch = Math.min(0.9, Math.max(-1.1, pitch + dy * 0.0035));
      canvas.style.cursor = 'grabbing';
      cb.onHover(null, 0, 0);
    }
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0 && moved <= 6) {
      const o = pickBook(e.clientX, e.clientY);
      if (o && o !== selected) cb.onPick(o.book.id);
      else if (selected) cb.onPick(null);
      else walkTo(e.clientX, e.clientY);
    }
    if (pointers.size === 0) canvas.style.cursor = hovered ? 'pointer' : 'grab';
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (selected) cb.onPick(null);
    goal.addScaledVector(forward(), -e.deltaY * 0.012);
    goal.addScaledVector(rightward(), e.deltaX * 0.012);
    clampGoal();
  };
  const onLeave = () => cb.onHover(null, 0, 0);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.style.cursor = 'grab';

  // ── Loop ──────────────────────────────────────────────────────────────
  let raf = 0;
  let last = performance.now();
  const tipped = new THREE.Vector3();
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const ahead = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    const side = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    const turn = (keys.has('arrowleft') ? 1 : 0) - (keys.has('arrowright') ? 1 : 0);
    if (ahead || side) {
      if (selected) cb.onPick(null);
      goal.addScaledVector(forward(), ahead * WALK_SPEED * dt);
      goal.addScaledVector(rightward(), side * WALK_SPEED * dt);
      clampGoal();
    }
    yaw += turn * 1.6 * dt;

    pos.lerp(goal, 1 - Math.exp(-dt * 5));
    camera.position.copy(pos);
    camera.rotation.set(pitch, yaw, 0);
    lamp.position.copy(pos).addScaledVector(forward(), 1.5).add(new THREE.Vector3(0, 1.2, 0));

    for (const [o, a] of anim) {
      o.mesh.position.lerp(a.pos, 1 - Math.exp(-dt * 8));
      o.mesh.quaternion.slerp(a.quat, 1 - Math.exp(-dt * 8));
      if (o.mesh.position.distanceTo(a.pos) < 0.001 && o.mesh.quaternion.angleTo(a.quat) < 0.001) anim.delete(o);
    }
    // A hovered book slides toward you a little, like a finger hooked over the headcap.
    if (hovered && hovered !== selected && !anim.has(hovered)) {
      tipped.copy(hovered.home).addScaledVector(hovered.outDir, 0.1);
      hovered.mesh.position.lerp(tipped, 1 - Math.exp(-dt * 12));
    }
    for (const o of bookObjs) {
      if (o === hovered || o === selected || anim.has(o)) continue;
      if (o.mesh.position.distanceToSquared(o.home) > 1e-8) o.mesh.position.lerp(o.home, 1 - Math.exp(-dt * 12));
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    canvas,
    resize(width, height) {
      aspect = width / Math.max(1, height);
      renderer.setSize(width, height, false);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      camera.aspect = aspect;
      // Phones get a wider view so a shelf still fits across the screen.
      camera.fov = aspect < 1 ? 75 : 62;
      camera.updateProjectionMatrix();
    },
    select,
    dispose() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      disposables.forEach(x => x.dispose());
      renderer.dispose();
    },
  };
}
