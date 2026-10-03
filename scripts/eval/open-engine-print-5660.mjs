#!/usr/bin/env node
// PRIOR ART: benchmark-seal.mjs (exports a SEALED stratum's images — used as is for eebo-tcp-5488; it
// cannot export english-ia-5124, whose registry is the #5216 `rows` shape), benchmark-score.mjs and
// benchmark-cost-lane.mjs (score and decide — used as is, with a --cells option added), the #5600
// fleet's paddle-zh-runpod.sh / paddle-zh-box.sh `arm` (the GPU run — used as is). None assembles one
// bench root across ten existing strata from four registries and fixes the per-cell page membership
// that PREREGISTRATION-open-engine-print-5660.md defines; this is that glue, nothing else.
/**
 * open-engine-print-5660.mjs — glue for the #5660 step-2 eval (open engine vs flash-lite on print).
 *
 *   node scripts/eval/open-engine-print-5660.mjs assemble --root=/root/ocr-bench-5660 --lane=/root/paddle-latin-5660
 *       hard-links the existing strata's images (/root/ocr-bench/images), copies their lite / lite-b /
 *       flash-preview outputs, exports english-ia-5124's referenced pages, writes the cell map
 *       (results/open-engine-print-5660/cells.json) and the Paddle manifest (<lane>/bench/acc.tsv).
 *       eebo-tcp-5488's images come from `benchmark-seal.mjs --stratum=eebo-tcp-5488 --out=<root>` first.
 *   node scripts/eval/open-engine-print-5660.mjs paddle-in --root=… --lane=… --arm=<arm> [--engine=paddleocr-vl-1.6]
 *       copies the pulled arm's page outputs into <root>/<stratum>/out/<engine>/<slug>.txt.
 *   node scripts/eval/open-engine-print-5660.mjs tally --root=…
 *       the descriptive long-s / abbreviation / ligature tally of the prereg, per engine, on early print.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const CMD = process.argv[2];
const ROOT = argOf('root', '/root/ocr-bench-5660');
const LANE = argOf('lane', '/root/paddle-latin-5660');
const SRC = argOf('src', '/root/ocr-bench/images');
const RES = path.join(__dirname, 'results', 'open-engine-print-5660');
const REFS = path.join(__dirname, 'benchmark', 'refs');
const ARMS = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-b', 'gemini-3-flash-preview'];
const COPIED = ['greek', 'greek-ext', 'greek-ext2', 'ref-ws', 'latin-pre1700', 'latin-1700s', 'german-fraktur', 'longs-en-fr'];
const AGREEMENT = ['latin-pre1700', 'latin-1700s', 'german-fraktur', 'longs-en-fr'];
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const latest = st => { const d = path.join(__dirname, 'results', 'benchmark'); const f = fs.readdirSync(d).filter(x => x.startsWith(`${st}-`) && x.slice(st.length + 1).match(/^\d{4}-\d{2}-\d{2}\.json$/)).sort().pop(); return readJson(path.join(d, f)); };

function link(src, dst) { if (!fs.existsSync(dst)) { try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); } } }

async function exportEnglish() {
  const reg = readJson(path.join(__dirname, 'benchmark', 'english-ia-5124.json'));
  const dir = path.join(ROOT, 'english-ia-5124'); fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  const sharp = (await import('sharp')).default;
  const manifest = [];
  for (const r of reg.rows.filter(r => r.reference && !r.excluded)) {
    const dest = path.join(dir, `${r.slug}.jpg`);
    if (fs.existsSync(dest)) { manifest.push({ slug: r.slug, cached: true }); continue; }
    try {
      const res = await fetch(r.image_url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let buf = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buf).metadata();   // same rule as benchmark-seal.mjs: width ≤ 2400, JPEG q92
      if (meta.width > 2400) buf = await sharp(buf).resize({ width: 2400 }).jpeg({ quality: 92 }).toBuffer();
      else if (meta.format !== 'jpeg') buf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
      fs.writeFileSync(dest, buf); manifest.push({ slug: r.slug, width: Math.min(2400, meta.width), bytes: buf.length });
    } catch (e) { manifest.push({ slug: r.slug, error: e.message.slice(0, 100) }); console.log(`  ! ${r.slug}: ${e.message.slice(0, 100)}`); }
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ stratum: 'english-ia-5124', exported_at: new Date().toISOString(), pages: manifest }, null, 2));
  console.log(`english-ia-5124: ${manifest.filter(m => !m.error).length} images`);
}

/** The prereg's cell membership, page by page. */
function cells() {
  const out = [];
  const refRec = s => { const f = path.join(REFS, `${s}.json`); return fs.existsSync(f) ? readJson(f) : null; };
  // EEBO-TCP (#5488): sealed, leaf-checked, library books
  for (const p of readJson(path.join(__dirname, 'benchmark', 'eebo-tcp-5488.json')).pages.filter(p => !p.spare || p.promoted)) {
    const cell = p.language === 'Latin' && p.year >= 1500 && p.year < 1700 ? 'latin-1500-1699' : p.language === 'English' && p.year >= 1600 && p.year < 1700 ? 'english-1600-1699' : null;
    out.push({ slug: p.slug, stratum: 'eebo-tcp-5488', cell, origin: 'library', book_id: p.book_id, year: p.year, language: p.language, ...(cell ? {} : { excluded: 'EEBO English 1500s — reported apart' }) });
  }
  // #5216 English references
  for (const r of readJson(path.join(__dirname, 'benchmark', 'english-ia-5124.json')).rows.filter(r => r.reference && !r.excluded)) {
    const rec = refRec(r.slug); const y = r.catalogue?.published;
    const bad = rec?.reference_error ? `reference_error: ${String(rec.reference_error).slice(0, 80)}` : (rec?.leaf_check?.status && rec.leaf_check.status !== 'ok') ? `leaf_check ${rec.leaf_check.status}` : null;
    const cell = bad ? null : y >= 1600 && y < 1700 ? 'english-1600-1699' : y >= 1700 ? 'english-1700+' : null;
    out.push({ slug: r.slug, stratum: 'english-ia-5124', cell, origin: 'library', book_id: r.book_id, year: y, language: 'English', ...(cell ? {} : { excluded: bad || `catalogue year ${y}` }) });
  }
  // Wikisource scans (external)
  for (const p of latest('ref-ws').pages) {
    const y = p.year; let cell = null;
    if (p.language === 'Latin') cell = y >= 1500 && y < 1700 ? 'latin-1500-1699' : y >= 1700 ? 'latin-1700+' : null;
    else if (p.language === 'German') cell = 'german';
    if (p.language === 'Greek') continue;   // Greek is decided on the library Greek strata
    out.push({ slug: p.slug, stratum: 'ref-ws', cell, origin: 'external', book_id: null, work: p.slug.replace(/-p\d+$/, ''), year: y, language: p.language, ...(cell ? {} : { excluded: `year ${y}` }) });
  }
  // Greek print (library): by-eye typeset-print, greek_share ≥ 0.5, referenced
  for (const st of ['greek', 'greek-ext', 'greek-ext2']) for (const p of latest(st).pages.filter(p => p.has_ref)) {
    const ok = p.script_class === 'typeset-print' && (typeof p.greek_share !== 'number' || p.greek_share >= 0.5);
    out.push({ slug: p.slug, stratum: st, cell: ok ? 'greek-print' : null, origin: 'library', year: p.year, language: 'Greek', ...(ok ? {} : { excluded: `script_class ${p.script_class}, greek_share ${p.greek_share}` }) });
  }
  // one page per book across strata: a second page of a book already in the cell is excluded
  const seen = new Set();
  for (const r of out) { if (!r.cell || !r.book_id) continue; const k = `${r.cell}|${r.book_id}`; if (seen.has(k)) { r.excluded = 'second page of a book in this cell'; r.cell = null; } else seen.add(k); }
  return out;
}

