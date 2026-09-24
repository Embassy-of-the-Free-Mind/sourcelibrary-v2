#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/build-gallery-subject-index.mjs reads the same
 * `metadata.subjects` field but only counts raw strings — it has no vocabulary, which is
 * why "botany", "herbalism", "flora" and "medicinal plants" were four separate tiles.
 * The Iconclass backfills (scripts/backfill-iconclass-*.mjs) are the cautionary prior
 * art: they asked the model to RECALL codes and ~29% did not exist (#4856). This script
 * only lets the model choose among the fixed term ids in src/data/image-subjects.json,
 * and drops any id it returns that is not on that list.
 *
 * Map raw illustration subject strings onto the controlled vocabulary (#4856).
 *
 * The extractor writes free-text `metadata.subjects` (≈39K distinct strings). The browse
 * page and `/gallery?topic=` read `src/data/image-subject-map.json` (raw string → term
 * ids) to group them. This script finds strings above a usage floor that are not yet in
 * the map and proposes term ids for them.
 *
 * It never touches `gallery_images`, `books` or `pages` — it reads counts and writes a
 * JSON file in the repo, which a human reviews in the PR diff before it takes effect.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/map-image-subjects.mjs
 *   … --min-count=N   only strings used on ≥ N visible images (default 25)
 *   … --write         merge proposals into src/data/image-subject-map.json
 *                     (default: print proposals, write nothing)
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import { callGemini } from '../lib/gemini-script-client.mjs';

const ARG = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const MIN_COUNT = Number(ARG('min-count', '25'));
const WRITE = process.argv.includes('--write');
const VOCAB_PATH = 'src/data/image-subjects.json';
const MAP_PATH = 'src/data/image-subject-map.json';
const BATCH = 120;
const MODEL = 'gemini-3.1-flash-lite';

const vocab = JSON.parse(fs.readFileSync(VOCAB_PATH, 'utf8'));
const termIds = new Set(vocab.categories.flatMap((c) => c.terms.map((t) => t.id)));
const termList = vocab.categories
  .map((c) => `${c.label}:\n` + c.terms.map((t) => `  ${t.id} = ${t.label}`).join('\n'))
  .join('\n');
const existing = fs.existsSync(MAP_PATH) ? JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')) : { map: {} };

function prompt(strings) {
  return `You are sorting subject labels that were written for illustrations in early-modern books into a fixed browsing vocabulary.

VOCABULARY (use only these ids):
${termList}

For each label below, return the 0, 1 or 2 term ids that a reader browsing for that label would expect it under.
- Choose ONLY ids from the vocabulary. Never invent an id.
- Return [] for labels that are only a place, period, dynasty, person, nationality or collection name (e.g. "France", "Ming Dynasty", "Siku Quanshu", "Philodemus"), or too vague to place (e.g. "science", "history" may still map to a general term if one fits).
- Prefer one id; use two only when the label genuinely spans both (e.g. "sacred geometry" → geometry and number symbolism).

LABELS:
${strings.map((s) => JSON.stringify(s)).join('\n')}

Return ONLY a JSON object mapping each label exactly as given to an array of ids.`;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const rows = await client.db('bookstore').collection('gallery_images').aggregate([
    { $match: { book_visible: true, 'metadata.subjects.0': { $exists: true } } },
    { $unwind: '$metadata.subjects' },
    { $group: { _id: '$metadata.subjects', n: { $sum: 1 } } },
    { $match: { n: { $gte: MIN_COUNT } } },
    { $sort: { n: -1 } },
  ], { allowDiskUse: true, maxTimeMS: 600000 }).toArray();
  await client.close();

  const todo = rows.filter((r) => typeof r._id === 'string' && !(r._id in existing.map));
  console.log(`${rows.length} strings ≥ ${MIN_COUNT}; ${todo.length} not yet mapped`);

  const proposals = {};
  let dropped = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const strings = todo.slice(i, i + BATCH).map((r) => r._id);
    const { text } = await callGemini({
      model: MODEL, prompt: prompt(strings), endpoint: 'scripts/maintenance/map-image-subjects.mjs',
      maxOutputTokens: 8000, temperature: 0,
    });
    const m = text.match(/\{[\s\S]*\}/);
    const out = m ? JSON.parse(m[0]) : {};
    for (const s of strings) {
      const ids = Array.isArray(out[s]) ? out[s] : [];
      const valid = ids.filter((id) => termIds.has(id));
      dropped += ids.length - valid.length;
      proposals[s] = valid;
    }
    console.log(`  mapped ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }
  console.log(`dropped ${dropped} ids that are not in the vocabulary`);

  const counts = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  for (const [s, ids] of Object.entries(proposals).slice(0, 60)) console.log(`${counts[s]}\t${s}\t→ ${ids.join(', ') || '(none)'}`);

  if (!WRITE) { console.log('\n(no --write: nothing saved)'); return; }
  const merged = { ...existing.map, ...proposals };
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => (counts[b] ?? 0) - (counts[a] ?? 0)));
  fs.writeFileSync(MAP_PATH, JSON.stringify({
    _about: 'Raw metadata.subjects string → term ids in src/data/image-subjects.json (#4856). Proposed by scripts/maintenance/map-image-subjects.mjs, reviewed by a human in the PR diff. [] = deliberately unmapped (a place, period or name, not a subject). Hand edits welcome.',
    map: sorted,
  }, null, 1) + '\n');
  console.log(`wrote ${MAP_PATH}: ${Object.keys(sorted).length} strings`);
}

main().catch((e) => { console.error(e); process.exit(1); });
