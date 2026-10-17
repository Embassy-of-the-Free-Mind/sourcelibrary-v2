#!/usr/bin/env node
/**
 * latin-refs-5924 — the reference set that gates #5924 (Latin print by century): one page per book, drawn at
 * random from every Latin book we hold printed in the 1500s / 1600s, transcribed from the leaf image itself by
 * three independent Opus reads (A blind, B blind, C adjudicates every A≠B word against the image).
 *
 * PRIOR ART: scripts/eval/latin-r4-refs-5924.mjs — draws only books that have an external same-edition
 *   transcription (CAMENA / EEBO-TCP / la.wikisource), which is why round 4's pool had no gothic type; this set draws
 *   from all holdings and makes the reference from the leaf. Its yearOf / Mulberry32 / Latin regex are reused verbatim
 *   so the century cells mean the same thing. scripts/eval/kraken-refused-4686 — the same-leaf Opus transcription
 *   precedent (single blind read, no second pass); its `same-leaf-transcription` sidecar shape is kept.
 *
 * Usage (env: MONGODB_URI; read-only on Mongo, never writes `pages` or `books`):
 *   node --env-file=<.env.production.local> scripts/eval/latin-refs-5924.mjs draw  --work=$JOB_SCRATCH/lr
 *   node scripts/eval/latin-refs-5924.mjs fetch    --work=…           leaf images + sha256 + reading crops
 *   node scripts/eval/latin-refs-5924.mjs diff     --work=…           A vs B word diff → adjudication packets
 *   node scripts/eval/latin-refs-5924.mjs finalize --work=… --out=scripts/eval/benchmark
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const WORK = arg('work', path.join(process.env.JOB_SCRATCH || '/tmp', 'lr'));
const W = f => path.join(WORK, f);
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
fs.mkdirSync(WORK, { recursive: true });

export const SEED = 5924;
// Mulberry32, the house seeded generator (latin-r4-refs-5924, latin-period-refs-5126)
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shuffle = (xs, seed) => { const r = rng(seed); return xs.map(x => ({ x, k: r() })).sort((a, b) => a.k - b.k).map(o => o.x); };
const fnv1a = s => { let h = 0x811c9dc5; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
// `published` → the first 14xx–17xx year (#5924's queue definition), as round 4
const yearOf = p => +((String(p ?? '').match(/1[4-7]\d\d/) || [])[0]) || null;
const century = y => (y >= 1500 && y < 1600 ? '1500s' : y >= 1600 && y < 1700 ? '1600s' : null);

// ≥ 50 / ≥ 30 after rejects; --target=1600s:N,1500s:M extends the SAME seeded order (the first books are unchanged)
const TARGET = Object.fromEntries((arg('target', '1600s:56,1500s:36')).split(',').map(x => x.split(':')).map(([k, v]) => [k, +v]));
const MIN_PAGES = 12;                          // a book needs a body to draw from (excludes broadsides)
const BODY = [0.15, 0.90];                     // body window: skip the first 15 % and last 10 % of leaves
const CANDIDATES = 4;                          // seeded body leaves tried per book before the book is dropped
const OUR_HOSTS = /images\.sourcelibrary\.org|r2\.dev|r2\.cloudflarestorage|book-translation-data\.s3/i;

/** The leaf image: pages.photo when it is the provider's own URL, else photo_original when that is (R2 copy of a
 *  known provider leaf). Our own upload buckets are of unknown provenance → null. */
export function leafUrl(p) {
  for (const u of [p.photo, p.photo_original]) if (u && /^https?:/.test(u) && !OUR_HOSTS.test(u)) return { url: u, field: u === p.photo ? 'photo' : 'photo_original' };
  return null;
}

