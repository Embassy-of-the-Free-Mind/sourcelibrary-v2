/**
 * The 3D bookcase for /prototype/shelf (#6855). Imported dynamically by
 * ShelfViewer, so three.js loads only on this route.
 *
 * One collection is laid out as a wooden case: books in date order, left to
 * right and top to bottom, with a brass plaque wherever the century changes.
 * Spines are canvas textures (title, author, date). Clicking a spine pulls the
 * book out and turns it to show its title page; the HTML card is the viewer's
 * job, the scene only reports which book was picked.
 *
 * Camera is a constrained pan/zoom rig, not an orbit: the reader stands in
 * front of the case and moves along it, the way you would at a real shelf.
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
  /** Pull a book out (or put the current one back with null). */
  select(id: string | null): void;
  /** Move the camera along the case: dx/dy in case units. */
  pan(dx: number, dy: number): void;
  dispose(): void;
}

interface Callbacks {
  onPick(id: string | null): void;
  onHover(book: ShelfBook | null, x: number, y: number): void;
}

const SHELF_H = 1.45;        // height of one shelf bay
const BOARD = 0.06;          // shelf board thickness
const SIDE = 0.12;           // case side panel thickness
const CASE_DEPTH = 1.05;
const GAP = 0.006;           // air between neighbouring books
const PLAQUE_W = 0.34;

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

type Slot =
  | { kind: 'book'; book: ShelfBook; w: number }
  | { kind: 'plaque'; label: string; w: number };

