#!/usr/bin/env node
// PRIOR ART: the 2026-10-28 1,000-book run (sourcelibrary-ops evals/ft-fresh-check-2026-10-28/run-1000),
// whose sample and prompts this reproduces as a script. scripts/eval/ft-* and the card harvest select for
// the retired card-review lane (#7598), not "every translated book without a fresh search".
//
// Select the next batch for the fresh prior-translation search (#7598) and write one prompt per book.
// A book is eligible when it is visible, has translated pages, is not English, and has no fresh-search
// attempt yet (method claude_subagent_verify). Random order, seeded, so a batch is reproducible.
//
//   set -a; source .env.production.local; set +a
//   node scripts/ft-search/select-batch.mjs --n 1000 --out <dir> [--seed 20261029] [--exclude <ids.txt>[,<ids.txt>]]
// --ids <file>: re-search exactly these books (ingest them with ingest.mjs --research).
// --exclude: ids already drawn by a batch that has not been ingested yet, so parallel batches never overlap.
// One search per work: the books of one work_id that are volumes of the same title are searched ONCE (a
// representative), and <dir>/siblings.json maps rep -> siblings, which ingest.mjs inherits a none_found badge
// onto. On only while propagation-gate.json says the gate passed (>=95% agreement); --one-per-work forces it
// on, --no-one-per-work off. --gate <N> [--gate-siblings 3]: draw N multi-volume works and search the rep AND
// the siblings (a read-only experiment: the dir is marked GATE and ingest refuses it), then gate-report.mjs.
import { MongoClient } from 'mongodb';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = parseInt(arg('--n', '1000'), 10);
const OUT = arg('--out');
const SEED = parseInt(arg('--seed', String(Date.now() % 1e8)), 10);
if (!OUT) { console.error('Missing --out <dir>'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

export const METHOD = 'claude_subagent_verify';

// Seeded shuffle (mulberry32), so a batch can be re-drawn exactly.
function shuffle(a, seed) {
  let t = seed >>> 0;
  const rnd = () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// The book's own record goes into the prompt, fetched here with the internal full-tier key.
// A search that curls /api/books anonymously spends the machine's anonymous budget and, once
// it runs out, reads the crawler notice instead of the record (5 of 174 on 2026-10-28).
const KEY_FILE = [process.env.SL_INTERNAL_KEY_FILE, `${homedir()}/.sl-internal-key`, '/root/.sl-internal-key'].find((f) => f && existsSync(f));
const KEY = KEY_FILE ? readFileSync(KEY_FILE, 'utf8').trim() : null;
if (!KEY) console.error('No ~/.sl-internal-key: prompts will fall back to an anonymous curl of the record');

async function fetchRecord(id) {
  if (!KEY) return null;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://sourcelibrary.org/api/books/${id}`, { headers: { Authorization: `Bearer ${KEY}` } }).catch(() => null);
    if (r?.ok) return (await r.text()).slice(0, 4000);
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  return null;
}

// Leads from Supabase translation_catalogs (#7598): rows for the same author surname, given to the
// searcher to check, never to trust. A 30-row spot check (2026-10-29) confirmed 12 of 18 library and
// catalogue rows (UNESCO, LoC, HathiTrust, Open Library) and 1 of 6 sl_ft_llm_claim rows.
const SUPA = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY;
const SL_ORIGIN = /^sl_|^validated_additions$/;
const surname = (a) => {
  const s = (a || '').split(/[;|]/)[0].trim();
  const n = (s.indexOf(',') > 0 ? s.slice(0, s.indexOf(',')) : s).replace(/\b(saint|st\.?|von|de|van|del|di|da|al-)\b/gi, '').trim();
  return (n.split(/\s+/).pop() || '').toLowerCase();
};
async function catalogLeads(b) {
  const s = surname(b.author);
  if (!SUPA || s.length < 3 || /^(anonymous|anon|unknown)$/.test(s)) return null;
  const q = `author_surname_lower=eq.${encodeURIComponent(s)}&select=source,english_title,original_title,canonical_work,translator,pub_year,publisher,source_url&limit=200`;
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/translation_catalogs?${q}`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  }).catch(() => null);
  const rows = r?.ok ? await r.json() : [];
  if (!rows.length) return null;
  // Rows sharing words with this book's title first, then library and catalogue rows before our own findings.
  const words = (t) => new Set((t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/\p{L}{4,}/gu) || []);
  const mine = words(`${b.title || ''} ${b.display_title || ''}`);
  const overlap = (x) => [...words(`${x.english_title} ${x.original_title} ${x.canonical_work}`)].filter((w) => mine.has(w)).length;
  rows.forEach((x) => { x._o = overlap(x); });
  rows.sort((x, y) => y._o - x._o || SL_ORIGIN.test(x.source) - SL_ORIGIN.test(y.source));
  const line = (x) => `- ${x.english_title}${x.translator ? `, tr. ${x.translator}` : ''}${x.pub_year ? ` (${x.pub_year})` : ''}${x.publisher ? `, ${x.publisher}` : ''} [${SL_ORIGIN.test(x.source) ? 'our earlier finding, unverified' : x.source}]${x.source_url ? ` ${x.source_url}` : ''}`;
  return `${rows.length}${rows.length === 200 ? '+' : ''} row(s) in our catalogue of English translations match this author's surname${rows.length > 10 ? '; the 10 whose titles best match this book' : ''}. They are LEADS to check, not answers: many are a different work by the author, wrong in detail, or not real. Cite one only after you find it yourself.\n${rows.slice(0, 10).map(line).join('\n')}\n`;
}

// Collected-works sets: their volumes hold DIFFERENT works, so one volume's answer says nothing about another.
const COLLECTION = /collected|works|opera|werke|sämtliche|samtliche|corpus|tengyur|kangyur|collection|anthology|selected|omnia|全書|集成|選|选/i; // 選 added after the gate: Yuanqu xuan's volumes were different plays
// A title with its volume number taken out: two volumes of one work normalise to the same string.
const VOL_WORDS = /\b(vol(ume|umen)?s?|tomus|tome|tomo|pars|part|pt|liber|lib|band|bd|buch|teil|book|bk|livre|no|nr|fasc(icle)?|heft|deel|stuk|t)\b\.?/gi;
const ROMAN = /^(x{0,3})(ix|iv|v?i{0,3})$/i;
export function normTitle(t) {
  return (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(VOL_WORDS, ' ').replace(/[0-9０-９一二三四五六七八九十百卷冊册第]+/g, ' ')
    .split(/[^\p{L}]+/u).filter((w) => w && !(w.length <= 4 && ROMAN.test(w) && /^[ivx]+$/i.test(w))).join(' ');
}
const titleOf = (b) => b.display_title || b.title || '';
export const isCollection = (b) => COLLECTION.test(b.work_id || '') || /^kr:/.test(b.work_id || '') || /^kr:/.test(b.id || '') || COLLECTION.test(titleOf(b));
// Siblings of rep that may inherit its answer: same work_id, same title once the volume number is removed.
export function inheritors(rep, group) {
  if (isCollection(rep) || !normTitle(titleOf(rep))) return [];
  return group.filter((b) => b !== rep && !isCollection(b) && normTitle(titleOf(b)) === normTitle(titleOf(rep)));
}

function prompt(b, record, leads, volumes = 1) {
  const id = b.id || String(b._id);
  const read = record
    ? `The book's Source Library record (first 4,000 characters, already fetched; do not fetch sourcelibrary.org yourself):\n<<<\n${record}\n>>>\n`
    : `First read the book's summary: curl -s https://sourcelibrary.org/api/books/${id} | head -c 4000. `;
  return `Find out whether a published English translation already exists for this book. Source Library has machine-translated it.
Book: ${b.display_title || b.title || ''} | author: ${b.author || 'Anonymous'} | date: ${b.published || b.year || ''} | edition language: ${b.language || ''} | Source Library id ${id}.
${read}${leads || ''}Identify the WORK. For a volume of a Chinese collection (卷), identify the specific juan or texts it contains.
${volumes > 1 ? `This is one of ${volumes} volumes of the same work in our library; answer for the WHOLE work and say in translation_covers which parts the translation covers.\n` : ''}Then use web search to look for any published English translation of the work, from any year; one embedded in a scholarly edition counts. Search the original-language title, the English title, and the author with "translated". Look in WorldCat, Google Books, HathiTrust, Internet Archive, publisher sites and JSTOR. One legitimate prior translation settles it. Give up after about 8 searches.
What counts as a prior: an English TRANSLATION (the text itself rendered into English) of ALL the text this book contains. Compare the two: what does this book contain, and what does the translation cover?
- A translation of only part of it (one of several works in the volume, one volume of several, selected poems or chapters, excerpts, an abridgement) is partial_only, not a prior.
- A study, monograph, dissertation, commentary, summary, paraphrase, review, or an encyclopedia or Wikipedia article ABOUT the work is not a translation, even when it quotes passages. It settles nothing: keep searching, and if that is all you find, answer none_found or unclear.
- The url must be the translation itself or a library or publisher record of it. A Wikipedia page or a review is not enough; find the record.
Report only URLs you actually opened. Never guess a URL.
metadata_issue.kind is "none" unless our record is clearly wrong; then name the kind (author_is_printer, author_is_editor, author_is_uploader, author_is_root_text_author, date_is_upload_date, wrong_volume, wrong_language, other) and give right_value. Approximate dates, missing details and several compilers are "none".
Answer with ONLY a JSON object: {"id":"${id}","work_identified":"...","verdict":"prior_translation_found|partial_only|none_found|unclear","prior":{"translator":"","title":"","year":"","publisher":"","url":"","book_contains":"what this book contains","translation_covers":"what the translation covers"} or null,"queries":["..."],"metadata_issue":{"kind":"none|author_is_printer|author_is_editor|author_is_uploader|author_is_root_text_author|date_is_upload_date|wrong_volume|wrong_language|other","right_value":"the correct author, date, volume or language; empty when kind is none"},,"card":"1-3 sentence library card notice: 'Prior English translation: <translator>, <title> (<publisher>, <year>). <url>' or 'Searched <today's date> for an earlier English translation (<sources>); none found.'"}`;
}

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const searched = new Set(await db.collection('first_translation_attempts').distinct('book_id', { method: METHOD }));
// Books the old card system searched. Its "found" verdicts were mostly wrong (68 of 71 adjudicated
// conflicts went to the fresh search, 2026-10-28), so a book with an old search still needs one, but
// a book with no search at all comes first (Derek, 2026-10-28).
const oldSearched = new Set(await db.collection('first_translation_attempts').distinct('book_id', { method: { $ne: METHOD } }));
const pool = await db.collection('books').find(
  { visible: true, pages_translated: { $gt: 0 }, language: { $nin: ['English', 'english', 'en', 'eng'] } },
  { projection: { id: 1, title: 1, display_title: 1, author: 1, published: 1, year: 1, language: 1, is_first_translation: 1, prior_translation: 1, work_id: 1 } },
).toArray();
const excluded = new Set((arg('--exclude', '') || '').split(',').filter(Boolean).flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean)));
// --ids <file>: search exactly these books again, searched or not (e.g. books whose credit a recheck retracted).
const only = arg('--ids') ? new Set(readFileSync(arg('--ids'), 'utf8').split(/\s+/).filter(Boolean)) : null;
const eligible = only
  ? pool.filter((b) => only.has(b.id || String(b._id)))
  : pool.filter((b) => !searched.has(b.id || String(b._id)) && !excluded.has(b.id || String(b._id)));
if (excluded.size) console.log(`excluded ${excluded.size} ids drawn by un-ingested batches`);
// Priority tiers, each shuffled: 0 never searched; 1 searched by the old system, no badge or credit;
// 2 already badged or credited (a fresh search there only adds evidence).
const tier = (b) => (!oldSearched.has(b.id || String(b._id)) ? 0 : b.is_first_translation || b.prior_translation ? 2 : 1);
const tiers = [0, 1, 2].map((t) => shuffle(eligible.filter((b) => tier(b) === t), SEED + t));
const ordered = tiers.flat();
console.log(`tiers: never searched ${tiers[0].length}, old search unmarked ${tiers[1].length}, badged/credited ${tiers[2].length}`);

// Groups of eligible books per work_id; the first book of a group in draw order is its representative.
const GATE_FILE = fileURLToPath(new URL('./propagation-gate.json', import.meta.url));
const gateOn = existsSync(GATE_FILE) && JSON.parse(readFileSync(GATE_FILE, 'utf8')).enabled === true;
const GATE_N = parseInt(arg('--gate', '0'), 10);
const ONE_PER_WORK = !only && (process.argv.includes('--one-per-work') || (gateOn && !process.argv.includes('--no-one-per-work')));
const groups = new Map();
for (const b of ordered) if (b.work_id) (groups.get(b.work_id) || groups.set(b.work_id, []).get(b.work_id)).push(b);
const siblings = {}; // rep id -> [sibling ids], written only for books that really are in the batch as reps
const idOf = (b) => b.id || String(b._id);
let batch;
if (GATE_N) {
  const multi = [...groups.values()].filter((g) => inheritors(g[0], g).length > 0);
  const per = parseInt(arg('--gate-siblings', '3'), 10);
  const drawn = shuffle(multi, SEED).slice(0, GATE_N);
  batch = drawn.flatMap((g) => { const sibs = inheritors(g[0], g).slice(0, per); siblings[idOf(g[0])] = sibs.map(idOf); return [g[0], ...sibs]; });
  console.log(`gate: ${drawn.length} multi-volume works of ${multi.length}, ${batch.length} books (rep + up to ${per} siblings each)`);
} else if (ONE_PER_WORK) {
  const seen = new Set();
  batch = [];
  for (const b of ordered) {
    if (batch.length >= N) break;
    const g = b.work_id ? groups.get(b.work_id) : null;
    if (g && seen.has(b.work_id)) { if (!inheritors(g[0], g).includes(b)) batch.push(b); continue; } // a sibling that may not inherit is searched itself
    if (g) { seen.add(b.work_id); const sibs = inheritors(b, g); if (sibs.length) siblings[idOf(b)] = sibs.map(idOf); }
    batch.push(b);
  }
  const nsib = Object.values(siblings).reduce((a, x) => a + x.length, 0);
  console.log(`one search per work: ${Object.keys(siblings).length} representatives stand for ${nsib} sibling volumes in this batch`);
} else batch = ordered.slice(0, N);
const volumesOf = (b) => (siblings[idOf(b)]?.length || 0) + 1;

mkdirSync(OUT, { recursive: true });
let missing = 0;
let withLeads = 0;
for (let i = 0; i < batch.length; i += 8) {
  await Promise.all(batch.slice(i, i + 8).map(async (b) => {
    const [record, leads] = await Promise.all([fetchRecord(b.id || String(b._id)), catalogLeads(b)]);
    if (!record) missing++;
    if (leads) withLeads++;
    writeFileSync(`${OUT}/${b.id || String(b._id)}.prompt`, prompt(b, record, leads, volumesOf(b)));
  }));
}
console.log(`${withLeads} of ${batch.length} prompts carry catalogue leads${SUPA ? '' : ' (SUPABASE_URL not set: none)'}`);
if (missing) console.error(`${missing} records not fetched; those prompts curl the record themselves`);
if (Object.keys(siblings).length) writeFileSync(`${OUT}/siblings.json`, JSON.stringify(siblings, null, 1));
if (GATE_N) writeFileSync(`${OUT}/GATE`, 'read-only propagation gate: do not ingest\n');
writeFileSync(`${OUT}/ids.txt`, batch.map((b) => b.id || String(b._id)).join('\n') + '\n');
writeFileSync(`${OUT}/batch.json`, JSON.stringify({ seed: SEED, drawn_at: new Date().toISOString(), eligible: eligible.length, n: batch.length }, null, 1));
console.log(`eligible ${eligible.length} (of ${pool.length} translated non-English visible); wrote ${batch.length} prompts to ${OUT} (seed ${SEED})`);
await c.close();
