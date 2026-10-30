#!/usr/bin/env node
/**
 * Report-only seed for `books.contributors[]` (#7787 steps 1-2). WRITES NOTHING.
 *
 * PRIOR ART: scripts/audit/thesaurus-variant-shape.mjs — classifies the shape of
 * `authors.variants[]` strings; this applies the same classifier to
 * `books.author` and asks the next question: could each part be attached to a
 * thesaurus person, and in what role?
 *
 * A book has one `author` string and one `author_id`, so co-authors, editors,
 * translators and printers are packed into the string ("Plato; Ficino, Marsilio
 * (trans.)", "Katherine Tingley (editor)"). This report proposes, per book, the
 * contributor list a later write would store, and buckets books by how safe
 * that proposal is. The main danger is a bad split minting people who do not
 * exist, so a part counts as resolved only when it matches exactly one
 * thesaurus doc on a matchable name form (`matchKeyVerdict`, the gate every
 * name-linking writer here uses).
 *
 * Buckets:
 *   single_clean         one person, no role: contributors = [author_id as aut]
 *   single_role_matched  one person with a role, person found in the thesaurus
 *   single_role_unmatched
 *   multi_all_matched    every part resolves to exactly one thesaurus doc
 *   multi_partial        some parts resolve
 *   multi_none           no part resolves (leave the string alone)
 *   multi_ambiguous      a part matches several docs
 *   left_alone           script pair, institutional, edition, overlong, bare forename
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/contributors-seed-report.mjs [--all]
 *   --all  every text book, not just live ones (visible && pages_count > 0)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { buildExtenderIndex, classifyVariant, matchKeyVerdict, parseContributor } from '../lib/variant-shape.mjs';
import { stripRelator } from '../lib/name-equivalence.mjs';

const ALL = process.argv.includes('--all');
const OUT = 'scripts/output/contributors-seed-report.json';
const SAMPLES = 25;

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');
const authors = db.collection('authors');

const scope = ALL
  ? { content_type: { $ne: 'artwork' } }
  : { visible: true, pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' } };

const extendingPeople = buildExtenderIndex((await books.aggregate([
  { $match: { author: { $type: 'string', $nin: ['', null] }, content_type: { $ne: 'artwork' } } },
  { $group: { _id: '$author' } },
], { allowDiskUse: true }).toArray()).map((r) => r._id));

/**
 * Lookup key for a personal name: marks, case, life dates and punctuation off,
 * so "Manuzio, Aldo, 1449 or 50-1515" and "Manuzio, Aldo" meet. Each name is
 * also keyed in swapped order ("Ficino, Marsilio" -> "marsilio ficino").
 */
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(ca|approximately|active|fl|or|b|d)\b\.?/g, ' ')
  .replace(/[\d?]+/g, ' ').replace(/[^\p{L}\s,]/gu, ' ').replace(/\s+/g, ' ').trim();
function keys(name) {
  const f = fold(name).replace(/\s*,\s*$/, '');
  if (!f) return [];
  const flat = f.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const out = new Set([flat]);
  const m = f.match(/^([^,]+),\s*([^,]+)/);
  if (m) out.add(`${m[2].trim()} ${m[1].trim()}`);
  return [...out];
}

const index = new Map();
// Every form, gated or not, so a bare "Longinus" the gate refuses can still
// confirm the link a book already has (it adds nothing new, so it is safe).
const anyForm = new Map();
let docs = 0;
for await (const a of authors.find({ merged_into: { $exists: false } },
  { projection: { canonical_name: 1, variants: 1, aliases: 1 } }).batchSize(2000)) {
  docs++;
  for (const form of [a.canonical_name, ...(a.variants || []), ...(a.aliases || [])]) {
    for (const k of keys(form)) {
      if (!anyForm.has(k)) anyForm.set(k, new Set());
      anyForm.get(k).add(a._id);
    }
    if (!form || !matchKeyVerdict(form, a._id, { extendingPeople }).matchable) continue;
    for (const k of keys(form)) {
      if (!index.has(k)) index.set(k, new Set());
      index.get(k).add(a._id);
    }
  }
}

function resolve(name) {
  const hits = new Set();
  for (const k of keys(name)) for (const s of index.get(k) || []) hits.add(s);
  return [...hits];
}

const buckets = {};
const add = (b, row) => {
  buckets[b] ??= { books: 0, strings: new Map() };
  buckets[b].books++;
  const e = buckets[b].strings.get(row.author);
  if (e) e.books++; else buckets[b].strings.set(row.author, { ...row, books: 1 });
};
const roles = {};
let total = 0; let authorIdAgrees = 0; let authorIdDisagrees = 0;
const disagreeSamples = [];
// author_id slugs minted from a role-polluted string ("trans-richard-francis-
// burton", "zang-maoxun-compiler"): the fake-person risk, already in the data.
const POLLUTED_SLUG = /(^|-)(trans|tr|ed|eds|editor|editors|compiler|translator|hrsg|bearb)(-|$)/;
const pollutedSlugs = new Map();

