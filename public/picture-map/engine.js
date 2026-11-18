// Picture Map engine. Generated from latent-walks/map.html by build_map_site.py; data lives at
// https://images.sourcelibrary.org/picture-map/v1/ (map.bin, labels/N.json, suggestions.json).
(() => {

const STATIC = true, DATA = 'https://images.sourcelibrary.org/picture-map/v1/';   // build_map_site.py sets this to true for the online copy (no server: ready-made searches, labels from files)
const $ = id => document.getElementById(id);
const canvas = $('c');
if (!canvas || canvas.dataset.started) throw new Error('picture map already running');
canvas.dataset.started = '1';
const gl = canvas.getContext('webgl2', {antialias: true, alpha: false});

// Each picture is one point in its own average colour. Points found by a search glow gold and larger.
const VS = `#version 300 es
in vec2 xy; in vec4 rgba; uniform vec3 uCam; uniform float uAsp, uSize, uGain, uDim; out vec3 c;
void main(){ vec2 p = (xy - uCam.xy)/(uCam.z*0.5); gl_Position = vec4(p.x, -p.y/uAsp, 0.0, 1.0); gl_PointSize = uSize;
  vec3 g = vec3(dot(rgba.rgb, vec3(0.333))); c = max(vec3(0.0), mix(g, rgba.rgb, 2.4))*uGain*uDim; }`;
const FS = `#version 300 es
precision highp float; in vec3 c; uniform float uRing; out vec4 o;
void main(){ float r = length(gl_PointCoord - 0.5)*2.0; if (r > 1.0) discard;
  float a = uRing > 0.5 ? smoothstep(0.62, 0.74, r)*(1.0 - smoothstep(0.9, 1.0, r)) : 1.0 - r*r; o = vec4(c*a, a); }`;
function shader(t, s){ const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(x); return x; }
const prog = gl.createProgram(); gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
gl.bindAttribLocation(prog, 0, 'xy'); gl.bindAttribLocation(prog, 1, 'rgba'); gl.linkProgram(prog); gl.useProgram(prog);
const U = {}; for (const n of ['uCam', 'uAsp', 'uSize', 'uGain', 'uDim', 'uRing']) U[n] = gl.getUniformLocation(prog, n);
const allBuf = gl.createBuffer(), hitBuf = gl.createBuffer(), selBuf = gl.createBuffer();

const smooth = x => { x = Math.min(1, Math.max(0, x)); return x*x*(3 - 2*x); };
const iw = () => innerWidth, ih = () => innerHeight;
let sugg = {};
function chips(){                                // a few ready-made searches to tap, reshuffled each visit
  const w = Object.keys(sugg).sort(() => Math.random() - 0.5).slice(0, 14);
  $('chips').innerHTML = w.map(x => `<button>${x}</button>`).join('');
  $('chips').querySelectorAll('button').forEach(b => b.onclick = () => { $('q').value = b.textContent; search(); });
}
let N = 0, XY = null, raw = null, ids = null, grid = null, mid = [0, 0], ext = 1;
let cam = {x: 0, y: 0, w: 2}, anim = null, hits = [], hitSet = new Set(), sel = null, drag = null, hover = null;
const toMap = (sx, sy) => ({x: cam.x + (sx/iw() - 0.5)*cam.w, y: cam.y + (sy/ih() - 0.5)*cam.w*ih()/iw()});
const toScreen = (x, y) => ({x: (0.5 + (x - cam.x)/cam.w)*iw(), y: (0.5 + (y - cam.y)/(cam.w*ih()/iw()))*ih()});
const wideW = () => 2.2*ext*Math.max(1, iw()/ih());

function flyTo(to, dur){ anim = {from: {...cam}, to, t: 0, dur}; }
function stepAnim(dt){
  if (!anim) return;
  anim.t = Math.min(1, anim.t + dt/anim.dur);
  const e = smooth(anim.t), a = anim.from, b = anim.to;
  const w = Math.exp(Math.log(a.w) + (Math.log(b.w) - Math.log(a.w))*e);
  const k = Math.abs(Math.log(b.w/a.w)) > 0.15 ? (w - a.w)/(b.w - a.w) : e;
  cam = {x: a.x + (b.x - a.x)*k, y: a.y + (b.y - a.y)*k, w};
  if (anim.t >= 1) anim = null;
}

function points(buf, list, color){                 // a small vertex buffer for a list of map indexes
  const a = new Uint8Array(list.length*12), dv = new DataView(a.buffer);
  list.forEach((i, k) => { dv.setFloat32(k*12, XY[i*2], true); dv.setFloat32(k*12 + 4, XY[i*2 + 1], true); a.set(color, k*12 + 8); });
  gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, a, gl.DYNAMIC_DRAW);
}
function bind(buf){ gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0); gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 12, 8); }

