#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/cursive-census-classify.mjs (#5100) — a metered, capped, resumable
 * page-image classifier over a manifest, summarised per BOOK; this follows its plumbing (metered
 * client, list-price cap, one JSON per page). It does not fit as-is: its prompt is the six-class
 * CJK script prompt, and its manifest is drawn from Japanese books; here the question is only
 * "handwritten codex or print?" over Greek books, and most books already answer it in their own
 * OCR envelope (`<script>handwritten</script>`), so the image is asked only where the envelope is
 * silent. scripts/eval/benchmark/script-class/ is the by-eye page classification of the sealed
 * strata (362 pages) — it covers none of these books.
 *
 * #5619 step 1 — census of the Greek MANUSCRIPTS we hold. Read-only: writes nothing to Mongo.
 *
 *   node --env-file=.env.production.local scripts/eval/greek-ms-census-5619.mjs [--out=DIR] [--cap=1] [--concurrency=4]
 *
 * 1. Candidates: books whose language / original_language / languages[] says Greek AND one
 *    manuscript signal — a manuscript-holding provider (Bodleian, Vatican, Laurenziana, Gallica,
 *    Cambridge, e-codices, Marciana, BL, Harvard, …), a shelfmark, a shelfmark-shaped title
 *    (gr., graec., Grec N, Cod., MS, Barocci, Laud, …), a date before 1460, or a "century" date.
 * 2. Per book, up to 5 interior pages (15–95 % of the book) with OCR: the envelope's `<script>`.
 *    Three or more tagged pages decide the book (handwritten majority → manuscript).
 * 3. Otherwise one interior page IMAGE is classified by gemini-3.1-flash-lite (thinking off,
 *    temperature 0) as manuscript / print / other. Metered via gemini-script-client; stops at --cap.
 * 4. Summary: books, pages, visible vs hidden, work_id, by provider.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { withMongo } from '../lib/mongo.mjs';
import { callGemini } from '../lib/gemini-script-client.mjs';
import { MODEL_PRICING } from '../lib/model-pricing.mjs';

const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const OUT = argOf('out', '/mnt/HC_Volume_105839809/greek-ms-align-5619/census');
const CAP = parseFloat(argOf('cap', '1'));
const CONC = parseInt(argOf('concurrency', '4'), 10);
const MODEL = 'gemini-3.1-flash-lite';
const ENDPOINT = 'scripts/eval/greek-ms-census-5619.mjs';
const MS_PROVIDERS = ['bodleian', 'gallica', 'laurenziana', 'vatican', 'cambridge', 'e-codices', 'leiden', 'manchester', 'marciana', 'bl', 'bph', 'iiif', 'harvard', 'sbb', 'slub_dresden', 'goettingen', 'contentdm'];
const PROMPT = `Look at this page image. Is the running text on it WRITTEN BY HAND (a manuscript codex, any script) or PRINTED (typeset or engraved)? Answer with one JSON object only:
{"kind": "manuscript" | "print" | "other" (no running text: blank, binding, plate, colour card), "script": "greek" | "latin" | "mixed" | "other", "spread": true if two facing pages are shown}`;

fs.mkdirSync(path.join(OUT, 'pages'), { recursive: true });
const price = MODEL_PRICING[MODEL];
let spent = 0;

const tagOf = (ocr) => (String(ocr || '').match(/<script>([^<]*)<\/script>/i)?.[1] || '').toLowerCase().trim();
const greekShare = (ocr) => { const t = String(ocr || '').replace(/<[^>]+>/g, ''); const g = (t.match(/\p{Script=Greek}/gu) || []).length, l = (t.match(/\p{L}/gu) || []).length; return l ? g / l : null; };

async function classifyImage(url, file) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (spent >= CAP) return { error: 'cap' };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`image ${res.status}`);
    const buf = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    const r = await callGemini({ model: MODEL, prompt: PROMPT, endpoint: ENDPOINT, imageParts: [{ mimeType: 'image/jpeg', data: buf }], maxOutputTokens: 200, type: 'eval' });
    spent += (r.inputTokens * price.input + r.outputTokens * price.output) / 1e6;
    const m = r.text.match(/\{[\s\S]*\}/);
    const out = m ? JSON.parse(m[0]) : { error: 'unparsed', raw: r.text.slice(0, 200) };
    out.url = url;
    fs.writeFileSync(file, JSON.stringify(out));
    return out;
  } catch (e) {
    const out = { error: String(e.message || e).slice(0, 200), url };
    fs.writeFileSync(file, JSON.stringify(out));
    return out;
  }
}

