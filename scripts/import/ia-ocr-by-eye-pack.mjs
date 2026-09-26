#!/usr/bin/env node
/**
 * PRIOR ART: scripts/import/ia-ocr-ingest.mjs — the lane this feeds; its only reference today is
 *   Gemini-written pages (the paid 25-page preview), so a held book with no model pages cannot be
 *   calibrated at all. scripts/eval/ia-ocr-delivered-quality.mjs — measures delivered IA text
 *   against a fresh MODEL read, one page per book; not a human read, and it needs the model pass.
 *   scripts/lib/interior-sample.mjs — interior sampling for previews; reused here for the leaf pick.
 *
 * ia-ocr-by-eye-pack — build a reading pack so a person (or Claude on the subscription, never an
 * API call) can judge the Archive's OCR of a book BY EYE and produce the reference verdict that
 * `ia-ocr-ingest.mjs --by-eye <verdicts.jsonl>` consumes.
 *
 * WHY (2026-09-26, Derek: "or, you could look at them manually… find the title page and evaluate
 * the ocr quality"). The free IA lane gates on agreement with a paid Gemini sample. For post-1870
 * typeset English a person can settle the same question in a minute per book by opening two
 * leaves and reading the Archive's text against the scan — and that costs nothing on the Gemini
 * dial. Tesseract is NOT an option for the reference (Derek, 2026-09-26): it shares IA's engine's
 * blind spots and proves nothing.
 *
 * For each book it picks TWO leaves — the first text leaf (title page or first page with ≥ 40
 * words; it also pins the leaf↔page alignment) and one interior leaf at ~60 % of the book — and
 * writes, under <out>/<book_id>/:
 *   leaf-<k>.jpg   the page image, downscaled to --width px (default 1100) for cheap reading
 *   leaf-<k>.txt   the Archive's text for that leaf (dehyphenated, as the ingest would write it)
 *   pack.json      book, ia id, language, pages, the leaves, and the verdict schema to fill in
 * and one <out>/PACK.md listing every book with the paths to open.
 *
 * The verdict file the reader produces (one JSON line per book) is:
 *   { "book_id", "ia_identifier", "reader": "<who>", "read_at": "<ISO>",
 *     "leaves": [ { "leaf": k, "page_number": n, "verdict": "accept"|"reject"|"skip", "note": "…" } ],
 *     "verdict": "accept"|"reject", "note": "one line: what was compared and what was seen" }
 * "accept" means: the Archive's text of that leaf is a faithful reading of that image (word order,
 * spelling, no dropped columns), AND the image at pages.photo for that page IS that leaf.
 *
 * CONTACT SHEETS (--sheets; Derek, 2026-09-26: "maybe from the contact sheet image identification?").
 * The two read leaves judge the TEXT; they cannot find the non-text leaves elsewhere in the book —
 * covers, patent drawing sheets, plates, blanks — where the Archive's engine emits junk that an
 * accepted book would then write (pilot: a Tesla drawing sheet read as ~100 junk tokens). With
 * --sheets every page is tiled into numbered grids (sheet-NN.jpg, --cols × --rows cells, each
 * labelled with its IA leaf index), so one look per ~30 pages lists the leaves to skip. The reader
 * records them as `skip_leaves: [k, …]` in the verdict. Same idea as
 * scripts/eval/contact-sheet-screen.mjs (#5009), but read by eye, never sent to a model.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/ia-ocr-by-eye-pack.mjs --ids <file> --out <dir> [--width 1100] [--per-book 2]
 *   node scripts/import/ia-ocr-by-eye-pack.mjs --campaign keely-circle-2026-09-25 --out <dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ObjectId } from 'mongodb';
import { withMongo } from '../lib/mongo.mjs';
import { iaFetch, iaOcrMeta } from '../lib/ia-ocr-meta.mjs';
import { dehyphenateLineBreaks } from '../lib/dehyphenate.mjs';
import sharp from 'sharp';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const IDS_FILE = arg('--ids', null);
const CAMPAIGN = arg('--campaign', null);
const OUT = arg('--out', null);
const WIDTH = +arg('--width', 1100);
const PER_BOOK = +arg('--per-book', 2);
const SHEETS = process.argv.includes('--sheets');
const COLS = +arg('--cols', 6), ROWS = +arg('--rows', 5), CELL_W = +arg('--cell', 200);
if (!OUT || (!IDS_FILE && !CAMPAIGN)) { console.error('Required: --out <dir> and --ids <file> | --campaign <tag>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const UA = 'SourceLibrary by-eye pack (contact: derek@sourcelibrary.org)';
const words = (t) => t.split(/\s+/).filter(Boolean).length;
const leafIndex = (p) => { const m = String(p.photo || p.archived_photo || '').match(/\/page\/n(\d+)\//); return m ? +m[1] : (p.page_number || 1) - 1; };

/** The Archive's per-leaf text for an item (word-boxed XML → one string per <OBJECT>), dehyphenated. */
async function leafTexts(iaId) {
  const meta = await iaOcrMeta(iaId);
  const xml = meta.djvu_xml_files?.[0];
  if (!xml || meta.djvu_xml_files.length !== 1) return { meta, leaves: null, reason: xml ? 'several XMLs (ambiguous)' : 'no _djvu.xml' };
  const res = await iaFetch(`https://archive.org/download/${iaId}/${encodeURIComponent(xml)}`);
  if (!res.ok) return { meta, leaves: null, reason: `HTTP ${res.status} for ${xml}` };
  const t = await res.text();
  const leaves = [...t.matchAll(/<OBJECT[\s\S]*?<\/OBJECT>/g)].map((o) => {
    // `<LINE\b[^>]*>`, not `<LINE>`: IA tags running heads and patent header blocks as
    // `<LINE x-struct="header">`. The bare pattern dropped them from the reading text while the
    // ingest (which splits on `<LINE\b`) writes them, so the reader judged a different text (2026-09-26).
    const lines = [...o[0].matchAll(/<LINE\b[^>]*>([\s\S]*?)<\/LINE>/g)].map((l) => [...l[1].matchAll(/<WORD[^>]*>([^<]*)<\/WORD>/g)].map((w) => w[1]).join(' '));
    return lines.join('\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  });
  return { meta, leaves: leaves.map(dehyphenateLineBreaks), xml };
}

async function fetchImage(url, dest) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const raw = dest + '.orig';
  fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
  // sips ships with macOS; ImageMagick on Hetzner. Either way the reader gets a ~1100-px-wide JPEG.
  try { execFileSync('sips', ['-Z', String(Math.round(WIDTH * 1.6)), '--resampleWidth', String(WIDTH), raw, '--out', dest], { stdio: 'ignore' }); }
  catch { execFileSync('convert', [raw, '-resize', `${WIDTH}x`, '-quality', '82', dest], { stdio: 'ignore' }); }
  fs.unlinkSync(raw);
}

/** A small image URL for a page: IIIF-sized for archive.org, the stored JPEG otherwise (sharp shrinks it). */
function thumbUrl(p) {
  const u = String(p.photo || p.archived_photo || '');
  return u.includes('/full/full/') ? u.replace('/full/full/', `/full/${CELL_W * 2},/`) : u;
}
/** Tile every page into numbered grids; returns the sheet paths. Cell label = IA leaf index. */
async function buildSheets(pages, dir) {
  const cellH = Math.round(CELL_W * 1.45), per = COLS * ROWS, out = [];
  const thumbs = new Array(pages.length);
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < pages.length) {
      const i = next++;
      try {
        const r = await fetch(thumbUrl(pages[i]), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
        thumbs[i] = r.ok ? await sharp(Buffer.from(await r.arrayBuffer())).resize(CELL_W, cellH - 22, { fit: 'contain', background: '#fff' }).jpeg({ quality: 70 }).toBuffer() : null;
      } catch { thumbs[i] = null; }
    }
  }));
  for (let s0 = 0; s0 < pages.length; s0 += per) {
    const comps = [];
    for (let j = 0; j < per && s0 + j < pages.length; j++) {
      const p = pages[s0 + j], x = (j % COLS) * CELL_W, y = Math.floor(j / COLS) * cellH;
      const label = `n${leafIndex(p)} · p${p.page_number}${thumbs[s0 + j] ? '' : ' · NO IMAGE'}`;
      comps.push({ input: Buffer.from(`<svg width="${CELL_W}" height="22"><rect width="100%" height="100%" fill="#222"/><text x="6" y="16" font-family="Helvetica" font-size="14" fill="#fff">${label}</text></svg>`), left: x, top: y });
      if (thumbs[s0 + j]) comps.push({ input: thumbs[s0 + j], left: x, top: y + 22 });
    }
    const f = path.join(dir, `sheet-${String(s0 / per + 1).padStart(2, '0')}.jpg`);
    await sharp({ create: { width: COLS * CELL_W, height: ROWS * cellH, channels: 3, background: '#fff' } }).composite(comps).jpeg({ quality: 78 }).toFile(f);
    out.push(f);
  }
  return out;
}

