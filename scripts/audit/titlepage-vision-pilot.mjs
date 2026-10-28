#!/usr/bin/env node
// PRIOR ART: scripts/audit/titlepage-model-pilot-v2.mjs — reads the title page from OCR TEXT with the Gemini API; the
// ~110K author-less books of the 2026-10 wave have no OCR, and the API is not to be used here. scripts/audit/
// titlepage-prompt-v4.txt — its role vocabulary (author/editor/translator/printer/dedicatee/respondent) is kept.
// scripts/lib/agy-cli.mjs — the gated call; its multi-image read-file pattern (#7558) is how the leaves are shown.
/**
 * #7660 stage 4 — PILOT: can one agy Flash-low vision call per book find the title
 * page among the first leaves and read who wrote the book, for books whose
 * catalogue names nobody and whose holding library's record names nobody either?
 *
 * Per book: 4 leaves of image_source.iiif_manifest at ~1000 px (hot-linked, nothing
 * stored but the read), one call, a JSON answer
 *   {title_page_leaf, author, author_as_printed, author_role, title, imprint, year}
 * kept at once via candidate-reads (field 'metadata', page 'title-page'), so a
 * re-run reads nothing twice. WRITES NOTHING to books.
 *
 * WHICH 4 LEAVES. Not blindly the first 4: on the first test draw (20 books) the
 * first canvases were cover, endpaper, a blank and a blank verso, with the title
 * page at leaf 5 — the model read all four correctly and found no title. Libraries
 * mark the title page themselves, so the window starts one leaf before it:
 *   a range labelled Titelblatt / Titelseite / Title page (SBB, Göttingen), else the
 *   manifest's startCanvas (e-rara), else the first canvas. Internet Archive items:
 *   the scandata's first pageType "Title" leaf, images from the BookReader page API
 *   (iiif.archive.org manifests timed out at 45 s). The scorer is a person
 * looking at the leaves: --keep-images writes them under $JOB_SCRATCH for that.
 *
 *   AGY_HOME=/root/.agy-james node --env-file=.env.production.local scripts/audit/titlepage-vision-pilot.mjs \
 *     --n=200 --out=<reads.jsonl> [--images=<dir>] [--seed=7660]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { agyCall, CLI_SAFE_ARGS, installToolGate, firstJson, pageBlockFile, OCR_READ_FILE_INSTRUCTION } from '../lib/agy-cli.mjs';
import { keepRead, findRead, reuseHash } from '../lib/candidate-reads.mjs';
import { unwrapSentinels } from '../lib/cli-chatter.mjs';
import { recordUrlFor, parseBsbManifest, parseSbbManifest, parseMetsMods, authorOf } from '../lib/catalogue-authority.mjs';

const val = (k, d = null) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const N = Number(val('n', 200));
const OUT = val('out');
const IMAGES = val('images');
const SEED = Number(val('seed', 7660));
const MODEL = 'gemini-3.8-flash-low';
const PROMPT_VERSION = 'titlepage-vision-v2';
const LEAVES = 4;
if (!OUT) { console.error('--out=<reads.jsonl>'); process.exit(2); }
const PLACEHOLDER = /^\s*(?:unknown|\[?s\.\s?n\.?\]?|not known|not traceable|n\/?a|not available|anonym\w*(?: \w+)?|anon\.?|none|-+)?\s*$/i;
const UA = { 'User-Agent': 'SourceLibrary/1.0 (+https://sourcelibrary.org; title-page pilot #7660)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Seeded shuffle, so the draw is reproducible.
let s = SEED;
const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };

const PROMPT = `These are ${LEAVES} consecutive leaves from the front of a digitised early printed book (or manuscript), in order: ${Array.from({ length: LEAVES }, (_, i) => `leaf ${i + 1}: ./${pageBlockFile(i)}`).join(', ')}. ${OCR_READ_FILE_INSTRUCTION.replace('Open it', 'Open each')}
Find the TITLE PAGE among them (covers, bindings, blank leaves, library stamps and colour charts are not title pages; a half-title naming no author is not the title page if a fuller one follows).
Then read who the title page says WROTE the work, by the grammar of the page: a Latin genitive ("Auli Gellii ... libri"), "auctore"/"autore"/"von"/"par"/"by"/"di" + name = author; "a/ab X emendatus/recognitus", "edidit", "herausgegeben" = editor; "interprete", "übersetzt", "traduit par" = translator; "apud", "typis", "excudebat", "gedruckt bey", "chez" = printer; "praeside X ... respondente Y" = X praeses, Y respondent. Never promote a printer, editor or dedicatee to author. If the page names no author, say so.
Answer with ONE JSON object between two marker lines <<<BEGIN>>> and <<<END>>>, nothing outside them:
{"title_page_leaf": <1-${LEAVES} or null>, "author": <the author's name in nominative, reading order, or null>, "author_as_printed": <the exact words on the page naming the author, or null>, "author_role": <"author"|"praeses"|"editor_only"|"none">, "title": <short title as printed>, "imprint": <place : printer, as printed, or null>, "year": <year as printed, arabic numerals, or null>}`;

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');

// ── draw ─────────────────────────────────────────────────────────────────────
const pool = [];
for await (const b of db.collection('books').find({
  author_id: { $in: [null, undefined] }, content_type: { $ne: 'artwork' }, resource_type: { $exists: false },
  'image_source.iiif_manifest': { $exists: true, $ne: null },
}, { projection: { id: 1, author: 1, title: 1, year: 1, 'image_source.provider': 1, 'image_source.iiif_manifest': 1 } })) {
  if (PLACEHOLDER.test(b.author ?? '')) pool.push(b);
}
const harvested = new Map();
for await (const r of db.collection('catalogue_authority_harvest').find({ book_id: { $in: pool.map((b) => b.id) } }, { projection: { book_id: 1, author: 1, author_gnd_resolved: 1 } })) harvested.set(r.book_id, r);
const remaining = pool.filter((b) => !harvested.get(b.id)?.author);
const byProv = new Map();
for (const b of remaining) { const p = b.image_source.provider; if (!byProv.has(p)) byProv.set(p, []); byProv.get(p).push(b); }
// Proportional allocation, at least 2 from every provider with 50+ books, largest remainders first.
const provs = [...byProv.entries()].filter(([, v]) => v.length >= 50).sort((a, b) => b[1].length - a[1].length);
const tot = provs.reduce((t, [, v]) => t + v.length, 0);
const alloc = new Map(provs.map(([p, v]) => [p, Math.max(2, Math.floor((N * v.length) / tot))]));
let over = [...alloc.values()].reduce((a, b) => a + b, 0) - N;
for (const [p] of provs) { if (over <= 0) break; if (alloc.get(p) > 2) { alloc.set(p, alloc.get(p) - 1); over--; } }
const draw = [];
for (const [p, v] of provs) {
  const shuffled = [...v].sort(() => rnd() - 0.5);
  draw.push(...shuffled.slice(0, alloc.get(p) + 8).map((b) => ({ ...b, _alt: true })));   // spares, for books whose record DOES name an author
}
console.log(`author-less books with a manifest ${pool.length}; record names nobody (or not harvested) ${remaining.length}; providers drawn ${provs.length}`);
console.log(Object.fromEntries(alloc));

// ── per book ─────────────────────────────────────────────────────────────────
async function getJson(url) { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(45_000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
async function getBuf(url) { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(90_000), redirect: 'follow' }); if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()); }
const TITLE_RANGE = /^\s*(?:titel(?:blatt|seite)?|title[\s-]?page|titre|frontespizio|portada|titelbl)/i;
/** n canvases around the manifest's own title-page pointer, as ~1000px image URLs (Presentation v2 or v3). */
function leafUrls(m, n) {
  const canvases = m.sequences?.[0]?.canvases || m.items || [];
  const idOf = (c) => c?.['@id'] || c?.id;
  const ranges = m.structures || (m.items || []).filter((x) => x.type === 'Range');
  const range = (ranges || []).find((r) => TITLE_RANGE.test(String(typeof r.label === 'object' ? JSON.stringify(r.label) : r.label || '').replace(/^\{"\w+":\["?/, '')));
  const first = range && (range.canvases?.[0] || range.members?.[0]?.['@id'] || range.items?.[0]?.id || range.items?.[0]?.source);
  const start = first || m.startCanvas || m.sequences?.[0]?.startCanvas || m.start?.id || null;
  let at = start ? canvases.findIndex((c) => idOf(c) === (typeof start === 'string' ? start : idOf(start))) : 0;
  if (at < 0) at = 0;
  const from = Math.max(0, at - 1);
  return canvases.slice(from, from + n).map((c) => {
    const img = c.images?.[0]?.resource || c.items?.[0]?.items?.[0]?.body;
    const svc = [].concat(img?.service || [])[0];
    const base = svc?.['@id'] || svc?.id;
    if (base) return `${base.replace(/\/$/, '')}/full/!1000,1000/0/default.jpg`;
    return img?.['@id'] || img?.id || null;
  }).filter(Boolean);
}
/** Internet Archive: the scandata's first Title leaf (else leaf 0), images from the BookReader page API. */
async function iaLeafUrls(id, n) {
  let at = 0;
  try {
    const r = await fetch(`https://archive.org/download/${id}/${id}_scandata.xml`, { headers: UA, signal: AbortSignal.timeout(60_000) });
    if (r.ok) {
      const pages = [...(await r.text()).matchAll(/<page leafNum="\d+">([\s\S]*?)<\/page>/g)].map((x) => x[1]).filter((x) => !/<addToAccessFormats>false/.test(x));
      const t = pages.findIndex((x) => /<pageType>Title<\/pageType>/i.test(x));
      if (t > 0) at = t;
    }
  } catch { /* leaf 0 */ }
  const from = Math.max(0, at - 1);
  return Array.from({ length: n }, (_, i) => `https://archive.org/download/${id}/page/n${from + i}_w1000.jpg`);
}

/** Does the holding library's own record name an author? (a book harvested since the draw, or never harvested) */
async function recordNamesAuthor(b) {
  const rec = recordUrlFor(b);
  if (!rec) return false;
  try {
    const r = await fetch(rec.url, { headers: UA, signal: AbortSignal.timeout(45_000) });
    if (!r.ok) return false;
    const t = await r.text();
    const p = rec.kind === 'bsb-manifest' ? parseBsbManifest(JSON.parse(t)) : rec.kind === 'sbb-manifest' ? parseSbbManifest(JSON.parse(t)) : parseMetsMods(t);
    return Boolean(authorOf(p.names).name);
  } catch { return false; }
}

const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).book_id) : []);
const outFd = fs.openSync(OUT, 'a');
const taken = new Map();
let calls = 0;
let total = done.size;   // a restart re-draws; the cap is on reads in the file, never more than N
for (const b of draw) {
  if (total >= N) break;
  const p = b.image_source.provider;
  if ((taken.get(p) || 0) >= alloc.get(p)) continue;
  if (done.has(b.id)) { taken.set(p, (taken.get(p) || 0) + 1); continue; }
  if (!harvested.has(b.id) && await recordNamesAuthor(b)) continue;
  let urls, bufs;
  try {
    const ia = (b.image_source.iiif_manifest.match(/iiif\.archive\.org\/iiif\/(?:3\/)?([^/]+)\/manifest/) || [])[1];
    urls = ia ? await iaLeafUrls(ia, LEAVES) : leafUrls(await getJson(b.image_source.iiif_manifest), LEAVES);
    if (urls.length < 1) throw new Error('no canvases');
    bufs = [];
    for (const u of urls) { bufs.push(await getBuf(u)); await sleep(p === 'bsb' || p === 'mdz' || p === 'sbb' ? 1000 : 300); }
  } catch (e) { console.log(`  skip ${b.id} (${p}): ${e.message}`); continue; }
  taken.set(p, (taken.get(p) || 0) + 1);
  total++;
  const shas = bufs.map((x) => crypto.createHash('sha256').update(x).digest('hex'));
  const hash = reuseHash({ field: 'metadata', prompt: `${PROMPT_VERSION}\n${PROMPT}`, input: shas.join(',') });
  let text = null, meta = {};
  const hit = await findRead({ page_id: 'title-page', book_id: b.id, field: 'metadata', model: MODEL, prompt_hash: hash });
  if (hit) { text = hit.text; meta = hit.meta; }
  else {
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'agy-titlepage-'));
    bufs.forEach((x, i) => fs.writeFileSync(path.join(ws, pageBlockFile(i)), x));
    installToolGate(ws, { task: 'ocr' });
    const prompt = urls.length === LEAVES ? PROMPT : PROMPT.replace(`first ${LEAVES} leaves`, `first ${urls.length} leaves`);
    const r = await agyCall(['-p', prompt, '--model', MODEL, ...CLI_SAFE_ARGS], ws);
    calls++;
    fs.rmSync(ws, { recursive: true, force: true });
    if (r.cls === 'quota') { console.error(`quota: ${r.err}`); break; }
    const u = unwrapSentinels(r.text);
    const body = String(u.inside ?? r.text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    let j = null;
    try { j = JSON.parse(body); } catch { j = firstJson(body); }
    meta = { model: MODEL, model_requested: MODEL, cli: 'agy', prompt_variant: PROMPT_VERSION, secs: r.secs, usage: r.usage, cls: r.cls, image_urls: urls, image_sha256: shas, finished_at: new Date().toISOString(), read_site: 'scripts/audit/titlepage-vision-pilot.mjs', issue: 7660, account: process.env.AGY_HOME ? 'second' : 'main' };
    // A reply that does not parse is still a paid read: kept verbatim, and reported as unparsed.
    text = JSON.stringify(j || { unparsed_reply: r.text, cls: r.cls ?? null });
    if (r.text || j) await keepRead({ page_id: 'title-page', book_id: b.id, field: 'metadata', text, model: MODEL, prompt_hash: hash, job: 'authors-7660', meta: { ...meta, ...(j ? {} : { error_class: 'unparsed' }) }, prompt_text: prompt });
  }
  if (IMAGES) { fs.mkdirSync(IMAGES, { recursive: true }); bufs.forEach((x, i) => fs.writeFileSync(path.join(IMAGES, `${b.id}-${i + 1}.jpg`), x)); }
  const parsed = text ? JSON.parse(text) : null;
  const read = parsed && !parsed.unparsed_reply ? parsed : null;
  fs.writeSync(outFd, JSON.stringify({ book_id: b.id, provider: p, catalogue_title: String(b.title ?? '').slice(0, 200), catalogue_year: b.year ?? null, leaves: urls.length, read, ok: Boolean(read), unparsed_reply: parsed?.unparsed_reply ?? null, secs: meta.secs ?? null, usage: meta.usage ?? null, reused: Boolean(hit) }) + '\n');
  console.log(`${[...taken.values()].reduce((a, c) => a + c, 0)}/${N} ${p} ${b.id}: ${read ? `leaf ${read.title_page_leaf} · ${read.author_role} · ${read.author ?? '—'}` : 'NO READ'}`);
}
console.log(`DONE: ${calls} model calls`);
await mc.close();
