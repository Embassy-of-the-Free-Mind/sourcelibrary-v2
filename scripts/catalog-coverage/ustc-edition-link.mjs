#!/usr/bin/env node
/**
 * Link live early-printed books to their USTC EDITION (books.ustc_id = USTC sn),
 * judged against our own title-page text. Three stages, each a separate run:
 *
 *   propose  loads our copy of USTC (Supabase ustc_editions, 1449–1701) over a
 *            DIRECT Postgres connection (SUPABASE_DB_URL), then for each book takes
 *            the editions printed within ±1 year of it that share its author's
 *            surname or rare title words. Top candidates → JSONL. No writes.
 *   judge    claude -p --model sonnet (subscription) reads our record + the OCR of
 *            the first leaves beside each candidate's imprint, printer, place,
 *            format and pagination, and returns same_edition / other_edition /
 *            different_work / unsure. JSONL. No writes.
 *   apply    writes ustc_id + ustc_match + field_provenance.ustc_id and one
 *            sweep_log row per book, ONLY for same_edition verdicts whose sn is a
 *            proposed candidate and whose USTC year is within ±1. Dry run unless
 *            --apply. Backup of every before-state.
 *
 * Why not backfill-ustc-matches.mjs / matchToUstc(): they query ustc_editions over
 * the REST API, whose statement timeout fires under load and is caught as "no
 * match" (half of a 200-book pilot came back empty), and they accept a record
 * anywhere in ±20 years on 50% title overlap — the right WORK, often another
 * EDITION — written unjudged.
 *
 * PRIOR ART: scripts/catalog-coverage/backfill-ustc-matches.mjs — REST timeouts read as no-match, ±20-year window, unjudged writes; scripts/translation-layer/lib.mjs titleFit — work-level, not edition-level.
 *
 * Usage (on a box with SUPABASE_DB_URL; the main box has it):
 *   node --env-file=.env.production.local scripts/catalog-coverage/ustc-edition-link.mjs propose --sample 200 --out p.jsonl
 *   node --env-file=.env.production.local scripts/catalog-coverage/ustc-edition-link.mjs propose --all --out p.jsonl
 *   node --env-file=.env.production.local scripts/catalog-coverage/ustc-edition-link.mjs judge --in p.jsonl --out j.jsonl [--conc 4]
 *   node --env-file=.env.production.local scripts/catalog-coverage/ustc-edition-link.mjs apply --in j.jsonl [--apply]
 *
 * Issue: #7761 (edition identity for the USTC coverage count, #7751).
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const [, , STAGE, ...rest] = process.argv;
const arg = (k, d = null) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d; };
const flag = (k) => rest.includes(`--${k}`);
const OUT = arg('out'), IN = arg('in'), CONC = +arg('conc', 4);
const RUN = 'ustc-edition-link-7761';
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI required'); process.exit(1); }

// USTC is European print: these are the languages it catalogues; manuscripts are out.
const LANGS = ['Latin', 'German', 'de', 'French', 'Italian', 'Greek', 'Hebrew', 'English', 'Dutch', 'Spanish', 'Portuguese',
  'Polish', 'Czech', 'Danish', 'Swedish', 'Hungarian', 'Icelandic', 'Catalan', 'Croatian', 'Slovenian', 'Ancient Greek', 'Welsh'];
const SCOPE = {
  visible: true, pages_count: { $gt: 0 }, language: { $in: LANGS },
  'image_source.provider': { $nin: ['heidelberg', 'vatican'] },
  $and: [
    { $or: [{ year: { $gte: 1450, $lte: 1700 } }, { published: { $gte: 1450, $lte: 1700 } }] },
    { $or: [{ ustc_id: { $exists: false } }, { ustc_id: null }] },
  ],
};
const yearOf = (b) => { for (const v of [b.year, b.published]) { const m = String(v ?? '').match(/\b(1[4-7]\d\d)\b/); if (m) return +m[1]; } return null; };
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

// Early-modern spelling folds: diacritics off, u/v and i/j merged, letters only.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/v/g, 'u').replace(/j/g, 'i').replace(/[^a-z\s]/g, ' ');
const STOP = new Set('cum quae quod qui quibus atque etiam sive item nunc primum nova noua nouum libri liber libro tomus tome pars partes und oder der die das des dem den von vnd auff durch sampt ganz gantz eines einer einem neue neuw newe dans avec pour sont leur leurs plus della delle degli nella sopra libro libri como para nuevamente with from that this which their unto'.split(' ').map(fold));
const toks = (s) => [...new Set(fold(s).split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)))];
const surname = (a) => { const s = fold(String(a ?? '').split(/[,(]/)[0]).trim().split(/\s+/); return s.length ? s[s.length - 1] : ''; };
const surnameOfBook = (a) => { if (!a) return ''; const raw = String(a); return raw.includes(',') ? surname(raw) : (fold(raw).trim().split(/\s+/).filter((w) => w.length > 2).pop() || ''); };

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore'); const books = db.collection('books');

if (STAGE === 'propose') {
  if (!process.env.SUPABASE_DB_URL) { console.error('SUPABASE_DB_URL required (direct Postgres; the REST API times out on ustc_editions)'); process.exit(1); }
  const pg = (await import('pg')).default;
  const pc = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL }); await pc.connect();
  await pc.query('SET statement_timeout = 0');
  const t0 = Date.now();
  const { rows: E } = await pc.query(`SELECT sn, author_1, title, imprint, place, printer_1, year, format, pagination, language_1, work_cluster_id
    FROM ustc_editions WHERE year BETWEEN 1449 AND 1701 AND sn IS NOT NULL`);
  await pc.end();
  console.log(`ustc editions 1449–1701: ${E.length} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  // Per-year indexes: surname → rows, title token → rows; document frequency for rarity.
  const byYear = new Map(), df = new Map();
  for (let i = 0; i < E.length; i++) {
    const e = E[i]; e._t = toks(e.title); e._s = surname(e.author_1);
    let Y = byYear.get(e.year); if (!Y) byYear.set(e.year, Y = { sur: new Map(), tok: new Map() });
    if (e._s) (Y.sur.get(e._s) || Y.sur.set(e._s, []).get(e._s)).push(i);
    for (const w of e._t) { (Y.tok.get(w) || Y.tok.set(w, []).get(w)).push(i); df.set(w, (df.get(w) || 0) + 1); }
  }
  const idf = (w) => Math.log(E.length / (1 + (df.get(w) || 0)));
  const proj = { id: 1, title: 1, original_title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, published_place: 1, published_location: 1, publisher: 1, pages_count: 1, 'image_source.provider': 1 };
  const rows = flag('all')
    ? await books.find(SCOPE, { projection: proj }).toArray()
    : await books.aggregate([{ $match: SCOPE }, { $sample: { size: +arg('sample', 200) } }, { $project: proj }]).toArray();
  const out = fs.createWriteStream(OUT);
  let withC = 0;
  for (const b of rows) {
    const y = yearOf(b), sur = surnameOfBook(b.author);
    const bt = toks([b.original_title, b.title].filter(Boolean).join(' ')).filter((w) => idf(w) > 4); // ~ < 25K editions
    const wsum = bt.reduce((a, w) => a + idf(w), 0) || 1;
    const score = new Map();
    for (let yy = y - 1; yy <= y + 1; yy++) {
      const Y = byYear.get(yy); if (!Y) continue;
      const hit = new Set(sur ? Y.sur.get(sur) || [] : []);
      for (const w of bt) for (const i of Y.tok.get(w) || []) hit.add(i);
      for (const i of hit) {
        const e = E[i]; const shared = e._t.filter((w) => bt.includes(w));
        const t = shared.reduce((a, w) => a + idf(w), 0) / wsum;
        const s = t + (sur && e._s === sur ? 0.35 : 0) - (yy === y ? 0 : 0.05);
        if (s >= 0.4) score.set(i, s);
      }
    }
    const candidates = [...score.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 5)
      .map(([i, s]) => { const { _t, _s, ...e } = E[i]; return { ...e, score: +s.toFixed(3) }; });
    if (candidates.length) withC++;
    out.write(JSON.stringify({ book_id: b.id, title: b.title, original_title: b.original_title ?? null, author: b.author ?? null, year: y,
      place: b.published_place || b.published_location || null, publisher: b.publisher ?? null, pages_count: b.pages_count,
      provider: b.image_source?.provider ?? null, language: b.language, candidates }) + '\n');
  }
  out.end();
  console.log(`books ${rows.length} · with candidates ${withC}`);
}

async function pageText(id) {
  // Scans often open with binding, endpapers and blanks: take the first five leaves
  // (of the first twelve) that carry real text, so the title page is usually among them.
  const ps = await db.collection('pages').find({ book_id: id, page_number: { $lte: 12 } }, { projection: { page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  const texty = ps.filter((p) => String(p.ocr?.data ?? '').replace(/\s+/g, '').length >= 60).slice(0, 5);
  if (!texty.length) return '(no OCR text on the first twelve leaves)';
  return texty.map((p) => `--- leaf ${p.page_number} ---\n${String(p.ocr.data).slice(0, 1200)}`).join('\n');
}
function claude(prompt) {
  return new Promise((res) => {
    // Subscription only: an ANTHROPIC_API_KEY from the env file would route the CLI to the paid API.
    const env = { ...process.env }; delete env.ANTHROPIC_API_KEY;
    const p = spawn('claude', ['-p', '--model', 'sonnet', '--output-format', 'text', '--disallowedTools', 'Bash,Edit,Write,Read,WebFetch,WebSearch,Task'], { stdio: ['pipe', 'pipe', 'pipe'], env });
    let out = ''; p.stdout.on('data', (d) => { out += d; }); p.on('close', () => res(out));
    const t = setTimeout(() => p.kill('SIGTERM'), 180000); p.on('close', () => clearTimeout(t));
    p.stdin.end(prompt);
  });
}
const JUDGE = `You decide whether a scanned book is a SPECIFIC printed edition recorded in the USTC catalogue.
An edition = one printing: same text, same printer/publisher, same place, same year (allow ±1 for dating conventions).
A reprint by another printer, another year, or another city is a DIFFERENT edition even if the title is identical.
Evidence: our catalogue record and the OCR text of the first leaves (usually the title page with its imprint: place, printer, year).
Weigh the title-page imprint above our catalogue record.
If the OCR shows no imprint, decide from our record: USTC aims to list every edition, so when exactly ONE candidate is the same work by the same author within the year, answer same_edition (imprint_seen false). When two or more same-work candidates remain and nothing separates them (place, printer, volume, impression), answer unsure.
A volume can bind several works: if our title page names a different work than the candidate, answer different_work.
imprint_seen = true only if the OCR itself shows place, printer or year on a title page or colophon.
Answer with ONE line of JSON and nothing else:
{"verdict":"same_edition|other_edition|different_work|unsure","sn":<candidate sn or null>,"imprint_seen":true|false,"reason":"<= 25 words citing the imprint evidence"}`;

if (STAGE === 'judge') {
  const rows = readJsonl(IN).filter((r) => r.candidates?.length);
  const done = OUT && fs.existsSync(OUT) ? new Set(readJsonl(OUT).map((r) => r.book_id)) : new Set();
  const todo = rows.filter((r) => !done.has(r.book_id));
  console.log(`with candidates ${rows.length} · judged ${done.size} · to do ${todo.length}`);
  let k = 0;
  await pool(todo, CONC, async (r) => {
    const cands = r.candidates.map((c) => `sn ${c.sn} | ${c.author_1 ?? ''} | ${c.title} | imprint: ${c.imprint ?? ''} | place: ${c.place ?? ''} | printer: ${c.printer_1 ?? ''} | year: ${c.year} | ${c.format ?? ''} | ${c.pagination ?? ''}`).join('\n');
    const prompt = `${JUDGE}\n\nOUR BOOK\ntitle: ${r.title}\nauthor: ${r.author ?? ''}\nyear: ${r.year ?? ''}\nplace: ${r.place ?? ''}\npublisher: ${r.publisher ?? ''}\nleaves scanned: ${r.pages_count}\n\nFIRST LEAVES (OCR)\n${await pageText(r.book_id)}\n\nUSTC CANDIDATES\n${cands}`;
    const raw = await claude(prompt);
    let v = null; try { v = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? 'null'); } catch { /* unparsed */ }
    fs.appendFileSync(OUT, JSON.stringify({ book_id: r.book_id, verdict: v?.verdict ?? 'unparsed', sn: v?.sn ?? null, imprint_seen: v?.imprint_seen ?? null, reason: v?.reason ?? raw.slice(0, 200), candidates: r.candidates, year: r.year, title: r.title }) + '\n');
    if (++k % 10 === 0) console.log(`  ${k}/${todo.length}`);
  });
}

