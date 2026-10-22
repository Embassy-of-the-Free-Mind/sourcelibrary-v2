// Date each harvested work by when it was WRITTEN, not by the edition the library holds (#7073).
// Usage: node --env-file=<repo>/.env.production.local scripts/eval/figure-reception/written.mjs
//        → scripts/eval/figure-reception/written.json   (all figures at once; reads only, free)
//
// PRIOR ART: none for this — books.year is the edition's year everywhere (catalog.jsonl, Mongo); the authors
// thesaurus carries wikidata_death_year for some authors, which is what this reads. Looked in scripts/lib,
// scripts/eval/lib and scripts/maintenance for a composition-date helper.
//
// Why: Claudianus Mamertus wrote c. 470, but the library holds the 1885 CSEL edition, so the Philolaus page put him
// after Raynaud (1622) and Boeckh (1819), who cite him — and the story tree, which only links a passage to an
// EARLIER one, could never make the source the root of its own story.
//
// Rule: written = min(edition year, the author's death year). The death year is an upper bound on when the text
// was written, so the pages show it as "by 474". Death years come from the authors thesaurus
// (wikidata_death_year), else from Wikidata (P570) via the author's wikidata_id. A book whose catalogue author is
// an editor or a modern scholar is untouched, since the editor died after the edition. written-overrides.json
// holds hand corrections, each with its reason: author_id pointing at the subject rather than the writer (a study
// of Philolaus filed under Philolaus), or a wrong Wikidata match.
//
// Output: { "<book id>": [writtenYear, "<author slug>", "<author's name, one word>", editionYear, pages] } for books whose year changes; absent = edition year.
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { HERE, workDir } from './lib.mjs';

const FIGS = Object.keys(JSON.parse(fs.readFileSync(path.join(HERE, 'figures.json'), 'utf8'))).filter((k) => !k.startsWith('_'));
const ids = new Set(FIGS.flatMap((k) => JSON.parse(fs.readFileSync(path.join(workDir(k), 'hits.json'), 'utf8')).map((b) => b.id)));
const cat = new Map();
for (const l of fs.readFileSync(path.join(process.env.HOME, 'sl-corpus/catalog.jsonl'), 'utf8').split('\n')) {
  if (!l) continue;
  const d = JSON.parse(l);
  if (ids.has(d.id)) cat.set(d.id, d);
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
const slugs = [...new Set([...cat.values()].map((d) => d.author_id).filter(Boolean))];
const authors = new Map();
for await (const a of client.db('bookstore').collection('authors').find({ slug: { $in: slugs } }, { projection: { slug: 1, wikidata_id: 1, wikidata_death_year: 1, canonical_name: 1 } })) authors.set(a.slug, a);
await client.close();

// Wikidata for authors the thesaurus has no death year for. Earliest P570 value; BCE years come back negative.
const need = [...authors.values()].filter((a) => typeof a.wikidata_death_year !== 'number' && /^Q\d+$/.test(a.wikidata_id || ''));
const wd = new Map();
for (let i = 0; i < need.length; i += 200) {
  const q = `SELECT ?a (MIN(YEAR(?d)) AS ?y) WHERE { VALUES ?a { ${need.slice(i, i + 200).map((a) => 'wd:' + a.wikidata_id).join(' ')} } ?a wdt:P570 ?d } GROUP BY ?a`;
  const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: { 'user-agent': 'SourceLibrary figure-reception (sourcelibrary.org)', accept: 'application/sparql-results+json' } });
  if (!r.ok) throw new Error(`wikidata ${r.status}`);
  for (const b of (await r.json()).results.bindings) if (b.y) wd.set(b.a.value.split('/').pop(), Number(b.y.value));
}

const overrides = JSON.parse(fs.readFileSync(path.join(HERE, 'written-overrides.json'), 'utf8'));
const out = {};
const review = [];
for (const [id, d] of cat) {
  const a = authors.get(d.author_id);
  const death = a ? (typeof a.wikidata_death_year === 'number' ? a.wikidata_death_year : wd.get(a.wikidata_id)) : undefined;
  // Conservative: a pseudonymous text, or a compilation of several authors, keeps its edition year, since one
  // author's death year says nothing about when the rest was written.
  const names = (d.author || '').replace(/\(.*?\)/g, '').split(/[;|/]| and | & /).filter((x) => x.trim() && !/\b(ed|eds|edited|trans|tr|transl|translated|comm|notes|introd\w*|printed)\b\.?/i.test(x));
  // An edition WITH someone else's commentary (Bekker's Scholia in Aristotelem, "Aratus with Commentaries", Muret's
  // scholia on Horace) is catalogued under the author commented on, but its notes are the commentator's.
  const title = d.display_title || d.title || '';
  const withCommentary = /with (the |his )?\S*\s?(commentar|scholi|notes)|\((greek text with )?commentary\)|scholi(a|is|um)|commentari(is|i a)|annotation(es|s)|glosses|notis|emendat|commentary by|commentaries of/i.test(title);
  const plain = names.length <= 1 && !/pseudo/i.test(d.author || '') && !withCommentary;
  let y = plain && d.year != null && death != null && death < d.year ? death : null;
  if (id in overrides) y = overrides[id].year;
  if (y == null) continue;
  // The author's own name, for dating.py: an author rarely names himself, so a passage that names him is an editor's.
  const self = (a?.canonical_name || '').split(/[\s,]+/).find((w) => w.length >= 4 && !/^(saint|pseudo|the|of)$/i.test(w)) || '';
  out[id] = [y, d.author_id, self, d.year, d.pages_count || 0];
  review.push([d.year - y, y, d.year, a?.canonical_name ?? d.author_id, d.author, d.display_title || d.title, id]);
}
fs.writeFileSync(path.join(HERE, 'written.json'), JSON.stringify(out, null, 0).replace(/\],"/g, '],\n"') + '\n');
review.sort((x, y) => y[0] - x[0]);
fs.writeFileSync(path.join(workDir('_review'), 'written-review.tsv'), review.map((r) => r.join('\t')).join('\n') + '\n');
console.log(`books ${cat.size}, with an author record ${[...cat.values()].filter((d) => authors.has(d.author_id)).length}, death year known for ${[...cat.values()].filter((d) => { const a = authors.get(d.author_id); return a && (typeof a.wikidata_death_year === 'number' || wd.has(a.wikidata_id)); }).length} (Wikidata filled ${wd.size}); redated ${review.length}; review → ${path.join(workDir('_review'), 'written-review.tsv')}`);
