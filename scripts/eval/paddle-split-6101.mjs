#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/cbeta-ref-6101.mjs (#6101 — the frame, the sealed 200, the bench trees, the `nolabel` filter and
 * the book-cluster report; reused here, its tree read in place), scripts/lib/gutter-detect.mjs (the spread splitter
 * split-book.mjs uses, called as is, with split-book's 3 % overlap), scripts/gpu/paddle-zh-run.py (the Paddle runner,
 * `--layout 0|1`, run unchanged on gex45). None crops NDL's label strip or reads a spread as two leaves in vertical order.
 *
 * #6101 follow-up — PaddleOCR-VL on SPLIT leaves (prereg: scripts/eval/PREREGISTRATION-paddle-split-6101.md).
 * Every text this writes (engine outputs, CBETA) stays under --dir on Hetzner; the repo gets scores and counts only.
 *
 *   prep      --set=shared|fail   crop each spread above NDL's ruler + label strip (detected per image), split at the
 *             gutter, write <dir>/split/leaves/<slug>-{R,L}.jpg and <dir>/split/manifest-<set>.tsv for paddle-zh-run.py
 *             (<slug>\t<R|L>\tleaves/<file>), plus split/prep-<set>.json (crop row, gutter, confidence per page).
 *   assemble  --arm=<name> --from=<dir with out/<slug>/{R,L}.txt>  → bench tree <dir>/bench-split (stored P0/L/F from
 *             bench-nolabel, the new arm as R + "\n" + L with the same label-line filter), for benchmark-score.mjs.
 *   report    → the preregistered table from the scorer's per-page rows (+ the descriptive failure-set table).
 *
 *   node scripts/eval/paddle-split-6101.mjs prep --set=shared [--dir=/root/cbeta-ref-6101]
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { detectGutterPixel } from '../lib/gutter-detect.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const CMD = process.argv[2];
const DIR = argOf('dir', '/root/cbeta-ref-6101');
const SPLIT = path.join(DIR, 'split');
const STRATUM = 'chinese-print-cbeta';
const OVERLAP = 0.03;   // split-book.mjs default (#1491 lesson 6: 1 % clipped tight gutters)
const SEED = 6101;
const LABEL_LINE = /国立国会図書館|國立國會圖書館|請求記号|ガラス使用/;   // cbeta-ref-6101.mjs `nolabel`, unchanged
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const latest = (dir, st) => readJson(path.join(dir, fs.readdirSync(dir).filter(x => new RegExp(`^${st}-\\d{4}-\\d{2}-\\d{2}\\.json$`).test(x)).sort().at(-1)));

