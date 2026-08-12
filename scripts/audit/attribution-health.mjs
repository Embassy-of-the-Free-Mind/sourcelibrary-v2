#!/usr/bin/env node
/**
 * Attribution health — the number that says whether the corpus is getting
 * better at answering "who wrote this". (#3894)
 *
 * WHY THIS EXISTS. The attribution workstream had been reporting counts of
 * records fixed. That is an activity metric: no denominator, no baseline, no
 * trend, and it cannot come back negative. This is the quality metric it should
 * have been reported against, built to the same shape as the OCR loop
 * (`.claude/docs/ocr-quality-measurement-loop.md`): computable for free from
 * fields that already exist, re-runnable, and able to show a regression.
 *
 * WHAT ATTRIBUTION IS FOR. A byline is not decoration — it is how a reader
 * REACHES a book. Machiavelli's *Il Principe* filed under its printer is
 * present in the corpus and unreachable by the only search anyone would try.
 * So the metric measures reachability, not prettiness, and its tiers are the
 * successive things that have to be true for a reader to arrive:
 *
 *   T0 ABSENT     no author, or a placeholder ("Unknown", "[s.n.]").
 *                 Nothing to search for.
 *   T1 UNUSABLE   a string that is not a name — a #3434 search term, a work
 *                 title, "[object Object]". WORSE than absent: it looks like an
 *                 answer and sends the reader nowhere.
 *   T2 UNLINKED   a plausible name with no `author_id`. The byline renders, but
 *                 there is no author page and the work graph cannot see it.
 *   T3 LINKED     joined to a thesaurus doc. The author page works.
 *   T4 ANCHORED   that doc carries VIAF or Wikidata. The identity is checkable
 *                 by someone outside this project, which is what "citable"
 *                 requires.
 *
 * Each book scores the highest tier it reaches. The headline is the share of
 * VISIBLE books at T3+ and at T4, because visible books are the ones a reader
 * can actually hit.
 *
 * CONTRADICTIONS are counted separately and deliberately NOT folded into the
 * tiers. A book can be beautifully linked and anchored to the wrong person —
 * that is precisely what this workstream kept finding — so a contradiction is
 * an overlay on any tier, not a rung below them.
 *
 * Read-only. Writes a dated snapshot with --snapshot so the trend is a fact on
 * disk rather than a memory.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/attribution-health.mjs
 *   node scripts/audit/attribution-health.mjs --json
 *   node scripts/audit/attribution-health.mjs --snapshot   # append to the ledger
 *   node scripts/audit/attribution-health.mjs --all        # include hidden books
 */
import { MongoClient } from 'mongodb';
import { appendFileSync, readFileSync, existsSync } from 'fs';
import { sameNameForm } from '../lib/name-equivalence.mjs';

const JSON_OUT = process.argv.includes('--json');
const SNAPSHOT = process.argv.includes('--snapshot');
const ALL = process.argv.includes('--all');
const LEDGER = '.claude/docs/attribution-health-ledger.jsonl';
const log = (...a) => { if (!JSON_OUT) console.log(...a); };

/** Placeholders — a value that names nobody. */
const PLACEHOLDER = /^(unknown|anonymous|anon|various|n\/?a|none|untitled|\[?s\.?\s*n\.?\]?|sine nomine|no author|not stated|unbekannt|onbekend|\[?unknown author\]?)$/i;

/**
 * Strings that are not names at all. Each pattern is a defect class this
 * project has actually shipped, not a hypothetical.
 */
const NOT_A_NAME = [
  { tag: 'object-stringified', re: /^\[object Object\]$/ },
  { tag: 'concatenated-placeholder', re: /^(anonymous|unknown)(unknown|anonymous)/i },
  { tag: 'model-reasoning', re: /\b(wait|I will use|must be exactly one)\b/i },
  { tag: 'over-long', re: /^.{200,}$/s },
  { tag: 'relator-artifact', re: /\b(creator|contributor|author)\s*$/i },
];

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');
// TEXT ONLY. `resource_type` present means the record is an ARTWORK, which has
// a different identity model: the "author" is the artist, and artwork titles
// conventionally OPEN with the artist's name. Including them made the
// work-title-as-author check flag Goltzius, Bruegel, Bosch and Botticelli —
// 3,606 books, nearly all of the apparent defect. Attribution health is a
// question about the book corpus; artworks need their own instrument.
const TEXT_ONLY = { resource_type: { $exists: false } };
const scope = ALL ? TEXT_ONLY : { visible: true, ...TEXT_ONLY };
const authors = db.collection('authors');

