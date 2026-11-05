#!/usr/bin/env node
/**
 * Builds panel.json once; it is then fixed, because a benchmark over a moving panel cannot fall honestly.
 *
 * Four strata:
 *   topic   30 history questions from the #8154 trigger test, reused unchanged. Written by the author.
 *   work    20 non-English editions we hold translated, drawn at random, so no one chose them.
 *   modern  10 modern questions from #8154. A citation of us here is a false positive.
 *   pointed 10 topic questions naming our address. The positive control, and the acceptance test on #8161.
 *
 * Read-only. Run with the production env file:
 *   node --env-file=<main checkout>/.env.production.local scripts/eval/citation-benchmark-8161/draw-panel.mjs
 *
 * PRIOR ART: scripts/eval/mcp-trigger-8154/questions.json supplies topic and modern; it holds nothing drawn from the corpus.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { READABLE_RUNGS } from '../../lib/page-counts.mjs';

// One physical volume of a set, such as a Siku Quanshu slice: no one asks for a work this way.
// This under-samples Chinese, and the write-up says so.
const VOLUME_SLICE = /\(vol\b|\bvol\.|\bslice\b|卷/i;

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'panel.json');
if (existsSync(OUT)) throw new Error('panel.json exists; the panel is fixed. Delete it by hand only to start a new series.');

const { positive, negative } = JSON.parse(readFileSync(join(HERE, '../mcp-trigger-8154/questions.json'), 'utf8'));
const WORK_N = 20;
const POINTED_N = 10;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const pool = await client.db('bookstore').collection('books').aggregate([
  {
    $match: {
      visible: true,
      pages_count: { $gt: 0 },
      'translation_state.rung': { $in: [...READABLE_RUNGS] },
      'translation_state.english_original': { $ne: true },
      author: { $type: 'string', $nin: ['', 'Unknown'] },
      title: { $type: 'string', $not: VOLUME_SLICE },
    },
  },
  { $sample: { size: 200 } },
  { $project: { id: 1, title: 1, display_title: 1, author: 1, published: 1, language: 1 } },
]).toArray();
await client.close();

const seen = new Set();
const works = [];
for (const b of pool) {
  const author = b.author.trim();
  if (seen.has(author) || author.length > 80 || b.title.length > 140 || /unknown|anonym/i.test(author)) continue;
  seen.add(author);
  works.push(b);
  if (works.length === WORK_N) break;
}
if (works.length < WORK_N) throw new Error(`drew only ${works.length} usable works`);

const every = Math.floor(positive.length / POINTED_N);
const panel = [
  ...positive.map((q, i) => ({ id: `topic-${i}`, stratum: 'topic', q })),
  ...works.map((b, i) => ({
    id: `work-${i}`,
    stratum: 'work',
    book_id: b.id,
    book_slug_hint: b.display_title || b.title,
    q: `Is there an English translation of "${b.title}" by ${author(b)}, and where can I read it online?`,
  })),
  ...negative.map((q, i) => ({ id: `modern-${i}`, stratum: 'modern', q })),
  ...positive.filter((_, i) => i % every === 0).slice(0, POINTED_N).map((q, i) => ({
    id: `pointed-${i}`,
    stratum: 'pointed',
    q: `${q} Use sourcelibrary.org to find it.`,
  })),
];

function author(b) { return b.author.trim(); }

writeFileSync(OUT, `${JSON.stringify({ drawn_at: new Date().toISOString(), pool_n: pool.length, panel }, null, 1)}\n`);
console.log(`wrote ${panel.length} questions`);
for (const w of panel.filter((p) => p.stratum === 'work')) console.log(w.q);
