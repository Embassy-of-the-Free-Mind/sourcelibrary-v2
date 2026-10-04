#!/usr/bin/env node
/**
 * latin-period-refs-5126.mjs — the batch driver for the Latin-print-by-century reference set (#5126, #4925).
 *
 * PRIOR ART: build-edition-refs.mjs — cuts and writes the reference window for ONE book from ONE edition
 * file, and is what this calls for every cut and every write (no second window cutter, no second record
 * writer). benchmark-refs.mjs searches open corpora for a sealed page's WORK; here the edition is known.
 * What neither has: (1) turning the three open same-edition transcription sources into edition files —
 * CAMENA TEI (github.com/nevenjovanovic/camena-neolatinlit, CC BY-SA 4.0), EEBO-TCP TEI (CC0) and
 * la.wikisource proofread `Pagina:` pages (CC BY-SA 4.0) — and (2) the per-book loop: seeded draw of 8,
 * middle accepted page, the leaf-check worklist, and stamping the by-eye verdict into the record.
 * The #5488 run did the same loop by hand for EEBO-TCP; this is that loop, kept.
 *
 *   node --env-file=.env.production.local scripts/eval/latin-period-refs-5126.mjs --stage=<s> --work=<dir>
 *
 *   editions   candidates.jsonl → <work>/editions/<key>.txt (+ .pb.json page-break offsets). CAMENA needs
 *              --camena=<clone of the mirror>; TCP and Wikisource are fetched.
 *   draw       per candidate: build-edition-refs --draw=8 --seed=5126 (report only; the same permutation read further if none is accepted), then the accepted
 *              pages in page order, middle first → <work>/worklist.json, and the page images for the check.
 *   write      reads <work>/leaf-check.json (by-eye verdicts) and, for each accepted row, runs build-edition-refs
 *              --pages=<n> --write, then stamps leaf_check + same-edition evidence into the record and
 *              publishes the (openly licensed) text beside it. Two kinds have no window to cut and are
 *              written whole: a transcription PAGE located on our leaf by eye (books with no stored OCR),
 *              and the #5695 T1 transcriptions corrected against the image (`corrected-served-ocr`).
 *
 * Candidates (results/latin-period-5126/candidates.jsonl) are pairs already shown to be the same text by
 * the stored OCR of ≥ 2–3 pages; `same_edition` says how the EDITION was established: `page-breaks`
 * (the transcription's page breaks fall where our pages break), `catalogue-number` (STC/Wing), or
 * `same-text` (established on the leaf by eye, or refused there).
 *
 * Never writes to Mongo. Makes no model call.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { cleanPageText } from './lib/wikisource-text.mjs';
import { writePrivateRef, privateRefsDir, sha256 } from './lib/private-refs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const STAGE = args.stage, WORK = args.work, SEED = 5126;
const RES = path.join(__dirname, 'results', 'latin-period-5126');
const REFS = path.join(__dirname, 'benchmark', 'refs');
const CANDS = path.join(RES, 'candidates.jsonl');
const MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (MAIN && (!STAGE || !WORK)) { console.error('required: --stage=editions|draw|write --work=<dir>'); process.exit(1); }
const UA = { 'User-Agent': 'SourceLibraryEval/1.0 (https://sourcelibrary.org)' };
const readJsonl = f => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const nat = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const shortId = id => String(id).replace(/[^0-9a-z]/gi, '');

// ── edition files ────────────────────────────────────────────────────────────
const ent = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
// TEI → printed text + the character offset of every page break. Where the markup records the printed
// form beside a regularised one (<reg orig>, <corr sic>) the PRINTED form is kept: the page is the truth.
export function flattenTei(xml, kind) {
  let t = xml.replace(/^[\s\S]*?<\/teiHeader>/i, '');
  t = t.replace(/<reg\b[^>]*\borig="([^"]*)"[^>]*>[\s\S]*?<\/reg>/g, (_, o) => o).replace(/<corr\b[^>]*\bsic="([^"]*)"[^>]*>[\s\S]*?<\/corr>/g, (_, o) => o);
  // TCP: an end-of-line hyphen is layout; a <gap> is a span the keyer could not read (it counts against
  // every engine alike, as in #5488); a figure description is not printed text.
  if (kind === 'tcp') t = t.replace(/<g ref="char:EOL(?:un)?hyphen"\s*\/>/g, '').replace(/<gap\b[^>]*>[\s\S]*?<\/gap>/g, ' ').replace(/<gap\b[^>]*\/>/g, ' ').replace(/<figDesc>[\s\S]*?<\/figDesc>/g, ' ');
  t = t.replace(/<pb\b[^>]*\/?>/g, '\n\u0001\n');
  t = t.replace(/<(?:l|p|head|lb|div\d?|note|lg|item|row|sp|salute|closer|opener|trailer)\b[^>]*>/g, '\n').replace(/<[^>]+>/g, '');
  t = ent(t).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n');
  let text = ''; const pbs = [];
  for (const [i, part] of t.split('\u0001').entries()) { if (i > 0) pbs.push(text.length); text += part; }
  return { text, pbs };
}

async function wsApi(params) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch('https://la.wikisource.org/w/api.php', { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ format: 'json', formatversion: '2', ...params }), signal: AbortSignal.timeout(40000) });
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 2000 * (i + 1)));
  }
  throw new Error('la.wikisource API failed');
}
// Proofread (quality ≥ 3) pages only: quality 1 is the uploader's raw OCR, not a transcription.
export async function wikisourceEdition(liber) {
  const file = liber.replace(/^Liber:/, ''); const titles = []; let cont = {};
  do {
    const j = await wsApi({ action: 'query', generator: 'allpages', gapnamespace: '104', gapprefix: file + '/', gaplimit: '500', prop: 'proofread', ...cont });
    for (const p of j.query?.pages || []) if ((p.proofread?.quality ?? 0) >= 3) titles.push(p.title);
    cont = j.continue || null;
  } while (cont);
  titles.sort(nat);
  let text = ''; const pbs = [], ids = [];
  for (let i = 0; i < titles.length; i += 40) {
    const j = await wsApi({ action: 'query', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main', titles: titles.slice(i, i + 40).join('|') });
    const by = Object.fromEntries(j.query.pages.map(p => [p.title, p]));
    for (const t of titles.slice(i, i + 40)) {
      const rev = by[t]?.revisions?.[0]; if (!rev) continue;
      const clean = cleanPageText(rev.slots.main.content);
      if ((clean.match(/\p{L}/gu) || []).length < 200) continue;
      pbs.push(text.length); ids.push({ title: t, revid: rev.revid }); text += clean.trim() + '\n';
    }
  }
  return { text, pbs, ids };
}

async function stageEditions() {
  const dir = path.join(WORK, 'editions'); fs.mkdirSync(dir, { recursive: true });
  for (const c of readJsonl(CANDS)) {
    const fp = path.join(dir, `${c.key}.txt`); if (fs.existsSync(fp)) continue;
    let ed;
    if (c.source === 'CAMENA') {
      if (!args.camena) throw new Error('--camena=<clone of nevenjovanovic/camena-neolatinlit> required');
      let text = ''; const pbs = [];
      for (const f of [...c.source_files].sort((a, b) => (/_front/.test(b) - /_front/.test(a)) || nat(a, b))) {
        const r = flattenTei(fs.readFileSync(path.join(args.camena, f), 'utf8'), 'camena');
        pbs.push(text.length, ...r.pbs.map(x => x + text.length)); text += r.text + '\n';
      }
      ed = { text, pbs };
    } else if (c.source === 'EEBO-TCP') {
      const r = await fetch(`https://raw.githubusercontent.com/textcreationpartnership/${c.source_id}/master/${c.source_id}.xml`, { headers: UA });
      if (!r.ok) { console.log(`! ${c.key}: TCP fetch ${r.status}`); continue; }
      ed = flattenTei(await r.text(), 'tcp');
    } else if (c.source === 'la.wikisource') {
      ed = await wikisourceEdition(c.source_id);
      fs.writeFileSync(path.join(dir, `${c.key}.ids.json`), JSON.stringify(ed.ids));
    } else { console.log(`! ${c.key}: unknown source ${c.source}`); continue; }
    fs.writeFileSync(fp, ed.text); fs.writeFileSync(path.join(dir, `${c.key}.pb.json`), JSON.stringify(ed.pbs));
    console.log(`${c.key}: ${ed.text.length} chars, ${ed.pbs.length} page breaks`);
  }
}

// ── draw ─────────────────────────────────────────────────────────────────────
const LICENCE = { CAMENA: 'CC-BY-SA-4.0', 'EEBO-TCP': 'CC0-1.0', 'la.wikisource': 'CC-BY-SA-4.0' };
function metaFor(c) {
  return {
    source: c.source === 'la.wikisource' ? `la.wikisource ${c.source_id}` : `${c.source} ${c.source_id}`,
    edition: `${c.source_title} — ${c.source_bibl}`.slice(0, 300), licence: LICENCE[c.source], kind: 'same-edition-transcription',
    canonical: !!c.canonical, memorization_risk: c.canonical ? 'high' : 'low', acquired: 'open e-text, fetched 2026-10-04',
    source_url: c.source_url || null, same_edition: c.same_edition,
  };
}
function runBuilder(c, extra) {
  const metaPath = path.join(WORK, 'meta', `${c.key}.json`); fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(metaFor(c)));
  execFileSync(process.execPath, [path.join(__dirname, 'build-edition-refs.mjs'), `--book=${c.book_id}`, `--edition=${path.join(WORK, 'editions', `${c.key}.txt`)}`, '--script=latin', `--meta=${metaPath}`, ...extra], { stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
  const report = path.join(__dirname, 'results', 'edition-refs', `${shortId(c.book_id)}.json`);
  const j = JSON.parse(fs.readFileSync(report, 'utf8')); fs.unlinkSync(report);   // packed into one file below (PR file limit)
  return j;
}
async function stageDraw() {
  const { MongoClient } = await import('mongodb');
  const client = await MongoClient.connect(process.env.MONGODB_URI); const db = client.db('bookstore');
  const outP = path.join(WORK, 'worklist.json'); const work = fs.existsSync(outP) ? JSON.parse(fs.readFileSync(outP, 'utf8')) : {};
  fs.mkdirSync(path.join(WORK, 'check'), { recursive: true });
  for (const c of readJsonl(CANDS)) {
    if (work[c.book_id]) continue;
    if (!fs.existsSync(path.join(WORK, 'editions', `${c.key}.txt`))) { work[c.book_id] = { key: c.key, skipped: 'no-edition-file' }; continue; }
    // The draw is a seeded permutation of the OCR'd pages; --draw=N takes its first N. A transcription that
    // covers only part of a book (Wikisource proofreads a few dozen leaves; some of our books have OCR on 25
    // pages) can miss all of the first 8, so the SAME permutation is read further — 8, 24, 72, all — and the
    // first prefix with an accepted page is used. Fixed before any page was looked at.
    let rep, ok = [], drawN = null;
    try { for (const n of [8, 24, 72, 100000]) { rep = runBuilder(c, [`--draw=${n}`, `--seed=${SEED}`]); ok = rep.rows.filter(r => !r.skipped).sort((a, b) => a.page - b.page); drawN = n; if (ok.length) break; } }
    catch (e) { work[c.book_id] = { key: c.key, skipped: 'builder-failed: ' + String(e.message).slice(0, 80) }; continue; }
    // middle accepted page first, then outward: the order alternates are tried in if the leaf check refuses one
    const mid = Math.floor(ok.length / 2); const order = ok.map((r, i) => ({ r, d: Math.abs(i - mid) })).sort((a, b) => a.d - b.d || a.r.page - b.r.page).map(x => x.r);
    work[c.book_id] = { key: c.key, source: c.source, book_year: c.book_year, title: rep.summary.title, draw_n: drawN, drawn: rep.rows.map(r => ({ page: r.page, skipped: r.skipped || null, overlap: r.overlap ?? null, engine: r.engine ?? null })), order: order.map(r => r.page) };
    for (const pn of order.slice(0, 2)) {
      const pg = await db.collection('pages').findOne({ book_id: c.book_id, page_number: pn }, { projection: { photo: 1, 'ocr.data': 1 } });
      work[c.book_id][`photo_${pn}`] = pg?.photo || null;
    }
    fs.writeFileSync(outP, JSON.stringify(work, null, 1));
    console.log(`${c.key} ${c.book_id}: ${ok.length}/8 accepted, order ${order.map(r => r.page).join(',') || '—'}`);
  }
  fs.writeFileSync(outP, JSON.stringify(work, null, 1));
  await client.close();
}

// ── write ────────────────────────────────────────────────────────────────────
// Every source here is openly licensed, so the text is published beside its record (as the EEBO-TCP
// references are). build-edition-refs always writes through the private store; this moves it over.
function publish(slug, patch) {
  const recP = path.join(REFS, `${slug}.json`); const rec = JSON.parse(fs.readFileSync(recP, 'utf8'));
  const priv = path.join(privateRefsDir(), `${slug}.txt`); const text = fs.readFileSync(priv, 'utf8');
  if (sha256(text) !== rec.text_sha256) throw new Error(`${slug}: text does not match its record`);
  fs.writeFileSync(path.join(REFS, `${slug}.txt`), text); fs.unlinkSync(priv);
  fs.writeFileSync(recP, JSON.stringify({ ...rec, ...patch, text_location: 'repo', stratum: 'latin-period-5126' }, null, 2) + '\n');
}
const leafCheck = row => ({ status: 'ok', by: row.checker || 'model-eye', at: row.at, note: row.note, leaf_language: row.leaf_language || 'lat', page_type: row.page_type || null, abbreviations: row.abbreviations || null, human_spot_check: null });
// The T1 corrected transcriptions (#5695, PR #5721) carry the OCR's tags; the reference is the text.
const stripOcrTags = t => t.replace(/<(scan-quality|language|script|page-type|page-num|columns|meta|image-desc|warning)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<\/?[a-z-]+>/gi, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
function stageWrite() {
  if (!process.env.SL_PRIVATE_REFS_DIR) throw new Error('set SL_PRIVATE_REFS_DIR to a scratch dir: the builder writes there and this stage publishes from it');
  const checks = JSON.parse(fs.readFileSync(path.join(WORK, 'leaf-check.json'), 'utf8')).rows;
  const cands = Object.fromEntries(readJsonl(CANDS).map(c => [c.book_id, c]));
  const packed = [];
  for (const row of checks.filter(r => r.accepted)) {
    const c = cands[row.book_id]; if (!c) { console.log(`! ${row.book_id}: not a candidate`); continue; }
    const slug = `ed-${shortId(c.book_id)}-p${row.page}`;
    if (c.same_edition === 'page-unit-by-eye' || c.source === 'xlref-t1') {
      // No window to cut: the reference is a whole transcribed page that a reader placed on our leaf
      // (a book with no stored OCR), or a transcription corrected against the image in #5695 T1.
      const text = c.source === 'xlref-t1' ? stripOcrTags(fs.readFileSync(path.join(__dirname, c.source_file), 'utf8')) : fs.readFileSync(path.join(WORK, 'noocr', `${c.book_id}.target.txt`), 'utf8').replace(/^.*\|\d+px\s*$/gm, '').trim();
      const meta = c.source === 'xlref-t1'
        ? { source: 'xlref-t1 corrected transcription', edition: 'the served OCR of this leaf, corrected against the image (#5695 T1, PR #5721)', licence: 'CC0-1.0', kind: 'corrected-served-ocr', canonical: !!c.canonical, memorization_risk: c.canonical ? 'high' : 'low', anchored_on: c.anchored_on, source_url: c.source_file }
        : metaFor(c);
      writePrivateRef(REFS, slug, text, { ...meta, origin: 'library', book_id: c.book_id, page_number: row.page, script: 'latin', reference_kind: meta.kind,
        window: c.source === 'xlref-t1' ? null : { unit: 'transcription-page', page_break_index: row.target_pb, probe: 'none (located by eye)' }, reference_error_rate: null, built_by: 'latin-period-refs-5126.mjs', built_at: new Date().toISOString() });
    } else {
      const rep = runBuilder(c, [`--pages=${row.page}`, '--write']);
      packed.push({ book_id: c.book_id, key: c.key, ...rep });
      if (!fs.existsSync(path.join(REFS, `${slug}.json`))) { console.log(`! ${slug}: builder refused the page at write time (${rep.rows[0]?.skipped})`); continue; }
    }
    publish(slug, { leaf_check: leafCheck(row), same_edition: { evidence: c.same_edition, text_match_pages: c.text_match_pages ?? null, pb_aligned_pages: c.pb_aligned ?? null } });
    console.log(`${slug}: written`);
  }
  fs.mkdirSync(RES, { recursive: true });
  fs.writeFileSync(path.join(RES, 'edition-refs-written.jsonl'), packed.map(p => JSON.stringify(p)).join('\n') + '\n');
}

if (!MAIN) { /* imported for flattenTei / wikisourceEdition */ }
else if (STAGE === 'editions') await stageEditions();
else if (STAGE === 'draw') await stageDraw();
else if (STAGE === 'write') stageWrite();
else { console.error(`unknown stage ${STAGE}`); process.exit(1); }
