#!/usr/bin/env node
/**
 * Pair the two readers on the frozen random-50 and find where they disagree.
 *
 * Only DISCORDANT rows carry information for McNemar — concordant rows cancel
 * out of the test by construction — so adjudication is spent there and nowhere
 * else. A row where both readers say the same thing is either right or a shared
 * blind spot, and a same-family adjudicator would not catch the latter anyway.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { sameNameForm, foldOrtho } from '../lib/name-equivalence.mjs';

const DIR = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/99d9b906-8887-4b60-ab4c-e4747d013447/scratchpad/bench50';
const index = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8'));

/** Same person, allowing for Latin/vernacular forms and partial name runs. */
function samePerson(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (sameNameForm(a, b)) return true;
  const fa = foldOrtho(a).split(' ').filter((w) => w.length >= 4);
  const fb = foldOrtho(b).split(' ').filter((w) => w.length >= 4);
  if (!fa.length || !fb.length) return foldOrtho(a) === foldOrtho(b);
  return fa.some((x) => fb.some((y) => x.startsWith(y.slice(0, 4)) || y.startsWith(x.slice(0, 4))));
}

const rows = [];
let missing = 0;
for (const e of index) {
  const p = `${DIR}/answers/reader-${e.n}.json`;
  if (!existsSync(p)) { missing++; continue; }
  let a;
  try {
    let t = readFileSync(p, 'utf8').trim();
    if (t.startsWith('```')) t = t.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    a = JSON.parse(t);
  } catch { missing++; continue; }
  const reader = a.author ?? null;
  const flash = e.flash_lite ?? null;
  rows.push({
    n: e.n, book_id: e.book_id, title: e.title, language: e.language, year: e.year,
    reader, reader_quote: a.quoted_line ?? null, reader_conf: a.confidence, reader_reason: a.reasoning,
    reader_caveat: a.caveat ?? null, reader_others: a.other_names ?? [],
    flash, flash_quote: e.flash_lite_quote ?? null,
    concordant: samePerson(reader, flash),
  });
}

const disc = rows.filter((r) => !r.concordant);
const conc = rows.filter((r) => r.concordant);
const bothNamed = disc.filter((r) => r.reader && r.flash);
const readerNull = disc.filter((r) => !r.reader && r.flash);
const flashNull = disc.filter((r) => r.reader && !r.flash);

console.log(`scored rows: ${rows.length}${missing ? ` (${missing} missing/unparseable)` : ''}`);
console.log(`  concordant : ${conc.length}  — both readers name the same person, or both name nobody`);
console.log(`  DISCORDANT : ${disc.length}  ← the only rows McNemar can use`);
console.log(`     reader says NOBODY, flash-lite names someone : ${readerNull.length}`);
console.log(`     reader names someone, flash-lite says nobody : ${flashNull.length}`);
console.log(`     both name someone, but different people      : ${bothNamed.length}`);
console.log(`\n  of the concordant rows, ${conc.filter((r) => !r.reader).length} are "both say nobody"`);

writeFileSync(`${DIR}/paired.json`, JSON.stringify({ rows, discordant: disc.map((r) => r.n) }, null, 1));
console.log(`\ndiscordant rows needing adjudication: ${disc.map((r) => r.n).join(', ')}`);
console.log(`written: ${DIR}/paired.json`);
