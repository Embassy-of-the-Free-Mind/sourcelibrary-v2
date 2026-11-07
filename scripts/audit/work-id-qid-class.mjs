#!/usr/bin/env node
/**
 * Standing audit: every Wikidata QID carried as `books.work_id` must name a WORK (#8325).
 *
 * PRIOR ART: scripts/audit/author-anchor-validity.mjs — the same check for author
 * anchors (scripts/lib/author-anchor-classes.mjs is a person-side denylist; it
 * cannot tell a work from an edition). The one-off scan this repeats is
 * scripts/eval/work-recall/qid-nonwork-scan-8293.jsonl (96 ids on 454 books).
 *
 * An edition, translation or manuscript item as a work_id makes a cluster that can
 * never join the work's other editions, and a person / disambiguation page as one is
 * a plain mis-link (Q200655 "Mercurio" carried 33 Mahabharata books). Read-only.
 *
 *   node --env-file=.env.production.local scripts/audit/work-id-qid-class.mjs [--out f.jsonl] [--strict]
 *
 * Kinds: `edition` (an edition/translation/manuscript class and no work class),
 * `not_a_work` (no work class at all, after one P279 hop), `no_p31`, `redirected`
 * — these FAIL with --strict. `mixed` (typed both work and edition) is reported, not
 * failed: on Wikidata it is usually the only item for a one-edition work.
 * Fix a failing id with scripts/maintenance/apply-reviewed-work-splits.mjs --issue 8325
 * (a dissolve onto the P629 work, the old id kept as an alias).
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';

const UA = 'SourceLibrary-work-id-audit/1.0 (https://sourcelibrary.org; team@sourcelibrary.org)';
const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;

// a physical or published manifestation, not the work
const EDITION = new Set(['Q3331189', 'Q1789489', 'Q57933693', 'Q216665', 'Q7553', 'Q21112633', 'Q1346592', 'Q87167', 'Q48498',
  'Q125309905', 'Q1238720', 'Q213924']);
// work classes; anything else gets one P279 hop before it is called not-a-work
const WORK = new Set(['Q7725634', 'Q47461344', 'Q13136', 'Q384515', 'Q17518870', 'Q7725310', 'Q386724', 'Q17537576', 'Q732577',
  'Q234460', 'Q49848', 'Q5185279', 'Q25379', 'Q1279564', 'Q12765855', 'Q2668072', 'Q1371849', 'Q179461', 'Q37484', 'Q7099402',
  'Q3026037', 'Q1416320', 'Q10870555', 'Q1675302', 'Q27560760', 'Q1244841', 'Q913554', 'Q2271441', 'Q1631107',
  // "book" and its kin: how Wikidata most often types a one-edition early modern work
  'Q571', 'Q7433672']);

const claimIds = (e, p) => (e?.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
async function entities(ids, props = 'labels|claims') {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const r = await fetch('https://www.wikidata.org/w/api.php?' + new URLSearchParams({ action: 'wbgetentities', ids: ids.slice(i, i + 50).join('|'), props, languages: 'en', format: 'json' }),
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`wbgetentities ${r.status}`);
    Object.assign(out, (await r.json()).entities);
    await new Promise((s) => setTimeout(s, 300));
  }
  return out;
}

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
await client.connect();
const books = client.db(process.env.MONGODB_DB || 'bookstore').collection('books');
const carried = await books.aggregate([{ $match: { work_id: { $regex: /^Q\d+$/ } } },
  { $group: { _id: '$work_id', books: { $sum: 1 }, visible: { $sum: { $cond: [{ $eq: ['$visible', true] }, 1, 0] } } } }]).toArray();
await client.close();

const ents = await entities(carried.map((c) => c._id));
const classes = [...new Set(Object.values(ents).flatMap((e) => claimIds(e, 'P31')))];
const cls = await entities(classes); // labels for the report, P279 for the one hop
// an edition class is never a work, though it is a SUBCLASS of one (Q3331189 -> creative work)
const isWork = (q) => !EDITION.has(q) && (WORK.has(q) || claimIds(cls[q], 'P279').some((p) => WORK.has(p) && !EDITION.has(p)));
const label = (q) => cls[q]?.labels?.en?.value || q;

const rows = [];
for (const c of carried) {
  const e = ents[c._id] || {};
  const p31 = claimIds(e, 'P31');
  let kind = null;
  if (e.redirects) kind = 'redirected';
  else if (e.missing !== undefined) kind = 'missing';
  else if (!p31.length) kind = 'no_p31';
  else {
    const work = p31.some(isWork), ed = p31.some((q) => EDITION.has(q));
    kind = ed && !work ? 'edition' : ed ? 'mixed' : !work ? 'not_a_work' : null;
  }
  if (kind) rows.push({ qid: c._id, kind, label: e.labels?.en?.value ?? null, p31: p31.map((q) => `${q} ${label(q)}`), edition_of: claimIds(e, 'P629'),
    redirect: e.redirects?.to ?? null, books: c.books, visible: c.visible });
}
rows.sort((a, b) => b.books - a.books);
const failing = rows.filter((r) => r.kind !== 'mixed');
const byKind = rows.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] || 0) + 1 }), {});
console.log(JSON.stringify({ qids_carried: carried.length, books_on_qids: carried.reduce((n, c) => n + c.books, 0), flagged: byKind,
  failing_ids: failing.length, failing_books: failing.reduce((n, r) => n + r.books, 0) }, null, 1));
for (const r of failing.slice(0, 40)) console.log(`  ${r.kind.padEnd(10)} ${r.qid.padEnd(11)} ${String(r.books).padStart(3)} books  ${r.label} [${r.p31.join('; ')}]`);
if (OUT) { fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); console.log(`-> ${OUT}`); }
if (argv.includes('--strict') && failing.length) process.exit(1);
