/**
 * PRIOR ART: scripts/qa/plate-captions.mjs, scripts/qa/plate-ornaments.mjs and
 * scripts/qa/render-scholarly-pdf.mjs do the work; this runs them in order for
 * one book and adds the two steps that were by hand on Fludd UCH I (#5849):
 * the ornament contact sheet, and the "how this edition was made" text, which
 * is generated from the page records so every claim in it is one the data
 * supports. Nothing here writes to production.
 *
 * An illustrated scholarly edition of one book, step by step (#5849).
 *
 *   node --env-file=.env.production.local scripts/qa/illustrated-edition.mjs <bookId> <step> [opts]
 *
 *   check     is the book ready (translated, plates, title page)? what will the passes cost?
 *   submit    caption + ornament passes as Gemini Batch jobs (half price)
 *   collect   collect both; re-ask the pages that failed, in realtime, with a larger token cap
 *   sheet     ornament crops as numbered contact sheets, to check by eye
 *   verify    --reject 0,3,11   mark every ornament verified except those numbers (from the sheet)
 *   texts     write edition-texts/<id>/methodology.md from the page records, and facts.md
 *             (title-page text, imprint, provenance) for whoever writes introduction.md
 *   render    the PDF (no source transcription), with page/plate/warning counts
 *
 * Outputs: scripts/output/plate-captions/<id>.json, scripts/output/plate-ornaments/<id>*.{json,jpg},
 * scripts/qa/edition-texts/<id>/*.md, scripts/output/illustrated-edition/<id>.pdf
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { illustrationQuery, spreadPageNumbers } from '../lib/scholarly-typst.mjs';

const [bookId, step] = process.argv.slice(2);
const args = process.argv.slice(4);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const STEPS = ['check', 'submit', 'collect', 'sheet', 'verify', 'texts', 'render'];
if (!bookId || !STEPS.includes(step)) { console.error(`usage: illustrated-edition.mjs <bookId> <${STEPS.join('|')}>`); process.exit(1); }

const captionsFile = join('scripts', 'output', 'plate-captions', `${bookId}.json`);
const ornamentsFile = join('scripts', 'output', 'plate-ornaments', `${bookId}.json`);
const textsDir = join('scripts', 'qa', 'edition-texts', bookId);
const readJson = f => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf-8')) : null);
// Measured on Fludd UCH I at Batch price, gemini-3-flash: $0.782 / 494 caption pages, $0.087 / 245 ornament pages
const USD_PER_CAPTION_PAGE = 0.0016, USD_PER_ORNAMENT_PAGE = 0.00036;

/** Run one of the pass scripts, streaming its output; returns its exit code. */
function run(script, extra = []) {
  const r = spawnSync(process.execPath, [...process.execArgv, join('scripts', 'qa', script), bookId, ...extra], { stdio: 'inherit' });
  return r.status;
}

async function withDb(fn) {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try { return await fn(client.db('bookstore')); } finally { await client.close(); }
}

