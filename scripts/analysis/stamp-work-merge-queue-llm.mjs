#!/usr/bin/env node
/**
 * stamp-work-merge-queue-llm.mjs (#3846) — LLM screening pass over pending
 * `work_merge_queue` rows. Stamps `llm: {verdict, reason, model, at}` on each
 * row so /admin/identity-review can put the SAME-verdict rows on a fast path
 * and reserve human attention for `unsure` + disagreements. Writes NOTHING
 * except the stamp — no merge happens here; the human approve button does.
 *
 * Follows the design of llm-verify-work-merges.mjs (under-cluster, never
 * guess a merge), but pairwise over the queue, batched 20 pairs per call.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/analysis/stamp-work-merge-queue-llm.mjs --limit 40        # trial
 *   node scripts/analysis/stamp-work-merge-queue-llm.mjs                   # full queue
 *   node scripts/analysis/stamp-work-merge-queue-llm.mjs --force          # re-stamp already-screened rows
 *
 * Cost: gemini-3.1-flash-lite, ~100 calls for the full 1.9K queue — well
 * under $1. Env: MONGODB_URI, GEMINI_API_KEY_TIER3|GEMINI_API_KEY.
 */
import { MongoClient } from 'mongodb';

const FORCE = process.argv.includes('--force');
const LIMIT = parseInt((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]
  || process.argv[process.argv.indexOf('--limit') + 1] || '0', 10) || 0;
const KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-lite';
const GEN_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
if (!KEY) { console.error('GEMINI_API_KEY[_TIER3] not set'); process.exit(1); }

const BATCH = 12; // richer per-side context now — keep prompts short of the empty-candidate zone
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pair: { type: 'string' },                                    // the P<n> ref
          verdict: { type: 'string', enum: ['same', 'different', 'unsure'] },
          reason: { type: 'string' },
        },
        required: ['pair', 'verdict', 'reason'],
      },
    },
  },
  required: ['verdicts'],
};

// Long titles must NOT be truncated short: the audit's worst over-merges
// (Polanus pars nona vs duodecima, Plutarch vol 1 vs 8, Boyle Opera Varia
// tracts) all had their distinguishing volume/part marker beyond a 90-char
// cut. The work_id slug is included too — it encodes volume digits and year
// markers even when the sampled titles hide them.
function sideLine(s) {
  const langs = s.langs.size ? ` [${[...s.langs].join('/')}]` : '';
  const years = s.years.length ? ` (${Math.min(...s.years)}${Math.max(...s.years) !== Math.min(...s.years) ? '-' + Math.max(...s.years) : ''})` : '';
  const titles = [...s.titles].slice(0, 4).map((t) => `"${t.slice(0, 220)}"`).join('; ');
  return `${titles}${langs}${years}, ${s.n} book${s.n === 1 ? '' : 's'}, id: ${s.wid}`;
}

async function judgeBatch(pairs) {
  const list = pairs.map((p, i) =>
    `P${i}: author "${p.author}"\n  A: ${sideLine(p.sideA)}\n  B: ${sideLine(p.sideB)}`
  ).join('\n');
  const prompt = `You are a bibliographic cataloger applying FRBR Work-level identity. For each pair below, decide whether A and B are the SAME intellectual WORK — i.e. editions, printings, or translations of one work (titles may differ across languages), or DIFFERENT works.

Rules:
- CONTAINMENT IS NOT IDENTITY. If one side is a collection, anthology, combined volume, or collected edition ("Iliad AND Odyssey", "Opera omnia", "De officiis + Cato maior + Laelius") and the other is a single constituent work, they are DIFFERENT — a container is never the same work as one thing inside it.
- Separate VOLUMES or PARTS of a multi-volume set are DIFFERENT works.
- A commentary ON a work, or an excerpt OF a work, is DIFFERENT from the whole.
- Identical or near-identical titles in the same or different languages, with no containment signal, are usually the SAME work minted twice (e.g. an original-language title and its English gloss).
- A generic title ("Fragments", "Letters", "Works", "Theses theologicae") matched against a specific title could be the same item catalogued lazily OR a different one — answer "unsure" unless something pins it.
- Check the ids and the FULL titles for volume/part/series markers (vol., tomus, pars, "1745-2", a year embedded in a serial id): identical wording with different part markers = DIFFERENT.
- Use your bibliographic knowledge of original vs translated titles.
- Base your reasoning ONLY on the listed titles/languages/years — do not invent facts about the books.
- Answer "same" or "different" ONLY when the listed evidence clearly supports it; when both readings are plausible or the evidence is thin, answer "unsure". "unsure" is a good answer — it routes the pair to a human.

Pairs:
${list}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    // default thinking budget left on: the container-vs-constituent rule needs
    // it — with thinkingBudget 0 the trial run merged works into collections
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(GEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      if (r.status === 429) { await sleep(5000 * (attempt + 1)); continue; }
      if (!r.ok) { if (attempt === 3) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`); await sleep(2000); continue; }
      const j = await r.json();
      const txt = j.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!txt) { if (attempt === 3) return null; await sleep(1500); continue; }
      return JSON.parse(txt);
    } catch (e) { if (attempt === 3) { console.error(`  ! batch failed: ${e.message}`); return null; } await sleep(2000); }
  }
  return null;
}

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db(process.env.MONGODB_DB || 'bookstore');
const queue = db.collection('work_merge_queue');
const books = db.collection('books');

