#!/usr/bin/env node
/**
 * Canon gap map (#5513): open typed corpora × English coverage × licence ×
 * draft-English cost, for the Eternity working session.
 *
 * One row per corpus. Every number carries the source it was measured from:
 *   - licence  — a sentence QUOTED from the source's own page / LICENSE / API,
 *                re-fetched on every run and checked to still be there
 *                (`licence.verified`). No quote → "unverified".
 *   - size     — measured from the download, the git tree API or the source
 *                API. Where only a sample was downloaded, `size.method` says
 *                so and how it was extrapolated.
 *   - English  — only from a cited source (84000 catalogue, SuttaCentral
 *                bilara-data, Sefaria counts API). Otherwise "unknown", and the
 *                cost is then an UPPER bound (the whole corpus).
 *   - holdings — Mongo `books`, indexed queries only (language, collections,
 *                id); live = visible && pages_count>0, everything else hidden.
 *   - cost     — base characters × a $/char rate MEASURED from our own
 *                translation meter (Supabase `gemini_usage`, chained Batch
 *                lane, last 45 days) ÷ the characters on the same books' pages.
 *
 * "Base characters": tags/markers stripped, whitespace and combining marks
 * (Unicode Mn — nikud, Tibetan vowel signs, …) not counted. The SAME function
 * counts the corpora and our own pages, so the $/char rate transfers.
 *
 * Downloads are capped (~2 GB budget; this run uses well under 1 GB) and cached
 * under $GAPMAP_CACHE (default /root/works-catalog-cache/gap-map). No OCR or
 * translation calls; measurement spend is $0 (public APIs + our own DBs).
 *
 * PRIOR ART: scripts/works-catalog/ (ingest-bdrc/cbeta/gretil/sefaria/openiti/
 * kanripo.mjs, #2453) — reused for the enumeration routes (cbeta-metadata
 * work-info, OpenITI kitab-metadata-automation, GRETIL-mirror tree, Kanripo
 * KR-Catalog, Sefaria index) and the works/work_sources tables for scan
 * coverage; they count WORKS, not characters, and carry no English-coverage
 * figure or cost, so they do not answer this question on their own.
 * scripts/lib/model-pricing.mjs PAGE_RATE_USD is the realtime lane (2026-09-04);
 * the corpus drafts would run on the chained Batch lane, so the rate is
 * re-measured here.
 *
 * Usage (Hetzner; needs MONGODB_URI + SUPABASE_DB_URL):
 *   node --env-file=.env.production.local scripts/catalog-coverage/canon-gap-map.mjs
 *   [--out=path.json] [--md=path.md]
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { MongoClient } from 'mongodb';
import { pgClient } from '../works-catalog/lib.mjs';
import { loadHoldingCandidates, corpusBookSets, sumHoldings } from '../lib/canon-holdings.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, v] = a.slice(2).split('='); return [k, v ?? true];
}));
const CACHE = process.env.GAPMAP_CACHE || '/root/works-catalog-cache/gap-map';
const OUT = args.out || 'scripts/catalog-coverage/results/canon-gap-map-2026-10.json';
const MD = args.md || `${CACHE}/canon-gap-map.md`;
mkdirSync(`${CACHE}/dl`, { recursive: true });
const UA = 'SourceLibrary-CanonGapMap/1.0 (derek@sourcelibrary.org)';
const GH_TOKEN = process.env.GITHUB_TOKEN || (() => { try { return execSync('gh auth token', { encoding: 'utf8' }).trim(); } catch { return null; } })();
const DL_CAP = 2e9;
const stats = { bytes_fetched: 0, bytes_from_cache: 0, http_calls: 0 };
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------- helpers
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchRaw(url, { headers = {}, tries = 4 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      stats.http_calls++;
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(180000) });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      stats.bytes_fetched += buf.length;
      if (stats.bytes_fetched > DL_CAP) throw new Error('download cap exceeded');
      return { status: res.status, buf };
    } catch (e) {
      if (i === tries - 1 || /cap exceeded/.test(e.message)) throw e;
      await sleep(3000 * (i + 1));
    }
  }
}
const cacheName = url => `${CACHE}/dl/${url.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-200)}`;
/** Fetch with an on-disk cache (re-runs never re-download). */
async function fetchCached(url, opts = {}) {
  const f = cacheName(url);
  if (existsSync(f)) { const b = readFileSync(f); stats.bytes_from_cache += b.length; return b; }
  const { status, buf } = await fetchRaw(url, opts);
  if (status !== 200) throw new Error(`HTTP ${status} ${url}`);
  writeFileSync(f, buf);
  return buf;
}
function parseCsvLine(l) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
const fetchText = async (url, opts) => (await fetchCached(url, opts)).toString('utf8');
const fetchJson = async (url, opts) => JSON.parse(await fetchText(url, opts));
/** Uncached fetch — for licence pages, which must be re-read every run. */
async function fetchLive(url, opts) { const { status, buf } = await fetchRaw(url, opts); return { status, text: buf.toString('utf8') }; }
const gh = path => fetchJson(`https://api.github.com/${path}`, { headers: GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {} });
async function ghTree(repo, ref = 'HEAD') {
  const t = await gh(`repos/${repo}/git/trees/${ref}?recursive=1`);
  return { truncated: t.truncated, sha: t.sha, blobs: t.tree.filter(x => x.type === 'blob') };
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
// seeded RNG so samples are reproducible
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
function sample(arr, n, seed = 5513) { const r = rng(seed); const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); }
const htmlToText = s => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

/** Base characters: no tags, no whitespace, no combining marks (Mn). */
const MN = /\p{Mn}/u, WS = /\s/u;
function baseChars(s, { stripTags = true } = {}) {
  if (stripTags) s = s.replace(/<[^>]*>/g, '');
  let n = 0;
  for (const ch of s) if (!WS.test(ch) && !MN.test(ch)) n++;
  return n;
}
const round = (x, d = 0) => x == null ? null : Math.round(x * 10 ** d) / 10 ** d;

/** Quote check: is the licence sentence still on the source's page? */
async function licence({ url, quote, label, open, viaApi = false, note = null }) {
  if (!quote) return { label: 'unverified', url, quote: null, verified: false, open: 'unverified', note };
  let verified = false, status = null;
  try {
    const r = await fetchLive(url, viaApi && GH_TOKEN && url.includes('api.github.com') ? { headers: { Authorization: `Bearer ${GH_TOKEN}` } } : {});
    status = r.status;
    const norm = s => htmlToText(s).replace(/\\u0026/g, '&');
    const squash = s => norm(s).replace(/\s+/g, '');
    verified = norm(r.text).includes(norm(quote)) || r.text.includes(quote) || squash(r.text).includes(squash(quote));
  } catch (e) { note = `${note ? note + '; ' : ''}licence fetch failed: ${e.message}`; }
  return { label, url, quote, verified, http_status: status, open, note };
}