await withMongo(async (db) => {
  const greek = { $or: [{ language: /greek/i }, { original_language: /greek/i }, { languages: /greek/i }] };
  const q = { $and: [greek, { $or: [
    { 'image_source.provider': { $in: MS_PROVIDERS } }, { shelfmark: { $exists: true, $ne: null } }, { 'image_source.shelfmark': { $exists: true } },
    { title: /\b(gr\.|graec|grec \d|cod\.|codex|ms\.?\s|MS |plut\.|barocci|auct\.|laud|holkham|suppl\.? gr)/i },
    { year: { $lt: 1460 } }, { published: /century|saec|th c\b/i },
  ] }] };
  const greekTotal = await db.collection('books').countDocuments(greek);
  const books = await db.collection('books').find(q, { projection: { _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1, year: 1, visible: 1, hidden: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, work_id: 1, 'image_source.provider': 1, 'image_source.shelfmark': 1, shelfmark: 1 } }).toArray();
  console.log(`Greek-tagged books ${greekTotal}; candidates ${books.length}`);
  const rows = [];
  let next = 0;
  const worker = async () => {
    while (next < books.length) {
      const b = books[next++];
      const n = b.pages_count || 0;
      const pages = await db.collection('pages').find({ book_id: b.id, page_number: { $gte: Math.floor(n * 0.15), $lte: Math.ceil(n * 0.95) } },
        { projection: { _id: 0, page_number: 1, 'ocr.data': 1, photo: 1, archived_photo: 1 } }).sort({ page_number: 1 }).limit(600).toArray();
      const withOcr = pages.filter((p) => p.ocr?.data);
      const step = Math.max(1, Math.floor(withOcr.length / 5));
      const pick = withOcr.filter((_, i) => i % step === 0).slice(0, 5);
      const tags = pick.map((p) => tagOf(p.ocr.data)).filter(Boolean);
      const shares = pick.map((p) => greekShare(p.ocr.data)).filter((x) => x != null);
      const row = { ...b, provider: b.image_source?.provider || null, tags, greek_share_median: shares.length ? shares.sort((x, y) => x - y)[Math.floor(shares.length / 2)] : null };
      delete row.image_source;
      if (tags.length >= 3) {
        row.kind = tags.filter((t) => /hand|manuscr/.test(t)).length * 2 > tags.length ? 'manuscript' : 'print';
        row.kind_by = 'ocr-envelope';
      } else {
        const mid = pages[Math.floor(pages.length / 2)];
        const url = mid?.archived_photo || mid?.photo;
        if (!url) { row.kind = 'unknown'; row.kind_by = 'no-image'; }
        else {
          const c = await classifyImage(url, path.join(OUT, 'pages', `${b.id}-p${mid.page_number}.json`));
          row.kind = c.error ? 'unknown' : c.kind; row.kind_by = c.error ? `image-error:${c.error}` : `image:${MODEL}`; row.image_script = c.script || null; row.spread = c.spread ?? null;
        }
      }
      rows.push(row);
      if (rows.length % 100 === 0) console.log(`${rows.length}/${books.length}  spent $${spent.toFixed(3)}`);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  fs.writeFileSync(path.join(OUT, 'books.json'), JSON.stringify(rows, null, 1));

  // ── summary ──
  const ms = rows.filter((r) => r.kind === 'manuscript');
  const live = (r) => r.visible === true && (r.pages_count || 0) > 0;
  const sum = (a, k) => a.reduce((s, r) => s + (r[k] || 0), 0);
  const by = (a, f) => { const o = {}; for (const r of a) { const k = f(r); o[k] = (o[k] || 0) + 1; } return Object.entries(o).sort((x, y) => y[1] - x[1]); };
  const summary = {
    at: new Date().toISOString(), greek_tagged_books: greekTotal, candidates: rows.length, spent_usd: +spent.toFixed(4),
    kind: by(rows, (r) => r.kind), kind_by: by(rows, (r) => r.kind_by.split(':')[0]),
    manuscripts: {
      books: ms.length, pages: sum(ms, 'pages_count'), pages_ocr: sum(ms, 'pages_ocr'), pages_translated: sum(ms, 'pages_translated'),
      visible_books: ms.filter(live).length, visible_pages: sum(ms.filter(live), 'pages_count'),
      hidden_books: ms.filter((r) => !live(r)).length, hidden_pages: sum(ms.filter((r) => !live(r)), 'pages_count'),
      with_work_id: ms.filter((r) => r.work_id).length, local_work_id: ms.filter((r) => /^local:/.test(r.work_id || '')).length,
      by_provider: by(ms, (r) => r.provider), mostly_latin_text: ms.filter((r) => r.greek_share_median != null && r.greek_share_median < 0.5).length,
    },
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}, { noTimeout: true });