let last = performance.now();
function frame(now){
  const dt = Math.min(0.2, (now - last)/1000); last = now; stepAnim(dt);
  const W = Math.round(iw()*Math.min(2, devicePixelRatio)), H = Math.round(ih()*Math.min(2, devicePixelRatio));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  gl.viewport(0, 0, W, H); gl.clearColor(0.102, 0.086, 0.071, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  gl.uniform3f(U.uCam, cam.x, cam.y, cam.w); gl.uniform1f(U.uAsp, H/W); gl.uniform1f(U.uRing, 0);
  const px = W/iw(), zoom = wideW()/cam.w;
  bind(allBuf);
  gl.uniform1f(U.uSize, px*Math.min(12, 1.6*Math.pow(zoom, 0.55)));
  gl.uniform1f(U.uGain, Math.min(0.85, 0.13*Math.pow(zoom, 0.6))); gl.uniform1f(U.uDim, hits.length ? 0.35 : 1);
  gl.drawArrays(gl.POINTS, 0, N);
  if (hits.length) {                              // search results: gold, pulsing gently
    bind(hitBuf); gl.uniform1f(U.uDim, 1); gl.uniform1f(U.uGain, 0.75 + 0.2*Math.sin(now/600));
    gl.uniform1f(U.uSize, px*Math.min(16, 4*Math.pow(zoom, 0.4))); gl.drawArrays(gl.POINTS, 0, hits.length);
  }
  if (sel != null) { bind(selBuf); gl.uniform1f(U.uDim, 1); gl.uniform1f(U.uGain, 1); gl.uniform1f(U.uRing, 1);
    gl.uniform1f(U.uSize, px*(28 + 6*Math.sin(now/450))); gl.drawArrays(gl.POINTS, 0, 1); }
  gl.disableVertexAttribArray(1);
  thumbs();
  requestAnimationFrame(frame);
}

// Zoomed in far enough, the points become the pictures themselves.
const pool = new Map();
function visible(limit){
  const a = toMap(0, 0), b = toMap(iw(), ih()), {G, x0, y0, cs, cells} = grid, out = [];
  const gx0 = Math.max(0, Math.floor((a.x - x0)/cs)), gx1 = Math.min(G, Math.floor((b.x - x0)/cs));
  const gy0 = Math.max(0, Math.floor((a.y - y0)/cs)), gy1 = Math.min(G, Math.floor((b.y - y0)/cs));
  if ((gx1 - gx0 + 1)*(gy1 - gy0 + 1) > 2500) return null;
  for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) for (const i of cells.get(gx + gy*(G + 1)) || []) {
    const x = XY[i*2], y = XY[i*2 + 1];
    if (x >= a.x && x <= b.x && y >= a.y && y <= b.y) { out.push(i); if (out.length > limit) return null; } }
  return out;
}
function thumbs(){
  const box = $('thumbs');
  const vis = grid ? visible(260) : null;
  const want = new Set(vis || []);
  for (const [i, im] of pool) if (!want.has(i)) { im.remove(); pool.delete(i); }
  if (!vis) return;
  const size = Math.max(36, Math.min(220, 1500/Math.sqrt(vis.length + 1)));
  for (const i of vis) {
    let im = pool.get(i);
    if (!im) { im = new Image(); im.onload = () => im.classList.add('on'); thumbSrc(i).then(u => { if (u) im.src = u; }); box.appendChild(im); pool.set(i, im); }
    const s = toScreen(XY[i*2], XY[i*2 + 1]);
    im.style.left = s.x + 'px'; im.style.top = s.y + 'px'; im.style.width = im.style.height = size + 'px';
    im.classList.toggle('hit', hitSet.has(i));
    im.style.zIndex = hitSet.has(i) ? 2 : 1;
  }
}

// ---- input ----
canvas.addEventListener('wheel', ev => {
  ev.preventDefault(); anim = null;
  const m = toMap(ev.clientX, ev.clientY), k = Math.exp(Math.max(-0.5, Math.min(0.5, ev.deltaY*(ev.ctrlKey ? 0.01 : 0.0018))));
  const w = Math.min(wideW()*1.5, Math.max(0.0008, cam.w*k));
  cam = {x: m.x - (ev.clientX/iw() - 0.5)*w, y: m.y - (ev.clientY/ih() - 0.5)*w*ih()/iw(), w};
  $('hint').style.opacity = 0;
}, {passive: false});
canvas.addEventListener('pointerdown', ev => { drag = {x: ev.clientX, y: ev.clientY, cam: {...cam}, moved: false}; canvas.setPointerCapture(ev.pointerId); });
canvas.addEventListener('pointermove', ev => {
  hover = {x: ev.clientX, y: ev.clientY};
  if (drag && (drag.moved || Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 5)) {
    drag.moved = true; anim = null; canvas.classList.add('drag');
    cam = {...cam, x: drag.cam.x - (ev.clientX - drag.x)/iw()*cam.w, y: drag.cam.y - (ev.clientY - drag.y)/iw()*cam.w};
  }
  tip(ev);
});
canvas.addEventListener('pointerup', ev => { const d = drag; drag = null; canvas.classList.remove('drag');
  if (d && !d.moved) { const i = nearest(ev.clientX, ev.clientY); if (i != null) open(i); else closePanel(); } });