for await (const b of books.find({ ...scope, author: { $type: 'string', $nin: ['', null] } },
  { projection: { author: 1, author_id: 1 } }).batchSize(2000)) {
  total++;
  if (b.author_id && POLLUTED_SLUG.test(b.author_id)) pollutedSlugs.set(b.author_id, (pollutedSlugs.get(b.author_id) || 0) + 1);
  const c = classifyVariant(b.author, { extendingPeople });
  // `classifyVariant` misses roles it has no word for ("(eds.)", "[Bearb.]"),
  // so a clean single name is parsed too and promoted if it carries one.
  const single = parseContributor(b.author);
  const singleHasRole = c.shape === 'clean' && (single.role || single.extra.length);
  if (c.shape === 'clean' && !singleHasRole) { add('single_clean', { author: b.author }); continue; }
  if (!singleHasRole && !['multi_person', 'role_annotated'].includes(c.shape)) {
    add('left_alone', { author: b.author, shape: c.shape });
    continue;
  }
  const multi = c.shape === 'multi_person';
  const SEP = /(\s*[|;]\s*|\s+&\s+|\s+\/\s+|\s*,\s+(?:and|et)\s+)/;
  const pieces = b.author.split(SEP);
  const rawParts = pieces.filter((_, i) => i % 2 === 0).map((s) => s.trim()).filter(Boolean);
  const seps = pieces.filter((_, i) => i % 2 === 1);
  const parsed = rawParts.map(parseContributor);
  // "A & B (eds.)": a bracketed role on the last of names joined by "&"/"and"
  // covers them all. After ";" or "|" each part keeps its own ("Euclid; T.L.
  // Heath (trans.)" makes Heath, not Euclid, the translator).
  const last = parsed[parsed.length - 1];
  if (multi && last.roleFrom === 'bracket' && seps.every((x) => !/[|;/]/.test(x))
      && parsed.slice(0, -1).every((p) => !p.role)) {
    for (const p of parsed) p.role = last.role;
  }
  const seen = new Set();
  const proposed = parsed.flatMap((p) => [{ name: p.name, role: p.role }, ...p.extra])
    .map(({ name, role }) => {
      const clean = stripRelator(name);
      const slugs = resolve(clean);
      // Several docs share the form (thesaurus duplicates): the book's existing
      // link breaks the tie, since keeping it changes nothing a reader sees.
      let pick = slugs.length === 1 ? slugs[0] : (b.author_id && slugs.includes(b.author_id) ? b.author_id : null);
      if (!pick && b.author_id && keys(clean).some((k) => anyForm.get(k)?.has(b.author_id))) pick = b.author_id;
      return { name: clean, role: role ?? 'aut', author_id: pick, candidates: slugs.length };
    })
    .filter((p) => {
      const k = `${p.author_id ?? p.name.toLowerCase()}|${p.role}`;
      if (seen.has(k) || !p.name) return false;
      seen.add(k); return true;
    });
  for (const p of proposed) roles[p.role] = (roles[p.role] || 0) + 1;

  const resolved = proposed.filter((p) => p.author_id).length;
  let bucket;
  if (proposed.length === 1) bucket = resolved ? 'single_role_matched' : 'single_role_unmatched';
  else if (proposed.some((p) => p.candidates > 1)) bucket = 'multi_ambiguous';
  else if (resolved === proposed.length) bucket = 'multi_all_matched';
  else bucket = resolved ? 'multi_partial' : 'multi_none';

  // Does the book's current author_id appear among the resolved parts? A
  // write must keep author_id as the primary author, so a disagreement means
  // the proposal and the existing link name different people.
  if (b.author_id && resolved) {
    if (proposed.some((p) => p.author_id === b.author_id)) authorIdAgrees++;
    else { authorIdDisagrees++; if (disagreeSamples.length < SAMPLES) disagreeSamples.push({ author: b.author, author_id: b.author_id, proposed }); }
  }
  add(bucket, { author: b.author, author_id: b.author_id ?? null, proposed });
}
await mc.close();

const report = {
  generated_at: new Date().toISOString(),
  scope: ALL ? 'all text books' : 'live text books (visible, pages_count > 0)',
  thesaurus_docs: docs,
  books_with_author: total,
  roles_proposed: roles,
  author_id_vs_proposal: { agrees: authorIdAgrees, disagrees: authorIdDisagrees, samples: disagreeSamples },
  role_polluted_author_ids: {
    slugs: pollutedSlugs.size,
    books: [...pollutedSlugs.values()].reduce((a, n) => a + n, 0),
    top: [...pollutedSlugs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40),
  },
  buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => {
    const strings = [...v.strings.values()].sort((a, b) => b.books - a.books);
    return [k, { books: v.books, distinct_strings: strings.length, top: strings.slice(0, SAMPLES) }];
  })),
};
mkdirSync('scripts/output', { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log(`${report.scope}: ${total} books with an author string; ${docs} thesaurus docs`);
for (const [k, v] of Object.entries(report.buckets)) console.log(`  ${k.padEnd(22)} ${String(v.books).padStart(6)} books  ${v.distinct_strings} strings`);
console.log('roles proposed:', JSON.stringify(roles));
console.log(`author_id among resolved parts: ${authorIdAgrees} agree, ${authorIdDisagrees} disagree`);
console.log(`author_id slugs that look role-polluted: ${report.role_polluted_author_ids.slugs} (${report.role_polluted_author_ids.books} books)`);
console.log(`report: ${OUT}`);
