#!/usr/bin/env node
// PRIOR ART: scripts/eval/hidden-flash-5795/adjudication-packet.mjs (blinded A/B packets: image + two OCR outputs) —
// it reads its pairs from a batch-eval store, not from a cli-ocr.mjs read directory, and plants no controls;
// scripts/eval/paddle-stale-english-6388/prepare.mjs (opaque seeded request ids, images under $JOB_SCRATCH) — its plant
// is in the English, made by hand. This draws the #6769 pilot's blind check from a `cli-ocr.mjs read` directory.
/**
 * #6769 step 2: a blind A/B of the SERVED transcription vs the Gemini 4 Argon low (G4L) re-read, against the image.
 *
 *   node --env-file=.env.production.local scripts/eval/g4-reread-pilot-6769/draw.mjs \
 *        --book=<id> --tag=greek --reads=$JOB_SCRATCH/read-greek --out=$JOB_SCRATCH/judge-greek [--n=30] [--controls=5] [--seed=6769]
 *
 * Frame: every page of the book with a usable G4L read (cli exit 0, text inside the markers) AND served text
 * (`ocr.data`), both non-trivial after markup is removed. 30 pages are drawn at random (seeded); 5 more pages, outside
 * the draw, are CONTROLS: the G4L text against a planted-error copy of itself (8% of words swapped for other words of
 * the page, one line dropped). A judge that cannot pick the clean copy cannot be trusted on the sample.
 * Both texts lose their markup first (prompt-format tags, markdown), so the judge cannot tell the two prompt
 * generations apart by their format. A/B order is randomised per request; ids are opaque. The image is the page's own
 * (`getPageSource`, split-aware: #6731 Amendment 2), saved whole and as two enlarged halves (left/right on a landscape
 * spread, top/bottom on a portrait page), long side <= 2000 px.
 * Writes OUT/requests.jsonl (what the judge sees) and OUT/key.json (what it must not).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const BOOK = arg('book'), TAG = arg('tag'), READS = arg('reads'), OUT = arg('out');
const N = Number(arg('n', 30)), NC = Number(arg('controls', 5)), SEED = Number(arg('seed', 6769));
if (!BOOK || !TAG || !READS || !OUT) { console.error('usage: draw.mjs --book= --tag= --reads= --out= (see header)'); process.exit(2); }
fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
const rng = makeRng(SEED + [...TAG].reduce((s, c) => s + c.charCodeAt(0), 0));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Markup out, text in: tags whose CONTENT is page text (margin, header, footnote, unclear…) keep it; tags whose content
// is the reader's description of the page (format envelope, image descriptions, vocab, warnings) are dropped whole.
const META = 'scan-quality|language|lang|script|page-type|warning|meta|vocab|image-desc|summary|keywords|notes?|columns|detected-images?';
export function clean(t) {
  return String(t || '')
    .replace(new RegExp(`<(${META})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), '')
    .replace(new RegExp(`<(${META})\\b[^>]*/>`, 'gi'), '')
    .replace(/<\/?[a-z][\w-]*[^>]*>/gi, '')
    .replace(/^#+\s*/gm, '').replace(/\*\*|__/g, '').replace(/(^|\s)\*(\S)/g, '$1$2').replace(/(\S)\*(?=\s|$)/g, '$1')
    .replace(/->|<-/g, '').replace(/^\s*(---+|\*\*\*+)\s*$/gm, '')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
const letters = (t) => (t.match(/\p{L}/gu) || []).length;

// The plant: ~8% of words (at least 5) replaced by another word of the same page, and one middle line dropped.
function plant(text) {
  const lines = text.split('\n');
  const content = lines.map((l, i) => (l.trim().split(/\s+/).length >= 3 ? i : -1)).filter((i) => i >= 0);
  let dropped = null;
  if (content.length >= 5) { dropped = content[Math.floor(content.length / 2)]; lines.splice(dropped, 1); }
  const words = lines.join('\n').split(/(\s+)/);
  const idx = words.map((w, i) => (/\p{L}{2,}/u.test(w) ? i : -1)).filter((i) => i >= 0);
  const k = Math.min(idx.length, Math.max(5, Math.round(idx.length * 0.08)));
  const pick = shuffle([...idx]).slice(0, k);
  let swapped = 0;
  for (const i of pick) {
    const other = words[idx[Math.floor(rng() * idx.length)]];
    if (other !== words[i]) { words[i] = other; swapped++; }
  }
  return { text: words.join(''), swapped, dropped_line: dropped };
}

async function images(src, uid) {
  const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
  const img = sharp(buf, { limitInputPixels: false });
  const { width: w, height: h } = await img.metadata();
  const fit = (s) => s.resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 });
  const dir = path.join(OUT, 'img', uid); fs.mkdirSync(dir, { recursive: true });
  await fit(sharp(buf, { limitInputPixels: false })).toFile(path.join(dir, 'page.jpg'));
  const ov = 0.03, land = w > h;
  const parts = land
    ? [{ left: 0, top: 0, width: Math.round(w * (0.5 + ov)), height: h }, { left: Math.round(w * (0.5 - ov)), top: 0, width: w - Math.round(w * (0.5 - ov)), height: h }]
    : [{ left: 0, top: 0, width: w, height: Math.round(h * (0.5 + ov)) }, { left: 0, top: Math.round(h * (0.5 - ov)), width: w, height: h - Math.round(h * (0.5 - ov)) }];
  for (const [i, r] of parts.entries()) await fit(sharp(buf, { limitInputPixels: false }).extract(r)).toFile(path.join(dir, `part${i + 1}.jpg`));
  return { dir, files: ['page.jpg', 'part1.jpg', 'part2.jpg'], layout: land ? 'left/right halves' : 'top/bottom halves', w, h, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

const PROMPT = (layout, a, b) => `You are checking two transcriptions of the same manuscript or printed page against the page image.