async function assemble() {
  fs.mkdirSync(ROOT, { recursive: true });
  for (const st of COPIED) {
    const s = path.join(SRC, st), d = path.join(ROOT, st);
    fs.mkdirSync(path.join(d, 'out'), { recursive: true });
    for (const f of fs.readdirSync(s).filter(f => f.endsWith('.jpg'))) link(path.join(s, f), path.join(d, f));
    fs.copyFileSync(path.join(s, 'manifest.json'), path.join(d, 'manifest.json'));
    for (const e of ARMS) if (fs.existsSync(path.join(s, 'out', e))) fs.cpSync(path.join(s, 'out', e), path.join(d, 'out', e), { recursive: true });
    if (st.startsWith('greek')) {   // the by-eye classes the Greek cell membership is read from
      fs.mkdirSync(path.join(d, 'out', 'script-class'), { recursive: true });
      const sc = path.join(__dirname, 'benchmark', 'script-class');
      for (const f of fs.readdirSync(sc).filter(f => f.startsWith(`${st}-`) && f.endsWith('.json') && !(st === 'greek-ext' && f.startsWith('greek-ext2-')))) fs.copyFileSync(path.join(sc, f), path.join(d, 'out', 'script-class', f));
    }
  }
  if (!fs.existsSync(path.join(ROOT, 'eebo-tcp-5488', 'manifest.json'))) throw new Error('export eebo-tcp-5488 first: benchmark-seal.mjs --stratum=eebo-tcp-5488 --out=' + ROOT);
  fs.mkdirSync(path.join(ROOT, 'eebo-tcp-5488', 'out'), { recursive: true });
  await exportEnglish();
  const c = cells();
  fs.mkdirSync(RES, { recursive: true });
  const n = {}; for (const r of c) if (r.cell) { n[r.cell] ||= { pages: 0, library: 0, external: 0 }; n[r.cell].pages++; n[r.cell][r.origin]++; }
  fs.writeFileSync(path.join(RES, 'cells.json'), JSON.stringify({ prereg: 'PREREGISTRATION-open-engine-print-5660.md', written_at: new Date().toISOString(), counts: n, agreement_strata: AGREEMENT, pages: c }, null, 1) + '\n');
  console.log(n);
  // the Paddle manifest: every image in every stratum (cells + agreement strata), one row each
  const img = path.join(LANE, 'bench', 'img', '_bench'); fs.mkdirSync(img, { recursive: true });
  const rows = [], where = {};
  for (const st of fs.readdirSync(ROOT).filter(d => fs.existsSync(path.join(ROOT, d, 'manifest.json')))) {
    for (const f of fs.readdirSync(path.join(ROOT, st)).filter(f => f.endsWith('.jpg')).sort()) {
      const slug = f.slice(0, -4);
      if (where[slug]) throw new Error(`slug ${slug} in ${where[slug]} and ${st}`);
      where[slug] = st; link(path.join(ROOT, st, f), path.join(img, f)); rows.push(`_bench\t${slug}\timg/_bench/${f}`);
    }
  }
  fs.writeFileSync(path.join(LANE, 'bench', 'acc.tsv'), rows.join('\n') + '\n');
  fs.writeFileSync(path.join(LANE, 'bench', 'tput.tsv'), rows.slice(0, 16).join('\n') + '\n');   // warm-up (discarded)
  fs.writeFileSync(path.join(LANE, 'bench', 'where.json'), JSON.stringify(where));
  console.log(`manifest: ${rows.length} pages → ${path.join(LANE, 'bench', 'acc.tsv')}`);
}