// The thesaurus, loaded once: slug -> is it authority-anchored?
const anchored = new Map();
for await (const a of authors.find({}, { projection: { wikidata_id: 1, viaf_id: 1, merged_into: 1 } })) {
  anchored.set(a._id, {
    anchored: Boolean(a.wikidata_id || a.viaf_id),
    tombstone: Boolean(a.merged_into),
  });
}
log(`thesaurus docs: ${anchored.size.toLocaleString()}\n`);

// Author strings that are really work TITLES.
//
// Two guards, because the naive test is badly wrong. A string is title-ish only
// when it opens some book's title AND both of the following hold:
//
//  1. it is NOT an authority-anchored person. A real author with a VIAF or
//     Wikidata id is a person, whatever else their name also opens.
//  2. the books WEARING it as an author are different works from the ones it
//     titles. An author heading their own book is the normal case, not a
//     defect — "Hermes Trismegistus" opens many titles AND wrote them.
//
// Without guard 2 this reported 6,025 unusable strings on its first run, i.e.
// 16% of the visible corpus, by flagging every author whose name starts a
// title. `author-attribution.mjs` has carried this same guard since #3434;
// dropping it here reproduced the bug it was written to prevent.
const titleish = new Set();
{
  const normKey = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // title opening -> set of book ids whose title starts that way
  const openings = new Map();
  for await (const b of books.find(scope, { projection: { normalized_title: 1, title: 1 } })) {
    const words = normKey(b.normalized_title || b.title).split(' ').filter(Boolean);
    for (let n = 2; n <= 4 && n <= words.length; n++) {
      const k = words.slice(0, n).join(' ');
      if (!openings.has(k)) openings.set(k, new Set());
      openings.get(k).add(b._id.toString());
    }
  }

  // author string -> the books carrying it, and whether it is anchored
  const carriers = new Map();
  for await (const b of books.find({ ...scope, author: { $type: 'string', $ne: '' } },
    { projection: { author: 1, author_id: 1 } })) {
    const a = b.author.trim();
    if (!carriers.has(a)) carriers.set(a, { ids: new Set(), anchored: false });
    carriers.get(a).ids.add(b._id.toString());
    const doc = b.author_id ? anchored.get(b.author_id) : null;
    if (doc && doc.anchored) carriers.get(a).anchored = true;
  }

  let skippedSelfTitled = 0;
  let skippedAnchored = 0;
  for (const [a, info] of carriers) {
    if (a.length < 8) continue;
    const k = normKey(a);
    if (k.split(' ').length < 2) continue;
    const titled = openings.get(k);
    if (!titled) continue;
    if (info.anchored) { skippedAnchored++; continue; }
    // Guard 2: are the carriers the very books this string titles?
    let overlap = 0;
    for (const id of info.ids) if (titled.has(id)) overlap++;
    if (overlap >= info.ids.size / 2) { skippedSelfTitled++; continue; }
    titleish.add(a);
  }
  log(`title openings indexed: ${openings.size.toLocaleString()}`);
  log(`  skipped, authority-anchored person  : ${skippedAnchored}`);
  log(`  skipped, author heads their own book: ${skippedSelfTitled}`);
}
log(`author strings that are work titles: ${titleish.size}\n`);

const tiers = { T0_ABSENT: 0, T1_UNUSABLE: 0, T2_UNLINKED: 0, T3_LINKED: 0, T4_ANCHORED: 0 };
const unusableBy = {};
let total = 0;
let contradicted = 0;
let comparable = 0;
let danglingLink = 0;
let tombstoneLink = 0;

