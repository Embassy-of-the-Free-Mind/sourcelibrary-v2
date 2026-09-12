#!/usr/bin/env node
/**
 * #4318 — repair the bare-forename variants and the books they mis-claimed.
 *
 * THE DEFECT. `authors.variants[]` is a MATCH SURFACE: the canonical-link
 * backfill links every book whose author string equals a variant of exactly one
 * doc. A BARE FORENAME variant therefore claims every namesake in the corpus.
 * #4313 repaired one instance (`jan-hus` carrying "Johannes", 115 wrong books).
 * It was not a one-off: 10 docs carried such a variant and 75 books were linked
 * through them. Uniqueness is not validity — each string matched exactly one
 * doc, which is precisely why the backfill trusted it.
 *
 * WHAT THIS DOES, in the order that matters:
 *   1. MINTS the three docs the corpus needs to hold the correct attributions
 *      (Jacobus de Voragine, Denis the Carthusian, Bernardus Parmensis). All
 *      anchored to a verified QID whose P31 is Q5 (human).
 *   2. RELINKS the books whose real author the TITLE names outright, and
 *      UNLINKS the ones no title settles — those re-enter the queue honestly
 *      rather than wearing a confident wrong answer (the #4313 precedent:
 *      relink title-explicit editions, never commentaries or guesses).
 *   3. PULLS the bare variant from each doc, LAST — so the match surface is
 *      only withdrawn once nothing depends on it.
 *
 * Per author-identity.md the repair is to stop MATCHING on these, never to
 * delete history: each doc and its specific variants stay, and `books.author`
 * is left untouched — a byline is how a reader reaches a book, and blanking it
 * would be more truthful and strictly worse.
 *
 * Every judgement below was made against the book's own title (and, where it
 * existed, `ai_metadata.author`), not inferred from the cluster.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-bare-name-variants-4318.mjs          # dry-run
 *   node --env-file=.env.production.local scripts/maintenance/repair-bare-name-variants-4318.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/repair-bare-name-variants-4318.mjs --revert
 */
import { MongoClient, ObjectId } from 'mongodb';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const BACKUP = 'scripts/output/bare-name-variant-repair-4318-backup.json';
const RUN = 'bare-name-variants-4318-2026-08-29';

/** Docs to mint. Each QID verified live: label, description, P31 = Q5 (human). */
const MINT = [
  { _id: 'jacobus-de-voragine', canonical_name: 'Jacobus de Voragine', wikidata_id: 'Q313460',
    variants: ['Jacobus de Voragine', 'Jacobus de Varagine', 'Voragine, Jacobus de'] },
  { _id: 'denis-the-carthusian', canonical_name: 'Denis the Carthusian', wikidata_id: 'Q690346',
    variants: ['Denis the Carthusian', 'Dionysius Carthusianus', 'Dionysius Cartusianus'] },
  { _id: 'bernardus-parmensis', canonical_name: 'Bernardus Parmensis', wikidata_id: 'Q942419',
    variants: ['Bernardus Parmensis', 'Bernard of Botone', 'Bernardus de Botone'] },
];

/**
 * Books whose title names their real author. `to: null` means unlink only —
 * the title does not settle it, so no claim is better than a wrong one.
 */
