// #6184 follow-on: Clef (image) and Jev (text) as non-Gemini readers of one disputed token, both candidate orders.
// PRIOR ART: scripts/eval/jev/clef-image-screens.mjs (Clef client; uses macOS sips, so images go through sharp here)
//   and scripts/eval/jev/jevlib.py (Jev gateway body/cost field), re-implemented inline in Node so the
//   two arms share one ledger and one cap. Items are the sealed slots in results/reader-diversity-6184/.
// Run (Hetzner, from /root/rd-6184 which holds texts.json + crops/):
//   node --env-file=/root/sourcelibrary/.env.production.local <this> [--limit=N] [--arms=clef-crop,...]
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.OUT || 'clef-jev';
const CAP = 1.0, STOP = 0.9;
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const LIMIT = Number(args.limit || 1e9);
const ARMS = (args.arms || 'clef-crop,clef-flash-crop,clef-page,clef-tight,jev').split(',');
const CF_ACCOUNT = 'eb0562555fd5ce2a4ec0f29b6df10e7b';
const PRICE = { clef: 0.24, 'clef-flash': 0.09 };
const GW = fs.readFileSync(process.env.GW_FILE || '/root/jev-env.gw', 'utf8').match(/VERCEL_OIDC_TOKEN="?([^"\n]+)/)[1];
fs.mkdirSync(OUT, { recursive: true });
const CALLS = path.join(OUT, 'calls.jsonl');
const done = new Set(fs.existsSync(CALLS) ? fs.readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return j.key; }) : []);
let spent = fs.existsSync(CALLS) ? fs.readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).reduce((a, l) => a + (JSON.parse(l).usd || 0), 0) : 0;

const slots = JSON.parse(fs.readFileSync('slots-final.json', 'utf8'));
const T = JSON.parse(fs.readFileSync('texts.json', 'utf8'));

// ---- candidates (prereg addendum) ----
function foil(print) {
  const i = print.indexOf('ा');
  return i >= 0 ? print.slice(0, i) + print.slice(i + 1) : print.slice(0, 1) + 'ा' + print.slice(1);
}
function candidates(s) {
  if (s.kind === 'disputed') return { right: s.flash.includes(s.core || s.print) || s.flash === s.print ? s.flash : s.lite, wrong: s.flash.includes(s.core || s.print) || s.flash === s.print ? s.lite : s.flash };
  if (s.flash !== s.print) return { right: s.print, wrong: s.flash };  // c51, c56: both stored reads wrong
  return { right: s.print, wrong: foil(s.print) };
}

// ---- images ----
const pageCache = new Map();
async function pageBuf(s) {
  const url = `https://images.sourcelibrary.org/archived/${s.book_id}/${s.page}.jpg`;
  if (!pageCache.has(url)) pageCache.set(url, Buffer.from(await (await fetch(url)).arrayBuffer()));
  return pageCache.get(url);
}
function lineOf(s) {
  const t = T.find((x) => x.page_id === s.page_id);
  const lines = t.pro.split('\n').filter((l) => l.trim());
  const grams = []; for (let i = 0; i + 4 <= s.flash.length; i += 2) grams.push(s.flash.slice(i, i + 4));
  let best = -1, li = 0; lines.forEach((l, i) => { const h = grams.filter((g) => l.includes(g)).length; if (h > best) { best = h; li = i; } });
  const l = lines[li]; const at = grams.map((g) => l.indexOf(g)).filter((k) => k >= 0);
  const x = at.length ? (Math.min(...at) + Math.max(...at) + 4) / 2 / l.length : 0.5;
  return { li, n: lines.length, x };
}
// exploratory arm (deviation, added after the probe showed Clef downsamples a full-width band): the token's
// x position estimated from its offset in the Pro line, a 40%-wide window over a 3-line band
async function tightBuf(s) {
  const f = `crops/${s.id}-tight.png`;
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const { li, n, x } = lineOf(s);
  const buf = await pageBuf(s); const m = await sharp(buf).metadata();
  const y = m.height * (0.06 + 0.89 * (li + 0.5) / n), h = m.height / n * 1.6;
  const top = Math.max(0, Math.round(y - h)), height = Math.min(m.height - top, Math.round(2 * h));
  const w = Math.round(m.width * 0.4), left = Math.min(m.width - w, Math.max(0, Math.round(m.width * x - w / 2)));
  const out = await sharp(buf).extract({ left, top, width: w, height }).resize(Math.round(w * (m.width < 1200 ? 2.0 : 1.0))).png().toBuffer();
  fs.writeFileSync(f, out); return out;
}
async function cropBuf(s) {
  const f = `crops/${s.id}.png`;
  if (fs.existsSync(f)) return fs.readFileSync(f);
  // same band rule as crop2.mjs (line located in the Pro read by 4-grams of the Flash token)
  const t = T.find((x) => x.page_id === s.page_id);
  const lines = t.pro.split('\n').filter((l) => l.trim());
  const grams = []; for (let i = 0; i + 4 <= s.flash.length; i += 2) grams.push(s.flash.slice(i, i + 4));
  let best = -1, li = 0; lines.forEach((l, i) => { const h = grams.filter((g) => l.includes(g)).length; if (h > best) { best = h; li = i; } });
  const buf = await pageBuf(s); const m = await sharp(buf).metadata();
  const y = m.height * (0.06 + 0.89 * (li + 0.5) / lines.length), h = m.height / lines.length * 2.2;
  const top = Math.max(0, Math.round(y - h)), height = Math.min(m.height - top, Math.round(2 * h));
  const out = await sharp(buf).extract({ left: 0, top, width: m.width, height }).resize(Math.round(m.width * (m.width < 1200 ? 2.0 : 0.85))).png().toBuffer();
  fs.writeFileSync(f, out); return out;
}
const dataUrl = async (buf, maxPx) => 'data:image/jpeg;base64,' + (await sharp(buf).resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()).toString('base64');

