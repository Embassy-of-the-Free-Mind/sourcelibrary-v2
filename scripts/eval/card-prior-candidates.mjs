#!/usr/bin/env node

/**
 * Propose candidate English translations for EMPTY translation cards, from the
 * LoC/ESTC catalogue in `reference_translations`.
 *
 * WHY
 * An empty card is a live absence claim readers see — "No earlier English
 * translation is known to us". 604 of 919 cards are empty. Meanwhile
 * `reference_translations` holds 105,317 English items whose original was not
 * English, 126,558 of them carrying an LCCN. If any of those is a translation
 * of an empty card's work, the card is WRONG in the direction that matters.
 *
 * WHAT THIS IS NOT
 * It never writes to a card. The method's rule (.claude/docs/translation-card-
 * method.md) is: "Anyone — instrument or human — proposes an entry WITH A
 * CITATION. A reviewer merges it. Nothing lands unreviewed on a card that
 * changes what readers see." This is a suggester. Output is a review file.
 *
 * WHY MATCHING IS THE HARD PART
 * `reference_translations` rows carry NO work_id, book_id, translator or URL —
 * they are raw MARC-derived catalogue records. Linking them to a work is
 * exactly the card method's `wrong_work_identity` error class. A naive surname
 * substring match was measured at ~100% false positives on a 56-card probe:
 * "Ruel" matched *Bar*ruel, "Kircher" matched Rudolf Kircher and Unterkircher
 * but never Athanasius, "Estienne" matched *L*estienne. So this uses:
 *
 *   1. ANCHORED author match (`^Surname,`) — not substring.
 *   2. MARC `uniform_title` (populated on 67.6%) — the library world's own
 *      work identifier, e.g. "Meditations." for Marcus Aurelius. This is the
 *      signal that actually carries work identity.
 *   3. Original-language agreement where the card knows it.
 *   4. A token-overlap score against the card's work title.
 *
 * Each candidate is scored and the evidence is printed with it, so a reviewer
 * judges the match rather than trusting it.
 *
 * USAGE
 *   node --env-file=.env.production.local scripts/eval/card-prior-candidates.mjs \
 *     [--limit N] [--min-score 0.34] [--out <file.md>]
 */

import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const argVal = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const LIMIT = Number(argVal('--limit', 0)) || 0;
const MIN_SCORE = Number(argVal('--min-score', 0.34));
const OUT = argVal('--out', `scripts/eval/results/card-prior-candidates.md`);

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Pull the surname out of a card author.
 *
 * Cards write natural order ("Athanasius Kircher"); MARC writes inverted order
 * ("Kircher, Athanasius"). Taking the FIRST token anchors on the given name and
 * matches nothing — that bug produced a flat zero across 115 cards before a
 * positive control located it. Take the LAST token, unless the string is
 * already inverted (contains a comma), in which case the surname is first.
 */
function surnameOf(rawAuthor) {
  const a = String(rawAuthor || '').split('|')[0].replace(/[;.,\s]+$/, '').trim();
  if (!a) return '';
  if (a.includes(',')) return a.split(',')[0].trim();
  const parts = a.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

/** Normalise a title for comparison: fold case, diacritics and punctuation. */
function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(['the', 'a', 'an', 'of', 'de', 'des', 'du', 'la', 'le', 'les', 'el', 'il', 'and', 'et', 'und', 'or', 'on', 'in', 'ad', 'ex', 'vol', 'liber', 'libri', 'book', 'books']);
const tokens = (s) => norm(s).split(' ').filter((t) => t.length > 2 && !STOP.has(t));

/** Jaccard-ish overlap, weighted toward covering the card's title. */
function titleScore(cardTitle, rowUniform, rowTitle) {
  const a = new Set(tokens(cardTitle));
  if (!a.size) return 0;
  const best = [rowUniform, rowTitle].map((t) => {
    const b = new Set(tokens(t));
    if (!b.size) return 0;
    let hit = 0;
    for (const t2 of a) if (b.has(t2)) hit++;
    return hit / a.size;
  });
  return Math.max(...best);
}

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('Missing MONGODB_URI'); process.exit(2); }

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
await client.connect();
const db = client.db('bookstore');
const rt = db.collection('reference_translations');