const RELINK = [
  // "Thomas" — Aquinas' doc had absorbed Thomas à Kempis' devotional works.
  { id: '69b631ea1c1c21a37380b8fd', from: 'thomas-aquinas', to: 'thomas-a-kempis', why: 'De Imitatione Christi is à Kempis' },
  { id: '69b6784cb3f4fc04415cb4c5', from: 'thomas-aquinas', to: 'thomas-a-kempis', why: 'De Imitando Christo is à Kempis' },
  { id: '69b6349e1c1c21a37382271e', from: 'thomas-aquinas', to: 'thomas-a-kempis', why: 'Hortulus rosarum is à Kempis' },
  { id: '69b648ce18b87551bfc583c0', from: 'thomas-aquinas', to: 'thomas-a-kempis', why: 'Hortulus rosarum is à Kempis' },
  { id: '69b632db1c1c21a37381407a', from: 'thomas-aquinas', to: null, why: 'Meditationes de vita Iesu Christi is pseudo-Bonaventure, not Aquinas' },
  { id: '69b638251c1c21a3738353c0', from: 'thomas-aquinas', to: null, why: 'liturgical office, no author established' },

  // "Jacobus" — a 17th-c Leiden theologian holding 1474-1521 incunabula.
  { id: '69b633361c1c21a373816dcf', from: 'jacobus-du-bois', to: 'jacobus-de-voragine', why: 'Legenda aurea' },
  { id: '69b6477e18b87551bfc4cc60', from: 'jacobus-du-bois', to: 'jacobus-de-voragine', why: 'Legenda aurea sive Lombardica historia' },
  { id: '69b646ef18b87551bfc4846f', from: 'jacobus-du-bois', to: 'jacobus-de-voragine', why: 'Lombardica historia' },
  { id: '69b6463018b87551bfc41535', from: 'jacobus-du-bois', to: 'jacobus-de-voragine', why: 'Sermones dominicales' },
  { id: '69b646e018b87551bfc47e3f', from: 'jacobus-du-bois', to: 'jacobus-de-voragine', why: 'Sermones de sanctis' },
  { id: '69b630f71c1c21a373804e23', from: 'jacobus-du-bois', to: 'jacobus-de-clusa', why: 'De veritate dicenda aut tacenda' },
  { id: '69b6314a1c1c21a3738063bc', from: 'jacobus-du-bois', to: 'jacobus-de-clusa', why: 'De apparitionibus animarum' },
  { id: '69b6311a1c1c21a3738052ca', from: 'jacobus-du-bois', to: 'jacobus-de-clusa', why: 'Tractatus de apparitionibus animarum' },
  { id: '69b64b4c18b87551bfc6cbef', from: 'jacobus-du-bois', to: 'jacobus-de-clusa', why: 'title names "Iacobi de paradiso" — de Clusa' },
  { id: '69b635171c1c21a3738260ba', from: 'jacobus-du-bois', to: null, why: 'Lavacrum conscientie — Jacobus de Gruytrode, no doc' },
  { id: '69b6480918b87551bfc5174b', from: 'jacobus-du-bois', to: null, why: 'Aureum speculum animae peccatricis — de Gruytrode, no doc' },
  { id: '69b632261c1c21a37380dd7e', from: 'jacobus-du-bois', to: null, why: 'Sermones de tempore et de sanctis — which Jacobus is unsettled' },
  { id: '69b6491918b87551bfc5a90d', from: 'jacobus-du-bois', to: null, why: 'title names "Magistri Jacobi de lenda" — a third Jacobus, no doc' },

  // "Dionysius" — Denis the Carthusian and Dionysius Periegetes under the Areopagite.
  { id: '69b6317e1c1c21a373808160', from: 'pseudo-dionysius-the-areopagite', to: 'denis-the-carthusian', why: 'Speculum amatorum mundi' },
  { id: '6a26bb1017b820d9cae8d120', from: 'pseudo-dionysius-the-areopagite', to: 'denis-the-carthusian', why: 'title reads "D. Dionysii Carthvsiani" — his commentary ON the Areopagite' },
  { id: '69b63b941c1c21a37384d780', from: 'pseudo-dionysius-the-areopagite', to: 'denis-the-carthusian', why: 'D. Dionysii Carthvsiani Opervm Minorum' },
  { id: '69b63c421c1c21a373851ad6', from: 'pseudo-dionysius-the-areopagite', to: 'denis-the-carthusian', why: 'D. Dionysii Carthvsiani In Psalmos' },
  { id: '69b63e791c1c21a373864bcf', from: 'pseudo-dionysius-the-areopagite', to: 'denis-the-carthusian', why: 'D. Dionysii Carthvsani Opervm Minorvm t.3' },
  { id: '69b6771cb3f4fc04415c6230', from: 'pseudo-dionysius-the-areopagite', to: 'denis-the-carthusian', why: 'D. Dionysii Carthusiani Inflammatorivm Divini Amoris' },
  { id: '6a26baf661b3857ed05b129b', from: 'pseudo-dionysius-the-areopagite', to: 'dionysius-periegetes', why: 'Orbis descriptio (with Aratus, Proclus)' },
  { id: '6a26bb604045b346e6ad0c6b', from: 'pseudo-dionysius-the-areopagite', to: 'dionysius-periegetes', why: 'Orbis descriptio' },
  { id: '69b639261c1c21a37383c9d8', from: 'pseudo-dionysius-the-areopagite', to: 'dionysius-periegetes', why: 'Orbis descriptio' },
  { id: '69b638de1c1c21a37383afc8', from: 'pseudo-dionysius-the-areopagite', to: 'dionysius-periegetes', why: 'Orbis descriptio' },

  // "Bernardus" — the alchemist Bernard of Treviso and the canonist, under Clairvaux.
  { id: '69db8266f4c595498deb9361', from: 'bernard-of-clairvaux', to: 'count-trevisan', why: 'Von der hermetischen Philosophia — Trevisanus' },
  { id: '69db8266f4c595498deb9422', from: 'bernard-of-clairvaux', to: 'count-trevisan', why: 'Graf von der Marck und Tervis, chymische Schrifften' },
  { id: '6a26bed70e247ebad6de9110', from: 'bernard-of-clairvaux', to: 'count-trevisan', why: 'Trevisanus De chymico miraculo' },
  { id: '6a26bef60e247ebad6de9e94', from: 'bernard-of-clairvaux', to: 'count-trevisan', why: 'Von der Hermetischen Philosophia' },
  { id: '6a26c36faad44c98627c9e64', from: 'bernard-of-clairvaux', to: 'count-trevisan', why: 'Bernhardus innovatus — Philosophus Chemicus' },
  { id: '6a26ca4f5ac5aecc53ce5cea', from: 'bernard-of-clairvaux', to: 'count-trevisan', why: 'Graf von der Marck und Tervis, chymische Schrifften' },
  { id: '69b631791c1c21a373807cfa', from: 'bernard-of-clairvaux', to: 'bernardus-parmensis', why: 'Casus longi super decretales; ai_metadata.author reads "Bernardus Parmensis"' },
  { id: '69b646db18b87551bfc479b1', from: 'bernard-of-clairvaux', to: 'bernardus-parmensis', why: 'Casus longi super quinque libros decretalium' },
  { id: '69db8266f4c595498deb93ca', from: 'bernard-of-clairvaux', to: null, why: 'Divers traitez de la philosophie naturelle — a multi-author collection' },

  // "Irenaeus" — Grotius' pen name "Irenaeus Philalethes" pulled in the Church Father.
  { id: '69c7e5c5fb10016c3f389ba4', from: 'hugo-grotius', to: 'irenaeus-of-lyon', why: 'Adversus haereses is Irenaeus of Lyon' },
  { id: '69c83ed06c6f3cc53c85029f', from: 'hugo-grotius', to: 'irenaeus-of-lyon', why: 'Contra haereses is Irenaeus of Lyon' },

  // "Basilius" — Basil Valentine's alchemical corpus under Basil the Great.
  { id: '69db8266f4c595498deb93f8', from: 'basil-of-caesarea-2', to: 'basil-valentine', why: 'Fratris Basilii Valentini chymische Schriften' },
  { id: '69db8266f4c595498deb941b', from: 'basil-of-caesarea-2', to: 'basil-valentine', why: 'Fr. Basilii Valentini Chymische Schriften' },
  { id: '6a26c58caad44c98627d83fa', from: 'basil-of-caesarea-2', to: 'basil-valentine', why: 'Fr. Basilii Valentini Benedictiner Ordens Chymische Schriften' },
  { id: '6a26d7276be3d771538b9fee', from: 'basil-of-caesarea-2', to: 'basil-valentine', why: 'Fr. Basilii Valentini Chymische Schriften' },
];