// ---------------------------------------------------------------- our pages: $/char by language
async function measureRates(db) {
  const pgc = pgClient(); await pgc.connect();
  const rows = (await pgc.query(`select book_id, model, sum(page_count)::int pages, sum(cost_usd)::float cost, count(*)::int n
     from gemini_usage where timestamp > now() - interval '45 days' and type='translation' and mode='batch'
       and endpoint='hetzner/translate-batch-chained' and page_count > 0 group by 1,2`)).rows;
  await pgc.end();
  const books = await db.collection('books').find({ id: { $in: [...new Set(rows.map(r => r.book_id))] } }, { projection: { id: 1, language: 1 } }).toArray();
  const L = Object.fromEntries(books.map(b => [b.id, b.language]));
  const LANES = {
    tibetan: { langs: ['Tibetan'], model: 'gemini-3-flash-preview' },
    chinese: { langs: ['Chinese', 'Classical Chinese'], model: 'gemini-3.1-flash-lite' },
    sanskrit: { langs: ['Sanskrit'], model: 'gemini-3.1-flash-lite' },
    pali: { langs: ['Pali'], model: 'gemini-3.1-flash-lite' },
    hebrew: { langs: ['Hebrew', 'Aramaic'], model: 'gemini-3.1-flash-lite' },
    arabic: { langs: ['Arabic'], model: 'gemini-3.1-flash-lite' },
    persian: { langs: ['Persian'], model: 'gemini-3.1-flash-lite' },
    latin: { langs: ['Latin'], model: 'gemini-3.1-flash-lite' },
    greek: { langs: ['Greek', 'Ancient Greek'], model: 'gemini-3.1-flash-lite' },
  };
  const out = {};
  for (const [k, lane] of Object.entries(LANES)) {
    const rs = rows.filter(r => lane.langs.includes(L[r.book_id]) && r.model === lane.model);
    const pages = rs.reduce((a, r) => a + r.pages, 0), cost = rs.reduce((a, r) => a + r.cost, 0);
    // characters on the same books' translated pages (indexed: book_id+page_number)
    const sampleBooks = sample(rs.map(r => r.book_id), 30, 7);
    let chars = 0, n = 0, words = 0;
    for (const bid of sampleBooks) {
      const ps = await db.collection('pages').find({ book_id: bid, 'translation.data': { $exists: true } }, { projection: { 'ocr.data': 1, 'translation.data': 1 } }).limit(40).toArray();
      for (const p of ps) {
        const t = p.ocr?.data, e = p.translation?.data;
        if (typeof t === 'string' && t.length > 20 && typeof e === 'string' && e.length > 20) { chars += baseChars(t); words += (e.replace(/<[^>]*>/g, ' ').match(/[A-Za-z][A-Za-z'’-]*/g) || []).length; n++; }
      }
    }
    const usdPerPage = pages ? cost / pages : null, charsPerPage = n ? chars / n : null;
    out[k] = {
      lane: `chained Batch, ${lane.model}`, books_metered: rs.length, pages_metered: pages, usd_metered: round(cost, 2),
      usd_per_page: round(usdPerPage, 6), sample_pages_for_chars: n, base_chars_per_page: round(charsPerPage, 1),
      usd_per_million_chars: usdPerPage && charsPerPage ? round(usdPerPage / charsPerPage * 1e6, 3) : null,
      english_words_per_source_char: chars ? round(words / chars, 4) : null,
      source: "Supabase gemini_usage, endpoint 'hetzner/translate-batch-chained', type translation, mode batch, last 45 days, books joined to books.language; chars from the same books' translated pages",
    };
    log(`rate ${k}: ${out[k].pages_metered} pages $${out[k].usd_metered} → $${out[k].usd_per_page}/pg, ${out[k].base_chars_per_page} ch/pg → $${out[k].usd_per_million_chars}/M ch`);
  }
  return out;
}

// ---------------------------------------------------------------- holdings
// The selectors live in scripts/lib/canon-holdings.mjs, shared with the status file (canon-gap-status.mjs).
async function holdings(db) {
  const pgc = pgClient(); await pgc.connect();
  const { books, whBy, counts } = await loadHoldingCandidates(db, pgc);
  await pgc.end();
  writeFileSync(`${CACHE}/holdings-books.json`, JSON.stringify(books));
  log(`holdings: ${books.length} candidate books (lang ${counts.lang}, collections ${counts.collections}, work_holdings ${counts.work_holdings})`);
  const S = corpusBookSets(books, whBy);
  const R = {};
  for (const [k, v] of Object.entries(S)) if (!k.endsWith('_other_editions')) R[k] = sumHoldings(v);
  R.tengyur.other_editions = sumHoldings(S.tengyur_other_editions);
  R.kangyur.other_editions = sumHoldings(S.kangyur_other_editions);
  return R;
}

// ---------------------------------------------------------------- corpora
async function esukhia(repo, sampleN) {
  const tree = await ghTree(repo);
  const texts = tree.blobs.filter(b => /^text\/.*\.txt$/.test(b.path));
  const totalBytes = texts.reduce((a, b) => a + b.size, 0);
  const picks = [...texts].sort((a, b) => a.path.localeCompare(b.path)).filter((_, i, arr) => i % Math.ceil(arr.length / sampleN) === 0);
  let bytes = 0, chars = 0, folios = 0, toh = new Set();
  await pool(picks, 4, async f => {
    const t = (await fetchCached(`https://raw.githubusercontent.com/${repo}/${tree.sha}/${encodeURI(f.path)}`)).toString('utf8');
    bytes += Buffer.byteLength(t);
    for (const m of t.matchAll(/\{(D\d+[a-z]?)[^}]*\}/g)) toh.add(m[1]);
    folios += new Set([...t.matchAll(/\[(\d+[ab])(?:\.\d+)?\]/g)].map(m => m[1])).size;
    chars += baseChars(t.replace(/\[[^\]]*\]|\{[^}]*\}/g, ''), { stripTags: false });
  });
  const k = totalBytes / bytes;
  return { tree_sha: tree.sha, files: texts.length, bytes: totalBytes, sample_files: picks.length, sample_bytes: bytes,
    base_chars: Math.round(chars * k), folio_sides_from_markers: Math.round(folios * k),
    method: `git tree API sizes (${texts.length} files, ${(totalBytes / 1e6).toFixed(0)} MB); ${picks.length} evenly spaced files downloaded and counted; chars and [Nb] folio-side markers scaled by total/sample bytes (×${k.toFixed(2)})` };
}

async function read84000() {
  const html = await fetchText('https://read.84000.co/section/lobby.json');
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map(m => JSON.parse(`"${m[1]}"`)).join('');
  const recs = new Map();
  for (const m of chunks.matchAll(/\{"toh":"(toh[^"]+)","title":[\s\S]*?"num_pages":(\d+|null),[\s\S]*?"publication_status":"([^"]+)"/g)) recs.set(m[1], { pages: m[2] === 'null' ? 0 : +m[2], status: m[3] });
  const agg = { Kangyur: {}, Tengyur: {} };
  for (const [toh, r] of recs) {
    const canon = +toh.match(/toh(\d+)/)[1] <= 1108 ? 'Kangyur' : 'Tengyur';
    const a = agg[canon][r.status] ||= { texts: 0, pages: 0 }; a.texts++; a.pages += r.pages;
  }
  const tot = c => Object.values(agg[c]).reduce((a, x) => ({ texts: a.texts + x.texts, pages: a.pages + x.pages }), { texts: 0, pages: 0 });
  return { records: recs.size, by_status: agg, total: { Kangyur: tot('Kangyur'), Tengyur: tot('Tengyur') },
    source: 'https://read.84000.co/section/lobby.json — the 84000 Reading Room catalogue (per-text toh, num_pages, publication_status); toh ≤ 1108 = Kangyur, > 1108 = Tengyur' };
}

async function bdrcAccess(rid) {
  try {
    const t = (await fetchLive(`https://purl.bdrc.io/admindata/${rid}.jsonld`)).text;
    return { rid, access: (t.match(/Access(Open|Restricted\w*|FairUse|MirrorOnly)/) || [])[0] || 'unknown', url: `https://purl.bdrc.io/admindata/${rid}.jsonld` };
  } catch (e) { return { rid, access: 'unknown', error: e.message }; }
}

async function cbeta() {
  const csv = await fetchText('https://cbdata.dila.edu.tw/stable/download/stat/cbeta-word-count.csv');
  const [head, ...lines] = csv.trim().split('\n');
  const cols = head.split(',');
  const rows = lines.map(l => { const v = parseCsvLine(l); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); });
  // titles + vol from cbeta-metadata work-info (same route as ingest-cbeta.mjs)
  const canons = [...new Set(rows.map(r => r.canon))];
  const info = {};
  for (const c of canons) { try { Object.assign(info, await fetchJson(`https://cdn.jsdelivr.net/gh/DILA-edu/cbeta-metadata@master/work-info/${c}.json`)); } catch { /* canon without work-info */ } }
  // Category B (not CC-licensed) per https://www.cbeta.org/copyright.php: 印順 (Y), 呂澂 (LC), 太虛 (TX), 演培 (YP)
  const CAT_B = new Set(['Y', 'LC', 'TX', 'YP']);
  const ok = rows.filter(r => !CAT_B.has(r.canon) && !r.alt);
  const chars = rs => rs.reduce((a, r) => a + (+r.chars_no_spaces || 0), 0);
  const chan = ok.filter(r => {
    const t = info[r.work]?.title || '', vol = info[r.work]?.vol || '';
    return /^(景德傳燈錄|祖堂集|五燈會元)$/.test(t) || (/語錄|廣錄|語要/.test(t) && (/^T4[78]$/.test(vol) || r.canon === 'X'));
  });
  return { rows, info, ok, CAT_B: [...CAT_B], chars, chan,
    whole: { texts: ok.length, base_chars: chars(ok), cjk_chars: ok.reduce((a, r) => a + (+r.cjk_chars || 0), 0) },
    tx: { texts: ok.filter(r => /^[TX]$/.test(r.canon)).length, base_chars: chars(ok.filter(r => /^[TX]$/.test(r.canon))) },
    chanSize: { texts: chan.length, base_chars: chars(chan), titles: chan.map(r => `${r.work} ${info[r.work]?.title || ''}`) },
    method: "CBETA API word-count report https://cbdata.dila.edu.tw/stable/download/stat/cbeta-word-count.csv (chars_no_spaces per work); rows with an 'alt' (partial duplicate) and the four non-CC Category B collections excluded" };
}

async function vri() {
  const tree = await ghTree('vipassanatech/tipitaka-xml');
  const romn = tree.blobs.filter(b => /^romn\/.*\.(mul|att|tik|nrf)\d*\.xml$/.test(b.path));
  const out = {};
  for (const cls of ['mul', 'att', 'tik', 'nrf']) {
    const fs_ = romn.filter(b => new RegExp(`\\.${cls}\\d*\\.xml$`).test(b.path));
    let chars = 0, bytes = 0;
    await pool(fs_, 6, async f => {
      const buf = await fetchCached(`https://raw.githubusercontent.com/vipassanatech/tipitaka-xml/${tree.sha}/${f.path}`);
      bytes += buf.length;
      const t = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
      chars += baseChars(t.replace(/<teiHeader[\s\S]*?<\/teiHeader>/, '').replace(/<note[\s\S]*?<\/note>/g, ''));
    });
    out[cls] = { files: fs_.length, bytes, base_chars: chars };
  }
  return { tree_sha: tree.sha, ...out, method: 'all romn/*.{mul,att,tik,nrf}.xml downloaded (UTF-16) and counted; <note> variant readings excluded' };
}

async function suttacentral() {
  const tree = await ghTree('suttacentral/bilara-data', 'published');
  const root = tree.blobs.filter(b => b.path.startsWith('root/pli/ms/'));
  const en = tree.blobs.filter(b => b.path.startsWith('translation/en/'));
  const uid = p => p.split('/').pop().split('_')[0];
  const enu = new Set(en.map(b => uid(b.path)));
  const by = {};
  for (const b of root) { const pit = b.path.split('/')[3]; const a = by[pit] ||= { files: 0, bytes: 0, en_files: 0, en_bytes: 0 }; a.files++; a.bytes += b.size; if (enu.has(uid(b.path))) { a.en_files++; a.en_bytes += b.size; } }
  const tot = Object.values(by).reduce((a, x) => ({ bytes: a.bytes + x.bytes, en_bytes: a.en_bytes + x.en_bytes }), { bytes: 0, en_bytes: 0 });
  return { by_pitaka: by, english_fraction_by_root_bytes: round(tot.en_bytes / tot.bytes, 3),
    source: 'github.com/suttacentral/bilara-data (branch published): root/pli/ms segment files with a translation/en file of the same uid, weighted by root-file bytes' };
}

async function gretil() {
  const tree = await ghTree('INDOLOGY/GRETIL-mirror');
  const base = 'gretil.sub.uni-goettingen.de/gretil/1_sanskr/';
  const skt = tree.blobs.filter(b => b.path.startsWith(base) && /\.htm$/.test(b.path));
  // collapse transliteration variants of one text (…au/…iu/…pu/…xu) to the smallest file
  const groups = new Map();
  for (const b of skt) {
    const dir = b.path.slice(0, b.path.lastIndexOf('/')), name = b.path.slice(b.path.lastIndexOf('/') + 1);
    const m = name.match(/^(.*?)_?([aipxbcst])u\.htm$/);
    const key = m ? `${dir}/${m[1]}` : `${dir}/${name}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(b);
  }
  // only merge real variant groups (≥2 files); singletons keep their own key
  const texts = [];
  for (const [, fs_] of groups) fs_.length > 1 ? texts.push(fs_.sort((a, b) => a.size - b.size)[0]) : texts.push(fs_[0]);
  const sub = p => p.slice(base.length);
  const SUBSETS = {
    buddhist: t => /^(4_rellit\/buddh|6_sastra\/3_phil\/buddh)\//.test(sub(t.path)),
    vedanta: t => /^6_sastra\/3_phil\/(vedanta|advaita)\//.test(sub(t.path)),
    vaisnava: t => /^4_rellit\/vaisn\//.test(sub(t.path)),
  };
  const measured = {};
  for (const [k, f] of Object.entries(SUBSETS)) {
    const fs_ = texts.filter(f);
    let chars = 0, bytes = 0, refOnly = 0, cc = 0; const titles = [];
    await pool(fs_, 6, async b => {
      const t = (await fetchCached(`https://raw.githubusercontent.com/INDOLOGY/GRETIL-mirror/${tree.sha}/${encodeURI(b.path)}`)).toString('utf8');
      bytes += Buffer.byteLength(t);
      if (/REFERENCE PURPOSES ONLY/i.test(t)) refOnly++;
      if (/creativecommons|Creative Commons/i.test(t)) cc++;
      titles.push({ path: sub(b.path), title: (t.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || '', chars: baseChars(t.replace(/<head>[\s\S]*?<\/head>/i, '')) });
    });
    for (const x of titles) chars += x.chars;
    measured[k] = { texts: fs_.length, bytes, base_chars: chars, files_marked_reference_only: refOnly, files_with_cc_notice: cc, titles };
  }
  // Gauḍīya: the vaiṣṇava directory also holds Pāñcarātra / Vaikhānasa texts — keep Gauḍīya authors only
  const GAUDIYA = /\b(R[uū]pa|San[aā]tana|J[iī]va'?s?|Gosv[aā]m\w*|K[rṛ][sṣ][nṇ]ad[aā]sa|Raghun[aā]tha\w*|Gop[aā]la ?bha[tṭ]+a|Vi[sś]van[aā]tha|Baladeva|Kavikar[nṇ]ap[uū]ra|Prabodh[aā]nanda|Caitanya\w*|Narottama|Bhaktivinoda)\b/i;
  const g = measured.vaisnava.titles.filter(x => GAUDIYA.test(x.title));
  measured.gaudiya = { texts: g.length, base_chars: g.reduce((a, x) => a + x.chars, 0), titles: g.map(x => x.title),
    files_marked_reference_only: null, note: 'Gauḍīya-author titles within 1_sanskr/4_rellit/vaisn (regex on the <title> author names)' };
  const sampleBytes = measured.buddhist.bytes + measured.vedanta.bytes + measured.vaisnava.bytes;
  const sampleChars = measured.buddhist.base_chars + measured.vedanta.base_chars + measured.vaisnava.base_chars;
  const allBytes = texts.reduce((a, b) => a + b.size, 0);
  return { tree_sha: tree.sha, files: skt.length, texts_after_variant_merge: texts.length, bytes_after_variant_merge: allBytes,
    whole_base_chars_est: Math.round(allBytes * sampleChars / sampleBytes), measured,
    method: `git tree API: ${skt.length} Sanskrit .htm files → ${texts.length} after merging transliteration variants; subsets downloaded and counted; whole Sanskrit section = merged bytes × measured chars/byte of the three subsets (${(sampleChars / sampleBytes).toFixed(3)})` };
}

async function sefaria() {
  const items = []; let tok = null;
  do {
    const d = JSON.parse((await fetchRaw(`https://storage.googleapis.com/storage/v1/b/sefaria-export/o?prefix=txt/Kabbalah/&fields=items(name,size),nextPageToken${tok ? `&pageToken=${encodeURIComponent(tok)}` : ''}`)).buf.toString('utf8'));
    items.push(...(d.items || [])); tok = d.nextPageToken;
  } while (tok);
  const merged = items.filter(i => i.name.endsWith('/merged.txt'));
  const titleOf = n => n.split('/').slice(-3, -2)[0];
  const subOf = n => n.split('/')[2];
  const he = merged.filter(i => i.name.includes('/Hebrew/'));
  const en = new Map(merged.filter(i => i.name.includes('/English/')).map(i => [titleOf(i.name), +i.size]));
  const SUBSETS = {
    zohar: i => subOf(i.name) === 'Zohar' && /^(Zohar|Zohar Chadash|Tikkunei Zohar)$/.test(titleOf(i.name)),
    lurianic: i => subOf(i.name) === 'Arizal and Chaim Vital',
    cordovero: i => subOf(i.name) === 'Ramak',
  };
  async function countTitle(i) {
    const title = titleOf(i.name);
    const t = (await fetchCached(`https://storage.googleapis.com/sefaria-export/${encodeURI(i.name)}`)).toString('utf8');
    const body = t.replace(/^[\s\S]*?\n\n/, ''); // drop the export header (title, version list)
    const c = await fetchJson(`https://www.sefaria.org/api/counts/${encodeURIComponent(title)}`);
    let heSeg = 0, enSeg = 0;
    (function walk(n) { if (!n || typeof n !== 'object') return;
      if (n._he?.availableTexts) heSeg += flat(n._he.availableTexts).filter(x => x > 0).length;
      if (n._en?.availableTexts) enSeg += flat(n._en.availableTexts).filter(x => x > 0).length;
      for (const [k, v] of Object.entries(n)) if (!k.startsWith('_')) walk(v); })(c);
    const versions = await fetchJson(`https://www.sefaria.org/api/texts/versions/${encodeURIComponent(title)}`);
    // the export header lists the versions merged into this file ("-<versionTitle>" lines before the first blank line)
    const used = t.split(/\n\n/)[0].split('\n').filter(l => l.startsWith('-') && !/^-https?:/.test(l)).map(l => l.slice(1).trim());
    const usedLic = used.map(vt => ({ version: vt, license: versions.find(v => v.language === 'he' && v.versionTitle === vt)?.license || 'unknown' }));
    const licClass = usedLic.some(u => !/public domain|cc0|cc-by/i.test(u.license)) ? 'unverified' : usedLic.some(u => /nc/i.test(u.license)) ? 'open-nc' : 'open';
    return { title, sub: subOf(i.name), he_bytes: +i.size, en_bytes: en.get(title) || 0, base_chars: baseChars(body),
      he_segments: heSeg, en_segments: enSeg, en_fraction_segments: heSeg ? round(Math.min(1, enSeg / heSeg), 3) : null,
      sefaria_en_completeness_pct: round(c._en?.completenessPercent, 1),
      merged_he_versions: usedLic, merged_licence_class: licClass,
      he_licences: versions.filter(v => v.language === 'he').map(v => `${v.versionTitle}: ${v.license || 'n/a'}`),
      en_versions: versions.filter(v => v.language === 'en').map(v => `${v.versionTitle}: ${v.license || 'n/a'}`),
      en_ai_flagged: versions.some(v => v.language === 'en' && /\bAI\b|machine|GPT|Gemini|Claude/i.test(v.versionTitle || '')),
      scan_source: versions.some(v => v.language === 'he' && /hebrewbooks|nli\.org|archive\.org|books\.google/i.test(v.versionSource || '')) };
  }
  const subsetRows = {};
  for (const [k, f] of Object.entries(SUBSETS)) subsetRows[k] = await pool(he.filter(f), 3, countTitle);
  const sampled = Object.values(subsetRows).flat();
  const sB = sampled.reduce((a, x) => a + x.he_bytes, 0), sC = sampled.reduce((a, x) => a + x.base_chars, 0);
  const totalHeBytes = he.reduce((a, i) => a + +i.size, 0);
  return { titles: he.length, he_bytes: totalHeBytes, en_titles: en.size, en_bytes: [...en.values()].reduce((a, b) => a + b, 0),
    whole_base_chars_est: Math.round(totalHeBytes * sC / sB), subsets: subsetRows,
    whole_en_fraction_by_bytes_proxy: null,
    method: `GCS bucket sefaria-export txt/Kabbalah listing (${he.length} Hebrew merged.txt, ${(totalHeBytes / 1e6).toFixed(1)} MB); the three subsets downloaded and counted (nikud not counted); whole category = bytes × measured chars/byte (${(sC / sB).toFixed(3)}). English share = segments with English ÷ segments with Hebrew, from /api/counts/{title}` };
}
const flat = a => Array.isArray(a) ? a.flatMap(flat) : [a];

async function openiti() {
  const csv = (await fetchCached('https://raw.githubusercontent.com/OpenITI/kitab-metadata-automation/master/output/OpenITI_Github_clone_metadata_light.csv')).toString('utf8');
  const [head, ...lines] = csv.split('\n').filter(Boolean);
  const cols = head.split('\t');
  const rows = lines.map(l => { const v = l.split('\t'); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); }).filter(r => r.status === 'pri');
  const SUFI = /GAL@sufism|GAL@mysticism|_TASAWWUF|JK@التصوف|LMN@tasawwuf|@التصوف|@الزهد والتصوف|_ZUHD/;
  const sufi = rows.filter(r => SUFI.test(r.tags || '') || /^0638IbnCarabi\./.test(r.book));
  const ia = rows.filter(r => /^0638IbnCarabi\./.test(r.book));
  const s = rs => ({ books: new Set(rs.map(r => r.book)).size, chars: rs.reduce((a, r) => a + (+r.char_length || 0), 0), tokens: rs.reduce((a, r) => a + (+r.tok_length || 0), 0),
    by_language: rs.reduce((a, r) => (a[r.language] = (a[r.language] || 0) + (+r.char_length || 0), a), {}) });
  // calibrate OpenITI's own char_length to base chars on a downloaded sample
  let cl = 0, bc = 0, n = 0;
  await pool(sample(sufi.filter(r => +r.char_length > 0 && +r.char_length < 3e6 && /^https:/.test(r.url || '')), 12, 9), 4, async r => {
    try {
      const t = (await fetchCached(r.url)).toString('utf8');
      const body = t.split('#META#Header#End#').pop().replace(/^###.*$/gm, '').replace(/PageV\d+P\d+|ms\d+|~~|[#|%@]/g, '');
      bc += baseChars(body, { stripTags: false }); cl += +r.char_length; n++;
    } catch { /* skip */ }
  });
  const k = cl ? bc / cl : null;
  const s2 = x => ({ ...x, base_chars: k ? Math.round(x.chars * k) : null });
  return { whole: s2(s(rows)), sufi: s2(s(sufi)), ibn_arabi: { ...s2(s(ia)), titles: ia.map(r => r.book) }, calibration: { sample_texts: n, base_chars_per_openiti_char: round(k, 3) },
    method: `OpenITI kitab-metadata-automation OpenITI_Github_clone_metadata_light.csv, primary (status=pri) version per book, its char_length; converted to base chars with a ratio measured on ${n} downloaded Sufi texts (mARkdown markers stripped); Sufi = genre tags GAL@sufism / GAL@mysticism / _TASAWWUF / JK@التصوف / LMN@tasawwuf, plus every 0638IbnCarabi work` };
}

async function ganjoor() {
  const manifest = await fetchJson('https://cdn.jsdelivr.net/gh/ganjoor/ganjoor-data@main/manifest.json');
  const shards = (await gh('repos/ganjoor/ganjoor-data/contents/index/poems-by-id')).map(f => f.name);
  const picked = sample(shards, 10, 11);
  const paths = [];
  for (const s of picked) { const m = await fetchJson(`https://cdn.jsdelivr.net/gh/ganjoor/ganjoor-data@main/index/poems-by-id/${s}`); paths.push(...sample(Object.values(m), 25, s.length)); }
  let chars = 0, n = 0;
  await pool(paths, 6, async p => {
    try { const d = await fetchJson(`https://cdn.jsdelivr.net/gh/ganjoor/ganjoor-data@main/poets${encodeURI(p)}.json`);
      chars += baseChars((d.Verses || []).map(v => v.Text || '').join(' ')); n++; } catch { /* skip */ }
  });
  return { poets: manifest.PoetsCount, poems: manifest.PoemsCount, generated: manifest.GeneratedAtUtc, sample_poems: n,
    chars_per_poem: round(chars / n, 1), base_chars_est: Math.round(chars / n * manifest.PoemsCount),
    method: `ganjoor/ganjoor-data manifest.json (${manifest.PoemsCount} poems); ${n} poems sampled from ${picked.length} random id shards, verse text counted, scaled by poem count` };
}

async function mongolianKanjur() {
  const col = await fetchJson('https://iiifpres.bdrc.io/collection/wio:bdr:MW4CZ5370');
  const mans = col.manifests || [];
  let canv = 0, ok = 0;
  for (const m of sample(mans, 12, 3)) {
    if (ok >= 6) break;
    try { const d = await fetchJson(m['@id']); canv += (d.sequences?.[0]?.canvases || []).length; ok++; } catch { /* BDRC IIIF 502s intermittently */ }
  }
  const picks = { length: ok };
  return { volumes: mans.length, sample_volumes: ok, images_est: ok ? Math.round(canv / ok * mans.length) : null,
    method: `BDRC IIIF collection wio:bdr:MW4CZ5370 (${mans.length} volume manifests); canvases counted in ${picks.length} sampled volumes, scaled` };
}

async function koreana(cb) {
  const t = await fetchText('http://www.acmuller.net/descriptive_catalogue/indexes/index-taisho.html');
  const txt = htmlToText(t);
  const pairs = [...txt.matchAll(/T (\d+) K (\d+)/g)].map(m => [`T${String(m[1]).padStart(4, '0')}`, +m[2]]);
  const ks = new Set(pairs.map(p => p[1]));
  const tset = new Set(pairs.map(p => p[0]));
  const tRows = cb.ok.filter(r => tset.has(r.work.replace(/[a-z]$/, '')));
  const kRows = cb.ok.filter(r => r.canon === 'K');
  return { lancaster_k_titles: 1514, lancaster_supplement_ks: 85, k_with_taisho_equivalent: ks.size,
    base_chars_via_taisho: cb.chars(tRows) + cb.chars(kRows), cbeta_k_canon_works: kRows.length,
    method: 'Lancaster, The Korean Buddhist Canon: A Descriptive Catalogue (digital ed., acmuller.net) — K 1–1514 + KS 1–85; Taishō→K concordance (index-taisho.html) mapped onto CBETA chars_no_spaces of the matching T works, plus CBETA K-canon works. A proxy: the K-Tripitaka e-text itself was unreachable from this host.' };
}

async function kanripo() {
  const idx = await gh('repos/kanripo/KR-Catalog/contents/KR');
  const juan = {};
  for (const f of idx.filter(f => f.name.endsWith('.txt'))) {
    const txt = await fetchText(`https://raw.githubusercontent.com/kanripo/KR-Catalog/master/KR/${f.name}`);
    for (const block of txt.split(/^\*\*\* /m).slice(1)) {
      const id = (block.match(/^(KR\d[a-z]\d{4})\s/) || [])[1];
      if (!id) continue;
      const ext = (block.match(/^\s*:EXTENT:\s*(\d+)\s*卷/m) || [])[1];
      juan[id] = ext ? +ext : null;
    }
  }
  const ids = Object.keys(juan);
  const bySec = {}; for (const id of ids) (bySec[id.slice(0, 3)] ||= []).push(id);
  const result = { works: ids.length, works_with_extent: ids.filter(id => juan[id]).length, sections: {} };
  for (const [sec, list] of Object.entries(bySec).sort()) {
    const picks = sample(list, sec === 'KR6' ? 8 : 40, sec.charCodeAt(2));
    let chars = 0, n = 0, sj = 0, sjc = 0;
    await pool(picks, 4, async id => {
      try {
        const t = await ghTree(`kanripo/${id}`);
        const txts = t.blobs.filter(b => /\.txt$/.test(b.path) && !/Readme/i.test(b.path));
        let c = 0;
        for (const b of txts) c += baseChars((await fetchCached(`https://raw.githubusercontent.com/kanripo/${id}/${t.sha}/${encodeURI(b.path)}`)).toString('utf8')
          .split('\n').filter(l => !l.startsWith('#')).join('\n').replace(/<pb:[^>]*>|¶/g, ''));
        chars += c; n++;
        if (juan[id]) { sj += juan[id]; sjc += c; }
      } catch { /* repo missing */ }
    });
    const totalJuan = list.reduce((a, id) => a + (juan[id] || 0), 0), noExt = list.filter(id => !juan[id]).length;
    const mean = n ? chars / n : null, perJuan = sj ? sjc / sj : null;
    const ratioEst = perJuan != null ? Math.round(perJuan * totalJuan + (mean || 0) * noExt) : null;
    result.sections[sec] = { works: list.length, juan: totalJuan, works_without_extent: noExt, sample_works: n, mean_chars: round(mean), chars_per_juan: round(perJuan),
      base_chars_est: ratioEst ?? (mean != null ? Math.round(mean * list.length) : null), base_chars_est_by_mean: mean != null ? Math.round(mean * list.length) : null };
  }
  const sumSec = f => Object.entries(result.sections).filter(([k]) => f(k)).reduce((a, [, s]) => a + (s.base_chars_est || 0), 0);
  result.base_chars_est = sumSec(() => true);
  result.base_chars_est_excl_kr6 = sumSec(k => k !== 'KR6');
  result.method = 'KR-Catalog work ids and :EXTENT: juan counts per section; 40 works sampled per section (8 for KR6, which mirrors CBETA), every .txt in the default branch downloaded and counted; section total = measured chars per juan × catalogue juan (+ sample mean × works lacking an EXTENT). The per-work mean estimate is kept alongside; the two differ where a few very long works dominate';
  return result;
}

async function worksCatalogCoverage() {
  const pgc = pgClient(); await pgc.connect();
  const q = async s => (await pgc.query(s)).rows;
  const status = await q(`select source_catalog, translation_status, count(*)::int n from works where source_catalog in ('kanripo','cbeta','openiti','gretil','sefaria') group by 1,2`);
  const scans = await q(`select w.source_catalog, count(distinct w.id)::int n from works w join work_sources s on s.work_id=w.id and s.kind='scan' where w.source_catalog in ('kanripo','cbeta','openiti','gretil','sefaria') group by 1`);
  const totals = await q(`select source_catalog, count(*)::int n from works where source_catalog in ('kanripo','cbeta','openiti','gretil','sefaria') group by 1`);
  await pgc.end();
  const out = {};
  for (const t of totals) out[t.source_catalog] = { works: t.n, with_scan_source: scans.find(s => s.source_catalog === t.source_catalog)?.n || 0,
    translation_status: Object.fromEntries(status.filter(s => s.source_catalog === t.source_catalog).map(s => [s.translation_status, s.n])) };
  return out;
}


// ---------------------------------------------------------------- Latin and Greek (#6220)
/** Letter runs: the word unit Corpus Corporum counts (punctuation and paratext excluded). */
const words = s => (s.match(/\p{L}+/gu) || []).length;
const teiBody = t => t.replace(/<teiHeader[\s\S]*?<\/teiHeader>/, '').replace(/<note[\s\S]*?<\/note>/g, '');

/** Corpus Corporum (Zurich): per-corpus text and word counts from its own navigation API. */
async function corpusCorporum() {
  const xml = (await fetchLive('https://mlat.uzh.ch/php_modules/navigate.php?load=/')).text;
  const corpora = [...xml.matchAll(/<corpus type="corpus">([\s\S]*?)<\/corpus>/g)].map(m => {
    const g = k => (m[1].match(new RegExp(`<${k}>([^<]*)`)) || [])[1];
    return { nr: +g('nr'), idno: g('idno'), name: g('name'), texts: +g('texts_count'), accessible_texts: +g('accessible_texts_count'), works: +g('works_count'), authors: +g('authors_count'), words: +g('words_count'), source: g('source') };
  });
  // base chars per word, measured on the Open Greek and Latin EpiDoc of the PL (the text Corpus Corporum loaded)
  const tree = await ghTree('OpenGreekAndLatin/patrologia_latina-dev');
  const files = tree.blobs.filter(b => /^data\/.*-lat\d*\.xml$/.test(b.path));
  let c = 0, w = 0, n = 0;
  await pool(sample(files, 12, 6220), 4, async f => {
    const t = teiBody((await fetchCached(`https://raw.githubusercontent.com/OpenGreekAndLatin/patrologia_latina-dev/${tree.sha}/${encodeURI(f.path)}`)).toString('utf8')).replace(/<[^>]*>/g, ' ');
    c += baseChars(t, { stripTags: false }); w += words(t); n++;
  });
  return { corpora, chars_per_word: round(c / w, 3), calibration: { repo: 'OpenGreekAndLatin/patrologia_latina-dev', sha: tree.sha, sample_files: n, base_chars: c, words: w },
    source: 'https://mlat.uzh.ch/php_modules/navigate.php?load=/ (Corpus Corporum navigation API: texts_count, words_count per corpus)' };
}

/**
 * A CTS repository (Perseus, First1KGreek): one source-language edition per work (the largest), and
 * whether the same work folder holds an English translation. English share = source bytes of works
 * with English ÷ all source bytes, the SuttaCentral method.
 */
async function ctsRepo(repo, srcLang, sampleN, seed) {
  const tree = await ghTree(repo);
  const re = new RegExp(`^data/([^/]+/[^/]+)/[^/]+-${srcLang}\\d*\\.xml$`), en = /^data\/([^/]+\/[^/]+)\/[^/]+-eng\d*\.xml$/;
  const works = new Map(), eng = new Set();
  for (const b of tree.blobs) {
    const m = b.path.match(re);
    if (m && (!works.has(m[1]) || works.get(m[1]).size < b.size)) works.set(m[1], b);
    const e = b.path.match(en); if (e) eng.add(e[1]);
  }
  const ed = [...works.entries()];
  const bytes = ed.reduce((a, [, b]) => a + b.size, 0), enBytes = ed.filter(([k]) => eng.has(k)).reduce((a, [, b]) => a + b.size, 0);
  let sb = 0, sc = 0, n = 0;
  await pool(sample(ed.map(([, b]) => b).filter(b => b.size < 8e6), sampleN, seed), 4, async b => {
    const buf = await fetchCached(`https://raw.githubusercontent.com/${repo}/${tree.sha}/${encodeURI(b.path)}`);
    sb += buf.length; sc += baseChars(teiBody(buf.toString('utf8'))); n++;
  });
  return { tree_sha: tree.sha, works: works.size, works_with_english: ed.filter(([k]) => eng.has(k)).length, bytes, base_chars: Math.round(bytes * sc / sb),
    english_fraction_by_bytes: round(enBytes / bytes, 3),
    method: `git tree API: ${works.size} works with a ${srcLang} edition under data/ (largest edition per work, ${(bytes / 1e6).toFixed(0)} MB); ${n} sampled editions downloaded and counted (teiHeader and notes excluded), chars scaled by bytes (${(sc / sb).toFixed(3)} base chars/byte)`,
    english_method: `${repo}: works whose folder also holds an -eng translation, weighted by source-edition bytes` };
}

/** Sefaria counts for every title in a TOC category path (segments with English ÷ segments with Hebrew). */
async function sefariaCategory(path) {
  const toc = await fetchJson('https://www.sefaria.org/api/index');
  let node = { contents: toc };
  for (const c of path) node = node.contents.find(x => x.category === c);
  const titles = [];
  // the six orders only (Seder Zeraim … Seder Tahorot); the category's commentary branches are skipped
  for (const seder of node.contents.filter(x => /^Seder /.test(x.category || ''))) for (const x of seder.contents || []) if (x.title && !x.category) titles.push(x.title);
  let he = 0, en = 0;
  await pool(titles, 1, async t => {
    const c = await fetchJson(`https://www.sefaria.org/api/counts/${encodeURIComponent(t)}`);
    (function walk(n) { if (!n || typeof n !== 'object') return;
      if (n._he?.availableTexts) he += flat(n._he.availableTexts).filter(x => x > 0).length;
      if (n._en?.availableTexts) en += flat(n._en.availableTexts).filter(x => x > 0).length;
      for (const [k, v] of Object.entries(n)) if (!k.startsWith('_')) walk(v); })(c);
  });
  return { titles: titles.length, he_segments: he, en_segments: en, fraction: he ? round(Math.min(1, en / he), 3) : null };
}

/**
 * Canons with a complete or near-complete English translation: listed with their English share and
 * its source, never priced as gaps.
 */
async function alreadyInEnglish(sc) {
  const tz = htmlToText((await fetchLive('https://tanzil.net/trans/')).text);
  const tanzilEnglish = (tz.match(/\bEnglish (?!Transliteration)[A-Z]/g) || []).length;
  const eb = htmlToText((await fetchLive('https://ebible.org/find/details.php?id=eng-kjv2006')).text);
  const mishnah = await sefariaCategory(['Mishnah']);
  const bavli = await sefariaCategory(['Talmud', 'Bavli']);
  const sutta = sc.by_pitaka.sutta;
  return [
    { id: 'bible', corpus: 'Bible (Hebrew Bible and New Testament)', tradition: 'Jewish and Christian scripture', url: 'https://ebible.org/find/details.php?id=eng-kjv2006', english: { fraction: 1, complete_translations: 'many; e.g. the King James Version, public domain',
      source: 'https://ebible.org/find/details.php?id=eng-kjv2006', quote: /public domain/.test(eb) ? 'King James (Authorized) Version … public domain' : null, note: 'Complete English translations exist; eBible.org lists the King James Version as public domain.' } },
    { id: 'quran', corpus: "Qur'an", tradition: 'Islamic scripture', url: 'https://tanzil.net/trans/', english: { fraction: 1, complete_translations: tanzilEnglish || null,
      source: 'https://tanzil.net/trans/', note: `Tanzil lists ${tanzilEnglish} complete English translations, among them Arberry, Pickthall and Saheeh International.` } },
    { id: 'mishnah', corpus: 'Mishnah', tradition: 'Rabbinic Judaism', url: 'https://www.sefaria.org/texts/Mishnah', english: { fraction: mishnah.fraction, titles: mishnah.titles, he_segments: mishnah.he_segments, en_segments: mishnah.en_segments,
      source: 'https://www.sefaria.org/api/counts/{title} for every tractate under Mishnah in https://www.sefaria.org/api/index', note: `Share of Sefaria's passages that have English, over all ${mishnah.titles} tractates.` } },
    { id: 'talmud-bavli', corpus: 'Babylonian Talmud', tradition: 'Rabbinic Judaism', url: 'https://www.sefaria.org/texts/Talmud', english: { fraction: bavli.fraction, titles: bavli.titles, he_segments: bavli.he_segments, en_segments: bavli.en_segments,
      source: 'https://www.sefaria.org/api/counts/{title} for every tractate under Talmud › Bavli in https://www.sefaria.org/api/index', note: `Share of Sefaria's passages that have English, over all ${bavli.titles} tractates, mainly the William Davidson translation.` } },
    { id: 'pali-suttas', corpus: 'Pali suttas (Sutta Piṭaka)', tradition: 'Theravāda', url: 'https://suttacentral.net', english: { fraction: round(sutta.en_bytes / sutta.bytes, 3), files: sutta.files, en_files: sutta.en_files,
      source: sc.source, note: 'Share of the Pali sutta text on SuttaCentral that has an English translation there; printed translations are not counted. The untranslated rest is priced in the Pali canon rows.' } },
  ];
}

// ---------------------------------------------------------------- assemble
const LIC_FACTOR = { open: 1, 'open-nc': 0.75, 'reference-only': 0.25, unverified: 0.25, restricted: 0 };
const PAIR_FACTOR = { yes: 1, partial: 0.6, no: 0.3, unknown: 0.3 };

async function main() {
  const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
  const db = mc.db('bookstore');
  log('— rates'); const rates = await measureRates(db);
  log('— holdings'); const hold = await holdings(db);
  await mc.close();
  log('— works catalog'); const wc = await worksCatalogCoverage();
  log('— 84000'); const e84 = await read84000();
  log('— Esukhia'); const teng = await esukhia('Esukhia/derge-tengyur', 14); const kang = await esukhia('Esukhia/derge-kangyur', 10);
  const bdrc = { tengyur: await bdrcAccess('W23703'), kangyur: await bdrcAccess('W22084'), mongolian: await bdrcAccess('W4CZ5370') };
  log('— CBETA'); const cb = await cbeta();
  log('— VRI'); const pali = await vri(); const sc = await suttacentral();
  log('— GRETIL'); const gr = await gretil();
  log('— Sefaria'); const sef = await sefaria();
  log('— OpenITI'); const oi = await openiti();
  log('— Ganjoor'); const gj = await ganjoor();
  log('— Mongolian Kanjur'); const mk = await mongolianKanjur();
  log('— Tripitaka Koreana'); const tk = await koreana(cb);
  log('— Kanripo'); const kr = await kanripo();
  log('— Corpus Corporum'); const cc = await corpusCorporum();
  log('— Perseus / First1KGreek'); const pgrc = await ctsRepo('PerseusDL/canonical-greekLit', 'grc', 40, 61);
  const plat = await ctsRepo('PerseusDL/canonical-latinLit', 'lat', 40, 62); const f1k = await ctsRepo('OpenGreekAndLatin/First1KGreek', 'grc', 40, 63);
  log('— already in English'); const already = await alreadyInEnglish(sc);

  // licences — quoted, re-fetched, checked
  log('— licences');
  const LIC = {
    esukhiaT: await licence({ url: 'https://raw.githubusercontent.com/Esukhia/derge-tengyur/master/README.md', quote: 'This work is a mechanical reproduction of a Public domain work, and as such is also in the Public domain.', label: 'Public domain', open: 'open' }),
    esukhiaK: await licence({ url: 'https://raw.githubusercontent.com/Esukhia/derge-kangyur/master/README.md', quote: 'This work is a mechanical reproduction of a Public Domain work, and as such is also in the Public Domain.', label: 'Public domain', open: 'open' }),
    cbeta: await licence({ url: 'https://www.cbeta.org/copyright.php', quote: '核心授權 ：除下方「二、底本來源與授權分類」中特別註明不適用之文獻外，本資料庫未特別說明處皆採用「Creative Commons 姓名標示-非商業性-相同方式分享 4.0 國際授權條款」釋出。', label: 'CC BY-NC-SA 4.0 (core; Category B collections excluded; non-profit use only)', open: 'open-nc' }),
    vri: await licence({ url: 'https://raw.githubusercontent.com/vipassanatech/tipitaka-xml/main/README.md', quote: 'These files are made freely available for non-commericial use. Please attribute Vipassana Research Institute when incorporating these files into your projects.', label: 'free for non-commercial use, attribution (VRI)', open: 'open-nc' }),
    gretil: await licence({ url: 'https://raw.githubusercontent.com/INDOLOGY/GRETIL-mirror/main/gretil.sub.uni-goettingen.de/gretil/1_sanskr/4_rellit/vaisn/ruphbr_u.htm', quote: 'THIS GRETIL TEXT FILE IS FOR REFERENCE PURPOSES ONLY! COPYRIGHT AND TERMS OF USAGE AS FOR SOURCE FILE.', label: "per file; most files say 'for reference purposes only… terms of usage as for source file'", open: 'reference-only', note: 'quote is the standard GRETIL file header (example file shown); per-subset counts of files carrying it are in size.measured' }),
    sefaria: { label: 'per version (Sefaria API `license` field)', url: 'https://www.sefaria.org/api/texts/versions/{title}', quote: 'see subsets[].he_licences (quoted per version from the API)', verified: true, open: 'open', note: 'every Hebrew version used by the Zohar / Lurianic / Cordovero subsets is listed with its licence string; check before import' },
    openiti: await licence({ url: 'https://zenodo.org/api/records/3082463/versions/latest', quote: '"license": {"id": "cc-by-nc-sa-4.0"}', label: 'CC BY-NC-SA 4.0 (Zenodo record of the OpenITI release)', open: 'open-nc' }),
    ganjoor: await licence({ url: 'https://github.com/ganjoor/ganjoor-data', quote: null, note: 'ganjoor/ganjoor-data has no LICENSE file and the GitHub API reports none; the RMuseum API spec (api.ganjoor.net/swagger) has no licence field; no licence sentence found on ganjoor.net' }),
    bdrcMong: { label: 'BDRC adm:access ' + bdrc.mongolian.access + ' (scans); no open typed text found', url: bdrc.mongolian.url, quote: bdrc.mongolian.access, verified: bdrc.mongolian.access !== 'unknown', open: 'unverified', note: 'access status ≠ a reuse licence; BDRC asks attribution' },
    koreana: await licence({ url: 'https://kb.sutra.re.kr/', quote: null, note: 'K-Tripitaka site (Research Institute of Tripitaka Koreana) did not answer from this host (connection failed); licence unverified. CBETA carries only its K-canon supplement under its own licence.' }),
    kanripo: await licence({ url: 'https://api.github.com/orgs/kanripo', quote: 'Licensed as CC BY SA 4.0.', label: 'CC BY-SA 4.0 (Kanripo GitHub organisation profile)', open: 'open', viaApi: true }),
    corpusCorporum: await licence({ url: 'https://mlat.uzh.ch/cc_modules/home.js', quote: 'Texts may be downloaded as TEI xml for non-commercial use and can thus be reused by other researchers.', label: 'non-commercial reuse (Corpus Corporum "About" text)', open: 'open-nc',
      note: "The same page says the texts \"stem from various online sources\" and are \"either in the public domain or their use was granted us by their owners\". The Open Greek and Latin EpiDoc of the PL on GitHub (patrologia_latina-dev) states no licence." }),
    camena: await licence({ url: 'http://mateo.uni-mannheim.de/camenahtdocs/camena_e.html', quote: 'The machine-readable texts of CAMENA (and MATEO / Alte Drucke) may be used in compliance with the licence Creative Commons Attribution / Share Alike.', label: 'CC BY-SA (CAMENA project page; links CC BY-SA 3.0)', open: 'open' }),
    perseusGrc: await licence({ url: 'https://raw.githubusercontent.com/PerseusDL/canonical-greekLit/master/README.md', quote: 'Unless otherwise indicated, all contents of this repository are licensed under a Creative Commons Attribution-ShareAlike 4.0 International License.', label: 'CC BY-SA 4.0 unless otherwise indicated (repository README)', open: 'open',
      note: 'The same README: "Materials within the Perseus DL have varying copyright status"; check each file header before import.' }),
    perseusLat: await licence({ url: 'https://raw.githubusercontent.com/PerseusDL/canonical-latinLit/master/README.md', quote: 'Unless otherwise indicated, all contents of this repository are licensed under a Creative Commons Attribution-ShareAlike 4.0 International License.', label: 'CC BY-SA 4.0 unless otherwise indicated (repository README)', open: 'open',
      note: 'The same README: "Materials within the Perseus DL have varying copyright status"; check each file header before import.' }),
    first1k: await licence({ url: 'https://raw.githubusercontent.com/OpenGreekAndLatin/First1KGreek/master/license.md', quote: 'Attribution-ShareAlike 4.0 International', label: 'CC BY-SA 4.0 (repository license.md)', open: 'open' }),
  };

  const rate = k => rates[k]?.usd_per_million_chars;
  const cost = (chars, k) => chars != null && rate(k) ? round(chars / 1e6 * rate(k), 0) : null;
  const pageEq = (chars, k) => chars != null && rates[k]?.base_chars_per_page ? Math.round(chars / rates[k].base_chars_per_page) : null;
  const row = r => {
    const untr = r.size.base_chars != null ? (r.english.fraction != null ? Math.round(r.size.base_chars * (1 - r.english.fraction)) : r.size.base_chars) : null;
    r.cost = { rate_key: r.lang, lane: rates[r.lang]?.lane, usd_per_million_chars: rate(r.lang), untranslated_base_chars: untr,
      page_equivalents: pageEq(untr, r.lang), english_words_est: untr != null && rates[r.lang]?.english_words_per_source_char ? Math.round(untr * rates[r.lang].english_words_per_source_char) : null,
      usd: cost(untr, r.lang),
      bound: r.english.fraction == null ? 'upper bound — English coverage unknown, whole corpus priced' : 'untranslated share only',
      ...(r.cost_extra || {}) };
    delete r.cost_extra;
    r.score = r.cost.english_words_est != null ? Math.round(r.cost.english_words_est / 1e3 * LIC_FACTOR[r.licence.open] * PAIR_FACTOR[r.pairing.status]) : null;
    return r;
  };
  const ccPL = cc.corpora.find(c => c.name === 'Patrologia Latina'), ccNeo = cc.corpora.find(c => /CAMENA/.test(c.source || ''));
  const CAMENA_PAGES = 60000; // quoted: "more than 60.000 pages" (camena_e.html)
  const kP = e84.total.Kangyur.pages, kPub = e84.by_status.Kangyur.Published?.pages || 0, kProg = e84.by_status.Kangyur['In Progress']?.pages || 0;
  const tP = e84.total.Tengyur.pages, tPub = e84.by_status.Tengyur.Published?.pages || 0, tProg = e84.by_status.Tengyur['In Progress']?.pages || 0;
  const TIB_FRAME = 0.0024; // brief #5513: Tibetan flash chained batch, per page-frame
  const scMul = sc.english_fraction_by_root_bytes;
  const sefSub = k => { const rs = sef.subsets[k]; const he = rs.reduce((a, x) => a + x.he_segments, 0), en = rs.reduce((a, x) => a + Math.min(x.en_segments, x.he_segments), 0);
    return { chars: rs.reduce((a, x) => a + x.base_chars, 0), en: he ? round(en / he, 3) : null, titles: rs.map(x => x.title), ai: rs.filter(x => x.en_ai_flagged).map(x => x.title), scans: rs.filter(x => x.scan_source).map(x => x.title),
      lic: rs.some(x => x.merged_licence_class === 'unverified') ? 'unverified' : rs.some(x => x.merged_licence_class === 'open-nc') ? 'open-nc' : 'open' }; };
  const zo = sefSub('zohar'), lu = sefSub('lurianic'), co = sefSub('cordovero');
  const wcStat = k => wc[k] ? `${wc[k].translation_status.full || 0} full + ${wc[k].translation_status.partial || 0} partial of ${wc[k].works} works evidenced in the SL works catalog (recall floor, not a coverage figure)` : null;

  const rows = [
    row({ id: 'derge-tengyur', corpus: 'Derge Tengyur', tradition: 'Tibetan Buddhist (Indian śāstra in Tibetan)', partner: 'Nālandā Restored (Eternity; per #5497)', lang: 'tibetan',
      source: { name: 'Esukhia digital Derge Tengyur', url: 'https://github.com/Esukhia/derge-tengyur', sha: teng.tree_sha }, licence: LIC.esukhiaT,
      size: { texts: e84.total.Tengyur.texts, texts_source: '84000 catalogue (toh > 1108)', folio_sides_84000: tP, folio_sides_markers_est: teng.folio_sides_from_markers, base_chars: teng.base_chars, bytes: teng.bytes, method: teng.method },
      english: { fraction: round(tPub / tP, 4), published_pages: tPub, in_progress_pages: tProg, source: e84.source, note: 'page-weighted (84000 num_pages = Degé folio sides)' },
      holdings: hold.tengyur, pairing: { status: bdrc.tengyur.access === 'AccessOpen' ? 'yes' : 'unknown', source: 'BDRC W23703 (Derge Tengyur scans), ' + bdrc.tengyur.access, url: 'https://library.bdrc.io/show/bdr:W23703' },
      cost_extra: { per_page_measured_usd: round((tP - tPub) * rates.tibetan.usd_per_page, 0), cross_check_frames_usd: round((tP - tPub) * TIB_FRAME, 0),
        cross_check: `${tP - tPub} untranslated 84000 pages × measured $${rates.tibetan.usd_per_page}/page = per_page_measured_usd; × $${TIB_FRAME}/page-frame (brief's figure) = cross_check_frames_usd. The per-char figure is lower because a Degé folio side (${Math.round(teng.base_chars / tP)} chars) is shorter than our average Tibetan page (${rates.tibetan.base_chars_per_page}), and per-request prompt overhead does not shrink with the page` } }),
    row({ id: 'derge-kangyur', corpus: 'Derge Kangyur', tradition: 'Tibetan Buddhist (canonical sūtra/tantra)', partner: 'unknown (84000 is the established English partner)', lang: 'tibetan',
      source: { name: 'Esukhia digital Derge Kangyur', url: 'https://github.com/Esukhia/derge-kangyur', sha: kang.tree_sha }, licence: LIC.esukhiaK,
      size: { texts: e84.total.Kangyur.texts, texts_source: '84000 catalogue (toh ≤ 1108)', folio_sides_84000: kP, folio_sides_markers_est: kang.folio_sides_from_markers, base_chars: kang.base_chars, bytes: kang.bytes, method: kang.method },
      english: { fraction: round(kPub / kP, 4), published_pages: kPub, in_progress_pages: kProg, source: e84.source, note: `page-weighted; a further ${kProg} pages are "In Progress" at 84000 — a draft there competes with funded human work` },
      holdings: hold.kangyur, pairing: { status: bdrc.kangyur.access === 'AccessOpen' ? 'yes' : 'unknown', source: 'BDRC W22084 (Derge Kangyur scans), ' + bdrc.kangyur.access, url: 'https://library.bdrc.io/show/bdr:W22084' },
      cost_extra: { per_page_measured_usd: round((kP - kPub) * rates.tibetan.usd_per_page, 0), cross_check_frames_usd: round((kP - kPub) * TIB_FRAME, 0), excluding_in_progress_usd: cost(Math.round(kang.base_chars * (1 - (kPub + kProg) / kP)), 'tibetan') } }),
    row({ id: 'cbeta', corpus: 'CBETA (whole Chinese Buddhist canon)', tradition: 'Chinese Buddhist', partner: 'unknown', lang: 'chinese',
      source: { name: 'CBETA XML P5', url: 'https://github.com/cbeta-org/xml-p5' }, licence: LIC.cbeta,
      size: { texts: cb.whole.texts, base_chars: cb.whole.base_chars, cjk_chars: cb.whole.cjk_chars, t_plus_x: cb.tx, excluded_category_b: cb.CAT_B, method: cb.method },
      english: { fraction: null, source: null, floor: wcStat('cbeta'), note: 'unknown — BDK English Tripiṭaka (bdkamerica.org/tripitaka-list) lists its volumes by title only, without Taishō numbers or sizes, so no measured share' },
      holdings: hold.cbeta, pairing: { status: 'partial', source: `SL works catalog: ${wc.cbeta?.with_scan_source || 0}/${wc.cbeta?.works || 0} CBETA works have a matched scan (other editions); Taishō print is ©`, url: null } }),
    row({ id: 'cbeta-chan', corpus: 'CBETA — Chan subset (景德傳燈錄, 祖堂集, 五燈會元, 語錄 in T47–48 and X)', tradition: 'Chan / Zen', partner: 'unknown', lang: 'chinese', subset_of: 'cbeta',
      source: { name: 'CBETA XML P5', url: 'https://github.com/cbeta-org/xml-p5' }, licence: LIC.cbeta,
      size: { texts: cb.chanSize.texts, base_chars: cb.chanSize.base_chars, titles: cb.chanSize.titles, method: cb.method + "; titles 景德傳燈錄/祖堂集/五燈會元 exactly, plus 語錄/廣錄/語要 titles in T47–T48 or the X canon" },
      english: { fraction: null, source: null, note: 'unknown — several classics (Linji lu, Blue Cliff, Platform Sūtra) are translated, but there is no bibliography mapped to these work ids' },
      holdings: hold.cbeta_chan, pairing: { status: 'partial', source: 'as CBETA', url: null } }),
    row({ id: 'pali-mula', corpus: 'Pali Chaṭṭha Saṅgāyana — root texts (mūla)', tradition: 'Theravāda', partner: 'unknown', lang: 'pali',
      source: { name: 'VRI CSCD tipitaka-xml', url: 'https://github.com/vipassanatech/tipitaka-xml', sha: pali.tree_sha }, licence: LIC.vri,
      size: { texts: pali.mul.files, texts_unit: 'VRI files (books/volumes)', base_chars: pali.mul.base_chars, bytes: pali.mul.bytes, method: pali.method },
      english: { fraction: scMul, source: sc.source, by_pitaka: sc.by_pitaka, note: 'SuttaCentral only — PTS and other print translations (e.g. the whole Abhidhamma) are not counted, so this understates English coverage' },
      holdings: hold.pali, pairing: { status: 'unknown', source: 'no open scan of the CSCD (Chaṭṭha Saṅgāyana) print checked', url: null } }),
    row({ id: 'pali-atthakatha', corpus: 'Pali Chaṭṭha Saṅgāyana — commentaries (aṭṭhakathā)', tradition: 'Theravāda', partner: 'unknown', lang: 'pali',
      source: { name: 'VRI CSCD tipitaka-xml', url: 'https://github.com/vipassanatech/tipitaka-xml', sha: pali.tree_sha }, licence: LIC.vri,
      size: { texts: pali.att.files, texts_unit: 'VRI files', base_chars: pali.att.base_chars, bytes: pali.att.bytes, method: pali.method },
      english: { fraction: null, source: null, note: 'unknown — SuttaCentral carries no aṭṭhakathā; PTS translations of some exist, no bibliography measured' },
      holdings: { ...hold.pali, method: 'shared with root texts row (Pali books are not split by layer)' }, pairing: { status: 'unknown', source: 'not checked', url: null } }),
    row({ id: 'pali-tika', corpus: 'Pali Chaṭṭha Saṅgāyana — sub-commentaries (ṭīkā)', tradition: 'Theravāda', partner: 'unknown', lang: 'pali',
      source: { name: 'VRI CSCD tipitaka-xml', url: 'https://github.com/vipassanatech/tipitaka-xml', sha: pali.tree_sha }, licence: LIC.vri,
      size: { texts: pali.tik.files, texts_unit: 'VRI files', base_chars: pali.tik.base_chars, bytes: pali.tik.bytes, anya_other_texts: pali.nrf, method: pali.method },
      english: { fraction: null, source: null, note: 'unknown' },
      holdings: { ...hold.pali, method: 'shared with root texts row' }, pairing: { status: 'unknown', source: 'not checked', url: null } }),
    ...[['buddhist', 'GRETIL Sanskrit — Buddhist', 'Indian Buddhist (Sanskrit)', hold.gretil_buddhist],
        ['vedanta', 'GRETIL Sanskrit — Vedānta', 'Vedānta', hold.gretil_vedanta],
        ['gaudiya', 'GRETIL Sanskrit — Gauḍīya Vaiṣṇava', 'Gauḍīya Vaiṣṇava', hold.gretil_gaudiya]].map(([k, name, trad, h]) => row({
      id: `gretil-${k}`, corpus: name, tradition: trad, partner: 'unknown', lang: 'sanskrit', source: { name: 'GRETIL (GitHub mirror INDOLOGY/GRETIL-mirror)', url: 'https://github.com/INDOLOGY/GRETIL-mirror', sha: gr.tree_sha },
      licence: { ...LIC.gretil, subset_files_reference_only: gr.measured[k].files_marked_reference_only, subset_files_cc_notice: gr.measured[k].files_with_cc_notice },
      size: { texts: gr.measured[k].texts, base_chars: gr.measured[k].base_chars, titles: k === 'gaudiya' ? gr.measured.gaudiya.titles : undefined, method: gr.method },
      english: { fraction: null, source: null, floor: wcStat('gretil'), note: 'unknown — no bibliography mapped to GRETIL file ids' },
      holdings: h, pairing: { status: 'unknown', source: `SL works catalog: ${wc.gretil?.with_scan_source || 0}/${wc.gretil?.works || 0} GRETIL works have a matched IA scan (edition not checked)`, url: null } })),
    ...[['zohar', 'Sefaria Kabbalah — Zohar (Zohar, Zohar Chadash, Tikkunei Zohar)', zo, hold.zohar],
        ['lurianic', 'Sefaria Kabbalah — Lurianic corpus (Arizal & Chaim Vital, 11 titles)', lu, hold.lurianic],
        ['cordovero', 'Sefaria Kabbalah — Cordovero (Ramak)', co, hold.cordovero]].map(([k, name, s, h]) => row({
      id: `sefaria-${k}`, corpus: name, tradition: 'Kabbalah', partner: 'unknown', lang: 'hebrew', source: { name: 'Sefaria export (GCS sefaria-export)', url: 'https://github.com/Sefaria/Sefaria-Export' },
      licence: { ...LIC.sefaria, open: s.lic, label: `per version (Sefaria API); Hebrew text merged into the export: ${s.lic === 'open' ? 'all PD / CC0 / CC-BY' : s.lic === 'open-nc' ? 'includes CC-BY-NC' : 'includes versions with licence "unknown"'}`,
        merged_versions: sef.subsets[k].map(x => ({ title: x.title, merged_he: x.merged_he_versions })), versions: sef.subsets[k].map(x => ({ title: x.title, he: x.he_licences, en: x.en_versions })) },
      size: { texts: s.titles.length, titles: s.titles, base_chars: s.chars, method: sef.method },
      english: { fraction: s.en, source: 'https://www.sefaria.org/api/counts/{title} (segments with English ÷ segments with Hebrew)', ai_translations_counted: s.ai,
        note: s.ai.length ? `English includes versions titled as AI/machine translations for: ${s.ai.join(', ')} — human coverage is lower` : 'segment-weighted' },
      holdings: h, pairing: { status: s.scans.length ? 'partial' : 'unknown', source: s.scans.length ? `Hebrew version sources point to scans (HebrewBooks/NLI/IA) for: ${s.scans.join(', ')}` : 'no version source points to a scan', url: null } })),
    row({ id: 'openiti-sufi', corpus: 'OpenITI — Sufi subset (incl. Ibn ʿArabī)', tradition: 'Sufism (Arabic/Persian)', partner: 'unknown', lang: 'arabic',
      source: { name: 'OpenITI (kitab-metadata-automation)', url: 'https://github.com/OpenITI' }, licence: LIC.openiti,
      size: { texts: oi.sufi.books, base_chars: oi.sufi.base_chars, openiti_char_length: oi.sufi.chars, calibration: oi.calibration, tokens: oi.sufi.tokens, by_language_chars: oi.sufi.by_language, ibn_arabi: oi.ibn_arabi, whole_openiti: oi.whole, method: oi.method },
      english: { fraction: null, source: null, floor: wcStat('openiti'), note: 'unknown — partial English exists for some (e.g. Fuṣūṣ al-ḥikam), no bibliography measured' },
      holdings: hold.openiti_sufi, pairing: { status: 'partial', source: `SL works catalog: ${wc.openiti?.with_scan_source || 0}/${wc.openiti?.works || 0} OpenITI works matched to an IA scan by title (~93% precision, edition not checked); OpenITI texts themselves come from born-digital libraries`, url: null } }),
    row({ id: 'ganjoor', corpus: 'Ganjoor (Persian poetry)', tradition: 'Persian classical poetry (incl. Rūmī, Ḥāfiẓ, ʿAṭṭār)', partner: 'unknown', lang: 'persian',
      source: { name: 'ganjoor/ganjoor-data', url: 'https://github.com/ganjoor/ganjoor-data' }, licence: LIC.ganjoor,
      size: { texts: gj.poems, poets: gj.poets, base_chars: gj.base_chars_est, method: gj.method },
      english: { fraction: null, source: null, note: 'unknown' },
      holdings: hold.ganjoor, pairing: { status: 'partial', source: 'Ganjoor records paper sources (scanned manuscripts/prints) per poet via its API `paperSources`; not measured per poem', url: 'https://api.ganjoor.net/api/ganjoor/poet/2' } }),
    row({ id: 'mongolian-kanjur', corpus: 'Mongolian Kanjur (BDRC)', tradition: 'Mongolian Buddhist', partner: 'unknown', lang: 'tibetan',
      source: { name: 'BDRC W4CZ5370 (scans only — no open typed text found)', url: 'https://library.bdrc.io/show/bdr:MW4CZ5370' }, licence: LIC.bdrcMong,
      size: { texts: null, volumes: mk.volumes, images: mk.images_est, base_chars: null, method: mk.method },
      english: { fraction: null, source: null, note: 'unknown; content parallels the Tibetan Kangyur (largely translated from it), so English for the same texts exists via 84000' },
      holdings: hold.mongolian_kanjur, pairing: { status: 'yes', source: 'BDRC W4CZ5370, ' + bdrc.mongolian.access, url: 'https://library.bdrc.io/show/bdr:W4CZ5370' },
      cost_extra: { usd: null, note: `no typed text → outside the "typed canon" pattern; would need OCR of ~${mk.images_est} images first (Mongolian script OCR unmeasured)` } }),
    row({ id: 'tripitaka-koreana', corpus: 'Tripitaka Koreana / K-Tripitaka', tradition: 'Korean (Chinese-language) Buddhist canon', partner: 'unknown', lang: 'chinese',
      source: { name: 'K-Tripitaka (Research Institute of Tripitaka Koreana) — unreachable; proxy via CBETA', url: 'https://kb.sutra.re.kr/' }, licence: LIC.koreana,
      size: { texts: tk.lancaster_k_titles + tk.lancaster_supplement_ks, base_chars: tk.base_chars_via_taisho, k_with_taisho_equivalent: tk.k_with_taisho_equivalent, method: tk.method },
      english: { fraction: null, source: null, note: 'unknown (same texts as the Taishō equivalents)' },
      holdings: hold.tripitaka_koreana, pairing: { status: 'unknown', source: 'woodblock rubbing images on the K-Tripitaka site — not reachable to verify', url: null },
      cost_extra: { note: 'NOT additive with CBETA: the Taishō is largely edited from the Koryŏ canon, so this is the same text priced twice' } }),
    row({ id: 'kanripo', corpus: 'Kanripo (Kanseki Repository), excl. KR6 Buddhist section (= CBETA)', tradition: 'Chinese classics, histories, masters, belles-lettres, Daoism, Buddhism', partner: 'unknown', lang: 'chinese',
      source: { name: 'Kanseki Repository', url: 'https://github.com/kanripo' }, licence: LIC.kanripo,
      size: { texts: kr.works - (kr.sections.KR6?.works || 0), base_chars: kr.base_chars_est_excl_kr6, whole_incl_kr6: { works: kr.works, base_chars: kr.base_chars_est }, sections: kr.sections, method: kr.method },
      english: { fraction: null, source: null, floor: wcStat('kanripo'), note: 'unknown (the Siku census #2234 put the imperial canon at ~1–2% translated — a sample, not a measure of Kanripo)' },
      holdings: hold.kanripo, pairing: { status: 'partial', source: `SL works catalog: ${wc.kanripo?.with_scan_source || 0}/${wc.kanripo?.works || 0} Kanripo works have a matched scan (IA-CADAL / Harvard-Yenching; edition not checked)`, url: null },
      cost_extra: { usd_whole_incl_kr6: cost(kr.base_chars_est, 'chinese'), note: 'KR6 (Buddhist, 4,850 works) mirrors CBETA and is excluded here so the row adds to CBETA without double counting' } }),
    row({ id: 'patrologia-latina', corpus: 'Patrologia Latina (Migne), via Corpus Corporum', tradition: 'Latin Christian: Church Fathers and medieval authors to 1216', partner: 'unknown', lang: 'latin',
      source: { name: 'Corpus Corporum (University of Zurich)', url: 'https://mlat.uzh.ch/browser?path=/38' }, licence: LIC.corpusCorporum,
      size: { texts: ccPL.texts, works: ccPL.works, authors: ccPL.authors, words: ccPL.words, base_chars: Math.round(ccPL.words * cc.chars_per_word), calibration: cc.calibration,
        method: `${cc.source}: corpus "Patrologia Latina" ${ccPL.texts} texts, ${ccPL.words} words; base chars = words × ${cc.chars_per_word} base chars per word, measured on ${cc.calibration.sample_files} sampled PL texts from ${cc.calibration.repo}` },
      english: { fraction: null, source: null, note: 'unknown: no catalogue maps English translations to PL columns. Many Fathers are in English (the 19th-century Ante-Nicene and Nicene and Post-Nicene Fathers series, Fathers of the Church), so the cost is an upper bound' },
      holdings: hold.patrologia_latina, pairing: { status: 'unknown', source: "Migne's printed volumes are on the Internet Archive and Google Books; not matched volume by volume", url: null } }),
    row({ id: 'camena-poemata', corpus: 'CAMENA POEMATA (Neo-Latin poetry by German authors, 16th–17th c.)', tradition: 'Neo-Latin (humanist and early modern)', partner: 'unknown', lang: 'latin',
      source: { name: 'CAMENA (Heidelberg / Mannheim)', url: 'http://mateo.uni-mannheim.de/camenahtdocs/camena_e.html' }, licence: LIC.camena,
      size: { texts: null, pages_stated: CAMENA_PAGES, base_chars: CAMENA_PAGES && rates.latin?.base_chars_per_page ? Math.round(CAMENA_PAGES * rates.latin.base_chars_per_page) : null,
        corpus_corporum_neolatinitas: ccNeo ? { texts: ccNeo.texts, words: ccNeo.words, base_chars: Math.round(ccNeo.words * cc.chars_per_word) } : null,
        method: `CAMENA states POEMATA "presents more than 60.000 pages of early editions reproduced both as images and as machine-readable texts" (camena_e.html); base chars = ${CAMENA_PAGES} pages × our own average Latin page (${rates.latin?.base_chars_per_page} base chars, rates.latin). An estimate: the e-texts are spread over per-author pages with no download list. CAMENA's other four collections (HISTORICA, THESAURUS, CERA, ITALI) are mostly typed as tables of contents and indexes only and are not counted. Cross-check: the 30 CAMENA texts loaded into Corpus Corporum ("Neolatinitas") are counted in corpus_corporum_neolatinitas` },
      english: { fraction: null, source: null, note: 'unknown; very little Neo-Latin poetry has been translated, but no catalogue measures it' },
      holdings: hold.camena, pairing: { status: 'yes', source: 'CAMENA serves the page images of the same printed editions beside each e-text', url: 'http://mateo.uni-mannheim.de/camenahtdocs/camenapoem_e.html' } }),
    row({ id: 'perseus-latin', corpus: 'Perseus classical Latin (canonical-latinLit)', tradition: 'Classical Latin', partner: 'unknown', lang: 'latin',
      source: { name: 'Perseus Digital Library, canonical-latinLit', url: 'https://github.com/PerseusDL/canonical-latinLit', sha: plat.tree_sha }, licence: LIC.perseusLat,
      size: { texts: plat.works, base_chars: plat.base_chars, bytes: plat.bytes, method: plat.method },
      english: { fraction: plat.english_fraction_by_bytes, works_with_english: plat.works_with_english, source: plat.english_method, note: 'Perseus English only; Loeb and other print translations are not counted, so this understates English coverage' },
      holdings: hold.latin_classical, pairing: { status: 'unknown', source: 'the 19th- and early 20th-century source editions are mostly on the Internet Archive; not matched', url: null } }),
    row({ id: 'perseus-greek', corpus: 'Perseus classical Greek (canonical-greekLit)', tradition: 'Classical Greek', partner: 'unknown', lang: 'greek',
      source: { name: 'Perseus Digital Library, canonical-greekLit', url: 'https://github.com/PerseusDL/canonical-greekLit', sha: pgrc.tree_sha }, licence: LIC.perseusGrc,
      size: { texts: pgrc.works, base_chars: pgrc.base_chars, bytes: pgrc.bytes, method: pgrc.method },
      english: { fraction: pgrc.english_fraction_by_bytes, works_with_english: pgrc.works_with_english, source: pgrc.english_method, note: 'Perseus English only; Loeb and other print translations are not counted, so this understates English coverage' },
      holdings: { ...hold.greek, method: `${hold.greek.method}; shared with the First1KGreek row` }, pairing: { status: 'unknown', source: 'the source editions are mostly on the Internet Archive; not matched', url: null } }),
    row({ id: 'first1k-greek', corpus: 'First Thousand Years of Greek (First1KGreek)', tradition: 'Greek: Church Fathers, philosophers, scientists to c. 250 CE and later', partner: 'unknown', lang: 'greek',
      source: { name: 'Open Greek and Latin, First1KGreek', url: 'https://github.com/OpenGreekAndLatin/First1KGreek', sha: f1k.tree_sha }, licence: LIC.first1k,
      size: { texts: f1k.works, base_chars: f1k.base_chars, bytes: f1k.bytes, method: f1k.method },
      english: { fraction: f1k.english_fraction_by_bytes, works_with_english: f1k.works_with_english, source: f1k.english_method, note: 'only translations in the repository are counted; many of these authors have printed English translations, so this understates English coverage' },
      holdings: { ...hold.greek, method: `${hold.greek.method}; shared with the Perseus Greek row` }, pairing: { status: 'unknown', source: 'source editions (Teubner, Migne PG, GCS) partly on the Internet Archive; not matched', url: null } }),
  ];

  // whole-corpus context rows (not in the top-5 ranking)
  const context = {
    gretil_whole_sanskrit: { texts: gr.texts_after_variant_merge, base_chars_est: gr.whole_base_chars_est, usd: cost(gr.whole_base_chars_est, 'sanskrit'), note: 'English coverage unknown → upper bound' },
    sefaria_kabbalah_whole: { titles: sef.titles, base_chars_est: sef.whole_base_chars_est, english_titles: sef.en_titles, usd_upper: cost(sef.whole_base_chars_est, 'hebrew'), note: 'English share for the whole category not measured (subsets only)' },
    openiti_whole: { books: oi.whole.books, base_chars: oi.whole.base_chars, usd_upper: cost(oi.whole.base_chars, 'arabic') },
  };

  // total: the rows as scoped in #5513, without double counting
  const additive = ['derge-tengyur', 'derge-kangyur', 'cbeta', 'pali-mula', 'pali-atthakatha', 'pali-tika', 'gretil-buddhist', 'gretil-vedanta', 'gretil-gaudiya', 'sefaria-zohar', 'sefaria-lurianic', 'sefaria-cordovero', 'openiti-sufi', 'ganjoor',
    'patrologia-latina', 'camena-poemata', 'perseus-latin', 'perseus-greek', 'first1k-greek'];
  const total = additive.reduce((a, id) => a + (rows.find(r => r.id === id).cost.usd || 0), 0) + (rows.find(r => r.id === 'kanripo').cost.usd || 0);
  const ranked = rows.filter(r => r.score != null && !r.subset_of).sort((a, b) => b.score - a.score);

  const result = {
    issue: 5513, generated_at: new Date().toISOString(), script: 'scripts/catalog-coverage/canon-gap-map.mjs',
    method: {
      base_chars: 'non-whitespace, non-combining-mark code points after stripping tags/markers; the same function counts corpora and our pages',
      cost: 'untranslated base chars × measured $/M base chars of the chained Batch translation lane for that language (rates{}); upper bound where English coverage is unknown',
      score: 'untranslated size in thousands of English words (base chars × English words per source char, measured on our own translated pages of that language) × licence factor × pairing factor', licence_factor: LIC_FACTOR, pairing_factor: PAIR_FACTOR,
      holdings: 'Mongo bookstore.books via indexed language / collections / id queries; live = visible:true && pages_count>0; hidden = all other matches. Title-matched: a floor, and editions are not checked unless the method says so',
    },
    rates, measurement: { ...stats, gb_fetched_this_run: round(stats.bytes_fetched / 1e9, 3), gb_downloaded_total: round((stats.bytes_fetched + stats.bytes_from_cache) / 1e9, 3),
      note: 'gb_downloaded_total = everything this script downloaded (this run + its own cache from earlier runs); the ~2 GB budget applies to it', model_calls: 0, spend_usd: 0 },
    total_draft_usd: round(total, 0), total_scope: `${additive.join(' + ')} + kanripo (excl. KR6). Excludes the Chan subset and the Sefaria/OpenITI whole-corpus figures (contained in other rows), Tripitaka Koreana (same text as CBETA T) and the Mongolian Kanjur (no typed text).`,
    ranking_top5: ranked.slice(0, 5).map(r => ({ id: r.id, score: r.score, untranslated_english_words_est: r.cost.english_words_est, licence: r.licence.open, pairing: r.pairing.status, usd: r.cost.usd })),
    rows, context, works_catalog: wc, english_sources: { '84000': e84, suttacentral: sc },
    already_in_english: already,
    left_out: LEFT_OUT, corpus_corporum: cc.corpora,
  };
  mkdirSync(OUT.slice(0, OUT.lastIndexOf('/')), { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  writeFileSync(MD, markdown(result));
  log(`\nwrote ${OUT} and ${MD}; total draft $${result.total_draft_usd}; downloaded ${result.measurement.gb_downloaded_total} GB total`);
}

// Canons considered for #6220 and not given a row, each with the reason. Checked by hand on 2026-10-07;
// the quotes are from the pages named.
const LEFT_OUT = [
  { corpus: 'Daoist canon (Zhengtong Daozang)', reason: 'Already inside the Kanripo row: Kanripo section KR5 is the Daoist canon.', source: 'https://github.com/kanripo/KR-Catalog' },
  { corpus: 'Avesta', reason: 'No open typed text found. TITUS (Frankfurt), the standard typed Avesta, states: "No parts of this document may be republished in any form without prior permission by the copyright holder." avesta.org states no licence for its Avestan text. Most of the Avesta has had English since the Sacred Books of the East (Darmesteter and Mills).', source: 'https://titus.uni-frankfurt.de/texte/etcs/iran/airan/avesta/avest.htm' },
  { corpus: 'Jain Āgamas', reason: 'No open typed canon found. GRETIL holds 8 Prakrit files, a few of the 45 Āgamas (Āyāraṅga, Sūyagaḍa, Uttarajjhāyā, Dasaveyāliya, Isibhāsiyāiṃ), each marked "FOR REFERENCE PURPOSES ONLY".', source: 'https://github.com/INDOLOGY/GRETIL-mirror' },
  { corpus: 'Other Corpus Corporum corpora (Acta Sanctorum, Monumenta Germaniae Historica, Thomas Aquinas and others)', reason: 'Listed with their sizes in corpus_corporum. Not priced: they mix public-domain and permission-only texts, and Thomas Aquinas shows 0 downloadable texts.', source: 'https://mlat.uzh.ch/php_modules/navigate.php?load=/' },
];

const fmt = x => x == null ? '—' : x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e4 ? `${Math.round(x / 1e3)}K` : String(x);
const pct = x => x == null ? 'unknown' : `${(x * 100).toFixed(1)}%`;
function markdown(R) {
  const L = [];
  L.push('| Corpus | Open typed source · licence | Size (texts · base chars) | Has English | Untranslated ≈ English words | We hold (live / hidden books) | Scan pairing | Draft $ |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of R.rows) {
    const lic = r.licence.quote ? `${r.licence.label}${r.licence.verified ? '' : ' (quote not re-found)'}` : 'unverified';
    L.push(`| ${r.corpus} | [${r.source.name}](${r.source.url}) · ${lic} | ${fmt(r.size.texts)} · ${fmt(r.size.base_chars)}${r.size.images ? ` · ${fmt(r.size.images)} images` : ''} | ${pct(r.english.fraction)} | ${fmt(r.cost.english_words_est)} | ${r.holdings.live_books} / ${r.holdings.hidden_books} | ${r.pairing.status} | ${r.cost.usd == null ? 'n/a' : `$${r.cost.usd.toLocaleString('en-US')}${r.english.fraction == null ? ' (upper)' : ''}`} |`);
  }
  return L.join('\n') + '\n';
}

await main();
process.exit(0);