function paddleIn() {
  const arm = argOf('arm'), engine = argOf('engine', 'paddleocr-vl-1.6');
  const where = readJson(path.join(LANE, 'bench', 'where.json'));
  const src = path.join(LANE, 'bench', 'arms', arm, 'out', '_bench');
  let n = 0, err = 0;
  for (const [slug, st] of Object.entries(where)) {
    const d = path.join(ROOT, st, 'out', engine); fs.mkdirSync(d, { recursive: true });
    if (fs.existsSync(path.join(src, `${slug}.txt`))) { fs.copyFileSync(path.join(src, `${slug}.txt`), path.join(d, `${slug}.txt`)); n++; }
    else if (fs.existsSync(path.join(src, `${slug}.err`))) { fs.writeFileSync(path.join(d, `${slug}.txt`), ''); err++; }   // a failed read is an empty output, never a missing one
  }
  console.log(`${engine}: ${n} outputs, ${err} errors written as empty`);
}

/** Descriptive weak-spot tally (#4877) per engine on the early-print strata. */
function tally() {
  const STRATA = ['eebo-tcp-5488', 'ref-ws', 'latin-pre1700', 'longs-en-fr', 'german-fraktur'];
  const ws = new Map(latest('ref-ws').pages.map(p => [p.slug, p]));
  const words = t => (t.normalize('NFC').toLowerCase().match(/[\p{L}ſ]+/gu) || []);
  const res = {};
  for (const st of STRATA) {
    const dir = path.join(ROOT, st, 'out'); if (!fs.existsSync(dir)) continue;
    const engines = fs.readdirSync(dir).filter(e => ARMS.includes(e) || e.startsWith('paddle') || e.startsWith('olm'));
    for (const e of engines) {
      const R = (res[e] ||= {});
      const T = (R[st] ||= { pages: 0, long_s_glyph: 0, f_for_s: 0, abbrev_marks: 0, ligature_glyphs: 0, ref_long_s_glyph: 0, ref_abbrev_marks: 0 });
      for (const f of fs.readdirSync(path.join(dir, e)).filter(f => f.endsWith('.txt'))) {
        const slug = f.slice(0, -4);
        if (st === 'ref-ws' && !(ws.get(slug)?.year < 1700)) continue;   // early print only
        const t = fs.readFileSync(path.join(dir, e, f), 'utf8'); T.pages++;
        T.long_s_glyph += (t.match(/ſ/g) || []).length;
        T.abbrev_marks += (t.normalize('NFC').match(/[āēīōūǣ̄ꝑꝓꝗꝙꝯꝫ̃ẽõũ]|q;/gu) || []).length;
        T.ligature_glyphs += (t.match(/[æœßﬀﬁﬂﬃﬄﬅﬆ]/g) || []).length;
        const rf = path.join(REFS, `${slug}.txt`);
        if (fs.existsSync(rf)) {
          const ref = fs.readFileSync(rf, 'utf8'); const refSet = new Set(words(ref).map(w => w.replace(/ſ/g, 's')));
          T.ref_long_s_glyph += (ref.match(/ſ/g) || []).length; T.ref_abbrev_marks += (ref.normalize('NFC').match(/[āēīōūǣ̄ꝑꝓꝗꝙꝯꝫ̃ẽõũ]|q;/gu) || []).length;
          // f-for-s: an output word that is NOT in the reference but becomes a reference word when its f's are read as s
          for (const w of words(t)) if (w.includes('f') && !refSet.has(w.replace(/ſ/g, 's')) && refSet.has(w.replace(/f/g, 's'))) T.f_for_s++;
        }
      }
    }
  }
  fs.mkdirSync(RES, { recursive: true });
  fs.writeFileSync(path.join(RES, 'weak-spots.json'), JSON.stringify({ note: 'descriptive only (prereg); f_for_s counted only where a reference exists; ref_* are the reference text\'s own counts (EEBO-TCP keeps ſ; Wikisource often normalises it)', engines: res }, null, 1) + '\n');
  console.log(JSON.stringify(res, null, 1));
}

if (CMD === 'assemble') await assemble();
else if (CMD === 'paddle-in') paddleIn();
else if (CMD === 'tally') tally();
else { console.error('usage: assemble | paddle-in --arm=<arm> | tally'); process.exit(1); }