/** The match surface to withdraw, once nothing depends on it. */
const PULL_VARIANTS = [
  { doc: 'thomas-aquinas', variant: 'Thomas' },
  { doc: 'r-h-charles', variant: 'Charles' },
  { doc: 'bernard-of-clairvaux', variant: 'Bernard' },
  { doc: 'bernard-of-clairvaux', variant: 'Bernardus' },
  { doc: 'mahomet', variant: 'Muhammad' },
  { doc: 'hermes-trismegistus', variant: 'Hermes' },
  { doc: 'jacobus-du-bois', variant: 'Jacobus' },
  { doc: 'pseudo-dionysius-the-areopagite', variant: 'Dionysius' },
  { doc: 'hugo-grotius', variant: 'Irenaeus' },
  { doc: 'basil-of-caesarea-2', variant: 'Basilius' },
  // Named by a bare forename rather than merely carrying one (2026-08-09 mint).
  { doc: 'arnoldus', variant: 'Arnoldus' },
];

const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');
const authors = db.collection('authors');

if (REVERT) {
  if (!existsSync(BACKUP)) { console.error(`No backup at ${BACKUP}.`); process.exit(1); }
  const saved = JSON.parse(readFileSync(BACKUP, 'utf8'));
  let restored = 0;
  for (const b of saved.books) {
    const set = b.before_author_id ? { $set: { author_id: b.before_author_id } } : { $unset: { author_id: '' } };
    const r = await books.updateOne({ _id: new ObjectId(b.id) }, { ...set, $pull: { author_link_provenance: { run: RUN } } });
    restored += r.modifiedCount;
  }
  let readded = 0;
  for (const p of saved.pulled) {
    const r = await authors.updateOne({ _id: p.doc }, { $addToSet: { variants: p.variant, ...(p.variant_slug ? { variant_slugs: p.variant_slug } : {}) } });
    readded += r.modifiedCount;
  }
  const del = await authors.deleteMany({ _id: { $in: saved.minted }, source: RUN });
  console.log(`Reverted: ${restored} books restored, ${readded} variants re-added, ${del.deletedCount} minted docs deleted.`);
  await mc.close();
  process.exit(0);
}