const cursor = books.find(scope, {
  projection: { author: 1, author_id: 1, 'ai_metadata.author': 1 },
});
for await (const b of cursor) {
  total++;
  const a = typeof b.author === 'string' ? b.author.trim() : '';

  if (!a || PLACEHOLDER.test(a)) { tiers.T0_ABSENT++; continue; }

  const bad = NOT_A_NAME.find((p) => p.re.test(a)) || (titleish.has(a) ? { tag: 'work-title-as-author' } : null);
  if (bad) {
    tiers.T1_UNUSABLE++;
    unusableBy[bad.tag] = (unusableBy[bad.tag] || 0) + 1;
    continue;
  }

  // Contradiction overlay — independent of tier.
  const ai = b.ai_metadata?.author;
  if (ai && typeof ai === 'string' && ai.trim()) {
    comparable++;
    if (!sameNameForm(a, ai)) contradicted++;
  }

  if (!b.author_id) { tiers.T2_UNLINKED++; continue; }
  const doc = anchored.get(b.author_id);
  if (!doc) { tiers.T2_UNLINKED++; danglingLink++; continue; }   // FK to a doc that isn't there
  if (doc.tombstone) tombstoneLink++;
  if (doc.anchored) tiers.T4_ANCHORED++;
  else tiers.T3_LINKED++;
}

const reachable = tiers.T3_LINKED + tiers.T4_ANCHORED;
const pct = (n) => `${((100 * n) / total).toFixed(1)}%`;
const result = {
  measured_at: new Date().toISOString().slice(0, 10),
  scope: ALL ? 'all' : 'visible',
  total,
  tiers,
  headline: {
    reachable_pct: Number(((100 * reachable) / total).toFixed(2)),
    anchored_pct: Number(((100 * tiers.T4_ANCHORED) / total).toFixed(2)),
    unusable: tiers.T1_UNUSABLE,
  },
  unusable_by: unusableBy,
  contradictions: { comparable, contradicted },
  integrity: { dangling_author_id: danglingLink, links_to_tombstone: tombstoneLink },
};

if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
else {
  log(`══ attribution health — ${result.scope} books ══\n`);
  log(`  books measured : ${total.toLocaleString()}\n`);
  for (const [k, v] of Object.entries(tiers)) log(`    ${k.padEnd(14)} ${String(v).padStart(7)}  ${pct(v)}`);
  log(`\n  HEADLINE`);
  log(`    reachable (T3+) : ${result.headline.reachable_pct}%   — the byline leads to an author page`);
  log(`    anchored  (T4)  : ${result.headline.anchored_pct}%   — that identity is checkable outside this project`);
  log(`    unusable  (T1)  : ${tiers.T1_UNUSABLE}   — a string that looks like an answer and is not`);
  if (Object.keys(unusableBy).length) {
    for (const [k, v] of Object.entries(unusableBy).sort((x, y) => y[1] - x[1])) log(`        ${k.padEnd(26)} ${v}`);
  }
  log(`\n  CONTRADICTED    : ${contradicted} of ${comparable} books where a second opinion exists`);
  log('    (an overlay, not a tier — a book can be anchored to the WRONG person)');
  if (danglingLink || tombstoneLink) {
    log(`\n  INTEGRITY`);
    if (danglingLink) log(`    author_id pointing at a missing doc : ${danglingLink}`);
    if (tombstoneLink) log(`    author_id pointing at a tombstone   : ${tombstoneLink}  (resolver follows it, but the FK should be re-pointed)`);
  }

  if (existsSync(LEDGER)) {
    const prev = readFileSync(LEDGER, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
      .filter((r) => r.scope === result.scope);
    const last = prev[prev.length - 1];
    if (last) {
      const d = (a, b) => { const x = (a - b); return `${x >= 0 ? '+' : ''}${x.toFixed(2)}`; };
      log(`\n  SINCE ${last.measured_at}`);
      log(`    reachable ${d(result.headline.reachable_pct, last.headline.reachable_pct)} pts`
        + `   anchored ${d(result.headline.anchored_pct, last.headline.anchored_pct)} pts`
        + `   unusable ${result.headline.unusable - last.headline.unusable}`);
    }
  }
}

if (SNAPSHOT) {
  appendFileSync(LEDGER, `${JSON.stringify(result)}\n`);
  log(`\nsnapshot appended to ${LEDGER}`);
}
await mc.close();