/** The 198 shared pages: sealed, referenced, not a misfit, and every #6101 engine answered. */
function sharedSlugs() {
  const d = latest(path.join(DIR, 'scored-nolabel'), STRATUM);
  return d.pages.filter(p => p.has_ref && !p.ref_mismatch && !Object.values(p.engines).some(e => e.refused)).map(p => p.slug);
}
/** #6101's every-page Paddle failures (CER > 0.5 or misfit, < 30 chars on a text page, or timeout), as committed on PR #6139. */
const p0Rows = () => fs.readFileSync(argOf('p0-all', path.join(DIR, 'split', 'p0-all-nolabel.jsonl')), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const isFail = r => r.misfit_or_cat || r.failed_no_text || r.timeout;
function failRows() { return p0Rows().filter(isFail); }
// bench-all slugs carry `-all-`; the image file in <dir>/img does not
const imgOf = slug => path.join(DIR, 'img', `${slug.replace(`${STRATUM}-all-`, `${STRATUM}-`)}.jpg`);

/**
 * NDL photographs each volume over a ruler with a white label strip below it, both spanning the full image width,
 * while the background either side of the book is mid grey. The crop row is the top of the ruler band, measured in the
 * two outer 3 % edge strips (background there, never book): per row, the share of edge PIXELS ≥ 20 grey levels above
 * the background (the edge median at 55–70 % of the height). Per pixel, not per row mean, because the ruler's tick marks
 * and numerals pull a row mean down (a first, mean-based version missed 4 of 198 rulers). A ruler row has ≥ 60 % bright
 * edge pixels; the band starts at the first row below 55 % of the height with ≥ 10 such rows in the next 16, and is
 * then walked up while ≥ 30 % stay bright (the ruler's top edge carries the ticks). Not found → null (uncropped, counted).
 */
async function rulerTop(buf) {
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info; const e = Math.max(4, Math.round(w * 0.03));
  const y0 = Math.round(h * 0.55), y1 = Math.round(h * 0.70);
  const edge = []; for (let y = y0; y < y1; y++) for (const x0 of [0, w - e]) for (let x = x0; x < x0 + e; x++) edge.push(data[y * w + x]);
  edge.sort((a, b) => a - b); const bg = edge[edge.length >> 1];
  const frac = y => { let k = 0; for (const x0 of [0, w - e]) for (let x = x0; x < x0 + e; x++) if (data[y * w + x] >= bg + 20) k++; return k / (2 * e); };
  const F = []; for (let y = 0; y < h; y++) F.push(y < y0 ? 0 : frac(y));
  for (let y = y0; y < h - 16; y++) {
    if (F[y] < 0.6) continue;
    let k = 0; for (let j = 0; j < 16; j++) if (F[y + j] >= 0.6) k++;
    if (k < 10) continue;
    let top = y; while (top > y0 && F[top - 1] >= 0.3) top--;
    return { row: top, h, bg };
  }
  return { row: null, h, bg };
}

async function prep() {
  const set = argOf('set', 'shared');
  // frame: every WOODBLOCK page #6101's Paddle pass read (1,883), minus the pages already split for `shared` / `fail`
  const done = () => new Set(['shared', 'fail'].flatMap(s => { const f = path.join(SPLIT, `prep-${s}.json`); return fs.existsSync(f) ? readJson(f).map(r => r.slug) : []; }));
  const slugs = set === 'shared' ? sharedSlugs() : set === 'fail' ? failRows().map(r => r.slug)
    : (d => p0Rows().filter(r => r.class === 'woodblock' && !d.has(r.slug)).map(r => r.slug))(done());
  const leaves = path.join(SPLIT, 'leaves'); fs.mkdirSync(leaves, { recursive: true });
  const man = [], rows = [];
  for (const slug of slugs) {
    const src = fs.readFileSync(imgOf(slug));
    const meta = await sharp(src).metadata();
    const r = await rulerTop(src);
    const cropH = r.row != null ? Math.max(1, r.row - 4) : meta.height;
    const body = await sharp(src).extract({ left: 0, top: 0, width: meta.width, height: cropH }).jpeg({ quality: 92 }).toBuffer();
    const g = await detectGutterPixel(body);
    let col = g.column, how = `pixel-${g.confidence}`;
    if (col == null || g.confidence !== 'high') {
      // a gap centre outside the central 35–65 % is a blank facing page's margin, not the gutter (9e6d1d-p55 cut at 25 %)
      const gc = g.gap ? (g.gap.start + g.gap.end) / 2000 : null;
      if (gc != null && gc >= 0.35 && gc <= 0.65) { col = Math.round(gc * meta.width); how = 'gap-centre'; }
      else { col = Math.round(meta.width / 2); how = 'image-centre'; }
    }
    const f = col / meta.width;
    const leftEnd = Math.round(Math.min(1, f + OVERLAP) * meta.width), rightStart = Math.round(Math.max(0, f - OVERLAP) * meta.width);
    await sharp(body).extract({ left: rightStart, top: 0, width: meta.width - rightStart, height: cropH }).jpeg({ quality: 92 }).toFile(path.join(leaves, `${slug}-R.jpg`));
    await sharp(body).extract({ left: 0, top: 0, width: leftEnd, height: cropH }).jpeg({ quality: 92 }).toFile(path.join(leaves, `${slug}-L.jpg`));
    man.push(`${slug}\tR\tleaves/${slug}-R.jpg`, `${slug}\tL\tleaves/${slug}-L.jpg`);
    rows.push({ slug, w: meta.width, h: meta.height, ruler_row: r.row, crop_h: cropH, cropped_frac: Math.round((1 - cropH / meta.height) * 1000) / 1000, gutter: col, gutter_frac: Math.round(f * 1000) / 1000, gutter_how: how, reason: g.reason });
  }
  fs.writeFileSync(path.join(SPLIT, `manifest-${set}.tsv`), man.join('\n') + '\n');
  fs.writeFileSync(path.join(SPLIT, `prep-${set}.json`), JSON.stringify(rows, null, 1));
  const c = k => rows.filter(x => x.gutter_how === k).length;
  console.log(`prep ${set}: ${rows.length} spreads → ${man.length} leaves; ruler not found ${rows.filter(x => x.ruler_row == null).length}; gutter high ${c('pixel-high')}, gap-centre ${c('gap-centre')}, image-centre ${c('image-centre')}; cropped median ${rows.map(x => x.cropped_frac).sort((a, b) => a - b)[rows.length >> 1]}`);
  // the by-eye check: 10 random pairs side by side, small, for opening
  const rnd = mulberry32(SEED); const pick = [...rows].map(x => [rnd(), x]).sort((a, b) => a[0] - b[0]).slice(0, 10).map(x => x[1]);
  const eye = path.join(SPLIT, `eye-${set}`); fs.mkdirSync(eye, { recursive: true });
  for (const p of pick) {
    const [R, L] = await Promise.all(['R', 'L'].map(s => sharp(path.join(leaves, `${p.slug}-${s}.jpg`)).resize({ height: 700 }).toBuffer({ resolveWithObject: true })));
    // right leaf shown on the RIGHT, as on the spread, with a 20 px red bar between
    await sharp({ create: { width: L.info.width + R.info.width + 20, height: 700, channels: 3, background: '#c00' } })
      .composite([{ input: L.data, left: 0, top: 0 }, { input: R.data, left: L.info.width + 20, top: 0 }]).jpeg({ quality: 80 }).toFile(path.join(eye, `${p.slug}.jpg`));
  }
  console.log(`eye check: ${pick.map(p => p.slug).join(' ')} → ${eye}`);
}

function assemble() {
  const arm = argOf('arm'); const from = argOf('from'); if (!arm || !from) throw new Error('--arm and --from required');
  const st = argOf('stratum', STRATUM);
  const src = path.join(DIR, st === STRATUM ? 'bench-nolabel' : 'bench-all-nolabel', st), dst = path.join(DIR, st === STRATUM ? 'bench-split' : 'bench-all-split', st);
  fs.mkdirSync(path.join(dst, 'out'), { recursive: true });
  for (const f of fs.readdirSync(src).filter(f => f.endsWith('.jpg') || f === 'manifest.json')) if (!fs.existsSync(path.join(dst, f))) fs.symlinkSync(fs.realpathSync(path.join(src, f)), path.join(dst, f));
  for (const e of fs.readdirSync(path.join(src, 'out'))) if (!fs.existsSync(path.join(dst, 'out', e))) fs.symlinkSync(path.join(src, 'out', e), path.join(dst, 'out', e));
  const out = path.join(dst, 'out', arm); fs.mkdirSync(out, { recursive: true });
  let n = 0, missing = 0, errs = 0, dedup = 0;
  const DEDUP = process.argv.includes('--dedup-join');
  const han = s => [...s].filter(c => /[\p{Script=Han}〇]/u.test(c)).join('');
  const lev = (a, b) => { let p = [...Array(b.length + 1).keys()]; for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c.push(Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] !== b[j - 1]))); p = c; } return p[b.length]; };
  for (const slug of fs.readdirSync(path.join(from, 'out'))) {
    const leaf = s => { const t = path.join(from, 'out', slug, `${s}.txt`); if (fs.existsSync(t)) return fs.readFileSync(t, 'utf8'); if (fs.existsSync(path.join(from, 'out', slug, `${s}.err`))) errs++; else missing++; return ''; };
    const r = leaf('R'), l = leaf('L');
    let lLines = l.split('\n');
    if (DEDUP) {   // sensitivity, not preregistered: the inner column of a tight gutter lands in BOTH leaves (3 % overlap)
      const rl = r.split('\n').filter(x => han(x).length >= 4).at(-1), li = lLines.findIndex(x => han(x).length >= 4);
      if (rl && li >= 0) { const a = han(rl), b = han(lLines[li]); if (1 - lev(a, b) / Math.max(a.length, b.length) >= 0.7) { lLines.splice(li, 1); dedup++; } }
    }
    const text = [r, lLines.join('\n')].join('\n').split('\n').filter(x => !LABEL_LINE.test(x)).join('\n');
    const name = st === STRATUM ? slug : slug.replace(`${STRATUM}-`, `${st}-`);   // bench-all slugs carry `-all-`
    fs.writeFileSync(path.join(out, `${name}.txt`), text); n++;
  }
  console.log(`assemble ${arm}: ${n} pages → ${out} (leaf errors/timeouts ${errs}, leaves missing ${missing}${DEDUP ? `, join duplicates dropped ${dedup}` : ''})`);
}