// ── plan ─────────────────────────────────────────────────────────────────────
const existing = new Set((await authors.find({}, { projection: { _id: 1 } }).toArray()).map(d => d._id));
const toMint = MINT.filter(m => !existing.has(m._id));
console.log(`Mint: ${toMint.length}/${MINT.length} new docs (${MINT.length - toMint.length} already present)`);
for (const m of toMint) console.log(`   ${m._id.padEnd(24)} ${m.wikidata_id}  "${m.canonical_name}"`);

const plan = [];
for (const r of RELINK) {
  const b = await books.findOne({ _id: new ObjectId(r.id) }, { projection: { title: 1, author: 1, author_id: 1 } });
  if (!b) { plan.push({ ...r, status: 'BOOK NOT FOUND' }); continue; }
  if (b.author_id !== r.from) { plan.push({ ...r, status: `author_id is "${b.author_id}", expected "${r.from}" — SKIPPED`, title: b.title }); continue; }
  plan.push({ ...r, status: 'ok', title: b.title, before_author_id: b.author_id });
}
const actionable = plan.filter(p => p.status === 'ok');
const stale = plan.filter(p => p.status !== 'ok');

console.log(`\nBooks: ${actionable.length} actionable (${actionable.filter(p => p.to).length} relink, ${actionable.filter(p => !p.to).length} unlink-only), ${stale.length} skipped`);
for (const p of actionable) console.log(`   ${p.from.padEnd(32)} -> ${String(p.to || '(none)').padEnd(24)} ${(p.title || '').slice(0, 46).padEnd(48)} ${p.why}`);
if (stale.length) { console.log('\nSkipped (state moved since adjudication):'); for (const p of stale) console.log(`   ${p.id} — ${p.status}`); }

console.log('\nVariants to pull:');
const pulls = [];
for (const p of PULL_VARIANTS) {
  const d = await authors.findOne({ _id: p.doc }, { projection: { variants: 1, canonical_name: 1 } });
  if (!d) { console.log(`   ${p.doc} — DOC NOT FOUND`); continue; }
  if (!(d.variants || []).includes(p.variant)) { console.log(`   ${p.doc.padEnd(32)} "${p.variant}" already absent`); continue; }
  // A doc must never be left with no match surface at all.
  const remaining = (d.variants || []).filter(v => v !== p.variant);
  if (!remaining.length) { console.log(`   ${p.doc.padEnd(32)} "${p.variant}" is its ONLY variant — left in place, needs a specific form first`); continue; }
  pulls.push({ ...p, variant_slug: slugify(p.variant), remaining: remaining.length });
  console.log(`   ${p.doc.padEnd(32)} -= "${p.variant}"  (${remaining.length} specific variants remain)`);
}

if (!APPLY) { console.log('\nDRY-RUN. Re-run with --apply to write.'); await mc.close(); process.exit(0); }

// ── apply ────────────────────────────────────────────────────────────────────
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({
  run: RUN, issue: 4318, created_at: new Date().toISOString(),
  minted: toMint.map(m => m._id),
  books: actionable.map(p => ({ id: p.id, before_author_id: p.before_author_id, to: p.to, why: p.why })),
  pulled: pulls,
}, null, 2));

let minted = 0;
for (const m of toMint) {
  await authors.insertOne({
    ...m, slug: m._id,
    variant_slugs: [...new Set(m.variants.map(slugify).filter(Boolean))],
    viaf_id: null, entity_ids: [], book_count: null,
    source: RUN, built_at: new Date(),
  });
  minted++;
}

let relinked = 0, unlinked = 0;
for (const p of actionable) {
  const prov = { run: RUN, method: 'title-explicit-reattribution', from: p.from, to: p.to, basis: p.why, confidence: p.to ? 'high' : 'n/a', at: new Date() };
  const op = p.to
    ? { $set: { author_id: p.to }, $push: { author_link_provenance: prov } }
    : { $unset: { author_id: '' }, $push: { author_link_provenance: prov } };
  const r = await books.updateOne({ _id: new ObjectId(p.id), author_id: p.from }, op);
  if (r.modifiedCount) { if (p.to) relinked++; else unlinked++; }
}

let pulled = 0;
for (const p of pulls) {
  const r = await authors.updateOne({ _id: p.doc }, { $pull: { variants: p.variant, variant_slugs: p.variant_slug } });
  pulled += r.modifiedCount;
}

console.log(`\nAPPLIED: minted ${minted}, relinked ${relinked}, unlinked ${unlinked}, pulled ${pulled} bare variants.`);
console.log(`Backup: ${BACKUP} (revert with --revert)`);
await mc.close();
