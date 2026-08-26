#!/usr/bin/env node
/**
 * Ongoing on-mission acquisition worker (Hetzner cron).
 *
 * Steadily fills the on-mission Latin/German gap: USTC tells us WHICH works we
 * lack; the open repos (IA + e-rara IIIF, MDZ/Gallica later) provide the scan.
 * Each run processes a BOUNDED batch of pending queue items — resolve an open
 * scan, LLM-verify it's the same work, import hidden + archive, mark status.
 *
 * Stateful: the queue + per-work status live in Mongo `acquisition_queue`, so
 * runs advance through the gap and never re-do work. Self-seeds from USTC.
 *
 * Cost: LLM verify ~$0.001/work (tiny). Imports are HIDDEN; OCR/translation is
 * the separate paused pipeline, so this never triggers large spend on its own.
 *
 * Usage (cron):
 *   node scripts/catalog-coverage/acquire-gap-batch.mjs --batch 50
 *   --batch N        works to attempt this run (default 50)
 *   --dry-run        resolve+verify, don't import
 *   --reseed         rebuild the queue from USTC even if populated
 *   --retry-failed   flip import-failed rows back to pending (records retry count), then exit
 *
 * v2 (#4225): the held gate is screened + LLM-verified (the regex-only gate measured
 * 60% false — works we silently declined to acquire); MDZ + Gallica live resolvers
 * added; terminal rows record the evidence that produced them (held_book_id etc.).
 */
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

// Flag-absent means indexOf() is -1 and argv[0] (the node path) gets parseInt'd to NaN —
// which made a bare invocation claim rows and process none. Parse defensively.
const intArg = (name, dflt) => { const i = process.argv.indexOf(name); const v = i >= 0 ? parseInt(process.argv[i + 1], 10) : NaN; return Number.isFinite(v) && v > 0 ? v : dflt; };
const BATCH = intArg('--batch', 50);
const DRY = process.argv.includes('--dry-run');
const RESEED = process.argv.includes('--reseed');
const RETRY_FAILED = process.argv.includes('--retry-failed');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const stripEm = s => (s || '').replace(/<\/?em>/g, '');
const BASE = process.env.SL_BASE_URL || 'https://sourcelibrary.org';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = 'gemini-3.1-flash-lite';
const clean = s => (s || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
const STOP = new Set(['liber', 'libri', 'opera', 'tractatus', 'commentaria', 'commentarii', 'pars', 'tomus', 'sive', 'seu', 'cum', 'das', 'ist', 'von', 'der', 'des', 'und', 'oder', 'nova', 'novae']);
const toks = t => (t || '').split(/[\s,.:;]+/).map(clean).filter(x => x.length > 5 && !STOP.has(x));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const db = mc.db('bookstore');
const queue = db.collection('acquisition_queue');
const books = db.collection('books');
const ecat = db.collection('erara_catalog');
const icat = db.collection('import_candidates'); // harvested German-library OAI catalog (SBB/Heidelberg/Göttingen, w/ IIIF manifests)
await queue.createIndex({ status: 1 }).catch(() => {});
await queue.createIndex({ sn: 1 }, { unique: true }).catch(() => {});

// ---- self-seed the queue from USTC (mission classes + witch-trial keywords) ----
async function seed() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const CLASSES = ['Medical Texts', 'Philosophy and Morality', 'Science', 'Mathematics', 'Astrology and Cosmography'];
  const WITCH = ['malefic', 'sortileg', 'venefic', 'lamiis', 'daemonum', 'daemonolog', 'hexen', 'zauber', 'sagarum', 'magorum', 'exorcis', 'incantation'];
  const cols = 'sn,author_1,title,year,language_1,classification_1';
  const upserts = new Map();
  const page = async (apply, cat) => {
    let from = 0; for (;;) {
      let q = sb.from('ustc_editions').select(cols).eq('has_iiif_scan', true).eq('in_source_library', false).in('language_1', ['Latin', 'German']).range(from, from + 999);
      q = apply(q); const { data, error } = await q; if (error || !data.length) break;
      for (const e of data) if (!upserts.has(e.sn)) upserts.set(e.sn, { sn: e.sn, author: e.author_1, title: e.title, year: e.year, lang: e.language_1, class: e.classification_1, category: cat, status: 'pending', added_at: new Date() });
      from += 1000; if (data.length < 1000) break;
    }
  };
  for (const c of CLASSES) await page(q => q.eq('classification_1', c), 'mission');
  for (const t of WITCH) await page(q => q.ilike('title', '%' + t + '%'), 'witch-trials');
  const ops = [...upserts.values()].map(d => ({ updateOne: { filter: { sn: d.sn }, update: { $setOnInsert: d }, upsert: true } }));
  for (let i = 0; i < ops.length; i += 2000) await queue.bulkWrite(ops.slice(i, i + 2000), { ordered: false }).catch(() => {});
  log('seeded queue:', upserts.size, 'works');
}
if (RESEED || (await queue.countDocuments({})) === 0) await seed();