// ---- Jev context: ~150 chars either side of the slot in the stored Flash read ----
const clean = (x) => x.replace(/<[^>]*>/g, '').replace(/->|<-|\*\*/g, '').replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ');
function context(s) {
  const t = clean(T.find((x) => x.page_id === s.page_id).flash);
  const k = t.indexOf(s.flash);
  if (k < 0) return null;
  return { pre: t.slice(Math.max(0, k - 150), k), post: t.slice(k + s.flash.length, k + s.flash.length + 150) };
}

// ---- clients ----
async function clef(model, image, state, qs) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/@cf/cloudflare/${model}`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.CF_ANALYTICS_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, images: [image], state, questions: qs }),
    });
    if (r.status === 401 || r.status === 403) throw new Error('clef auth ' + r.status);
    if (!r.ok) { console.error(model, r.status, (await r.text()).slice(0, 200)); await new Promise((z) => setTimeout(z, 3000 * (a + 1))); continue; }
    const j = (await r.json()).result;
    return { ans: j.answers.pick, usd: (j.usage.input_tokens * PRICE[model]) / 1e6, tok: j.usage.input_tokens };
  }
  return null;
}
async function jev(state, qs) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch('https://ai-gateway.vercel.sh/typesafe/v1/systemone', {
      method: 'POST', headers: { Authorization: 'Bearer ' + GW, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'typesafe-ai/jev', state, questions: qs }),
    });
    if (r.status === 401 || r.status === 403) throw new Error('jev auth ' + r.status);
    if (!r.ok) { console.error('jev', r.status, (await r.text()).slice(0, 200)); await new Promise((z) => setTimeout(z, 3000 * (a + 1))); continue; }
    const j = await r.json();
    return { ans: j.answers.pick, usd: Number(j.provider_metadata?.gateway?.marketCost || 0), tok: j.usage?.input_tokens };
  }
  return null;
}

// ---- run ----
const log = (row) => { fs.appendFileSync(CALLS, JSON.stringify(row) + '\n'); spent += row.usd || 0; };
let n = 0;
for (const s of slots.slice(0, LIMIT)) {
  const c = candidates(s);
  for (const order of ['RW', 'WR']) {
    const A = order === 'RW' ? c.right : c.wrong, B = order === 'RW' ? c.wrong : c.right;
    for (const arm of ARMS) {
      const key = `${s.id}|${arm}|${order}`;
      if (done.has(key)) continue;
      if (spent >= STOP) { console.log('stop at', spent.toFixed(4)); process.exit(0); }
      let res;
      if (arm.startsWith('clef')) {
        const model = arm.startsWith('clef-flash') ? 'clef-flash' : 'clef';
        const img = arm.endsWith('page') ? await dataUrl(await pageBuf(s), 1024) : arm.endsWith('tight') ? await dataUrl(await tightBuf(s), 1400) : await dataUrl(await cropBuf(s), 2048);
        const state = `A scanned page of a Sanskrit book printed in Devanagari (Tattvasangraha with Panjika, 1926). ${arm.endsWith('page') ? 'The image is the whole page.' : 'The image is a band of a few printed lines.'} One word on it has two candidate transcriptions that differ by a single mark.\ncandidate A: ${A}\ncandidate B: ${B}`;
        const qs = { pick: { type: 'choice', instructions: 'Which candidate is exactly the word as printed in the image (letter for letter, every vowel mark)?', criteria: { A: `candidate A: ${A}`, B: `candidate B: ${B}` } } };
        res = await clef(model, img, state, qs);
      } else {
        const ctx = context(s);
        if (!ctx) { log({ key, id: s.id, arm, order, skip: 'no-context' }); continue; }
        const state = `A passage of Sanskrit philosophical prose or verse (Santaraksita's Tattvasangraha with Kamalasila's Panjika). One word is disputed between two readings that differ by a single mark.\nReading A: …${ctx.pre}【${A}】${ctx.post}…\nReading B: …${ctx.pre}【${B}】${ctx.post}…`;
        const qs = { pick: { type: 'choice', instructions: 'Which reading of the bracketed word is correct Sanskrit and makes the sentence and the argument coherent?', criteria: { A: `reading A: ${A}`, B: `reading B: ${B}` } } };
        res = await jev(state, qs);
      }
      if (!res) { log({ key, id: s.id, arm, order, error: true }); continue; }
      const pickRight = (res.ans.choice === 'A') === (order === 'RW');
      log({ key, id: s.id, kind: s.kind, arm, order, choice: res.ans.choice, p: res.ans.probabilities, right: pickRight, usd: res.usd, tok: res.tok });
      n++;
    }
  }
  console.log(s.id, 'spent', spent.toFixed(4));
}
console.log('calls', n, 'spent', spent.toFixed(4));
