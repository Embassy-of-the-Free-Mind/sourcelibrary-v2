#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs packet (the blind packet and key format paired-arm.mjs reads: items
// with opaque ids, key rows kind item | wrong_page | repeat | planted) and scripts/eval/pro-translate-6545/plant.mjs (the
// planted meaning errors, used as is). judge.mjs packet is wired to its named cells; this writes the same files for #93.
/**
 * #93 packet: one item per (arm, page) for LIVE, OPUS2, OPUSX, FABLE; 2 wrong-page controls and 5 repeats per arm;
 * 4 planted meaning errors per arm (negation, number, name, clause). One cell, `frontier`. A page where a fresh arm gave
 * no text gets no item (score.mjs counts it as that arm's outcome). Images are fetched once to DIR/img/<uid>.jpg.
 *
 *   node scripts/eval/fable-frontier-93/packet.mjs --out=DIR
 * Writes DIR/packet.json, DIR/key.json, DIR/plants.json, DIR/recipe.json (if absent). No model call, no database.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = arg('out'); if (!OUT) { console.error('--out=DIR'); process.exit(2); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const h = (s) => crypto.createHash('sha256').update(`f93:${s}`).digest('hex');
const jsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
export const ARMS = ['LIVE', 'OPUS2', 'OPUSX', 'FABLE'];

const S = JSON.parse(fs.readFileSync(path.join(OUT, 'sample.json'), 'utf8'));
const P = new Map(jsonl(path.join(OUT, 'pages.jsonl')).map((r) => [r.uid, r]));
const text = { LIVE: new Map([...P].map(([u, r]) => [u, r.live])) };
for (const a of ARMS.slice(1)) {
  const m = new Map();
  for (const r of jsonl(path.join(OUT, 'arms', `${a}.jsonl`))) if (r.text?.trim()) m.set(r.uid, r.text.trim());
  text[a] = m;
}

// images, once
fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
for (const sp of S.pages) {
  const f = path.join(OUT, 'img', `${sp.uid}.jpg`);
  if (fs.existsSync(f) && fs.statSync(f).size > 1000) continue;
  const res = await fetch(sp.image_url);
  if (!res.ok) { console.log(`  image ${sp.uid}: HTTP ${res.status}`); continue; }
  fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
}
// a judge's Read tool takes images up to about 5 MB: shrink anything larger (long side 2400 px)
for (const sp of S.pages) {
  const f = path.join(OUT, 'img', `${sp.uid}.jpg`);
  if (fs.existsSync(f) && fs.statSync(f).size > 3.5e6) spawnSync('python3', ['-c', `from PIL import Image; im=Image.open('${f}').convert('RGB'); im.thumbnail((2400,2400)); im.save('${f}', quality=88)`]);
}

const items = [], key = [], seen = new Set();
const add = (arm, sp, kind, t, extra = {}) => {
  const id = `j${h(`${kind}:${arm}:${sp.uid}:${extra.other ?? ''}:${kind === 'item' ? '' : t.length}`).slice(0, 10)}`;
  if (!seen.has(id)) { seen.add(id); items.push({ id, task: 'translation', lang: sp.lang, image_file: path.join(OUT, 'img', `${sp.uid}.jpg`), text: t, source: P.get(sp.uid).ocr }); }
  key.push({ id: `k${h(`k:${id}:${arm}:${kind}`).slice(0, 10)}`, judged_as: id, cell: 'frontier', route: arm, kind, page_id: sp.page_id, book_id: sp.book_id, uid: sp.uid, lang: sp.lang, ...extra });
};
const hasImg = (sp) => fs.existsSync(path.join(OUT, 'img', `${sp.uid}.jpg`));
const order = (salt) => [...S.pages].filter(hasImg).sort((a, b) => h(`${salt}:${a.uid}`).localeCompare(h(`${salt}:${b.uid}`)));
for (const a of ARMS) for (const sp of S.pages) if (hasImg(sp) && text[a].has(sp.uid)) add(a, sp, 'item', text[a].get(sp.uid));
for (const a of ARMS) {
  const o = order(`wp:${a}`).filter((sp) => text[a].has(sp.uid));
  for (let i = 0; i < 2; i++) { const sp = o[i], other = o.find((x) => x.book_id !== sp.book_id && x.lang !== sp.lang && !o.slice(0, 2).includes(x)); add(a, sp, 'wrong_page', text[a].get(other.uid), { other: other.page_id }); }
  for (const sp of order(`rep:${a}`).filter((x) => text[a].has(x.uid)).slice(0, 5)) add(a, sp, 'repeat', text[a].get(sp.uid), { other: 'repeat' });
}
// planted: 4 per arm, kinds rotate; pages drawn apart from the repeats and controls
const KINDS = ['negation', 'number', 'name', 'clause'];
const reqs = [];
for (const a of ARMS) order(`pl:${a}`).filter((sp) => text[a].has(sp.uid)).slice(0, 4).forEach((sp, i) => reqs.push({ key: `${a}|${sp.uid}`, text: text[a].get(sp.uid), kinds: [KINDS[i], ...KINDS.filter((k) => k !== KINDS[i])].slice(0, 1), seed: 93 + i }));
const r = spawnSync('node', [path.join(HERE, '../pro-translate-6545/plant.mjs')], { input: JSON.stringify(reqs), encoding: 'utf8', maxBuffer: 1e8 });
if (r.status) { console.error(r.stderr); process.exit(1); }
const planted = JSON.parse(r.stdout);
for (const pl of planted) {
  if (!pl.plants?.length || pl.text === reqs.find((q) => q.key === pl.key).text) { console.log(`  no plant site: ${pl.key}`); continue; }
  const [a, uid] = pl.key.split('|'); const sp = S.pages.find((x) => x.uid === uid);
  add(a, sp, 'planted', pl.text, { other: `planted:${pl.plants[0].kind}`, plant: pl.plants[0] });
}
const ord = [...items].sort((x, y) => h(`o:${x.id}`).localeCompare(h(`o:${y.id}`)));
fs.writeFileSync(path.join(OUT, 'packet.json'), JSON.stringify({ items: ord }, null, 1));
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 1));
fs.writeFileSync(path.join(OUT, 'plants.json'), JSON.stringify(planted.map((p) => ({ key: p.key, plants: p.plants })), null, 1));
const t = {}; for (const k of key) t[`${k.route}/${k.kind}`] = (t[`${k.route}/${k.kind}`] ?? 0) + 1;
console.log(`${items.length} judge items, ${key.length} key rows`, t);