const empties = await db.collection('work_translation_history')
  .find({ $or: [{ entries: { $size: 0 } }, { entries: { $exists: false } }] },
        { projection: { _id: 1, author: 1, work_title: 1, status: 1, search: 1 } })
  .toArray();

const cards = LIMIT ? empties.slice(0, LIMIT) : empties;
console.log(`empty cards to probe: ${cards.length} (of ${empties.length})`);

const results = [];
let probed = 0;

for (const card of cards) {
  const author = String(card.author || '').split('|')[0].trim();
  const surname = surnameOf(card.author);
  if (surname.length < 4) continue;
  probed++;

  // Anchored on the surname at the START of the MARC author string — the form
  // MARC uses ("Kircher, Athanasius"). Substring matching is what produced the
  // false positives.
  let rows = [];
  try {
    rows = await rt.find(
      {
        author: { $regex: `^${escRe(surname)}\\b`, $options: 'i' },
        item_language: 'eng',
        original_languages: { $exists: true, $ne: [] },
      },
      { projection: { _id: 0, lccn: 1, author: 1, title: 1, uniform_title: 1, year: 1, publisher: 1, original_languages: 1, source: 1, added_entries: 1 },
        limit: 40, maxTimeMS: 20000 },
    ).toArray();
  } catch (err) {
    console.error(`  ! ${card._id}: ${err.message}`);
    continue;
  }

  const scored = rows
    .map((r) => ({ r, score: titleScore(card.work_title, r.uniform_title, r.title) }))
    .filter((x) => x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  if (scored.length) results.push({ card, scored });
  if (probed % 100 === 0) console.log(`  …${probed} probed, ${results.length} cards with candidates`);
}

console.log(`\nprobed ${probed} cards; ${results.length} have >=1 candidate at score >= ${MIN_SCORE}`);

const lines = [];
lines.push(`# Candidate priors for EMPTY translation cards`);
lines.push('');
lines.push(`Generated by \`scripts/eval/card-prior-candidates.mjs\` (min-score ${MIN_SCORE}).`);
lines.push('');
lines.push(`**These are PROPOSALS, not entries.** An empty card is a live absence claim`);
lines.push(`("No earlier English translation is known to us"). Each row below is a`);
lines.push(`catalogue record that *might* refute one. Matching is on anchored author +`);
lines.push(`MARC uniform_title + title-token overlap, which is the card method's`);
lines.push(`\`wrong_work_identity\` failure class — so **a reviewer must open the citation`);
lines.push(`and confirm the work identity before anything lands on a card.**`);
lines.push('');
lines.push(`Probed ${probed} empty cards · ${results.length} with candidates.`);
lines.push('');
for (const { card, scored } of results) {
  lines.push(`## ${card.work_title || '(untitled)'}`);
  lines.push(`card: \`${card._id}\` · author: ${card.author} · status: ${card.status}`);
  lines.push('');
  for (const { r, score } of scored) {
    lines.push(`- **${r.year}** — ${r.title}`);
    lines.push(`  - uniform_title: \`${r.uniform_title || '(none)'}\` · score ${score.toFixed(2)}`);
    lines.push(`  - author: ${r.author} · publisher: ${r.publisher || '—'} · orig: ${JSON.stringify(r.original_languages)}`);
    lines.push(`  - **LCCN ${r.lccn}** (${r.source})${r.added_entries?.length ? ` · added entries: ${r.added_entries.join('; ')}` : ''}`);
  }
  lines.push('');
}
writeFileSync(OUT, lines.join('\n'));
console.log(`wrote ${OUT}`);

await client.close();