// ---- resolve an open scan: IA search, then local e-rara catalog ----
async function iaResolve(w) {
  const surname = (w.author || '').split(/[,\s]+/)[0];
  const tk = toks(w.title).slice(0, 2).join(' ');
  if (!surname || !tk) return [];
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`(creator:(${surname}) OR title:(${surname})) AND (${tk}) AND mediatype:texts`)}&fl[]=identifier&fl[]=title&fl[]=year&fl[]=imagecount&rows=6&output=json`;
  try { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); return (await r.json()).response.docs.filter(d => d.imagecount > 15).map(d => ({ src: 'ia', id: d.identifier, title: d.title, year: d.year, ref: d.identifier })); } catch { return []; }
}
async function eraraResolve(w) {
  const tk = toks(w.title).slice(0, 3); if (!tk.length) return [];
  const cands = await ecat.find({ title: new RegExp('\\b(' + tk.join('|') + ')', 'i'), ...(w.year ? { year: { $gte: +w.year - 50, $lte: +w.year + 80 } } : {}) }, { projection: { id: 1, author: 1, title: 1, year: 1, manifest_url: 1 } }).limit(6).toArray();
  return cands.map(c => ({ src: 'erara', id: c.id, title: c.title, year: c.year, ref: c.manifest_url }));
}
// Live MDZ search (undocumented JSON API — contract in memory reference_mdz_search_api).
// Relevancy-sorted, includes fulltext hits, so filter to IIIF-available and let verify()
// judge; titles/authors carry <em> highlight tags that must be stripped.
async function mdzResolve(w) {
  const surname = (w.author || '').split(/[,\s]+/)[0];
  const tk = toks(w.title).slice(0, 2).join(' ');
  if (!surname || surname.length < 4 || !tk) return [];
  const url = `https://www.digitale-sammlungen.de/api/search?query=${encodeURIComponent(surname + ' ' + tk)}&handler=simple-all&startPage=0&pageSize=6`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.docs || []).filter(d => d.iiifAvailable && d.id).map(d => ({ src: 'mdz', id: d.id, title: stripEm(d.title), year: d.publicationDate || '', ref: d.id }));
  } catch { return []; }
}
// Live Gallica SRU (CQL). Gallica 429s datacenter IPs on heavy manifest fetching; one
// bounded search per work is modest, and any failure degrades to [] (other resolvers cover).
async function gallicaResolve(w) {
  const surname = (w.author || '').split(/[,\s]+/)[0];
  const tk = toks(w.title).slice(0, 2).join(' ');
  if (!surname || surname.length < 4 || !tk) return [];
  const cql = `gallica all "${surname} ${tk}" and dc.type all "monographie"`;
  const url = `https://gallica.bnf.fr/SRU?operation=searchRetrieve&version=1.2&query=${encodeURIComponent(cql)}&maximumRecords=6`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<srw:record>([\s\S]*?)<\/srw:record>/g)].map(m => {
      const rec = m[1];
      // A record carries both the document ark (bpt6k…/btv1b…) and the catalogue-notice
      // ark (cb…) — only the document ark resolves to a IIIF manifest.
      const ark = (rec.match(/ark:\/12148\/(?!cb)([a-z0-9]+)/i) || [])[1];
      const title = ((rec.match(/<dc:title>([\s\S]*?)<\/dc:title>/) || [])[1] || '').trim();
      const year = ((rec.match(/<dc:date>([\s\S]*?)<\/dc:date>/) || [])[1] || '').trim();
      return ark ? { src: 'gallica', id: ark, title, year, ref: ark } : null;
    }).filter(Boolean).slice(0, 6);
  } catch { return []; }
}
// Local match against the harvested German-library catalog (import_candidates): fast lookup by
// author_surname (indexed, partial on manifest_url), then distinctive-title-token filter. Recovers
// the continental Latin (VD16/17) that IA search misses. Imported as generic IIIF.
async function catalogResolve(w) {
  const surname = clean((w.author || '').split(/[,\s]+/)[0]);
  if (surname.length < 4) return [];
  const tk = toks(w.title).slice(0, 4);
  const cands = await icat.find({ author_surname: surname, manifest_url: { $exists: true, $ne: null } }, { projection: { title: 1, author: 1, year: 1, manifest_url: 1 } }).limit(25).toArray();
  const hits = tk.length ? cands.filter(c => { const ct = clean(c.title); return tk.some(t => ct.includes(t)); }) : cands;
  return hits.slice(0, 6).map(c => ({ src: 'iiif', id: c.manifest_url, title: c.title, year: c.year, ref: c.manifest_url }));
}
// Race a promise against a timeout so one stalled call (Gemini / import fetch) can't
// freeze a whole concurrent batch. On timeout the promise rejects and the caller's
// catch handles it (verify -> no-match, importWork -> retry, processWork -> back to pending).
const withTimeout = (p, ms, tag) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(tag || 'timeout')), ms))]);
async function verify(w, cands) {
  const prompt = `Which candidate (if any) is THE SAME WORK as the target (same text, any edition; a different work by the same author is NOT a match)?\nTARGET: author="${w.author}" title="${w.title}" year=${w.year || '?'}\n${cands.map((c, i) => `${i}: title="${(c.title || '').slice(0, 80)}" year=${c.year || '?'}`).join('\n')}\nReply ONLY JSON: {"match":<index or -1>,"confidence":"high"|"medium"|"low"}`;
  try { const r = await withTimeout(ai.models.generateContent({ model: MODEL, contents: prompt, config: { temperature: 0, maxOutputTokens: 60 } }), 30000, 'verify'); const j = JSON.parse((r.text || '').match(/\{[^}]*\}/)[0]); return (j.match >= 0 && j.confidence === 'high') ? cands[j.match] : null; } catch { return null; }
}
async function importWork(w, hit) {
  // Collections by seed category. Unknown categories (e.g. broad Greek classics) get NO
  // collection — imported hidden and curated later — rather than being forced into
  // astrology/natural-philosophy where they don't belong.
  const COLL_MAP = { 'witch-trials': ['witchcraft'], 'mission': ['astrology', 'natural-philosophy'] };
  const colls = COLL_MAP[w.category] || [];
  const ep = hit.src === 'ia' ? '/api/import/ia' : hit.src === 'mdz' ? '/api/import/mdz' : hit.src === 'gallica' ? '/api/import/gallica' : '/api/import/iiif';
  // Pass the USTC language (authoritative) — the IIIF import otherwise stores 'Unknown',
  // which keeps genuine Latin acquisitions out of the Latin filter / held count.
  const body = hit.src === 'ia' ? { ia_identifier: hit.ref, title: w.title, author: w.author, collections: colls, language: w.lang }
    : hit.src === 'mdz' ? { bsb_id: hit.ref, title: w.title, author: w.author, year: w.year, categories: colls, original_language: w.lang }
    : hit.src === 'gallica' ? { ark: hit.ref, title: w.title, author: w.author, published: w.year, categories: colls, language: w.lang }
    : { manifest_url: hit.ref, title: w.title, author: w.author, collections: colls, language: w.lang };
  const r = await fetch(BASE + ep, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.CRON_SECRET, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const j = await r.json(); return (r.ok && (j.success || j.bookId)) ? j.bookId : null;
}

// ---- process a bounded batch of pending works, CONCURRENTLY ----
const CONCURRENCY = intArg('--concurrency', 10);
const tally = { acquired: 0, held: 0, 'no-source': 0, 'no-match': 0, 'import-failed': 0 };

// Held gate v2 (#4225): the old regex-only gate ("surname anywhere + either of two title
// tokens") measured 60% FALSE on an LLM-judged sample — each false hit a work we silently
// declined to acquire. Now: deterministic screen (surname in the AUTHOR field + >=2
// significant title tokens overlap) and an LLM same-work verify on the survivors.
async function heldCheck(w, surname, targetToks) {
  const tk = targetToks.slice(0, 2);
  if (surname.length < 4 || !tk.length) return null;
  const cands = await books.find({ $and: [{ $or: [{ author: new RegExp(surname, 'i') }, { title: new RegExp(surname, 'i') }] }, { title: new RegExp(tk.join('|'), 'i') }] }, { projection: { id: 1, title: 1, author: 1, published: 1 } }).limit(8).toArray();
  const screened = cands.filter(b => {
    if (!clean(b.author || '').includes(surname)) return false;
    const bt = clean(b.title || '');
    return targetToks.filter(t => bt.includes(t)).length >= Math.min(2, targetToks.length);
  });
  if (!screened.length) return null;
  const v = await verify(w, screened.map(b => ({ id: b.id, title: b.title, year: b.published })));
  return v ? screened.find(b => b.id === v.id) || null : null;
}

async function processWork(w) {
  const surname = clean((w.author || '').split(/[,\s]+/)[0]);
  const targetToks = toks(w.title);
  const heldBook = await heldCheck(w, surname, targetToks);
  if (heldBook) { await queue.updateOne({ sn: w.sn }, { $set: { status: 'held', held_book_id: heldBook.id, held_via: 'screened+verified', done_at: new Date() } }); return 'held'; }
  // Combine candidates from ALL sources — don't stop at the first non-empty one. IA search
  // usually returns weak candidates that already failed verify, which would starve the
  // higher-precision German-library catalog (catalogResolve) of a chance. Gather IA + catalog
  // (+ e-rara + MDZ + Gallica), then let verify() pick the true match from the union.
  const [ia, cat, er, mdz, gal] = await Promise.all([iaResolve(w), catalogResolve(w), eraraResolve(w), mdzResolve(w), gallicaResolve(w)]);
  const cands = [...ia, ...cat, ...er, ...mdz, ...gal];
  if (!cands.length) { await queue.updateOne({ sn: w.sn }, { $set: { status: 'no-source', done_at: new Date() } }); return 'no-source'; }
  const v = await verify(w, cands.slice(0, 12));
  if (!v) { await queue.updateOne({ sn: w.sn }, { $set: { status: 'no-match', candidates_seen: cands.length, done_at: new Date() } }); return 'no-match'; }
  if (DRY) return 'acquired';
  const bookId = await importWork(w, v);
  if (bookId) { await queue.updateOne({ sn: w.sn }, { $set: { status: 'acquired', book_id: bookId, source: v.src, source_ref: v.ref, done_at: new Date() } }); return 'acquired'; }
  await queue.updateOne({ sn: w.sn }, { $set: { status: 'import-failed', done_at: new Date() } }); return 'import-failed';
}

// Deliberate retry lane: --retry-failed flips import-failed rows back to pending and exits.
if (RETRY_FAILED) {
  const r = await queue.updateMany({ status: 'import-failed' }, { $set: { status: 'pending' }, $inc: { retries: 1 }, $currentDate: { retried_at: true } });
  log('retry-failed: flipped', r.modifiedCount, 'rows back to pending');
  await mc.close();
  process.exit(0);
}

// Self-heal: return stale 'processing' (a prior run died mid-flight) back to pending
await queue.updateMany({ status: 'processing', claimed_at: { $lt: new Date(Date.now() - 60*60*1000) } }, { $set: { status: 'pending' } });
// Atomically claim a batch (set status:'processing') so concurrent/overlapping runs don't collide
const claimed = [];
for (let i = 0; i < BATCH; i++) {
  const r = await queue.findOneAndUpdate({ status: 'pending' }, { $set: { status: 'processing', claimed_at: new Date() } }, { returnDocument: 'after' });
  const doc = r?.value ?? r; if (!doc) break; claimed.push(doc);
}
for (let i = 0; i < claimed.length; i += CONCURRENCY) {
  const res = await Promise.all(claimed.slice(i, i + CONCURRENCY).map(w => withTimeout(processWork(w), 180000, 'work').catch(() => { queue.updateOne({ sn: w.sn }, { $set: { status: 'pending' } }); return 'error'; })));
  for (const s of res) if (tally[s] !== undefined) tally[s]++;
}

const remaining = await queue.countDocuments({ status: 'pending' });
log(`batch done (conc ${CONCURRENCY}): acquired ${tally.acquired}, held ${tally.held}, no-source ${tally['no-source']}, no-match ${tally['no-match']} | pending remaining ${remaining}`);
await mc.close();
