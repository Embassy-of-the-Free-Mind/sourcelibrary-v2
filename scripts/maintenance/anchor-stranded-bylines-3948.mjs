#!/usr/bin/env node
/**
 * #3948 — anchor the books the #3894 byline corrections left below T4.
 *
 * PRIOR ART: scripts/maintenance/additive-mint-authors-3780.mjs — mints from a
 * verdict file and links by exact variant string; it cannot re-point a book off a
 * duplicate doc or put a QID on a doc that already exists. fix-author-anchors-3951.mjs
 * is the shape copied here (hand-adjudicated cases, one script, reversible), but
 * keeps its backup in a gitignored file; this one keeps the prior value in Mongo.
 *
 * WHERE THE COHORT STOOD (measured 2026-11-11). Of the 133 books carrying a
 * `*-3894` record in `author_link_provenance`, 90 were T4, 33 T3 and 10 T2. The
 * issue expected ~33 at T2; since August most of them were linked to UNANCHORED
 * docs minted from the corrected bylines — the T3 shortcut the issue warned
 * about. So the work is anchoring, not minting.
 *
 * HOW EACH QID WAS CHOSEN. The #3894 resolver pattern without the paid model
 * call: Wikidata wbsearchentities over the corrected byline's name forms →
 * human (P31 Q5) candidates with dates and description → judged by hand against
 * the book's own title and year (Claude, 2026-11-11). Two needed a source beyond
 * the search hit and got it: Ragazzoni (itwiki: commentator on the Epistulae ad
 * familiares, published by Paolo Manuzio, so the 1555 commentary is his) and
 * Fumo (itwiki: Dominican inquisitor of Piacenza, author of the Summa aurea).
 * "Eleganze … scielte da Aldo Mannucci" (1589) is Aldo the YOUNGER, Q2459068,
 * not Aldus (Q213220), whom the bare name search returns first.
 * At run time every QID is re-fetched and must still be a human whose life
 * dates admit the book's year: born no later than year−5, and — for an author
 * who died in the age of print (1450+) — died no earlier than year−50 (the
 * reconcile-authors-grounded.mjs gate). For an ancient or medieval author every
 * edition is posthumous, so only the birth half applies (Pliny, Damascene,
 * Catherine of Siena, Ammonius).
 *
 * THREE WRITE SHAPES, all reversible:
 *   ANCHOR  an existing unanchored doc gets wikidata_id (+ VIAF from P214).
 *           Refused if any other doc already holds the QID.
 *   REPOINT a book linked to an unanchored duplicate (or, once, to a stranger:
 *           Pavao Skalić's Miscellanea sat on the "Joachim" doc via the Joachim
 *           of Fiore entity) moves to the doc that already carries the QID.
 *           The duplicate doc is left in place — merging or tombstoning it
 *           reshapes a cluster and is a separate decision.
 *   LINK    a T2 book (no author_id) is linked to the doc holding the QID.
 * Nothing is minted: every person already had a doc (Fumo and Ciofano were
 * minted unanchored by #3780/#7660 after August).
 * Left at T2 on purpose: Catullus/Tibullus/Propertius (three people, one
 * author_id), and Pedemonte and Faletti (no Wikidata item; under-link beats a
 * guessed one).
 *
 * REVERSIBLE WITHOUT A BACKUP FILE. Books get an `author_link_provenance` record
 * with run RUN and the `prev_author_id` / `prev_author_entity_id` it replaced.
 * Anchored docs get `anchor_correction: {run, prev_wikidata_id, prev_viaf_id}`.
 * --revert reads those back.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/anchor-stranded-bylines-3948.mjs           # dry run
 *   node --env-file=.env.production.local scripts/maintenance/anchor-stranded-bylines-3948.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/anchor-stranded-bylines-3948.mjs --revert [--apply]
 */
import { MongoClient, ObjectId } from 'mongodb';