canvas.addEventListener('pointerleave', () => { $('tip').style.opacity = 0; });

function nearest(sx, sy){
  if (!grid) return null;
  const vis = visible(260);
  if (vis) {                                      // pictures are showing: hit-test their squares
    const size = Math.max(36, Math.min(220, 1500/Math.sqrt(vis.length + 1)));
    let best = null, bd = Infinity;
    for (const i of vis) { const s = toScreen(XY[i*2], XY[i*2 + 1]);
      if (Math.abs(s.x - sx) < size/2 && Math.abs(s.y - sy) < size/2) { const d = Math.hypot(s.x - sx, s.y - sy); if (d < bd) { bd = d; best = i; } } }
    return best;
  }
  const m = toMap(sx, sy), r = 10/iw()*cam.w, {G, x0, y0, cs, cells} = grid;
  let best = null, bd = r*r;
  const gx0 = Math.floor((m.x - r - x0)/cs), gx1 = Math.floor((m.x + r - x0)/cs), gy0 = Math.floor((m.y - r - y0)/cs), gy1 = Math.floor((m.y + r - y0)/cs);
  if ((gx1 - gx0 + 1)*(gy1 - gy0 + 1) > 400) return null;
  for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) for (const i of cells.get(gx + gy*(G + 1)) || []) {
    const dx = XY[i*2] - m.x, dy = XY[i*2 + 1] - m.y, d = dx*dx + dy*dy; if (d < bd) { bd = d; best = i; } }
  return best;
}
const infoCache = new Map();
const shards = new Map(), SHARD = 3000;
const info = async i => {
  if (!STATIC) { if (!infoCache.has(i)) infoCache.set(i, fetch(`/api/at?mi=${i}`).then(r => r.json())); return infoCache.get(i); }
  const k = Math.floor(i/SHARD);
  if (!shards.has(k)) shards.set(k, fetch(`${DATA}labels/${k}.json`).then(r => r.json()));
  const row = (await shards.get(k))[i - k*SHARD] || ['', null, '', '', ''];
  return {label: row[0] + (row[1] ? ` · ${row[1]}` : ''), link: row[2] ? 'https://sourcelibrary.org' + row[2] : '', thumb: row[3], big: row[4] || row[3], desc: ''};
};
const thumbSrc = async i => STATIC ? (await info(i)).thumb : `/thumb/${ids[i]}.jpg`;
let tipFor = null;
async function tip(ev){
  const t = $('tip');
  if (drag && drag.moved) { t.style.opacity = 0; return; }
  const i = nearest(ev.clientX, ev.clientY);
  if (i == null) { t.style.opacity = 0; tipFor = null; return; }
  Object.assign(t.style, {left: Math.min(iw() - 210, ev.clientX + 18) + 'px', top: Math.min(ih() - 260, ev.clientY + 18) + 'px'});
  if (tipFor === i) return; tipFor = i;
  const nf = await info(i); if (tipFor !== i) return;
  t.querySelector('img').src = await thumbSrc(i); t.querySelector('div').textContent = nf.label; t.style.opacity = 1;
}

async function open(i){
  sel = i; points(selBuf, [i], [201, 168, 108, 255]);
  const nf = await info(i);
  $('pimg').src = STATIC ? nf.big : await thumbSrc(i); $('ptitle').textContent = nf.label;
  $('pdesc').textContent = nf.desc || ''; $('plink').href = nf.link || '#'; $('pdive').href = `/?start=${nf.id}`; $('pdive').style.display = STATIC ? 'none' : '';
  $('pnear').onclick = ev => { ev.preventDefault(); similar(i); };
  $('panel').classList.add('open'); $('tip').style.opacity = 0;
  const s = toScreen(XY[i*2], XY[i*2 + 1]);
  if (s.x > iw() - 420) flyTo({x: XY[i*2] + 0.18*cam.w, y: cam.y, w: cam.w}, 0.6);
}
function closePanel(){ sel = null; $('panel').classList.remove('open'); }
$('close').onclick = closePanel;