// ── report ─────────────────────────────────────────────────────────────────────────────────────
const median = xs => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r3 = x => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
function wilson(k, n, z = 1.96) { if (!n) return null; const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [r3(c - h), r3(c + h)]; }
function clusterCI(rows, stat, seed = SEED, B = 2000) {   // cbeta-ref-6101.mjs, unchanged: resample BOOKS, keep their pages
  const books = [...new Set(rows.map(r => r.book))]; const by = new Map(books.map(b => [b, rows.filter(r => r.book === b)]));
  const rnd = mulberry32(seed); const vals = [];
  for (let i = 0; i < B; i++) { const s = []; for (let j = 0; j < books.length; j++) s.push(...by.get(books[Math.floor(rnd() * books.length)])); const v = stat(s); if (v != null) vals.push(v); }
  vals.sort((a, b) => a - b); return vals.length ? [r3(vals[Math.floor(0.025 * vals.length)]), r3(vals[Math.floor(0.975 * vals.length)])] : null;
}

function report() {
  const ARMS = { P0: 'paddleocr-vl-1.6', L: 'gemini-3.1-flash-lite', F: 'gemini-3-flash-preview', P1: 'paddle-split-p1', P2: 'paddle-split-p2', P1d: 'paddle-split-p1-dedup' };
  const frame = readJson(path.join(DIR, 'frame.json')); const bookOf = new Map(frame.pages.map(p => [p.slug, p.book_id]));
  const d = latest(path.join(DIR, 'scored-split'), STRATUM);
  const shared = new Set(sharedSlugs());
  const cerOf = (p, e) => { const x = p.engines[e]; if (!x) return null; return x.cer == null ? 1 : x.cer; };   // empty read → CER 1.0
  const rows = d.pages.filter(p => shared.has(p.slug)).map(p => ({ slug: p.slug, book: bookOf.get(p.slug), cls: p.script_class, ...Object.fromEntries(Object.entries(ARMS).map(([k, e]) => [k, cerOf(p, e)])), inv: Object.fromEntries(Object.entries(ARMS).map(([k, e]) => [k, p.engines[e]?.invention_ref ?? null])), loop: Object.fromEntries(Object.entries(ARMS).map(([k, e]) => [k, !!p.engines[e]?.loop])) }));
  const arms = Object.keys(ARMS).filter(k => rows.every(r => r[k] != null));
  const block = rs => {
    const o = { n: rs.length, n_books: new Set(rs.map(r => r.book)).size, arms: {} };
    for (const k of arms) {
      const cat = rs.filter(r => r[k] > 0.5).length;
      o.arms[k] = { engine: ARMS[k], median_cer: r3(median(rs.map(r => r[k]))), median_cer_ci95: clusterCI(rs, s => median(s.map(r => r[k]))), catastrophic: cat, catastrophic_rate: r3(cat / rs.length), catastrophic_ci95: wilson(cat, rs.length), invention_ref_median: r3(median(rs.map(r => r.inv[k]).filter(x => x != null))), loops: rs.filter(r => r.loop[k]).length };
      for (const b of ['L', 'F']) if (k !== b) {
        const dd = rs.map(r => r[k] - r[b]);
        o.arms[k][`delta_vs_${b}`] = { median: r3(median(dd)), ci95: clusterCI(rs, s => median(s.map(r => r[k] - r[b]))), wlt: [dd.filter(x => x < 0).length, dd.filter(x => x > 0).length, dd.filter(x => x === 0).length] };
      }
    }
    return o;
  };
  const verdict = o => {
    const v = {};
    for (const k of ['P1', 'P2'].filter(k => o.arms[k])) {
      const a = o.arms[k], catOk = a.catastrophic_rate <= o.arms.L.catastrophic_rate + 0.02, dOk = a.delta_vs_L.ci95[1] <= 0.010;
      v[k] = { catastrophic_ok: catOk, delta_vs_L_ok: dOk, adopt_grade: catOk && dOk, better_than_flash: a.delta_vs_F.ci95[1] < 0 };
    }
    return v;
  };
  const res = { issue: 6101, prereg: 'scripts/eval/PREREGISTRATION-paddle-split-6101.md', scored: d.summary.date, scoring: 'benchmark-score.mjs, Han only, CBETA fitted to the page; every arm through the #6101 nolabel filter; empty read = CER 1.0', all: block(rows), woodblock: block(rows.filter(r => r.cls === 'woodblock')), typeset: block(rows.filter(r => r.cls === 'typeset')) };
  res.verdict = { all: verdict(res.all), woodblock: verdict(res.woodblock) };
  res.pages = rows.map(r => ({ slug: r.slug, cls: r.cls, ...Object.fromEntries(arms.map(k => [k, r3(r[k])])) }));
  const OUT = path.join(__dirname, 'results', 'paddle-split-6101'); fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'shared-198.json'), JSON.stringify(res, null, 1));
  for (const [name, o] of [['all', res.all], ['woodblock', res.woodblock], ['typeset', res.typeset]]) {
    console.log(`\n### ${name} (n = ${o.n} pages, ${o.n_books} books)\n| arm | median CER [95 % CI] | catastrophic | Δ vs L [CI] (W/L/T) | Δ vs F [CI] | inv_ref | loops |\n|---|---|---|---|---|---|---|`);
    for (const k of arms) { const a = o.arms[k]; console.log(`| ${k} | ${a.median_cer} [${a.median_cer_ci95}] | ${a.catastrophic} = ${(a.catastrophic_rate * 100).toFixed(1)} % [${a.catastrophic_ci95.map(x => (x * 100).toFixed(1))}] | ${a.delta_vs_L ? `${a.delta_vs_L.median} [${a.delta_vs_L.ci95}] (${a.delta_vs_L.wlt.join('/')})` : '—'} | ${a.delta_vs_F ? `${a.delta_vs_F.median} [${a.delta_vs_F.ci95}]` : '—'} | ${a.invention_ref_median} | ${a.loops} |`); }
  }
  console.log('\nverdict', JSON.stringify(res.verdict));
}