export function createShelfScene(books: ShelfBook[], cb: Callbacks): ShelfScene {
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  canvas.style.display = 'block';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a120c');
  scene.fog = new THREE.Fog('#1a120c', 9, 22);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);

  // Lighting: a warm reading lamp that follows the camera, plus fill.
  scene.add(new THREE.HemisphereLight('#ffe7c4', '#2a1a10', 0.9));
  const key = new THREE.DirectionalLight('#fff1d8', 1.4);
  key.position.set(-3, 6, 8);
  scene.add(key);
  const lamp = new THREE.PointLight('#ffcf8a', 14, 7, 1.6);
  scene.add(lamp);

  // ── Layout ────────────────────────────────────────────────────────────
  const slots: Slot[] = [];
  let lastCentury: number | null = null;
  for (const b of books) {
    const c = centuryOf(b.year);
    if (c !== null && c !== lastCentury) { slots.push({ kind: 'plaque', label: centuryLabel(c), w: PLAQUE_W }); lastCentury = c; }
    slots.push({ kind: 'book', book: b, w: sizeOf(b).t + GAP });
  }
  const total = slots.reduce((s, x) => s + x.w, 0);
  // Wide rather than tall: the reader pans sideways, the way you walk a shelf.
  const rows = Math.max(1, Math.min(6, Math.round(Math.sqrt(total / 4))));
  const innerW = Math.max(3, total / rows + 0.4);
  const caseW = innerW + SIDE * 2;
  const caseH = rows * SHELF_H + BOARD;

  const wood = keep(woodTexture());
  const woodMat = keep(new THREE.MeshStandardMaterial({ map: wood, color: '#8a5a36', roughness: 0.75 }));
  const backMat = keep(new THREE.MeshStandardMaterial({ color: '#2a1a10', roughness: 0.95 }));
  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };
  // Carcass: back, sides, top, shelves. Origin = bottom-left-front of the inner space.
  addBox(caseW, caseH + 0.2, 0.04, innerW / 2, caseH / 2, -CASE_DEPTH, backMat);
  addBox(SIDE, caseH + 0.2, CASE_DEPTH + 0.06, -SIDE / 2, caseH / 2, -CASE_DEPTH / 2, woodMat);
  addBox(SIDE, caseH + 0.2, CASE_DEPTH + 0.06, innerW + SIDE / 2, caseH / 2, -CASE_DEPTH / 2, woodMat);
  addBox(caseW + 0.12, 0.14, CASE_DEPTH + 0.14, innerW / 2, caseH + 0.13, -CASE_DEPTH / 2, woodMat);
  for (let r = 0; r <= rows; r++) addBox(innerW, BOARD, CASE_DEPTH, innerW / 2, r * SHELF_H + BOARD / 2, -CASE_DEPTH / 2, woodMat);
  // Floor.
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(80, 40)), keep(new THREE.MeshStandardMaterial({ color: '#24170e', roughness: 1 })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(innerW / 2, -0.01, 0);
  scene.add(floor);

  const pageMat = keep(new THREE.MeshStandardMaterial({ color: '#e9dcc0', roughness: 0.9 }));
  const plaqueGeo = keep(new THREE.BoxGeometry(PLAQUE_W - 0.04, 0.13, 0.02));

  interface BookObj { book: ShelfBook; mesh: THREE.Mesh; home: THREE.Vector3; size: { h: number; t: number; d: number }; coverMat: THREE.MeshStandardMaterial; coverLoaded: boolean }
  const bookObjs: BookObj[] = [];
  const byId = new Map<string, BookObj>();

  const rowWidth = innerW - 0.2;
  let row = 0, x = 0.1;
  for (const s of slots) {
    if (x + s.w > rowWidth + 0.1 && row < rows - 1) { row++; x = 0.1; }
    // Top shelf first, like reading a page.
    const baseY = (rows - 1 - row) * SHELF_H + BOARD;
    if (s.kind === 'plaque') {
      const tex = keep(plaqueTexture(s.label));
      const m = new THREE.Mesh(plaqueGeo, keep(new THREE.MeshStandardMaterial({ map: tex, metalness: 0.6, roughness: 0.35 })));
      m.position.set(x + s.w / 2, baseY - BOARD / 2, 0.012);
      scene.add(m);
      // A bookend so the plaque reads as a divider, not a gap.
      addBox(0.03, 0.5, 0.45, x + s.w / 2, baseY + 0.25, -0.35, woodMat);
    } else {
      const size = sizeOf(s.book);
      const leather = leatherFor(s.book);
      const leatherMat = keep(new THREE.MeshStandardMaterial({ color: leather, roughness: 0.7 }));
      const spine = keep(spineTexture(s.book, leather, size.h, size.t));
      const spineMat = keep(new THREE.MeshStandardMaterial({ map: spine, roughness: 0.6, metalness: 0.05 }));
      const coverMat = keep(new THREE.MeshStandardMaterial({ color: leather, roughness: 0.7 }));
      // Faces: +x front cover, -x back cover, +y/-y page block, +z spine, -z fore-edge.
      const mesh = new THREE.Mesh(keep(new THREE.BoxGeometry(size.t, size.h, size.d)), [coverMat, leatherMat, pageMat, pageMat, spineMat, pageMat]);
      // Spines sit flush-ish with the shelf front, with a little jitter so the row looks handled.
      const jitter = (hash(s.book.id + 'z') - 0.5) * 0.05;
      const home = new THREE.Vector3(x + size.t / 2, baseY + size.h / 2, -size.d / 2 + jitter);
      mesh.position.copy(home);
      mesh.userData.id = s.book.id;
      scene.add(mesh);
      const obj = { book: s.book, mesh, home, size, coverMat, coverLoaded: false };
      bookObjs.push(obj);
      byId.set(s.book.id, obj);
    }
    x += s.w;
  }

  // ── Camera rig ────────────────────────────────────────────────────────
  // target = the point on the case face we look at; dist = how far we stand back.
  const target = new THREE.Vector3(Math.min(innerW / 2, 2.2), caseH - SHELF_H * 0.9, 0);
  let dist = 4.2;
  const goal = { target: target.clone(), dist };
  let aspect = 1;
  const minDist = 1.1;
  const maxDist = () => Math.max(4, Math.max(caseH, innerW / aspect) * 1.5);
  const clampGoal = () => {
    goal.dist = Math.min(maxDist(), Math.max(minDist, goal.dist));
    goal.target.x = Math.min(innerW, Math.max(0, goal.target.x));
    goal.target.y = Math.min(caseH, Math.max(0.5, goal.target.y));
  };

  // ── Selection ─────────────────────────────────────────────────────────
  let selected: BookObj | null = null;
  let hovered: BookObj | null = null;
  const anim = new Map<BookObj, { pos: THREE.Vector3; rotY: number }>();
  let savedView: { target: THREE.Vector3; dist: number } | null = null;
  // Covers are drawn on first pull rather than up front: most books are never taken off the shelf.
  // (The title page itself is shown in the HTML card; the image host's CORS would block it as a texture off sourcelibrary.org.)
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
    if (selected) anim.set(selected, { pos: selected.home.clone(), rotY: 0 });
    selected = next;
    if (next) {
      if (!savedView) savedView = { target: goal.target.clone(), dist: goal.dist };
      loadCover(next);
      // Pull it clear of the shelf, lift it a little, and turn the front cover to the reader.
      const out = next.home.clone();
      out.z = next.size.d * 0.5 + 0.35;
      out.y = next.home.y + 0.05;
      anim.set(next, { pos: out, rotY: -Math.PI / 2 + 0.25 });
      // Portrait screens need more distance for the book to fit above the bottom card.
      goal.dist = Math.max(minDist + 0.6, next.size.h * (aspect < 1 ? 4.2 : 2.4));
      // On a wide screen the card sits on the right, so frame the book left of centre.
      const shift = aspect > 1.2 ? goal.dist * 0.22 : 0;
      goal.target.set(out.x + shift, out.y - (aspect > 1.2 ? 0 : next.size.h * 0.55), out.z);
    } else if (savedView) {
      goal.target.copy(savedView.target);
      goal.dist = savedView.dist;
      savedView = null;
    }
    clampGoal();
  }

  // ── Input ─────────────────────────────────────────────────────────────
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickAt = (cx: number, cy: number): BookObj | null => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(bookObjs.map(o => o.mesh), false)[0];
    return hit ? byId.get(hit.object.userData.id) ?? null : null;
  };
  const unitsPerPixel = () => (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / canvas.clientHeight;

  const pointers = new Map<number, { x: number; y: number }>();
  let downAt: { x: number; y: number } | null = null;
  let moved = 0;
  let pinchStart = 0;

  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { downAt = { x: e.clientX, y: e.clientY }; moved = 0; }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onMove = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === 'mouse') {
        const o = pickAt(e.clientX, e.clientY);
        if (o !== hovered) { hovered = o; canvas.style.cursor = o ? 'pointer' : 'grab'; }
        cb.onHover(o && o !== selected ? o.book : null, e.clientX, e.clientY);
      }
      return;
    }
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.size === 2) {
      pointers.set(e.pointerId, cur);
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart > 0) { goal.dist *= pinchStart / d; pinchStart = d; clampGoal(); }
      moved += 10;
      return;
    }
    const dx = cur.x - prev.x, dy = cur.y - prev.y;
    pointers.set(e.pointerId, cur);
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 6) {
      const u = unitsPerPixel();
      goal.target.x -= dx * u;
      goal.target.y += dy * u;
      clampGoal();
      canvas.style.cursor = 'grabbing';
      cb.onHover(null, 0, 0);
    }
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0 && downAt && moved <= 6) {
      const o = pickAt(e.clientX, e.clientY);
      cb.onPick(o && o !== selected ? o.book.id : null);
    }
    if (pointers.size === 0) { downAt = null; canvas.style.cursor = hovered ? 'pointer' : 'grab'; }
    pinchStart = 0;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 1.5 && !e.shiftKey) {
      // Pinch-to-zoom on a trackpad arrives as ctrl+wheel; a plain vertical wheel also zooms.
      goal.dist *= Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    } else {
      const u = unitsPerPixel();
      goal.target.x += (e.shiftKey ? e.deltaY : e.deltaX) * u;
    }
    clampGoal();
  };
  const onLeave = () => cb.onHover(null, 0, 0);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.style.cursor = 'grab';

  // ── Loop ──────────────────────────────────────────────────────────────
  let raf = 0;
  let last = performance.now();
  const hoverOut = new THREE.Vector3();
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const k = 1 - Math.exp(-dt * 7);
    target.lerp(goal.target, k);
    dist += (goal.dist - dist) * k;
    camera.position.set(target.x, target.y + dist * 0.06, target.z + dist);
    camera.lookAt(target);
    lamp.position.set(target.x + 0.6, target.y + 1.2, target.z + Math.min(dist, 3));

    for (const [o, a] of anim) {
      o.mesh.position.lerp(a.pos, 1 - Math.exp(-dt * 9));
      o.mesh.rotation.y += (a.rotY - o.mesh.rotation.y) * (1 - Math.exp(-dt * 8));
      if (o.mesh.position.distanceTo(a.pos) < 0.001 && Math.abs(a.rotY - o.mesh.rotation.y) < 0.001) anim.delete(o);
    }
    // Hovered spine tips out slightly, like a finger hooked over the headcap.
    for (const o of bookObjs) {
      if (o === selected || anim.has(o)) continue;
      hoverOut.copy(o.home);
      if (o === hovered) hoverOut.z += 0.08;
      o.mesh.position.lerp(hoverOut, 1 - Math.exp(-dt * 12));
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
      camera.updateProjectionMatrix();
      clampGoal();
    },
    select,
    pan(dx, dy) { goal.target.x += dx; goal.target.y += dy; clampGoal(); },
    dispose() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      disposables.forEach(x => x.dispose());
      renderer.dispose();
    },
  };
}