if (STAGE === 'apply') {
  const APPLY = flag('apply');
  const rows = readJsonl(IN).filter((r) => r.verdict === 'same_edition');
  const plan = [];
  for (const r of rows) {
    const c = r.candidates.find((x) => x.sn === r.sn);
    if (!c) { console.log(`  skip ${r.book_id}: sn ${r.sn} not among candidates`); continue; }
    if (r.year && Math.abs(c.year - r.year) > 1) { console.log(`  skip ${r.book_id}: USTC year ${c.year} vs ${r.year}`); continue; }
    plan.push({ r, c });
  }
  console.log(`same_edition ${rows.length} · planned ${plan.length} · ${APPLY ? 'APPLY' : 'dry run'}`);
  if (APPLY) {
    const backup = [];
    let n = 0, stale = 0;
    for (const { r, c } of plan) {
      const before = await books.findOne({ id: r.book_id }, { projection: { id: 1, ustc_id: 1, ustc_match: 1, 'field_provenance.ustc_id': 1 } });
      if (!before || before.ustc_id) { stale++; continue; }
      backup.push(before);
      const now = new Date();
      const match = { ustc_sn: c.sn, ustc_title: c.title, ustc_author: c.author_1, ustc_year: c.year, ustc_language: c.language_1, ustc_place: c.place, ustc_printer: c.printer_1,
        // high only when the judge read the imprint itself; title + author + year alone is medium.
        confidence: r.imprint_seen ? 'high' : 'medium', imprint_seen: !!r.imprint_seen, reasoning: r.reason, match_method: 'edition-judged', model: 'claude-sonnet (cli)', matched_at: now, run: RUN, cost_usd: 0 };
      const res = await books.updateOne({ id: r.book_id, $or: [{ ustc_id: { $exists: false } }, { ustc_id: null }] }, { $set: {
        ustc_id: c.sn, ustc_match: match,
        'field_provenance.ustc_id': { source: RUN, method: 'ustc_editions candidates (author|title, year ±1), sonnet-judged on title-page OCR vs USTC imprint', confidence: r.imprint_seen ? 'high' : 'medium', date: now },
      } });
      if (res.modifiedCount === 1) { n++; await recordSweepAction(db, { sweep: RUN, book_id: r.book_id, action: 'ustc-edition-linked', detail: { ustc_sn: c.sn, year: c.year, place: c.place, printer: c.printer_1 } }); }
    }
    const bf = `scripts/maintenance/backups/${RUN}-${Date.now()}.json`; fs.mkdirSync('scripts/maintenance/backups', { recursive: true });
    fs.writeFileSync(bf, JSON.stringify(backup));
    console.log(`written ${n} · stale ${stale} · backup ${bf}`);
  }
}
await client.close();