async function draw() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const d = c.db(process.env.MONGODB_DB || 'bookstore');
  // the whole frame, enumerated (no $sample): every Latin book with pages, century from `published`
  const rows = await d.collection('books').find({ language: /latin|^lat$|^la$/i, pages_count: { $gt: 0 } }, { projection: {
    id: 1, title: 1, author: 1, published: 1, pages_count: 1, visible: 1, hidden_reason: 1, duplicate_of: 1, language: 1, ia_identifier: 1 } }).toArray();
  const frame = {}; const excluded = { no_year_or_other_century: 0, duplicate_of: 0, under_min_pages: 0 };
  for (const b of rows) {
    const id = b.id || String(b._id); const y = yearOf(b.published); const cen = century(y);
    if (!cen) { excluded.no_year_or_other_century++; continue; }
    if (b.duplicate_of) { excluded.duplicate_of++; continue; }
    if ((b.pages_count || 0) < MIN_PAGES) { excluded.under_min_pages++; continue; }
    (frame[cen] ||= []).push({ book_id: id, year: y, title: String(b.title || '').slice(0, 140), author: b.author || null,
      pages_count: b.pages_count, visible: !!b.visible, hidden_reason: b.hidden_reason ?? null, language: b.language, ia: b.ia_identifier ?? null });
  }
  const out = { seed: SEED, built_at: new Date().toISOString(), frame_query: "books {language: /latin|^lat$|^la$/i, pages_count > 0}, enumerated in full",
    rule: `per century: frame sorted by book_id, shuffled by Mulberry32(${SEED} + centuryStart); taken in that order until the target of books with a usable body leaf is met. Per book: leaves sorted by page_number, body = index [${BODY[0]}·n, ${BODY[1]}·n), body shuffled by Mulberry32(${SEED} ^ fnv1a(book_id)); the first ${CANDIDATES} usable leaves (provider leaf URL, no split crop) are the candidates in order; the reader rejects non-text leaves and the next candidate is read.`,
    min_pages: MIN_PAGES, body: BODY, excluded, frame_sizes: {}, centuries: {} };
  for (const cen of Object.keys(TARGET)) {
    const f = frame[cen].sort((a, b) => (a.book_id < b.book_id ? -1 : 1)); out.frame_sizes[cen] = f.length;
    const order = shuffle(f, SEED + (cen === '1500s' ? 1500 : 1600));
    const picked = []; const skipped = [];
    for (const b of order) {
      if (picked.length >= TARGET[cen]) break;
      const pages = await d.collection('pages').find({ book_id: b.book_id }, { projection: { id: 1, page_number: 1, photo: 1, photo_original: 1, crop: 1, image_width: 1, image_height: 1 } }).sort({ page_number: 1 }).toArray();
      const n = pages.length; if (n < MIN_PAGES) { skipped.push({ ...b, reason: `pages collection has ${n} leaves` }); continue; }
      const body = pages.slice(Math.floor(BODY[0] * n), Math.ceil(BODY[1] * n));
      const cands = []; const why = {};
      for (const p of shuffle(body, SEED ^ fnv1a(b.book_id))) {
        if (p.crop) { why.split_crop = (why.split_crop || 0) + 1; continue; }
        const L = leafUrl(p); if (!L) { why.no_provider_leaf = (why.no_provider_leaf || 0) + 1; continue; }
        cands.push({ page_number: p.page_number, page_id: p.id || String(p._id), image_url: L.url, url_field: L.field });
        if (cands.length >= CANDIDATES) break;
      }
      if (!cands.length) { skipped.push({ ...b, reason: `no usable body leaf (${JSON.stringify(why)})` }); continue; }
      picked.push({ ...b, n_leaves: n, candidates: cands });
    }
    out.centuries[cen] = { picked, skipped };
    console.log(cen, 'frame', f.length, 'picked', picked.length, 'skipped', skipped.length);
  }
  fs.writeFileSync(W(arg('drawfile', 'draw.json')), JSON.stringify(out, null, 1));
  await c.close();
}