const RUN = 'anchor-stranded-3948';
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const UA = 'SourceLibrary-author-reconcile/1.0 (https://sourcelibrary.org; admin@sourcelibrary.org)';

// ANCHOR: existing unanchored doc → QID.
const ANCHOR = {
  'annibal-caro': 'Q566851',
  'louis-le-roy': 'Q684281',
  'francesco-priscianese': 'Q3750500',
  'asconius-pedianus': 'Q444285',
  'matteo-corti': 'Q18945660',
  'miquel-tomas-de-taxaquet': 'Q17301151',
  'juan-huarte-de-san-juan': 'Q3091925',
  'savino-de-bobali': 'Q1650958',
  'victor-faustus': 'Q110161787',
  'pietro-bizzarri': 'Q18530664',
  'ammonius-hermiae': 'Q123147',
  'tommaso-campeggi': 'Q5601620',
  'girolamo-ragazzoni': 'Q3761215',
  'isabella-sforza': 'Q87583851',
  'mariano-vittori': 'Q30234205',
  'bartolomeo-fumo': 'Q23814856',
  'ercole-ciofano': 'Q21544360',
};

// Book (_id) → QID. REPOINT when it already has an author_id, LINK when it has none.
const BOOKS = {
  '69b6554418b87551bfcd33b7': 'Q1396063', // Pauli principis de la Scala … Miscellanea (1570): joachim → Pavao Skalić
  '6a084dc349638a50931b4a4c': 'Q88178909', // Parisetti, Theopoeia (1550): ludovico- → lodovico-parisetti
  '6a085ba249638a50931cbeec': 'Q88178909', // Parisetti, De divina … beneficentia (1552)
  '6a08508749638a50931b6b61': 'Q51884', // Damascenus, Adversus … imaginum oppugnatores (1554)
  '6a085b7349638a50931cbd1f': 'Q172048', // Terentius a Mureto emendatus (1570)
  '6a085ba849638a50931cc0d7': 'Q510621', // Sannazaro, De partu Virginis (1533)
  '6a097141bf2196cdca905e0c': 'Q2459068', // Eleganze … scielte da Aldo Mannucci (1589): Aldo the Younger
  '6a0970dbbf2196cdca904f44': 'Q18945660', // Matthaei Curtii De prandii ac caenae modo (1562): → matteo-corti
  '6a06cd9cc749b698e5b2c042': 'Q1650958', // Rime amorose … Sauino De Bobali (1589)
  '6a06d5ba9a48d5139996571a': 'Q23814856', // Fumo, Summa Aurea armilla (1554)
  '6a06d7ff9a48d51399967d2c': 'Q61713206', // Audebert, Venetiae (1583)
  '6a0858e249638a50931c6cfa': 'Q2260338', // Capece, De principiis rerum (1546)
  '6a08596c49638a50931c78b0': 'Q21544360', // Ciofano, In Ovidii Metamorphosin (1575)
  '6a0859a349638a50931c82f5': 'Q21544635', // Luisini, In Horatii De arte poetica (1554)
  '6a0970c2bf2196cdca904aba': 'Q82778', // Plinii Naturalis historiae (1559)
  '6a097461f14f992996680c5d': 'Q91389', // Velser, Rerum Augustanarum Vindelicarum (1594)
  '6a0974a8f14f992996682587': 'Q229190', // Catharina da Siena, Epistole et orationi (1548)
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wd(qid) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims|descriptions|labels&languages=en|it&format=json`, { headers: { 'User-Agent': UA } });
    if (r.ok) {
      const e = (await r.json()).entities?.[qid];
      const c = e?.claims || {};
      const yr = (p) => { const t = c[p]?.[0]?.mainsnak?.datavalue?.value?.time; return t ? Number(t.slice(0, 5)) : null; };
      return {
        isHuman: (c.P31 || []).some((x) => x.mainsnak?.datavalue?.value?.id === 'Q5'),
        viaf: c.P214?.[0]?.mainsnak?.datavalue?.value || null,
        birth: yr('P569'), death: yr('P570'),
        label: e?.labels?.en?.value || e?.labels?.it?.value || qid,
        description: e?.descriptions?.en?.value || e?.descriptions?.it?.value || null,
      };
    }
    await sleep(2000);
  }
  throw new Error(`wikidata ${qid} unreachable`);
}
/** null = passes; else the reason it fails. */
function dateGate(f, year) {
  if (!f.isHuman) return 'not a human item';
  if (!year) return null;
  if (f.birth != null && f.birth > 0 && year < f.birth + 5) return `book ${year} predates birth ${f.birth}`;
  if (f.death != null && f.death >= 1450 && year > f.death + 50) return `book ${year} is ${year - f.death}y after death ${f.death}`;
  return null;
}
/** A guarded write that matched nothing means another writer moved the doc under us. */
const assertOne = (r, what) => { if (r.matchedCount !== 1) throw new Error(`${what}: changed since read, stopping`); };
const yearOf = (s) => { const m = String(s || '').match(/\b(1[0-9]{3})\b/); return m ? Number(m[1]) : null; };

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');
const A = db.collection('authors');
const say = (...a) => console.log(...a);
const now = new Date().toISOString();

if (REVERT) {
  const touched = await db.collection('books').find({ 'author_link_provenance.run': RUN }, { projection: { author_link_provenance: 1 } }).toArray();
  for (const b of touched) {
    const p = b.author_link_provenance.filter((x) => x.run === RUN)[0];
    const restore = p.prev_author_id ? { $set: { author_id: p.prev_author_id } } : { $unset: { author_id: '' } };
    if (p.prev_author_entity_id) restore.$set = { ...(restore.$set || {}), author_entity_id: p.prev_author_entity_id };
    say('book', String(b._id), '→', p.prev_author_id ?? '(unlinked)');
    if (APPLY) await db.collection('books').updateOne({ _id: b._id }, { ...restore, $pull: { author_link_provenance: { run: RUN } } });
  }
  for (const d of await A.find({ 'anchor_correction.run': RUN }).toArray()) {
    say('author', d._id, 'unanchor', d.wikidata_id);
    if (APPLY) await A.updateOne({ _id: d._id }, {
      $set: { wikidata_id: d.anchor_correction.prev_wikidata_id, viaf_id: d.anchor_correction.prev_viaf_id },
      $unset: { anchor_correction: '', wikidata_birth_year: '', wikidata_death_year: '', wikidata_description: '' },
    });
  }
  say(APPLY ? 'Reverted.' : 'Dry run — pass --apply with --revert.');
  await client.close();
  process.exit(0);
}

const facts = {};
for (const q of new Set([...Object.values(ANCHOR), ...Object.values(BOOKS)])) { facts[q] = await wd(q); await sleep(150); }

const books = await db.collection('books').find({ _id: { $in: Object.keys(BOOKS).map((i) => new ObjectId(i)) } },
  { projection: { author: 1, author_id: 1, author_entity_id: 1, published: 1, title: 1, author_link_provenance: 1 } }).toArray();
if (books.length !== Object.keys(BOOKS).length) throw new Error(`expected ${Object.keys(BOOKS).length} books, found ${books.length}`);
const yearsByQid = {};
for (const b of books) (yearsByQid[BOOKS[String(b._id)]] ||= []).push(yearOf(b.published));
for (const [slug, q] of Object.entries(ANCHOR)) for (const b of await db.collection('books').find({ author_id: slug }, { projection: { published: 1 } }).toArray()) (yearsByQid[q] ||= []).push(yearOf(b.published));

const refused = [];
const gate = (q) => { for (const y of yearsByQid[q] || [null]) { const why = dateGate(facts[q], y); if (why) return why; } return null; };

// 1. ANCHOR
let anchored = 0;
for (const [slug, q] of Object.entries(ANCHOR)) {
  const d = await A.findOne({ _id: slug });
  const other = await A.findOne({ wikidata_id: q, _id: { $ne: slug } }, { projection: { _id: 1 } });
  const why = !d ? 'doc missing' : d.merged_into ? `tombstone → ${d.merged_into}` : d.wikidata_id && d.wikidata_id !== q ? `already ${d.wikidata_id}` : other ? `QID held by ${other._id}` : gate(q);
  if (why) { refused.push(`ANCHOR ${slug} ${q}: ${why}`); continue; }
  if (d.wikidata_id === q) continue;
  const f = facts[q];
  say(`ANCHOR  ${slug.padEnd(28)} ${q.padEnd(11)} ${f.label} (${f.birth ?? '?'}–${f.death ?? '?'}) viaf=${f.viaf ?? '-'}`);
  anchored++;
  if (APPLY) assertOne(await A.updateOne({ _id: slug, wikidata_id: d.wikidata_id ?? null }, {
    $set: {
      wikidata_id: q, viaf_id: d.viaf_id || f.viaf,
      wikidata_birth_year: f.birth, wikidata_death_year: f.death, wikidata_description: f.description,
      anchor_correction: { run: RUN, prev_wikidata_id: d.wikidata_id ?? null, prev_viaf_id: d.viaf_id ?? null, at: now },
      updated_at: now,
    },
  }), `author ${slug}`);
}

// 2. REPOINT / LINK
let moved = 0;
for (const b of books) {
  const q = BOOKS[String(b._id)];
  // In a dry run step 1 has not written, so fall back to the doc it would anchor.
  const planned = Object.keys(ANCHOR).find((s) => ANCHOR[s] === q);
  const holder = await A.findOne({ wikidata_id: q, merged_into: { $exists: false } }, { projection: { _id: 1, slug: 1, entity_ids: 1 } })
    || (!APPLY && planned ? await A.findOne({ _id: planned }, { projection: { _id: 1, slug: 1, entity_ids: 1 } }) || { _id: planned, slug: planned, entity_ids: [] } : null);
  const why = !holder ? 'no doc holds the QID' : gate(q);
  if (why) { refused.push(`BOOK ${b._id} ${q}: ${why}`); continue; }
  const target = holder.slug || holder._id;
  if (b.author_id === target) continue;
  const set = { author_id: target, updated_at: now };
  const unset = {};
  // An entity link is the old doc's claim about who wrote this; it goes with the old doc.
  if (b.author_entity_id && b.author_id) {
    const oldDoc = await A.findOne({ _id: b.author_id }, { projection: { entity_ids: 1 } });
    if ((oldDoc?.entity_ids || []).includes(b.author_entity_id) || !(holder.entity_ids || []).includes(b.author_entity_id)) {
      if (holder.entity_ids?.[0]) set.author_entity_id = holder.entity_ids[0]; else unset.author_entity_id = '';
    }
  } else if (!b.author_entity_id && holder.entity_ids?.[0]) set.author_entity_id = holder.entity_ids[0];
  say(`${b.author_id ? 'REPOINT' : 'LINK   '} ${String(b._id)} ${(b.author_id || '(none)').padEnd(28)} → ${target}  [${b.author}] ${String(b.title).slice(0, 50)}`);
  moved++;
  if (APPLY) assertOne(await db.collection('books').updateOne({ _id: b._id, author_id: b.author_id ?? null }, {
    $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}),
    $push: { author_link_provenance: {
      run: RUN, method: 'wikidata-qid-hand-adjudicated', matched: q, authors_slug: target, anchored: true, confidence: 'high',
      prev_author_id: b.author_id ?? null, prev_author_entity_id: b.author_entity_id ?? null, at: now,
    } },
  }), `book ${b._id}`);
}

say(`\n${anchored} docs anchored, ${moved} books re-pointed/linked.`);
if (refused.length) say(`REFUSED (${refused.length}):\n  ` + refused.join('\n  '));
say(APPLY ? 'Applied.' : 'Dry run — pass --apply to write. Reversible via --revert --apply.');
await client.close();
