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
 *   --batch N   works to attempt this run (default 50)
 *   --dry-run   resolve+verify, don't import
 *   --reseed    rebuild the queue from USTC even if populated
 */
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

const BATCH = parseInt(process.argv[process.argv.indexOf('--batch') + 1] || '50');
const DRY = process.argv.includes('--dry-run');
const RESEED = process.argv.includes('--reseed');
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
async function verify(w, cands) {
  const prompt = `Which candidate (if any) is THE SAME WORK as the target (same text, any edition; a different work by the same author is NOT a match)?\nTARGET: author="${w.author}" title="${w.title}" year=${w.year || '?'}\n${cands.map((c, i) => `${i}: title="${(c.title || '').slice(0, 80)}" year=${c.year || '?'}`).join('\n')}\nReply ONLY JSON: {"match":<index or -1>,"confidence":"high"|"medium"|"low"}`;
  try { const r = await ai.models.generateContent({ model: MODEL, contents: prompt, config: { temperature: 0, maxOutputTokens: 60 } }); const j = JSON.parse((r.text || '').match(/\{[^}]*\}/)[0]); return (j.match >= 0 && j.confidence === 'high') ? cands[j.match] : null; } catch { return null; }
}
async function importWork(w, hit) {
  const colls = w.category === 'witch-trials' ? ['witchcraft'] : ['astrology', 'natural-philosophy'];
  const ep = hit.src === 'ia' ? '/api/import/ia' : '/api/import/iiif';
  const body = hit.src === 'ia' ? { ia_identifier: hit.ref, title: w.title, author: w.author, collections: colls } : { manifest_url: hit.ref, title: w.title, author: w.author, collections: colls };
  const r = await fetch(BASE + ep, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.CRON_SECRET, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); return (r.ok && (j.success || j.bookId)) ? j.bookId : null;
}

// ---- process a bounded batch of pending works, CONCURRENTLY ----
const CONCURRENCY = parseInt(process.argv[process.argv.indexOf('--concurrency') + 1] || '10');
const tally = { acquired: 0, held: 0, 'no-source': 0, 'no-match': 0, 'import-failed': 0 };

async function processWork(w) {
  const surname = clean((w.author || '').split(/[,\s]+/)[0]);
  const tk = toks(w.title).slice(0, 2);
  if (surname.length >= 4 && tk.length) {
    const have = await books.findOne({ $and: [{ $or: [{ author: new RegExp(surname, 'i') }, { title: new RegExp(surname, 'i') }] }, { title: new RegExp(tk.join('|'), 'i') }] }, { projection: { _id: 1 } });
    if (have) { await queue.updateOne({ sn: w.sn }, { $set: { status: 'held', done_at: new Date() } }); return 'held'; }
  }
  let cands = await iaResolve(w);
  if (!cands.length) cands = await eraraResolve(w);
  if (!cands.length) { await queue.updateOne({ sn: w.sn }, { $set: { status: 'no-source', done_at: new Date() } }); return 'no-source'; }
  const v = await verify(w, cands.slice(0, 6));
  if (!v) { await queue.updateOne({ sn: w.sn }, { $set: { status: 'no-match', done_at: new Date() } }); return 'no-match'; }
  if (DRY) return 'acquired';
  const bookId = await importWork(w, v);
  if (bookId) { await queue.updateOne({ sn: w.sn }, { $set: { status: 'acquired', book_id: bookId, source: v.src, source_ref: v.ref, done_at: new Date() } }); return 'acquired'; }
  await queue.updateOne({ sn: w.sn }, { $set: { status: 'import-failed', done_at: new Date() } }); return 'import-failed';
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
  const res = await Promise.all(claimed.slice(i, i + CONCURRENCY).map(w => processWork(w).catch(() => { queue.updateOne({ sn: w.sn }, { $set: { status: 'pending' } }); return 'error'; })));
  for (const s of res) if (tally[s] !== undefined) tally[s]++;
}

const remaining = await queue.countDocuments({ status: 'pending' });
log(`batch done (conc ${CONCURRENCY}): acquired ${tally.acquired}, held ${tally.held}, no-source ${tally['no-source']}, no-match ${tally['no-match']} | pending remaining ${remaining}`);
await mc.close();