// ---- search: words in, the closest pictures light up ----
function showHits(list, label){
  hits = list; hitSet = new Set(list); points(hitBuf, list, [255, 214, 140, 255]);
  $('count').textContent = list.length ? label : '';
  if (!list.length) return;
  const top = list.slice(0, 80), xs = top.map(i => XY[i*2]).sort((a, b) => a - b), ys = top.map(i => XY[i*2 + 1]).sort((a, b) => a - b);
  const cx = xs[xs.length >> 1], cy = ys[ys.length >> 1];
  const spread = Math.max(0.02, (xs[Math.floor(xs.length*0.8)] - xs[Math.floor(xs.length*0.2)])*2.5);
  flyTo({x: cx, y: cy, w: Math.min(wideW(), spread)}, 2.2);
}
let qTimer = null;
$('q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(search, 450); });
$('q').addEventListener('keydown', ev => { if (ev.key === 'Enter') { clearTimeout(qTimer); search(); } if (ev.key === 'Escape') { $('q').value = ''; search(); } });
async function search(){
  const q = $('q').value.trim();
  if (!q) { showHits([], ''); flyTo({x: mid[0], y: mid[1], w: wideW()}, 1.8); return; }
  if (STATIC) {                                    // online: the closest ready-made search
    const ql = q.toLowerCase(), words = Object.keys(sugg);
    const w = words.find(x => x === ql) || words.find(x => x.startsWith(ql)) || words.find(x => x.includes(ql)) || words.find(x => ql.includes(x));
    if (!w) { showHits([], ''); $('count').textContent = 'not in the ready-made searches yet: try one below'; return; }
    if (w !== ql) $('q').value = w;
    return showHits(sugg[w], `the 300 pictures that look most like “${w}”`);
  }
  const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&k=300`); if (!r.ok) { $('count').textContent = 'still waking up…'; return; }
  const j = await r.json(); showHits(j.mi, `the 300 pictures that look most like “${q}”`);
}
async function similar(i){
  // neighbours on the map are already alike; light up the nearest 150 by distance
  const x = XY[i*2], y = XY[i*2 + 1], d = [];
  for (let k = 0; k < N; k++) { const dx = XY[k*2] - x, dy = XY[k*2 + 1] - y; d.push([dx*dx + dy*dy, k]); }
  d.sort((a, b) => a[0] - b[0]); $('q').value = '';
  showHits(d.slice(0, 150).map(e => e[1]), 'the 150 pictures nearest this one');
}

// ---- start ----
(async () => {
  const [buf, idl] = await Promise.all([fetch(STATIC ? DATA + 'map.bin' : '/map.bin').then(r => r.arrayBuffer()),
    STATIC ? fetch(DATA + 'suggestions.json').then(r => r.json()) : fetch('/ids.json').then(r => r.json())]);
  if (STATIC) { sugg = idl; chips(); }
  raw = buf; ids = idl; N = buf.byteLength/12; const dv = new DataView(buf); XY = new Float32Array(N*2);
  for (let i = 0; i < N; i++) { XY[i*2] = dv.getFloat32(i*12, true); XY[i*2 + 1] = dv.getFloat32(i*12 + 4, true); }
  const xs = [], ys = []; for (let i = 0; i < N; i += 37) { xs.push(XY[i*2]); ys.push(XY[i*2 + 1]); }
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b); mid = [xs[xs.length >> 1], ys[ys.length >> 1]];
  const ds = []; for (let i = 0; i < N; i += 37) ds.push(Math.hypot(XY[i*2] - mid[0], XY[i*2 + 1] - mid[1]));
  ds.sort((a, b) => a - b); ext = ds[Math.floor(ds.length*0.98)];
  gl.bindBuffer(gl.ARRAY_BUFFER, allBuf); gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
  const G = 220, cells = new Map(); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < N; i++) { x0 = Math.min(x0, XY[i*2]); y0 = Math.min(y0, XY[i*2 + 1]); x1 = Math.max(x1, XY[i*2]); y1 = Math.max(y1, XY[i*2 + 1]); }
  const cs = Math.max(x1 - x0, y1 - y0)/G;
  for (let i = 0; i < N; i++) { const k = Math.floor((XY[i*2] - x0)/cs) + Math.floor((XY[i*2 + 1] - y0)/cs)*(G + 1);
    let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(i); }
  grid = {G, x0, y0, cs, cells};
  $('sub').textContent = `All ${N.toLocaleString('en')} pictures in Source Library, each one a point, placed near the pictures it resembles.`;
  cam = {x: mid[0], y: mid[1], w: wideW()*1.6}; flyTo({x: mid[0], y: mid[1], w: wideW()}, 3);
  $('msg').style.display = 'none';
  const q = new URLSearchParams(location.search).get('q'); if (q) { $('q').value = q; setTimeout(search, 1200); }
  requestAnimationFrame(frame);
})();

})();
