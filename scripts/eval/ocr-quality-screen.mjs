#!/usr/bin/env node
/**
 * A free corpus-wide OCR screen, and a BLINDED stratified sampler to calibrate it.
 *
 * Two modes:
 *   --mode=score    score stored OCR text. No API calls, no models, no cost.
 *   --mode=sample   stratify those scores and emit a blinded review sheet + key.
 *
 * ── WHY A SCREEN AND A SEPARATE VERIFIER ──────────────────────────
 * Cross-model containment (`ocr-self-agreement.mjs`) is the instrument that
 * actually detects fabrication, but it costs 2-3 model calls per page and cannot
 * run over 6.2M pages. These metrics need only the text already in Mongo, so they
 * can screen everything; containment then confirms whatever they flag. A cheap
 * screen backed by an expensive verifier — rather than one proxy asked to do both
 * jobs, which is what went wrong earlier in this workstream.
 *
 * ── THE METRICS, AND WHAT EACH CAUGHT ─────────────────────────────
 *   script_purity   share of letters in the language's EXPECTED script. Catches
 *                   the flagship model leaking its reasoning into the
 *                   transcription — an observed pro output on a Hebrew page read
 *                   "…This means the text flows from the LEFT page to the RIGHT
 *                   page! Wait, Hebrew books ope". A Hebrew page whose OCR is 40%
 *                   Latin is broken whatever it says.
 *   compress_ratio  gzip(text)/len. Detects repetition loops WITHOUT the 120-word
 *                   floor that let short Tibetan loops pass undetected as
 *                   "not degenerate".
 *   type_token      unique/total tokens; character trigrams on space-less scripts,
 *                   which whitespace tokenizing collapses to one giant token.
 *   len_z           page length against its own book's median — a page that is 10x
 *                   its neighbours is usually a loop, one that is 1/10 a refusal.
 *
 * No composite score is emitted on purpose. Each metric fails differently and a
 * single number would hide which one fired; the sampler stratifies on whichever
 * column you name.
 *
 * ── WHY THE SAMPLER IS BLINDED ────────────────────────────────────
 * A reviewer shown a flag will find something wrong with the page. The review
 * sheet therefore carries NO scores and is shuffled; the key is written to a
 * separate file. And sampling is EQUAL PER DECILE, not proportional: at a ~2%
 * base rate a random draw of 100 pages contains ~2 failures and teaches nothing
 * about the failure region. Re-weight by decile volume afterwards to recover
 * corpus-wide rates.
 *
 * Known-good control pages are mixed in (`--controls`). If a reviewer marks those
 * bad, the REVIEW is miscalibrated, not the corpus.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ocr-quality-screen.mjs --mode=score  [--books=400] [--scope=revised|all]
 *   node scripts/eval/ocr-quality-screen.mjs --mode=sample --metric=script_purity --per-decile=8
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { once } from 'node:events';
import { MongoClient } from 'mongodb';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const MODE = args.mode || 'score';
const OUT = args.out || 'scripts/output/ocr-screen';
const BOOK_LIMIT = parseInt(args.books || '0');       // 0 = all in scope
const SCOPE = args.scope || 'revised';
const CHUNK = 20;

// ── expected script per language ─────────────────────────────────
// Only languages whose script is unambiguous. Anything unmapped is scored
// null rather than guessed — an unscored page is honest, a wrongly-scored one
// pollutes the calibration it exists to produce.
const SCRIPTS = {
  hebrew: /\p{Script=Hebrew}/u, yiddish: /\p{Script=Hebrew}/u, aramaic: /\p{Script=Hebrew}/u,
  tibetan: /\p{Script=Tibetan}/u, arabic: /\p{Script=Arabic}/u, persian: /\p{Script=Arabic}/u,
  ottoman: /\p{Script=Arabic}/u, urdu: /\p{Script=Arabic}/u,
  sanskrit: /\p{Script=Devanagari}/u, hindi: /\p{Script=Devanagari}/u, marathi: /\p{Script=Devanagari}/u,
  greek: /\p{Script=Greek}/u, 'ancient greek': /\p{Script=Greek}/u,
  russian: /\p{Script=Cyrillic}/u, bulgarian: /\p{Script=Cyrillic}/u, serbian: /\p{Script=Cyrillic}/u,
  chinese: /[\p{Script=Han}]/u, 'classical chinese': /[\p{Script=Han}]/u,
  japanese: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  korean: /[\p{Script=Hangul}\p{Script=Han}]/u,
  armenian: /\p{Script=Armenian}/u, georgian: /\p{Script=Georgian}/u,
  syriac: /\p{Script=Syriac}/u, coptic: /\p{Script=Coptic}/u, "ge'ez": /\p{Script=Ethiopic}/u,
  thai: /\p{Script=Thai}/u, burmese: /\p{Script=Myanmar}/u, telugu: /\p{Script=Telugu}/u,
  punjabi: /\p{Script=Gurmukhi}/u, tamil: /\p{Script=Tamil}/u,
};
for (const l of ['latin', 'german', 'english', 'french', 'italian', 'dutch', 'spanish',
  'portuguese', 'danish', 'swedish', 'polish', 'czech', 'old english', 'middle english',
  'middle high german', 'occitan', 'old norse']) SCRIPTS[l] = /\p{Script=Latin}/u;

const WRAPPERS = 'meta|summary|keywords|vocab|language|scan-quality|script|page-type|columns|warning|image-desc';
const strip = t => (t || '')
  .replace(new RegExp(`<(${WRAPPERS})[^>]*>[\\s\\S]*?</\\1>`, 'gi'), '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]{2,8};|&#\d+;/gi, ' ');
const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}]/u;

function screen(rawText, lang) {
  const t = strip(rawText).replace(/\s+/g, ' ').trim();
  if (t.length < 20) return null;                     // nothing to score
  const letters = [...t].filter(c => /\p{L}/u.test(c));

  // script purity — null when the language has no unambiguous script
  const re = SCRIPTS[(lang || '').trim().toLowerCase()];
  let purity = null, latinLeak = null;
  if (re && letters.length) {
    purity = letters.filter(c => re.test(c)).length / letters.length;
    if (re.source !== /\p{Script=Latin}/u.source) {
      latinLeak = letters.filter(c => /\p{Script=Latin}/u.test(c)).length / letters.length;
    }
  }
  // compression — a looping page compresses far better than prose
  const compress = zlib.gzipSync(Buffer.from(t, 'utf8')).length / Buffer.byteLength(t, 'utf8');

  // type/token — character trigrams where there are no word delimiters
  let spaceless = 0;
  for (const c of letters.slice(0, 1500)) if (SPACELESS.test(c)) spaceless++;
  const isSpaceless = letters.length && spaceless / Math.min(letters.length, 1500) > 0.3;
  let toks;
  if (isSpaceless) {
    const ch = letters.map(c => c.toLowerCase());
    toks = []; for (let i = 0; i + 3 <= ch.length; i++) toks.push(ch.slice(i, i + 3).join(''));
  } else {
    toks = t.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(x => x.length > 1);
  }
  const ttr = toks.length ? new Set(toks).size / toks.length : null;
  return {
    chars: t.length, tokens: toks.length,
    script_purity: purity == null ? null : +purity.toFixed(4),
    latin_leak: latinLeak == null ? null : +latinLeak.toFixed(4),
    compress_ratio: +compress.toFixed(4),
    type_token: ttr == null ? null : +ttr.toFixed(4),
    spaceless: isSpaceless,
  };
}

const csvEsc = v => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

async function scoreMode() {
  fs.mkdirSync(OUT, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 120000, heartbeatFrequencyMS: 30000,
    socketTimeoutMS: 600000, retryReads: true,
  });
  await client.connect();
  const db = client.db('bookstore');

  let filter = { pages_ocr: { $gt: 0 } };
  if (SCOPE === 'revised') {
    const ids = await db.collection('page_revisions').distinct('book_id', { field: 'ocr' });
    filter = { $or: [{ id: { $in: ids } }, { _id: { $in: ids.filter(x => x && x.length === 24) } }] };
  }
  const books = await db.collection('books').find(filter,
    { projection: { id: 1, title: 1, slug: 1, language: 1 } })
    .sort({ _id: 1 }).limit(BOOK_LIMIT || 0).toArray();
  console.log(`scoring ${books.length.toLocaleString()} books (scope=${SCOPE})`);

  const file = path.join(OUT, 'scores.csv');
  const cols = ['page_id', 'book_id', 'book', 'slug', 'language', 'page_number', 'chars', 'tokens',
    'script_purity', 'latin_leak', 'compress_ratio', 'type_token', 'spaceless', 'len_ratio_to_book'];
  const out = fs.createWriteStream(file);
  out.write(cols.join(',') + '\n');
  let n = 0, scored = 0;
  for (let i = 0; i < books.length; i += CHUNK) {
    const chunk = books.slice(i, i + CHUNK);
    const keys = chunk.flatMap(b => [b.id, String(b._id)].filter(Boolean));
    const meta = new Map();
    for (const b of chunk) for (const k of [b.id, String(b._id)]) if (k) meta.set(k, b);
    const pages = await db.collection('pages').find(
      { book_id: { $in: keys }, 'ocr.data': { $type: 'string' } },
      { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1 } },
    ).toArray();
    // per-book median length, so len_ratio compares a page to its OWN book
    const byBook = new Map();
    const rows = [];
    for (const p of pages) {
      const b = meta.get(p.book_id); if (!b) continue;
      const s = screen(p.ocr.data, b.language);
      if (!s) continue;
      rows.push({ p, b, s });
      if (!byBook.has(p.book_id)) byBook.set(p.book_id, []);
      byBook.get(p.book_id).push(s.chars);
    }
    const med = new Map();
    for (const [k, v] of byBook) { const a = v.sort((x, y) => x - y); med.set(k, a[Math.floor(a.length / 2)] || 1); }
    for (const { p, b, s } of rows) {
      const r = {
        page_id: p.id, book_id: p.book_id, book: b.title, slug: b.slug, language: b.language,
        page_number: p.page_number, ...s,
        len_ratio_to_book: +(s.chars / (med.get(p.book_id) || 1)).toFixed(3),
      };
      if (!out.write(cols.map(c => csvEsc(r[c])).join(',') + '\n')) await once(out, 'drain');
      scored++;
    }
    n += chunk.length;
    if (n % 200 < CHUNK) console.log(`  ${n}/${books.length} books · ${scored.toLocaleString()} pages scored`);
  }
  await new Promise(r => out.end(r));
  await client.close();
  console.log(`\n  → ${file}  (${scored.toLocaleString()} pages)`);
}

async function sampleMode() {
  const METRIC = args.metric || 'script_purity';
  const PER = parseInt(args['per-decile'] || '8');
  const CONTROLS = parseInt(args.controls || '10');
  const file = path.join(OUT, 'scores.csv');
  if (!fs.existsSync(file)) { console.error(`no ${file} — run --mode=score first`); process.exit(1); }

  const rows = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let hdr = null, ix = null;
  const parse = l => { const o = []; let c = '', q = false;
    for (let i = 0; i < l.length; i++) { const ch = l[i];
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { o.push(c); c = ''; } else c += ch; }
    o.push(c); return o; };
  for await (const line of rl) {
    if (!hdr) { hdr = parse(line); ix = n => hdr.indexOf(n); continue; }
    if (!line.trim()) continue;
    const r = parse(line); if (r.length !== hdr.length) continue;
    const v = parseFloat(r[ix(METRIC)]);
    if (!Number.isFinite(v)) continue;                 // unscored on this metric
    rows.push({ page_id: r[ix('page_id')], book: r[ix('book')], slug: r[ix('slug')],
      language: r[ix('language')], page_number: r[ix('page_number')], value: v });
  }
  if (!rows.length) { console.error(`no rows with a numeric ${METRIC}`); process.exit(1); }
  rows.sort((a, b) => a.value - b.value);
  console.log(`${rows.length.toLocaleString()} scored pages · stratifying on ${METRIC}`);

  // EQUAL per decile, deliberately — proportional sampling would put almost
  // nothing in the failure region, which is the region we need to calibrate.
  const picked = [];
  const per = Math.ceil(rows.length / 10);
  for (let d = 0; d < 10; d++) {
    const band = rows.slice(d * per, (d + 1) * per);
    if (!band.length) continue;
    const step = Math.max(1, Math.floor(band.length / PER));
    for (let i = 0, k = 0; i < band.length && k < PER; i += step, k++) {
      picked.push({ ...band[i], decile: d + 1, role: 'sample' });
    }
    console.log(`  decile ${String(d + 1).padStart(2)}  ${METRIC} ${band[0].value.toFixed(3)}–${band[band.length - 1].value.toFixed(3)}  n=${band.length}`);
  }
  // Controls: the top decile is the known-good band. A reviewer marking these
  // bad indicts the review, not the corpus.
  const top = rows.slice(9 * per);
  for (let i = 0; i < Math.min(CONTROLS, top.length); i++) {
    picked.push({ ...top[Math.floor(i * top.length / CONTROLS)], decile: 10, role: 'control' });
  }

  // Deterministic shuffle so the sheet is reproducible but not ordered by score.
  let seed = 20260805;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = picked.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [picked[i], picked[j]] = [picked[j], picked[i]]; }

  fs.mkdirSync(OUT, { recursive: true });
  const sheet = path.join(OUT, 'review-sheet.csv');
  const key = path.join(OUT, 'review-key.csv');
  // The sheet carries NO score and NO decile. That is the blinding.
  const sc = ['review_id', 'language', 'book', 'page_number', 'url', 'verdict', 'notes'];
  const kc = ['review_id', 'page_id', 'decile', 'role', METRIC];
  const sOut = [sc.join(',')], kOut = [kc.join(',')];
  picked.forEach((p, i) => {
    const id = `R${String(i + 1).padStart(4, '0')}`;
    sOut.push([id, p.language, p.book, p.page_number,
      p.slug ? `https://sourcelibrary.org/book/${p.slug}/page/${p.page_id}` : '', '', ''].map(csvEsc).join(','));
    kOut.push([id, p.page_id, p.decile, p.role, p.value].map(csvEsc).join(','));
  });
  fs.writeFileSync(sheet, sOut.join('\n') + '\n');
  fs.writeFileSync(key, kOut.join('\n') + '\n');

  // Volunteer queue. Feeds the EXISTING page-check system unchanged:
  //   node scripts/maintenance/build-page-check-candidates.mjs --file <this> --apply
  // Blinding survives for free — a volunteer sees a URL and a question, never a
  // score — but only if the prompt is identical for every page. A prompt that
  // said "we think this page is broken" would leak the decile and turn the
  // calibration into a confirmation.
  //
  // The prompt asks for the ONE judgement a reader can make without the source
  // to hand: does the transcription correspond to the image in front of them.
  // It deliberately does not ask "is this good OCR" — that invites a quality
  // rating, and the thing being measured is correspondence, not quality.
  const tasks = picked.map((p, i) => ({
    item_id: `ocr-screen:${p.page_id}`,
    url: p.slug ? `https://sourcelibrary.org/book/${p.slug}/page/${p.page_id}` : '',
    label: `page ${p.page_number} of ${p.book}`,
    campaign: 'OCR spot check',
    prompt: 'Compare the scanned image with the transcribed text beside it. Does the text '
      + 'actually match what is printed or written on the page? Say if it is fine, if it is '
      + 'garbled, if it looks fluent but bears no relation to the image, or if the page is '
      + 'blank. If you cannot read the script, say that — it is a useful answer.',
  })).filter(t => t.url);
  const tasksFile = path.join(OUT, 'volunteer-tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));
  console.log(`\n  → ${sheet}  ${picked.length} pages, shuffled, no scores shown`);
  console.log(`  → ${tasksFile}  ${tasks.length} tasks for the volunteer page-check queue`);
  console.log(`     node scripts/maintenance/build-page-check-candidates.mjs --file ${tasksFile} --apply`);
  console.log(`  → ${key}  (do not open before reviewing)`);
  console.log(`\n  verdict column: good | garbled | fabricated | blank | unsure`);
  console.log(`  After review, join on review_id to get the calibration curve.`);
  console.log(`  Re-weight by decile volume for corpus-wide rates — the sample is`);
  console.log(`  equal-per-decile, so raw percentages overstate the failure rate.`);
}

(MODE === 'sample' ? sampleMode() : scoreMode()).catch(e => { console.error(e); process.exit(1); });