const filter = { status: 'pending', ...(FORCE ? {} : { llm: { $exists: false } }) };
let rows = await queue.find(filter).sort({ _id: 1 }).toArray();
if (LIMIT) rows = rows.slice(0, LIMIT);
console.log(`${rows.length} pending rows to screen (${FORCE ? 'force re-stamp' : 'unstamped only'})`);
if (!rows.length) { await mc.close(); process.exit(0); }

// Live context per side: representative title + languages + years, straight
// from books (the frozen evidence strings are display-order-unstable).
const wids = [...new Set(rows.flatMap((r) => [r.a, r.b]))];
const sideByWid = new Map();
for (let i = 0; i < wids.length; i += 500) {
  const docs = await books.find(
    { work_id: { $in: wids.slice(i, i + 500) } },
    { projection: { _id: 0, work_id: 1, title: 1, display_title: 1, language: 1, year: 1 } }
  ).toArray();
  for (const b of docs) {
    if (!sideByWid.has(b.work_id)) sideByWid.set(b.work_id, { wid: b.work_id, titles: new Set(), langs: new Set(), years: [], n: 0 });
    const s = sideByWid.get(b.work_id);
    s.n++;
    const t = b.display_title || b.title || '';
    if (t) s.titles.add(t);
    if (b.language) s.langs.add(b.language);
    if (typeof b.year === 'number') s.years.push(b.year);
  }
}

const jobs = rows
  .map((r) => ({
    id: r._id, author: r.evidence?.author || 'unknown',
    sideA: sideByWid.get(r.a), sideB: sideByWid.get(r.b),
  }))
  .filter((j) => j.sideA?.n && j.sideB?.n); // stale pairs are the UI's problem, not the screen's
console.log(`${jobs.length} pairs have live books on both sides`);

const now = new Date();
let stamped = 0;
const tally = { same: 0, different: 0, unsure: 0 };
for (let i = 0; i < jobs.length; i += BATCH) {
  const batch = jobs.slice(i, i + BATCH);
  const res = await judgeBatch(batch);
  if (!res?.verdicts) continue;
  const ops = [];
  for (const v of res.verdicts) {
    const idx = parseInt((v.pair || '').replace(/^P/, ''), 10);
    const job = batch[idx];
    if (!job || !['same', 'different', 'unsure'].includes(v.verdict)) continue;
    tally[v.verdict]++;
    ops.push({
      updateOne: {
        filter: { _id: job.id, status: 'pending' }, // never touch a row reviewed mid-run
        update: { $set: { llm: { verdict: v.verdict, reason: (v.reason || '').slice(0, 400), model: MODEL, at: now }, updated_at: now } },
      },
    });
  }
  if (ops.length) {
    const r = await queue.bulkWrite(ops, { ordered: false });
    stamped += r.modifiedCount;
  }
  process.stderr.write(`  ${Math.min(i + BATCH, jobs.length)}/${jobs.length} judged, ${stamped} stamped\n`);
}

console.log(`\nDONE — ${stamped} rows stamped: same=${tally.same} different=${tally.different} unsure=${tally.unsure}`);
console.log('Review lanes: /admin/identity-review → filter "LLM: unsure" first, then spot-check "same".');
await mc.close();
