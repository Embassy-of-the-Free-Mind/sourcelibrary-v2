#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/cursive-census-classify.mjs (the classifier and its 10-page control from
 * #4745) — it scores the instrument on pages already read for #4745; this draws FRESH census pages
 * for the 60-page by-eye validation #4925/#5100 require before the classifier routes a GPU lane.
 *
 * #5100 lane step 1 — validate the cursive/non-cursive router by eye on 60 census pages.
 *
 *   node scripts/eval/cursive-census-eyecheck.mjs --draw   → eyecheck/draw.json + eyecheck/img/vNN.jpg (blind: no labels)
 *   node scripts/eval/cursive-census-eyecheck.mjs --score  → joins eyecheck/eye.json with the classifier, prints the table
 *
 * Draw: seed 59250, one page per BOOK (a book is one hand), 30 books the classifier called cursive
 * (woodblock-/manuscript-cursive) and 30 it called text-but-not-cursive (woodblock-regular,
 * manuscript-regular, typeset). Illustration/other pages are left out: the router's only question
 * is whether a TEXT page is kuzushiji. Images are shuffled and renamed v01..v60 so the reader
 * labels them without seeing the classifier's answer; eye.json is written by the reader
 * ({"v01": "cursive" | "regular" | "unsure", ...}) before --score is run.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const DIR = 'scripts/eval/results/cursive-census';
const OUT = path.join(DIR, 'eyecheck');
const CURSIVE = new Set(['woodblock-cursive', 'manuscript-cursive']);
const REGULAR = new Set(['woodblock-regular', 'manuscript-regular', 'typeset']);
const SEED = 59250;

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(a, r) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const manifest = new Map(fs.readFileSync(path.join(DIR, 'manifest.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.slug, r]));
const pages = fs.readdirSync(path.join(DIR, 'pages')).map(f => JSON.parse(fs.readFileSync(path.join(DIR, 'pages', f), 'utf8'))).filter(p => !p.control && manifest.has(p.slug));

async function draw() {
  const r = rng(SEED);
  const pick = set => { const seen = new Set(); const out = []; for (const p of shuffle(pages.filter(p => set.has(p.script_class)).sort((a, b) => a.slug.localeCompare(b.slug)), r)) { if (seen.has(p.book_id)) continue; seen.add(p.book_id); out.push(p); if (out.length === 30) break; } return out; };
  const cur = pick(CURSIVE), reg = pick(REGULAR).filter(p => !cur.some(c => c.book_id === p.book_id));
  const all = shuffle([...cur, ...reg], r);
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  const rows = [];
  for (const [i, p] of all.entries()) {
    const id = `v${String(i + 1).padStart(2, '0')}`, m = manifest.get(p.slug);
    const resp = await fetch(m.image_url, { signal: AbortSignal.timeout(60000) });
    if (!resp.ok) { console.log(`${id} fetch ${resp.status}`); continue; }
    const buf = Buffer.from(await resp.arrayBuffer());
    await sharp(buf).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(path.join(OUT, 'img', `${id}.jpg`));
    rows.push({ id, slug: p.slug, book_id: p.book_id, page_number: p.page_number, image_url: m.image_url, title: m.title, year: m.year, classifier: p.script_class });
  }
  fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify({ seed: SEED, drawn_at: new Date().toISOString(), rows }, null, 1));
  console.log(`drew ${rows.length} (${cur.length} cursive-labelled, ${reg.length} regular-labelled)`);
}

function score() {
  const { rows } = JSON.parse(fs.readFileSync(path.join(OUT, 'draw.json'), 'utf8'));
  const eye = JSON.parse(fs.readFileSync(path.join(OUT, 'eye.json'), 'utf8'));
  const t = { cc: 0, cr: 0, rc: 0, rr: 0, unsure: 0 }; const miss = [];
  for (const row of rows) {
    const e = eye[row.id]?.label; if (!e) { miss.push(row.id); continue; }
    if (e === 'unsure') { t.unsure++; continue; }
    const k = (CURSIVE.has(row.classifier) ? 'c' : 'r') + (e === 'cursive' ? 'c' : 'r'); t[k]++;
    if (k[0] !== k[1]) console.log(`DISAGREE ${row.id} ${row.slug} classifier=${row.classifier} eye=${e} — ${eye[row.id].note || ''} (${row.title})`);
  }
  const n = t.cc + t.cr + t.rc + t.rr;
  const out = { n, unsure: t.unsure, missing: miss, confusion: { 'classifier cursive / eye cursive': t.cc, 'classifier cursive / eye regular': t.cr, 'classifier regular / eye cursive': t.rc, 'classifier regular / eye regular': t.rr }, agreement: (t.cc + t.rr) / n, precision_cursive: t.cc / (t.cc + t.cr), recall_cursive: t.cc / (t.cc + t.rc) };
  fs.writeFileSync(path.join(OUT, 'score.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

if (process.argv.includes('--draw')) await draw(); else if (process.argv.includes('--score')) score(); else console.log('--draw | --score');