await withMongo(async (db) => {
  const B = db.collection('books'), P = db.collection('pages');
  const q = CAMPAIGN ? { $or: [{ acquisition_campaign: CAMPAIGN }, { acquisition_batch: CAMPAIGN }] }
    : (() => { const ids = fs.readFileSync(IDS_FILE, 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      return { $or: [{ id: { $in: ids } }, { _id: { $in: ids.filter((x) => ObjectId.isValid(x)).map((x) => new ObjectId(x)) } }] }; })();
  const books = await B.find(q, { projection: { id: 1, title: 1, author: 1, language: 1, published: 1, ia_identifier: 1, image_source: 1, pages_count: 1 } }).toArray();
  const index = ['# By-eye reading pack', '', `Generated ${new Date().toISOString().slice(0, 10)} — ${books.length} books, ${PER_BOOK} leaves each.`, '',
    'For each book: open leaf-<k>.jpg, read leaf-<k>.txt against it, then write one JSON line to verdicts.jsonl (schema in pack.json).', ''];
  let done = 0, failed = 0;
  for (const b of books) {
    const bid = b.id || String(b._id);
    const iaId = b.ia_identifier || b.image_source?.identifier;
    const dir = path.join(OUT, bid); fs.mkdirSync(dir, { recursive: true });
    try {
      const { meta, leaves, reason, xml } = await leafTexts(iaId);
      if (!leaves) { console.log(`  SKIP ${bid} ${iaId}: ${reason}`); failed++; continue; }
      const pages = await P.find({ book_id: bid }, { projection: { page_number: 1, photo: 1, archived_photo: 1 } }).sort({ page_number: 1 }).toArray();
      const byLeaf = new Map(pages.map((p) => [leafIndex(p), p]));
      // first text leaf: ≥ 40 words, skipping Google's boilerplate leaf; then interior at 60 %.
      const firstText = leaves.findIndex((l) => words(l) >= 40 && !/digitized by google|google book search/i.test(l));
      const interior = Math.min(leaves.length - 1, Math.floor(leaves.length * 0.6));
      const picks = [...new Set([firstText < 0 ? 0 : firstText, interior].slice(0, PER_BOOK))];
      const items = [];
      for (const k of picks) {
        const p = byLeaf.get(k);
        if (!p) { items.push({ leaf: k, page_number: null, note: 'no page record at this leaf index' }); continue; }
        const jpg = path.join(dir, `leaf-${k}.jpg`);
        await fetchImage(p.photo || p.archived_photo, jpg);
        fs.writeFileSync(path.join(dir, `leaf-${k}.txt`), leaves[k]);
        items.push({ leaf: k, page_number: p.page_number, words: words(leaves[k]), image: jpg, text: path.join(dir, `leaf-${k}.txt`) });
      }
      const sheets = SHEETS ? await buildSheets(pages, dir) : [];
      const pack = { book_id: bid, ia_identifier: iaId, title: b.title, author: b.author, language: b.language, published: b.published, pages: pages.length, ia_leaves: leaves.length,
        engine: meta.engine || null, engine_version: meta.version || null, xml, leaves: items, sheets,
        verdict_schema: { book_id: bid, ia_identifier: iaId, reader: '<who read it, e.g. claude-fable-5-1 session …>', read_at: '<ISO>', leaves: items.map((i) => ({ leaf: i.leaf, page_number: i.page_number, verdict: 'accept|reject|skip', note: '' })), skip_leaves: [], verdict: 'accept|reject', note: '' } };
      fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(pack, null, 1));
      index.push(`- **${bid}** — ${String(b.title).slice(0, 70)} (${b.language}, ${pages.length} pp, IA leaves ${leaves.length}): ${items.map((i) => i.image ? `\`${path.relative(OUT, i.image)}\` (p.${i.page_number}, ${i.words} words)` : `leaf ${i.leaf}: ${i.note}`).join('; ')}${sheets.length ? ` + ${sheets.length} contact sheet(s)` : ''}`);
      console.log(`  OK   ${bid} ${String(b.title).slice(0, 50)} | leaves ${picks.join(',')} of ${leaves.length}`);
      done++;
    } catch (e) { console.log(`  FAIL ${bid} ${iaId}: ${e.message}`); failed++; }
  }
  fs.writeFileSync(path.join(OUT, 'PACK.md'), index.join('\n') + '\n');
  console.log(`packed ${done}, failed ${failed} → ${OUT}/PACK.md`);
}, { timeoutMs: 2 * 60 * 60 * 1000 });