// ── fetch: the leaf itself, its sha256, and reading crops (full view + overlapping horizontal bands) ─────────
async function fetchLeaves() {
  const sharp = (await import('sharp')).default;
  const dr = readJson(W('draw.json')); const which = +(arg('cand', '0'));
  const jobs = []; for (const cen of Object.keys(dr.centuries)) for (const b of dr.centuries[cen].picked) { const c = b.candidates[which]; if (c) jobs.push({ cen, b, c }); }
  const only = arg('only'); const onlySet = only ? new Set(only.split(',')) : null;
  const log = fs.existsSync(W('leaves.json')) ? readJson(W('leaves.json')) : {};
  for (const { cen, b, c } of jobs) {
    if (onlySet && !onlySet.has(b.book_id)) continue;
    const slug = `lr-${b.book_id}-p${c.page_number}`; if (log[slug]?.sha256) continue;
    const dir = W(`img/${slug}`); fs.mkdirSync(dir, { recursive: true });
    let buf; try {
      const r = await fetch(c.image_url, { headers: { 'User-Agent': 'SourceLibrary-eval/1.0 (latin-refs-5924)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`); buf = Buffer.from(await r.arrayBuffer());
    } catch (e) { log[slug] = { error: String(e.message || e), url: c.image_url }; console.log(slug, 'ERR', e.message); continue; }
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    fs.writeFileSync(path.join(dir, 'leaf.orig'), buf);
    const meta = await sharp(buf).metadata(); const { width: w, height: h } = meta;
    await sharp(buf).resize({ width: 1500, height: 1500, fit: 'inside' }).jpeg({ quality: 88 }).toFile(path.join(dir, '0-full.jpg'));
    // bands: 3 (or 4 when tall) overlapping horizontal strips, each resized to ≤ 1800 px wide
    const nb = h / w > 1.6 ? 4 : 3; const bh = Math.ceil(h / nb * 1.25); const files = ['0-full.jpg'];
    for (let i = 0; i < nb; i++) {
      const top = Math.max(0, Math.min(h - bh, Math.round(i * (h - bh) / (nb - 1))));
      const f = `${i + 1}-band.jpg`; files.push(f);
      await sharp(buf).extract({ left: 0, top, width: w, height: Math.min(bh, h - top) }).resize({ width: Math.min(w, 1800) }).jpeg({ quality: 90 }).toFile(path.join(dir, f));
    }
    log[slug] = { cen, book_id: b.book_id, page_number: c.page_number, page_id: c.page_id, image_url: c.image_url, url_field: c.url_field,
      sha256: sha, bytes: buf.length, width: w, height: h, crops: files, fetched_at: new Date().toISOString(), candidate: which };
    console.log(slug, w, 'x', h, files.length);
    fs.writeFileSync(W('leaves.json'), JSON.stringify(log, null, 1));
    await new Promise(r => setTimeout(r, 400));
  }
  fs.writeFileSync(W('leaves.json'), JSON.stringify(log, null, 1));
}

// ── diff: word-level A vs B alignment (exact, after nothing but whitespace splitting) ─────────────────────────
const toks = s => s.split(/\s+/).filter(Boolean);
export function wordDiff(a, b) {
  const A = toks(a), B = toks(b); const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks = []; let i = 0, j = 0, cur = null;
  const flush = () => { if (cur) { hunks.push(cur); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { flush(); i++; j++; continue; }
    cur ||= { a_at: i, a: [], b: [], ctx_before: A.slice(Math.max(0, i - 5), i).join(' ') };
    if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) cur.a.push(A[i++]); else cur.b.push(B[j++]);
  }
  flush();
  for (const h of hunks) h.ctx_after = A.slice(h.a_at + h.a.length, h.a_at + h.a.length + 5).join(' ');
  return { a_words: n, b_words: m, agree_words: dp[0][0], hunks };
}

function diff() {
  const leaves = readJson(W('leaves.json')); const out = {};
  for (const slug of Object.keys(leaves)) {
    const fa = W(`pass/A/${slug}.txt`), fb = W(`pass/B/${slug}.txt`);
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) continue;
    const a = fs.readFileSync(fa, 'utf8').normalize('NFC'), b = fs.readFileSync(fb, 'utf8').normalize('NFC');
    if (/^REJECT\b/.test(a) || /^REJECT\b/.test(b)) { out[slug] = { reject: true }; continue; }
    const d = wordDiff(a, b); out[slug] = { a_words: d.a_words, b_words: d.b_words, agree: +(d.agree_words / Math.max(1, d.a_words, d.b_words)).toFixed(4), n_hunks: d.hunks.length };
    fs.mkdirSync(W('pass/diff'), { recursive: true });
    // A hunk whose two sides differ only in spacing (`ord.reg.` / `ord. reg.`) is not adjudicated: A's spacing is kept
    // (the letters-only scorer cannot see it). Only the rest goes to reader C.
    const all = d.hunks.map((h, k) => ({ k, ctx_before: h.ctx_before, A: h.a.join(' '), B: h.b.join(' '), ctx_after: h.ctx_after, a_at: h.a_at, a_len: h.a.length, space_only: h.a.join('') === h.b.join('') }));
    out[slug].n_space_only = all.filter(h => h.space_only).length;
    fs.writeFileSync(W(`pass/diff/${slug}.all.json`), JSON.stringify(all, null, 1));
    fs.writeFileSync(W(`pass/diff/${slug}.json`), JSON.stringify(all.filter(h => !h.space_only).map(({ a_at, a_len, space_only, ...h }) => h), null, 1));
  }
  fs.writeFileSync(W('diff-summary.json'), JSON.stringify(out, null, 1));
  const v = Object.values(out).filter(x => !x.reject); console.log(v.length, 'pairs; median agree', v.map(x => x.agree).sort()[v.length >> 1], '; hunks', v.reduce((s, x) => s + x.n_hunks, 0));
}

// Apply C's resolutions to A's text (A keeps its line breaks). C answers per hunk: {k, text} where text is the
// reading the image shows (may be "" for an omission). Hunks are spliced by word index, from the end.
export function applyResolutions(aText, hunks, res) {
  const lines = aText.split('\n').map(l => toks(l)); const flat = []; lines.forEach((ws, li) => ws.forEach(w => flat.push({ w, li })));
  const byK = new Map(res.map(r => [r.k, r]));
  for (const h of [...hunks].sort((x, y) => y.a_at - x.a_at)) {
    const r = byK.get(h.k); if (!r) throw new Error(`no resolution for hunk ${h.k}`);
    const li = h.a_len ? flat[h.a_at].li : (flat[h.a_at - 1] ?? flat[h.a_at] ?? { li: 0 }).li;
    const repl = toks(r.text ?? '').map(w => ({ w, li }));
    flat.splice(h.a_at, h.a_len, ...repl);
  }
  const out = lines.map(() => []); for (const t of flat) out[t.li].push(t.w);
  return out.map(ws => ws.join(' ')).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function finalize() {
  const OUT = arg('out', 'scripts/eval/benchmark'); const PROV = arg('prov', 'scripts/eval/latin-refs-5924');
  const leaves = readJson(W('leaves.json')); const dr = readJson(W('draw.json')); const meta = readJson(W('readers.json'));
  const bookById = {}; for (const cen of Object.keys(dr.centuries)) for (const b of dr.centuries[cen].picked) bookById[b.book_id] = b;
  const manifest = { stratum: 'latin-refs-5924', issue: 5924, parent: 5660, built_by: 'scripts/eval/latin-refs-5924.mjs finalize', unit: 'book (one leaf)', draw: { seed: dr.seed, rule: dr.rule, frame_sizes: dr.frame_sizes, excluded: dr.excluded }, pages: [] };
  fs.mkdirSync(path.join(OUT, 'refs'), { recursive: true }); fs.mkdirSync(path.join(PROV, 'passes'), { recursive: true });
  // the per-book outcome of the draw (draw-status.cjs: accepted / unreachable / dropped-mislabelled / dropped-no-usable-leaf)
  const st = readJson(W('status.json')); const accepted = new Set(); const excluded = [];
  for (const cen of Object.keys(st)) for (const r of st[cen].rows) if (r.st === 'accepted') accepted.add(r.slug);
  for (const [slug, L] of Object.entries(leaves)) {
    const fa = W(`pass/A/${slug}.txt`); if (!L.sha256 || !fs.existsSync(fa) || !accepted.has(slug)) continue;
    const a = fs.readFileSync(fa, 'utf8').normalize('NFC'); if (/^REJECT\b/.test(a)) continue;
    const hunks = fs.existsSync(W(`pass/diff/${slug}.all.json`)) ? readJson(W(`pass/diff/${slug}.all.json`)) : [];
    const cRes = hunks.some(h => !h.space_only) ? readJson(W(`pass/C/${slug}.json`)) : [];
    const res = hunks.map(h => (h.space_only ? { k: h.k, choice: 'A', text: h.A, note: 'spacing only, not adjudicated' } : cRes.find(r => r.k === h.k)));
    if (res.some(r => !r)) throw new Error(`${slug}: C did not answer every hunk`);
    const text = applyResolutions(a, hunks, res).normalize('NFC');
    const unread = (text.match(/\[\?\]/g) || []).length;
    if (unread > 5) { excluded.push({ slug, book_id: L.book_id, century: L.cen, reason: `final text has ${unread} [?] (leaf obscured at an edge)` }); continue; }
    const ds = readJson(W('diff-summary.json'))[slug] || {};
    const b = bookById[L.book_id]; const m = meta[slug] || {};
    const sidecar = {
      source: 'model-transcription', edition: `${b.title} (${b.year}), the leaf itself: ${L.image_url}`, licence: 'CC0-1.0',
      kind: 'same-leaf-transcription', canonical: false, memorization_risk: 'low', origin: 'library',
      book_id: L.book_id, page_number: L.page_number, page_id: L.page_id, script: 'latin', reference_kind: 'same-leaf-transcription',
      century: L.cen, year: b.year, visible: b.visible, hidden_reason: b.hidden_reason,
      image: { url: L.image_url, field: `pages.${L.url_field}`, sha256: L.sha256, width: L.width, height: L.height, fetched_at: L.fetched_at },
      made_by: { engine: 'model', model: 'claude-opus-5-5', how: 'three independent reads of the leaf image (full view + overlapping bands): A and B blind diplomatic transcriptions; C re-read the image at every word where A and B differ and chose or corrected; final = A with C\'s readings', prompt_hash: m.prompt_hash ?? null, finish_reason: m.finish_reason ?? 'stop', readers: m.readers ?? ['A', 'B', 'C'], read_at: m.read_at ?? null },
      typeface: m.typeface ?? null, layout: m.layout ?? null, convention: 'latin-refs-5924@1 (README)',
      passes: { ab_word_agreement: ds.agree ?? null, hunks: hunks.length, space_only_hunks: hunks.filter(h => h.space_only).length, c_chose: { A: res.filter(r => r.choice === 'A').length - hunks.filter(h => h.space_only).length, B: res.filter(r => r.choice === 'B').length, other: res.filter(r => r.choice === 'other').length } },
      unit: { kind: 'page', chars: text.length, unread_words: unread }, leaf_check: { status: 'ok', by: 'model-eye', at: m.read_at ?? null, note: 'transcribed from this leaf\'s own image', human_spot_check: null },
      reference_error_rate: null, built_by: 'scripts/eval/latin-refs-5924.mjs', built_at: new Date().toISOString(), text_location: 'repo',
      text_sha256: crypto.createHash('sha256').update(text).digest('hex'),
    };
    fs.writeFileSync(path.join(OUT, 'refs', `${slug}.txt`), text);
    fs.writeFileSync(path.join(OUT, 'refs', `${slug}.json`), JSON.stringify(sidecar, null, 2) + '\n');
    for (const p of ['A', 'B']) fs.copyFileSync(W(`pass/${p}/${slug}.txt`), path.join(PROV, 'passes', `${slug}.${p}.txt`));
    if (cRes.length) fs.writeFileSync(path.join(PROV, 'passes', `${slug}.C.json`), JSON.stringify(hunks.filter(h => !h.space_only).map(({ a_at, a_len, space_only, ...h }) => ({ ...h, resolution: res.find(r => r.k === h.k) })), null, 1) + '\n');
    manifest.pages.push({ slug, book_id: L.book_id, page_number: L.page_number, substratum: L.cen, title: b.title, year: b.year, typeface: m.typeface ?? null });
  }
  const rows = Object.fromEntries(Object.entries(st).map(([cen, v]) => [cen, v.rows.map(r => ({ book_id: r.book, outcome: r.st, slug: r.slug, rejected_leaves: r.rej }))]));
  fs.writeFileSync(path.join(PROV, 'draw-log.json'), JSON.stringify({ seed: dr.seed, rule: dr.rule, frame_sizes: dr.frame_sizes, excluded_from_frame: dr.excluded, books_in_draw_order: rows, excluded_after_adjudication: excluded }, null, 1) + '\n');
  manifest.excluded_after_adjudication = excluded;
  manifest.pages.sort((x, y) => (x.substratum + x.slug < y.substratum + y.slug ? -1 : 1));
  fs.writeFileSync(path.join(OUT, 'latin-refs-5924.json'), JSON.stringify(manifest, null, 1) + '\n');
  const n = {}; for (const p of manifest.pages) n[p.substratum] = (n[p.substratum] || 0) + 1; console.log(n);
}

const cmd = process.argv[2];
if (cmd === 'draw') await draw();
else if (cmd === 'fetch') await fetchLeaves();
else if (cmd === 'diff') diff();
else if (cmd === 'finalize') finalize();
else if (cmd) { console.error('unknown command', cmd); process.exit(1); }