async function check() {
  await withDb(async db => {
    const book = await db.collection('books').findOne({ id: bookId }, { projection: { title: 1, display_title: 1, author: 1, published: 1, language: 1, pages_count: 1 } });
    if (!book) throw new Error(`book not found: ${bookId}`);
    const pages = await db.collection('pages').countDocuments({ book_id: bookId });
    const translated = await db.collection('pages').countDocuments({ book_id: bookId, 'translation.data': { $exists: true, $ne: '' } });
    const spreads = await spreadPageNumbers(db, bookId);
    const platePages = (await db.collection('gallery_images').distinct('page_number', illustrationQuery({ id: bookId }))).filter(n => !spreads.has(n)).length;
    if (spreads.size) console.log(`split book: ${spreads.size} archived spreads are left out (their single pages carry the text and figures)`);
    const titlePages = await db.collection('pages').countDocuments({ book_id: bookId, page_type: 'title-page' });
    console.log(`${book.display_title || book.title} — ${book.author}, ${book.published} (${book.language})`);
    console.log(`pages ${pages}, translated ${translated} (${Math.round((100 * translated) / pages)}%), plate pages ${platePages}, typed title pages ${titlePages}`);
    console.log(`estimate at Batch price: captions ~$${(platePages * USD_PER_CAPTION_PAGE).toFixed(2)}, ornaments ~$${(pages * 0.25 * USD_PER_ORNAMENT_PAGE).toFixed(2)} (if ~1 page in 4 is a candidate)`);
    if (translated / pages < 0.95) console.log('NOT READY: under 95% translated — the edition would have gaps');
    if (!platePages) console.log('NOT READY: no gallery records at quality ≥ 0.7 — run image extraction first');
    console.log(`caption cache: ${readJson(captionsFile) ? Object.keys(readJson(captionsFile).pages).length + ' pages' : 'none'}; ornament cache: ${readJson(ornamentsFile) ? Object.keys(readJson(ornamentsFile).pages).length + ' pages' : 'none'}`);
  });
}

function collect() {
  const a = run('plate-captions.mjs', ['--collect']);
  const b = run('plate-ornaments.mjs', ['--collect']);
  if (a === 3 || b === 3) { console.log('still running — collect again later'); return; }
  // Only after a clean collect: with no batch behind it, a realtime pass would
  // caption the whole book at full price
  if (a !== 0) { console.log('caption collect failed — not re-asking'); return; }
  // Pages that failed in the batch stay uncached; a realtime pass with a larger cap
  // asks only those (dense tables run past the default 4,000 tokens)
  run('plate-captions.mjs', ['--max-tokens', '16000']);
}

/** Numbered crops of every ornament the finder boxed, 24 to a sheet. */
async function sheet() {
  const cache = readJson(ornamentsFile);
  if (!cache) throw new Error('no ornament cache; submit and collect first');
  const items = Object.entries(cache.pages).flatMap(([n, p]) => (p.ornaments || []).map((o, k) => ({ n, k, url: p.scan_url, ...o })));
  const W = 360, H = 170, COLS = 4, PER = 24;
  const tiles = [];
  for (let i = 0; i < items.length; i += 8) {
    tiles.push(...await Promise.all(items.slice(i, i + 8).map(async (it, j) => {
      const raw = Buffer.from(await (await fetch(it.url)).arrayBuffer());
      const { width, height } = await sharp(raw).rotate().metadata();
      const [y0, x0, y1, x1] = it.box_2d;
      const left = Math.max(0, Math.round((x0 / 1000) * width)), top = Math.max(0, Math.round((y0 / 1000) * height));
      const w = Math.max(1, Math.min(width - left, Math.round(((x1 - x0) / 1000) * width))), h = Math.max(1, Math.min(height - top, Math.round(((y1 - y0) / 1000) * height)));
      const crop = await sharp(raw).rotate().extract({ left, top, width: w, height: h }).resize(W, H - 22, { fit: 'contain', background: '#fff' }).toBuffer();
      const label = Buffer.from(`<svg width="${W}" height="22"><rect width="100%" height="100%" fill="#222"/><text x="6" y="16" font-size="15" fill="#fff" font-family="Helvetica">#${i + j} p${it.n} ${it.kind}</text></svg>`);
      return sharp({ create: { width: W, height: H, channels: 3, background: '#fff' } }).composite([{ input: label, top: 0, left: 0 }, { input: crop, top: 22, left: 0 }]).png().toBuffer();
    })));
  }
  const files = [];
  for (let s = 0; s * PER < tiles.length; s++) {
    const page = tiles.slice(s * PER, (s + 1) * PER);
    const file = join('scripts', 'output', 'plate-ornaments', `${bookId}-sheet-${s}.jpg`);
    await sharp({ create: { width: COLS * (W + 6), height: Math.ceil(page.length / COLS) * (H + 6), channels: 3, background: '#888' } })
      .composite(page.map((t, i) => ({ input: t, left: (i % COLS) * (W + 6), top: Math.floor(i / COLS) * (H + 6) })))
      .jpeg({ quality: 80 }).toFile(file);
    files.push(file);
  }
  console.log(`${items.length} ornaments on ${files.length} sheet(s):\n  ${files.join('\n  ')}\nReject what is not an ornament (rules, text, blank paper, initials): verify --reject 0,3,11`);
}