/**
 * DESCRIPTIVE, not preregistered as a test: #6101's every-page Paddle failures re-read with P1. Kind from P0 (as in the
 * #6101 write-up): timeout; label-only/empty (< 30 chars on a text page); spread order (CER > 0.5 at length ratio
 * 0.8–1.25); one leaf dropped (length ratio 0.3–0.7); other. Fixed = P1 reads ≥ 30 characters at CER ≤ 0.5.
 */
function failreport() {
  const d = latest(path.join(DIR, 'scored-all-split'), `${STRATUM}-all`); const by = new Map(d.pages.map(p => [p.slug, p]));
  const P0 = 'paddleocr-vl-1.6', P1 = argOf('arm', 'paddle-split-p1');
  const kindOf = (r, e) => r.timeout ? 'timeout' : r.failed_no_text ? 'label-only/empty' : (e?.len_ratio >= 0.8 && e?.len_ratio <= 1.25) ? 'spread order' : (e?.len_ratio >= 0.3 && e?.len_ratio <= 0.7) ? 'one leaf dropped' : 'other';
  const rows = failRows().map(r => { const p = by.get(r.slug.replace(`${STRATUM}-`, `${STRATUM}-all-`)); const e1 = p?.engines[P1]; return { slug: r.slug, cls: r.class, kind: kindOf(r, p?.engines[P0]), p1_cer: e1 ? (e1.cer ?? 1) : null, p1_chars: e1?.n_content ?? null, p1_loop: !!e1?.loop }; });
  const fixed = r => r.p1_cer != null && r.p1_cer <= 0.5 && r.p1_chars >= 30;
  const kinds = {}; for (const r of rows) { const k = (kinds[r.kind] ||= { n: 0, fixed: 0, loops: 0 }); k.n++; if (fixed(r)) k.fixed++; if (r.p1_loop) k.loops++; }
  const res = { issue: 6101, note: 'DESCRIPTIVE (not preregistered as a test). One engine on these pages: a P1 fail can also be a reference misfit.', n: rows.length, fixed: rows.filter(fixed).length, fixed_ci95: wilson(rows.filter(fixed).length, rows.length), kinds, pages: rows.map(r => ({ ...r, p1_cer: r3(r.p1_cer) })) };
  const OUT = path.join(__dirname, 'results', 'paddle-split-6101'); fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'failures-285.json'), JSON.stringify(res, null, 1));
  console.log(`failures re-read with ${P1}: ${res.fixed}/${res.n} fixed [${res.fixed_ci95}]`); for (const [k, v] of Object.entries(kinds)) console.log(`  ${k}: ${v.fixed}/${v.n} fixed, ${v.loops} loops`);
}