Open every image file in this folder with the Read tool: page.jpg is the whole page; part1.jpg and part2.jpg are enlarged ${layout} of the same image (they overlap slightly in the middle).

Transcription A and Transcription B were made by two different readers. All formatting and markup has been removed from both, so judge only the TEXT: which letters and words are there, which lines, and in what order. Do not reward or penalise line breaks, spacing, punctuation style, or a reasonable expansion of an abbreviation. Do penalise misread letters and words, missing or dropped lines, words or lines that are not on the page, and text given in the wrong reading order (columns, page halves).

Before deciding, look up at least three places where A and B differ and read those places in the image. Then decide which transcription matches the image more faithfully overall. If the differences are negligible or balance out, answer "same".

Also report the layout: how many parallel text columns the main text block has on this image (count each page of a two-page spread separately; give the largest), and for each transcription whether it gives the columns and page halves in the correct reading order ("correct"), reversed ("reversed"), mixed line by line ("interleaved"), or "n/a" for a single column.

Reply with ONLY a JSON object between the markers:
<<<BEGIN>>>
{"verdict": "A" | "B" | "same", "confidence": "low" | "medium" | "high", "columns": <integer>, "order_A": "correct" | "reversed" | "interleaved" | "n/a", "order_B": "correct" | "reversed" | "interleaved" | "n/a", "checked": ["<up to 5 short notes: image reads X; A has Y; B has Z>"]}
<<<END>>>

=== Transcription A ===
${a}

=== Transcription B ===
${b}
`;

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const metas = fs.readdirSync(READS).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(READS, f), 'utf8')));
const pages = new Map((await db.collection('pages').find({ id: { $in: metas.map((m) => m.page_id) } }, { projection: { id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1 } }).toArray()).map((p) => [p.id, p]));
const frame = [];
for (const m of metas.sort((x, y) => x.page_number - y.page_number)) {
  const p = pages.get(m.page_id);
  if (!p || m.exit !== 0 || m.wrapper) continue;
  const g = clean(fs.readFileSync(path.join(READS, `${m.page_id}.txt`), 'utf8')), s = clean(p.ocr?.data);
  if (letters(g) < 20 || letters(s) < 20) continue;
  frame.push({ m, p, g, s });
}
const order = shuffle([...frame]);
const sample = order.slice(0, N);
// A book with fewer than N + NC pages in the frame takes its controls from the sample's pages (#6769 lane gate): a
// control is G4L against a planted copy of itself, so it never shares a judgment with that page's A/B.
const controls = order.length >= N + NC ? order.slice(N, N + NC) : shuffle([...sample]).slice(0, NC);
console.log(`${TAG}: ${metas.length} reads, ${frame.length} pages in the frame (G4L read + served text); ${sample.length} drawn + ${controls.length} controls`);
const key = {}, reqs = [];
for (const [kind, set] of [['sample', sample], ['control', controls]]) {
  for (const { m, p, g, s } of set) {
    const uid = crypto.createHash('sha256').update(`${SEED}|${TAG}|${kind}|${p.id}`).digest('hex').slice(0, 12);
    const im = await images(getPageSource(p), uid);
    let x, y, pl = null;
    if (kind === 'sample') { x = { who: 'g4l', text: g }; y = { who: 'served', text: s }; } else { pl = plant(g); x = { who: 'clean', text: g }; y = { who: 'planted', text: pl.text }; }
    const flip = rng() < 0.5; const [A, B] = flip ? [y, x] : [x, y];
    key[uid] = { kind, tag: TAG, book_id: BOOK, page_id: p.id, page_number: p.page_number, A: A.who, B: B.who, served_model: p.ocr?.model ?? null, served_source: p.ocr?.source ?? null, image: { url: getPageSource(p), w: im.w, h: im.h, sha256: im.sha256 }, ...(pl && { plant: { swapped: pl.swapped, dropped_line: pl.dropped_line } }), g4l_letters: letters(g), served_letters: letters(s), read_hash: crypto.createHash('sha256').update(fs.readFileSync(path.join(READS, `${m.page_id}.txt`), 'utf8')).digest('hex') };
    reqs.push({ uid, dir: im.dir, files: im.files, prompt: PROMPT(im.layout, A.text, B.text) });
  }
}
shuffle(reqs);
fs.writeFileSync(path.join(OUT, 'requests.jsonl'), reqs.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify({ at: new Date().toISOString(), seed: SEED, book: BOOK, tag: TAG, frame: frame.length, reads: metas.length, key }, null, 1));
await client.close();