function verify() {
  const cache = readJson(ornamentsFile);
  if (!cache) throw new Error('no ornament cache');
  const reject = new Set(String(opt('reject') || '').split(',').filter(Boolean).map(Number));
  let i = 0, kept = 0;
  for (const p of Object.values(cache.pages)) for (const o of p.ornaments || []) { o.verified = !reject.has(i++); if (o.verified) kept++; }
  cache.verified_by = `by eye from the contact sheet, ${new Date().toISOString().slice(0, 10)}; rejected ${[...reject].join(', ') || 'none'}`;
  writeFileSync(ornamentsFile, JSON.stringify(cache, null, 1));
  console.log(`${kept} of ${i} ornaments verified`);
}

const month = d => (d ? new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : null);
const day = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null);

/** The account of how the edition was made, from the records, and the facts an introduction may draw on. */
async function texts() {
  await withDb(async db => {
    const book = await db.collection('books').findOne({ id: bookId }, { projection: { pages: 0, editions: 0 } });
    const span = async field => (await db.collection('pages').aggregate([
      { $match: { book_id: bookId, [`${field}.data`]: { $exists: true, $ne: '' } } },
      { $group: { _id: `$${field}.model`, n: { $sum: 1 }, first: { $min: `$${field}.updated_at` }, last: { $max: `$${field}.updated_at` } } },
      { $sort: { n: -1 } },
    ]).toArray());
    const [ocr, tr] = [await span('ocr'), await span('translation')];
    const pages = await db.collection('pages').countDocuments({ book_id: bookId });
    const src = book.image_source || {};
    const models = list => list.filter(m => m._id).map(m => `${m._id} (${m.n} pages)`).join(', ') || 'a model not recorded on the pages';
    const holder = src.contributing_library ? `, photographed from the copy at the ${src.contributing_library}` : '';
    const lang = book.language || 'source-language';
    const captions = readJson(captionsFile), ornaments = readJson(ornamentsFile);
    const verifiedOrnaments = ornaments ? Object.values(ornaments.pages).flatMap(p => p.ornaments || []).filter(o => o.verified).length : 0;

    const methodology = `## How this edition was made

Source Library made this edition from photographs of a printed copy, with the help of AI models at each step. No specialist has reviewed the transcription or the translation; read the English as a working translation, and check anything that matters against the page images.

1. **Page images.** The ${pages} page images come from ${src.provider_name || 'a digital library'}${src.identifier ? ` (item *${src.identifier}*)` : ''}${holder}. Source Library keeps its own archived copy of each image.
2. **Transcription.** Each page image was read by ${models(ocr)}${month(ocr[0]?.first) ? ` (${month(ocr[0].first)}${month(ocr[0].last) !== month(ocr[0].first) ? `–${month(ocr[0].last)}` : ''})` : ''}, which transcribed the ${lang} and marked the running heads, marginal notes and illustrations on the page.
3. **Translation.** ${models(tr)} translated the transcription into English one page at a time, given the previous page's translation for continuity${day(tr[0]?.last) ? `; the last page was translated on ${day(tr[0].last)}` : ''}. The footnotes come from this step: they are the translation's explanations, not the author's.
4. **Illustrations.** ${captions ? `Every page carrying a figure was shown to the model again with its transcription and translation; the model boxed each figure, gave it a short title, and transcribed and translated the words engraved on it, which form the captions. ` : ''}A small cut is printed at roughly the share of the page it takes in the original.${verifiedOrnaments ? ' The headpieces and tailpieces are the book\'s own, located by the model and checked by eye.' : ''}
5. **Setting.** The book was typeset with Typst. The ${lang} transcription is not printed here; each source page number in the margin, and the line at the foot of each page, links to the photograph of that page, and the transcription can be read beside it at sourcelibrary.org.

Corrections are welcome at sourcelibrary.org, and later versions of this edition will carry them.
`;
    // Title pages in the book's own words: what an introduction can cite without outside help
    const titlePages = await db.collection('pages').find({ book_id: bookId, $or: [{ page_type: 'title-page' }, { 'ocr.data': /<page-type>\s*title/i }] }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).sort({ page_number: 1 }).limit(6).toArray();
    const plain = s => String(s || '').replace(/<(image-desc|lang|language|page-type|scan-quality|script|summary|keywords|vocab|meta|warning)\b[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const facts = `# Facts for the introduction — ${book.display_title || book.title}

Every claim in introduction.md must come from this file (our own scans and records) or from a source named beside it. Read the title page in the IMAGE, not only the OCR, before citing a date or imprint, and say so.

- Record: ${book.title} — ${book.author}, ${book.published}${book.place_published ? `, ${book.place_published}` : ''}${book.publisher ? `, ${book.publisher}` : ''} (${lang})
- USTC: ${book.ustc_id || book.ustc || 'none recorded'}
- Images: ${src.provider_name || '?'} ${src.source_url || ''}${src.contributing_library ? ` — ${src.contributing_library}` : ''}
- Reader: https://sourcelibrary.org/book/${bookId}

## Title pages (transcription, then translation)
${titlePages.map(p => `\n### Source page ${p.page_number} — https://sourcelibrary.org/book/${bookId}?page=${p.page_number}\n\n${plain(p.ocr?.data).slice(0, 1500)}\n\n${plain(p.translation?.data).slice(0, 1500)}\n`).join('') || '\n(none typed as title pages — find them by eye)\n'}
## Checklist before introduction.md is used
- [ ] author's dates and career from a named reference
- [ ] imprint and date read from the title-page image (a bound copy can join two editions)
- [ ] every later work, reply or reader named with its date and a source
- [ ] no claim about the book's influence that no source makes
`;
    mkdirSync(textsDir, { recursive: true });
    writeFileSync(join(textsDir, 'methodology.md'), methodology);
    writeFileSync(join(textsDir, 'facts.md'), facts);
    console.log(`wrote ${join(textsDir, 'methodology.md')} and facts.md (${titlePages.length} title pages)${existsSync(join(textsDir, 'introduction.md')) ? '' : '\nno introduction.md yet — write it from facts.md'}`);
  });
}

function render() {
  const out = join('scripts', 'output', 'illustrated-edition', `${bookId}.pdf`);
  mkdirSync(join('scripts', 'output', 'illustrated-edition'), { recursive: true });
  const r = spawnSync(process.execPath, [...process.execArgv, join('scripts', 'qa', 'render-scholarly-pdf.mjs'), bookId, '--no-original', '--out', out], { encoding: 'utf-8' });
  const all = `${r.stdout}\n${r.stderr}`;
  const warnings = (all.match(/^warning: .*/gm) || []);
  console.log(all.split('\n').filter(l => /illustrations|ornaments|MB/.test(l)).join('\n'));
  const counts = {}; for (const w of warnings) counts[w] = (counts[w] || 0) + 1;
  console.log(warnings.length ? `TYPST WARNINGS:\n${Object.entries(counts).map(([w, n]) => `  ${n}× ${w}`).join('\n')}` : 'no Typst warnings');
  const info = spawnSync('pdfinfo', [out], { encoding: 'utf-8' });
  console.log((info.stdout || '').split('\n').find(l => l.startsWith('Pages')) || '');
  if (r.status) process.exit(r.status);
}

const actions = { check, submit: () => { run('plate-captions.mjs', ['--batch']); run('plate-ornaments.mjs', ['--batch']); }, collect, sheet, verify, texts, render };
await actions[step]();
