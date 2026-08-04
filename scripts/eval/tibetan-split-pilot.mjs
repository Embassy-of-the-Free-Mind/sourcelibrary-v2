#!/usr/bin/env node
/**
 * PILOT: does splitting a multi-leaf Tibetan composite stop the OCR looping?
 *
 * The finding this tests (measured on 220 sampled page images):
 *   composite-shaped scans (aspect 1.3–2.0) break into repetition loops at
 *   ~63%, against ~8% for single pecha folios (aspect 3.0–4.5). Pixel height
 *   shows no monotonic effect, so the driver is GEOMETRY, not resolution — the
 *   model reads one leaf and repeats it across the rest.
 *
 * The pilot deliberately re-OCRs each cropped leaf with the SAME cheap model
 * that failed on the composite (`gemini-3.1-flash-lite-preview`). If splitting
 * alone fixes it, the fix is a splitter, not a model upgrade — which is far
 * cheaper. Upgrading the model would confound the test, so don't.
 *
 * Method follows .claude/docs/multi-leaf-scan-splitting.md geometry B:
 *   1. `gemini-3-flash-preview` returns one box per physical leaf (0–1000).
 *   2. Crop each leaf (no deterministic gap-snap in this pilot — the pilot asks
 *      whether the IDEA works, not whether the crop is pixel-perfect).
 *   3. OCR each leaf with the cheap model, using the production OCR prompt from
 *      the `prompts` collection so the comparison is against real output.
 *   4. Score looping the same way the corpus dataset does: type/token ratio
 *      below 0.15 on a text of 120+ words.
 *
 * Only reads production data; writes nothing back to Mongo.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/tibetan-split-pilot.mjs [--pages=12] [--out=scripts/output/tibetan-split-pilot]
 *
 * Cost: ~1 flash bbox call + N lite OCR calls per page. At 12 pages, cents.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const N_PAGES = parseInt(args.pages || '12');
const OUT = args.out || 'scripts/output/tibetan-split-pilot';
const BBOX_MODEL = 'gemini-3-flash-preview';
const OCR_MODEL = args.model || 'gemini-3.1-flash-lite-preview';   // the model that FAILED
const KEY = process.env.GEMINI_API_KEY;
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

// Same degeneracy test as build-corpus-dataset.mjs — a text of 120+ words whose
// unique-word share is under 0.15 is a repetition loop.
const deEntity = s => (s || '').replace(/&[a-z]{2,8};/gi, ' ').replace(/&#\d+;/g, ' ');
const WRAPPERS = 'meta|summary|keywords|vocab|language|scan-quality|script|page-type|columns|warning';
const dropTags = (t, names) => {
  for (const w of names.split('|')) t = t.replace(new RegExp(`<${w}[^>]*>[\\s\\S]*?</${w}>`, 'gi'), '');
  return t;
};
function loopStats(text) {
  const w = deEntity(dropTags(text || '', WRAPPERS)).replace(/<[^>]+>/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(x => x.length > 1);
  if (w.length < 120) return { words: w.length, unique: new Set(w).size, ttr: null, looped: false };
  const ttr = new Set(w).size / w.length;
  return { words: w.length, unique: new Set(w).size, ttr: +ttr.toFixed(4), looped: ttr < 0.15 };
}

async function gemini(model, parts, { json = false } = {}) {
  const body = { contents: [{ parts }] };
  if (json) body.generationConfig = { responseMimeType: 'application/json' };
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${API}/${model}:generateContent?key=${KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, 2000 * attempt));
      continue;
    }
    const j = await res.json();
    if (j.error) throw new Error(`${model}: ${j.error.message?.slice(0, 120)}`);
    const c = j.candidates?.[0];
    // An empty candidate is a real outcome (RECITATION, safety, over-length) and
    // must be reported, never silently treated as an empty page.
    return { text: c?.content?.parts?.map(p => p.text).join('') || '', finish: c?.finishReason || 'NONE' };
  }
  throw new Error(`${model}: exhausted retries`);
}

const BBOX_PROMPT = `This image is a photograph of Tibetan pecha (loose-leaf) manuscript folios.
Return one bounding box per DISTINCT PHYSICAL LEAF, ordered top to bottom.
A single pecha leaf is wide and short. Do NOT split one leaf into pieces.
If the image contains only one leaf, return exactly one box.
Respond ONLY with JSON: {"leaves":[{"box_2d":[ymin,xmin,ymax,xmax]}]} with coordinates 0-1000.`;

async function main() {
  if (!KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000, socketTimeoutMS: 300000 });
  await client.connect();
  const db = client.db('bookstore');

  const promptDoc = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
  if (!promptDoc?.content) throw new Error('no default OCR prompt in DB');
  const ocrPrompt = promptDoc.content.replace('{language_instruction}',
    '**Source language:** Tibetan. Transcribe the Tibetan text exactly as written.');
  console.log(`OCR prompt v${promptDoc.version} from DB · bbox=${BBOX_MODEL} · ocr=${OCR_MODEL}\n`);

  // Candidates: Tibetan pages whose CURRENT live text is a loop. Those are the
  // failures we want to fix; if splitting cannot rescue them, it is not the fix.
  const books = await db.collection('books').find(
    { language: 'Tibetan', 'image_source.provider': 'bl' },
    { projection: { id: 1, title: 1, slug: 1 } },
  ).limit(400).toArray();
  const bookById = new Map(books.map(b => [b.id, b]));
  const cands = [];
  for (let i = 0; i < books.length && cands.length < N_PAGES * 6; i += 50) {
    const ids = books.slice(i, i + 50).map(b => b.id);
    const pages = await db.collection('pages').find(
      { book_id: { $in: ids }, 'ocr.data': { $type: 'string' } },
      { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, display_photo: 1, photo: 1, 'ocr.data': 1, 'ocr.model': 1 } },
    ).limit(400).toArray();
    for (const p of pages) {
      const st = loopStats(p.ocr.data);
      if (st.looped) cands.push({ ...p, before: st });
    }
  }
  console.log(`found ${cands.length} Tibetan pages whose live OCR is a repetition loop`);
  const step = Math.max(1, Math.floor(cands.length / N_PAGES));
  const sample = cands.filter((_, i) => i % step === 0).slice(0, N_PAGES);
  console.log(`piloting ${sample.length} of them\n`);

  const results = [];
  for (const [i, p] of sample.entries()) {
    const bk = bookById.get(p.book_id) || {};
    const label = `${(bk.title || '?').slice(0, 30)} p${p.page_number}`;
    try {
      const url = p.archived_photo || p.display_photo || p.photo;
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const meta = await sharp(buf).metadata();
      const b64 = buf.toString('base64');

      const bb = await gemini(BBOX_MODEL, [
        { text: BBOX_PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: b64 } },
      ], { json: true });
      let leaves = [];
      try { leaves = JSON.parse(bb.text).leaves || []; } catch { /* handled below */ }
      if (!leaves.length) { console.log(`  [${i + 1}] ${label} — bbox returned nothing, skipped`); continue; }

      const texts = [];
      for (const [j, lf] of leaves.entries()) {
        const [ymin, xmin, ymax, xmax] = lf.box_2d;
        const left = Math.max(0, Math.round(xmin / 1000 * meta.width));
        const top = Math.max(0, Math.round(ymin / 1000 * meta.height));
        const w = Math.min(meta.width - left, Math.round((xmax - xmin) / 1000 * meta.width));
        const h = Math.min(meta.height - top, Math.round((ymax - ymin) / 1000 * meta.height));
        if (w < 40 || h < 20) continue;
        const crop = await sharp(buf).extract({ left, top, width: w, height: h }).jpeg({ quality: 92 }).toBuffer();
        fs.writeFileSync(path.join(OUT, `${p.id}-leaf${j + 1}.jpg`), crop);
        const r = await gemini(OCR_MODEL, [
          { text: ocrPrompt }, { inline_data: { mime_type: 'image/jpeg', data: crop.toString('base64') } },
        ]);
        texts.push({ leaf: j + 1, dims: `${w}x${h}`, finish: r.finish, ...loopStats(r.text), text: r.text });
      }
      // Per-leaf looping is the outcome; the joined text is reported too because
      // that is what would actually be stored if this ran in production.
      const joined = loopStats(texts.map(t => t.text).join('\n'));
      const anyLooped = texts.some(t => t.looped);
      results.push({
        page_id: p.id, book: bk.title, slug: bk.slug, page_number: p.page_number,
        image: `${meta.width}x${meta.height}`, aspect: +(meta.width / meta.height).toFixed(2),
        leaves: texts.length, before: p.before, after_leaves: texts.map(({ text, ...t }) => t),
        after_joined: joined, fixed: !anyLooped,
      });
      console.log(`  [${i + 1}] ${label.padEnd(34)} ${meta.width}x${meta.height} ar=${(meta.width / meta.height).toFixed(2)} ` +
        `→ ${texts.length} leaves · before ttr=${p.before.ttr} · after ttr=[${texts.map(t => t.ttr ?? '–').join(', ')}] ` +
        `${anyLooped ? '✗ still looping' : '✓ FIXED'}`);
    } catch (e) {
      console.log(`  [${i + 1}] ${label} — ERROR ${e.message.slice(0, 90)}`);
    }
  }

  const done = results.length, fixed = results.filter(r => r.fixed).length;
  console.log(`\n=== PILOT RESULT ===`);
  console.log(`  pages attempted (all looping before): ${done}`);
  console.log(`  no leaf loops after splitting        : ${fixed} (${done ? (100 * fixed / done).toFixed(0) : 0}%)`);
  console.log(`  still looping on ≥1 leaf             : ${done - fixed}`);
  console.log(`  leaves detected: ${results.reduce((s, r) => s + r.leaves, 0)} across ${done} pages`);
  console.log(`  model used for OCR: ${OCR_MODEL} — the SAME cheap model that failed on the composite.`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({
    date: new Date().toISOString(), bbox_model: BBOX_MODEL, ocr_model: OCR_MODEL,
    prompt_version: promptDoc.version, attempted: done, fixed, results,
  }, null, 2));
  console.log(`\n  → ${OUT}/results.json (+ cropped leaves as .jpg)`);
  await client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