/**
 * The frame rate (prereg "If P1 passes"): every woodblock page #6101's Paddle pass read (1,883), P0 vs P1 on the SAME
 * pages, one engine each, with #6101's failure definition (CER > 0.5 or misfit, or < 30 characters on a text page;
 * a P1 leaf timeout counts as its text, so a page fails only through these). Wilson CIs; s/leaf from the runner logs.
 */
function framereport() {
  const d = latest(path.join(DIR, 'scored-all-split'), `${STRATUM}-all`); const by = new Map(d.pages.map(p => [p.slug, p]));
  const P1 = 'paddle-split-p1';
  const rows = p0Rows().filter(r => r.class === 'woodblock').map(r => { const p = by.get(r.slug.replace(`${STRATUM}-`, `${STRATUM}-all-`)); const e = p?.engines[P1]; return { slug: r.slug, book: r.book, p0_fail: !!isFail(r), p0_cer: r.cer, has_ref: r.has_ref, ref_chars: r.ref_chars, p1_cer: e ? (e.cer ?? 1) : null, p1_chars: e?.n_content ?? 0, p1_loop: !!e?.loop, read: !!e }; });
  const read = rows.filter(r => r.read);
  const p1Fail = r => (r.p1_cer == null || r.p1_cer > 0.5) || (r.ref_chars >= 30 && r.p1_chars < 30);
  const f0 = read.filter(r => r.p0_fail).length, f1 = read.filter(p1Fail).length;
  const sc = read.filter(r => r.p1_cer != null && r.p1_cer <= 0.5);
  const res = { issue: 6101, class: 'woodblock', n_pages: read.length, n_books: new Set(read.map(r => r.book)).size, p0_failure: f0, p0_failure_rate: r3(f0 / read.length), p0_failure_ci95: wilson(f0, read.length), p1_failure: f1, p1_failure_rate: r3(f1 / read.length), p1_failure_ci95: wilson(f1, read.length), p1_loops: read.filter(r => r.p1_loop).length, p1_median_cer_scored: r3(median(sc.map(r => r.p1_cer))), p1_median_cer_ci95: clusterCI(sc, s => median(s.map(r => r.p1_cer))), both_fail: read.filter(r => r.p0_fail && p1Fail(r)).length, p1_only_fail: read.filter(r => !r.p0_fail && p1Fail(r)).length };
  const OUT = path.join(__dirname, 'results', 'paddle-split-6101'); fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'frame-woodblock.json'), JSON.stringify({ ...res, pages: read.map(r => ({ slug: r.slug, p0_fail: r.p0_fail, p1_cer: r3(r.p1_cer), p1_loop: r.p1_loop })) }, null, 1));
  console.log(JSON.stringify(res));
}

const CMDS = { prep, assemble, report, failreport, framereport };
if (!CMDS[CMD]) { console.error(`usage: ${Object.keys(CMDS).join(' | ')}`); process.exit(2); }
await CMDS[CMD]();
