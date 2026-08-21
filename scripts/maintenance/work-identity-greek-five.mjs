#!/usr/bin/env node
/**
 * Work identity for Epicurus, Longinus, Sappho, Sextus Empiricus and Polybius —
 * author thesaurus repair + work_id clustering, for the 40 editions imported by
 * scripts/import/greek-five-authors-batch.mjs AND the pre-existing holdings for
 * the same five authors.
 *
 * ─── Why this is hand-adjudicated and not a resolver run ─────────────────────
 * `resolve-work-ids-wikidata.mjs` is author-anchored: it needs `books.author_id`
 * and matches titles against that author's Wikidata P50 works. It could not run
 * here, for two independent reasons:
 *
 *   1. None of the 40 new books had an `author_id` (IA imports never set one),
 *      and the thesaurus itself was wrong or absent for four of the five —
 *      see the AUTHORS table below.
 *   2. Even with authors fixed, the candidate shape defeats it for two authors.
 *      Wikidata holds 208 works under Sappho, almost all single fragments
 *      ("Sappho fr. 174 Voigt"); every book we hold is a *collection* of the
 *      fragments, so containment matching would snap editions onto arbitrary
 *      individual fragments. Metrodorus has 0 English-labelled works and
 *      Anacreon none that correspond to anything we hold.
 *
 * So the QIDs below were resolved by hand and each one verified against
 * Wikidata: correct author (P50) and work-level rather than edition-level
 * (P31 = literary work, NOT Q3331189 "version, edition or translation" — that
 * test is what separates Q250816, the Histories, from Q16038921 and Q53748127,
 * which are *editions* of it and would have made a wrong cluster).
 *
 * ─── Casebook rules applied (.claude/docs/work-identity-casebook.md) ─────────
 *   #5 Volume of a multi-volume work → cluster the volumes under ONE work_id.
 *      Shuckburgh vols 1-2 and Sheeres/Dryden vols 1-2 all become Q250816.
 *   #4 Container / Sammelband → gets its own single work_id, never the
 *      constituent work's, and is never badged. Sextus's collected *Opera*
 *      contains BOTH the Hypotyposes and Adversus Mathematicos, so filing it
 *      under either would be wrong; likewise the Sappho+Anacreon anthologies.
 *   Extracts of one work (Polybius VI on the constitution, the De militia
 *      excerpts, the Excerpta Vaticana) are slices of the Histories → Q250816.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/work-identity-greek-five.mjs --dry-run
 *   node scripts/maintenance/work-identity-greek-five.mjs --apply
 */

import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

// ── Author thesaurus ────────────────────────────────────────────────────────
// `fix` entries correct a wrong wikidata_id already in production; `create`
// entries add a missing author. Every QID verified as P31=Q5 (human).
const AUTHORS = [
  { _id: 'epicurus', canonical_name: 'Epicurus', wikidata_id: 'Q43216', op: 'create',
    variants: ['Epicurus', 'Epicuro', 'Epicurus (tr. Walter Charleton)', 'Epicurus (tr. John Digby)', 'Epicurus (ed. Carlo Rosini)', 'Epicurus (trans. Cyril Bailey)', 'Epicurus; Hermann Usener'],
    note: 'Absent entirely — no Epicurus in a 4,825-author thesaurus.' },

  { _id: 'sextus', canonical_name: 'Sextus Empiricus', wikidata_id: 'Q236594', op: 'fix',
    was: 'Q1270100',
    variants: ['Sextus Empiricus', 'Sextus Empiricus (tr. Henricus Stephanus)', 'Sextus Empiricus (tr. Gentian Hervet)', 'Sextus Empiricus (ed. Immanuel Bekker)', 'Sextus Empiricus (ed. Hermann Mutschmann)', 'Sextus Empiricus (tr. Claude Huart)'],
    note: 'WRONG IN PRODUCTION: Q1270100 is the *Sentences of Sextus*, a 2nd-c collection of maxims (P31 = text, not human), not Sextus Empiricus the philosopher. Affected 4 visible books.' },

  { _id: 'longinus', canonical_name: 'Longinus (Pseudo-Longinus)', wikidata_id: 'Q744540', op: 'fix',
    was: 'Q436634',
    variants: ['Longinus', 'Pseudo-Longinus', 'Longin', 'Dionysius Longinus', 'Longinus (tr. Leonard Welsted)', 'Longinus (tr. William Smith)', 'Longinus (tr. Nicolas Boileau-Despreaux)', 'Longinus (tr. Anton Francesco Gori)', 'Longinus (ed. Benjamin Weiske)', 'Longinus (ed. W. Rhys Roberts)'],
    note: 'Q436634 is Cassius Longinus, the 3rd-c Neoplatonist to whom On the Sublime was traditionally but wrongly ascribed. The treatise author is Pseudo-Longinus (Q744540), which is what all our books are. Wikidata itself carries both on the work (P50 = Q744540, Q436634), so this is a genuine scholarly conflation, not a typo.' },

  { _id: 'sappho', canonical_name: 'Sappho', wikidata_id: 'Q17892', op: 'create',
    variants: ['Sappho', 'Saffo', 'Sappho (ed. H.T. Wharton)', 'Sappho (ed. Henry Thornton Wharton)', 'Sappho (trans. C.R. Haines)', 'Sappho (ed. Christian Friedrich Neue)', 'Sappho (ed. Johann Christian Wolf)', 'Sappho (ed. Heinrich Friedrich Magnus Volger)'],
    note: 'The only Sappho-ish entry was `sappho-ed-henry-thornton-wharton` — the editor-as-author import trap. That doc is marked merged_into this one and its books relinked.' },

  { _id: 'metrodorus-of-lampsacus', canonical_name: 'Metrodorus of Lampsacus', wikidata_id: 'Q780259', op: 'create',
    variants: ['Metrodorus of Lampsacus', 'Metrodorus of Lampsacus (ed. Alfred Koerte)'],
    note: 'The Epicurean (Q780259), NOT the Anaxagorean of the same name and city (Q539514).' },

  { _id: 'anacreon', canonical_name: 'Anacreon', wikidata_id: 'Q213484', op: 'create',
    variants: ['Anacreon', 'Anacreon; Sappho', 'Anacreon; Sappho; Erinna', 'Anacreon; Sappho; Alcaeus', 'Anacreon; Sappho; Bion; Moschus (tr. Francis Fawkes)'],
    note: 'Q213484. (Wikidata search for "Anacreon" returns the film Good Will Hunting above the poet — hence verifying every QID rather than accepting a search hit.)' },
];

// Old author doc superseded by a clean one; books relinked, doc tombstoned.
const AUTHOR_MERGES = [{ from: 'sappho-ed-henry-thornton-wharton', to: 'sappho' }];

// ── Work clusters ───────────────────────────────────────────────────────────
// work_id, work_title, and the books that belong to it. `container: true` marks
// a Sammelband: it gets its own id and must never carry a first-translation
// badge (casebook #4).
const WORKS = [
  { work_id: 'Q6245111', work_title: 'On the Sublime (Peri Hypsous)', author_id: 'longinus', books: [
    ['69b6802170c69d645a717dd4', 'e-rara Greek-Latin Peri hypsous'],
    ['69ef3d3272c1376fdf2afdec', '1636 Greek — Liber de Grandi Loquentia (VISIBLE)'],
    ['6a06f5294dcc6d5d8f03757a', '1555 Aldine, Manuzio — Peri ypsous logou (VISIBLE)'],
    ['6a76d4d66ba8d6d1d3f8e71d', '1698 An Essay upon Sublime — earliest English'],
    ['6a76d4de6ba8d6d1d3f8e791', '1712 Welsted'],
    ['6a76d4e76ba8d6d1d3f8e86c', '1733 Boileau, French'],
    ['6a76d4ed6ba8d6d1d3f8e9e5', '1737 Gori, Italian'],
    ['6a76d4f56ba8d6d1d3f8ea66', '1752 William Smith'],
    ['6a76d4fe6ba8d6d1d3f8eb54', '1810 Greek + English'],
    ['6a76d5066ba8d6d1d3f8ec82', '1838 Weiske Greek text'],
    ['6a76d50e6ba8d6d1d3f8ed41', '1907 Rhys Roberts, after Parisinus 2036'],
  ]},

  { work_id: 'Q250816', work_title: 'The Histories', author_id: 'polybius', books: [
    ['6993838250654cbbe2916e4c', '10th-c Vatican MS — ALREADY Q250816, the anchor'],
    ['699389e574305116d72d2c9f', '1420 MS, Historiae I-V'],
    ['6a08500b15c643eb1af463b6', '1521 Historiarum libri quinque'],
    ['6a4a3457b49cf960c37def8c', 'Sheeres/Dryden English Vol. 1  [casebook #5 volume]'],
    ['6a4a3472b49cf960c37df1aa', 'Sheeres/Dryden English Vol. 2  [casebook #5 volume]'],
    ['69aec5283b6ebce5e0ee8d8c', 'Shuckburgh Vol. 2             [casebook #5 volume]'],
    ['6a76d60d14c23e08b16a4090', 'Shuckburgh Vol. 1 (new)       [casebook #5 volume]'],
    ['6a76d59ff28570a9bf4e8a6a', '1539 Book VI on the constitution, printed alone [extract]'],
    ['69b66ba5b3f4fc0441581c08', 'Book VI de militia Romana fragment [extract]'],
    ['6a45dbf498e9f852e61cc15e', 'De militia Romanorum et castrorum metatione [extract]'],
    ['6a76d5aff28570a9bf4e8ab5', '1609 Casaubon, Greek + Latin'],
    ['6a76d5bbf28570a9bf4e9085', '1763 Ernesti'],
    ['6a76d5c5f28570a9bf4e942e', '1772 Hampton, English'],
    ['6a76d5cff28570a9bf4e968b', '1789 Schweighauser'],
    ['6a76d5d7f28570a9bf4e999a', '1829 Excerpta Vaticana [extract]'],
    ['6a76d5e7f28570a9bf4e9a5f', '1839 Dindorf, Historiarum reliquiae'],
    ['6a76d5fb14c23e08b16a3b8e', '1888 Strachan-Davidson, Selections [extract]'],
    ['6a76d5f0f28570a9bf4e9e6b', '1888 Achaean League narrative [extract]'],
    ['6a76d60314c23e08b16a3e6d', '1889 Buettner-Wobst Teubner Vol. 2 [casebook #5 volume]'],
  ]},

  // `promote_from`: local work_ids verified to denote THIS work, which may be
  // overwritten even though their source is not `local-mint`. The default guard
  // refuses to touch a curated (e.g. work-merge:llm-verified) id — right in
  // general, but here it would leave the Outlines cluster split between the
  // local id and the QID that means exactly the same thing. Promoting a local
  // id to a verified Wikidata QID is strictly an improvement; listing it
  // explicitly keeps that a per-cluster decision rather than a blanket override.
  { work_id: 'Q3058641', work_title: 'Outlines of Pyrrhonism (Pyrrhoniae Hypotyposes)', author_id: 'sextus',
    promote_from: ['local:a:sextus:pyrrhoniae-hypotyposes'], books: [
    ['69e8b23d2ff2a8dc09e77073', '15th-c Greek manuscript (VISIBLE)'],
    ['69a957a865ddd05bbcd3ee7c', '1562 Stephanus (VISIBLE)'],
    ['69ad73535953f4eff4f33fb8', '1899 Patrick, English (VISIBLE)'],
    ['6a76d583f28570a9bf4e83a6', '1725 Huart, first French'],
  ]},

  { work_id: 'Q20379739', work_title: 'Against the Mathematicians (Adversus Mathematicos)', author_id: 'sextus', books: [
    ['6a76d571f28570a9bf4e7e23', '1569 Hervet, Latin'],
    ['6a76d597f28570a9bf4e889b', '1914 Mutschmann, Adversus Dogmaticos = Adv. Math. VII-XI'],
  ]},

  { work_id: 'local:a:sextus:opera', work_title: 'Sextus Empiricus, Opera (collected works)', author_id: 'sextus', container: true, books: [
    ['69a956fa65ddd05bbcd3d7c8', '1718 Fabricius, Opera Graece et Latine (VISIBLE)'],
    ['6a76d57bf28570a9bf4e80a8', '1621 Opera quae extant, first complete Greek'],
    ['6a76d58ef28570a9bf4e855c', '1842 Bekker, Opera'],
    ['6a307f2f675ed2bdbe36d6ef', 'Mutschmann Teubner Opera vols 1-2'],
  ]},

  { work_id: 'Q7091086', work_title: 'On Nature (Peri Physeos)', author_id: 'epicurus', books: [
    ['6a76d4c66ba8d6d1d3f8e65a', '1818 Rosini — books II and XI from the Herculaneum papyri'],
  ]},

  { work_id: 'Q740527', work_title: 'Epicurea', author_id: 'epicurus', books: [
    ['69aea2f1803d5b811fc12386', 'Usener, Epicurea'],
  ]},

  { work_id: 'local:a:epicurus:morals', work_title: "Epicurus's Morals (the ethical remains)", author_id: 'epicurus', books: [
    ['6a76d4a3b13a2814115465a7', '1656 Charleton — first English'],
    ['6a76d4b6e4fbf6807f19662b', '1712 Digby'],
  ]},

  { work_id: 'local:a:epicurus:extant-remains', work_title: 'Epicurus: The Extant Remains', author_id: 'epicurus', container: true, books: [
    ['69ae903f14cd71fa8cd87214', 'Bailey 1926 — letters + doctrines + fragments together'],
  ]},

  { work_id: 'local:a:metrodorus-of-lampsacus:fragmenta', work_title: 'Metrodori Epicurei Fragmenta', author_id: 'metrodorus-of-lampsacus', books: [
    ['6a76d4cd6ba8d6d1d3f8e6ca', '1890 Koerte'],
  ]},

  // Sappho: hand-minted, NOT a Wikidata QID. Wikidata models Sappho at the level
  // of ~200 individual numbered fragments; every edition we hold is the corpus.
  { work_id: 'local:a:sappho:fragmenta', work_title: 'Sappho, fragments', author_id: 'sappho', books: [
    ['69ae904a14cd71fa8cd874bc', 'Haines, Poems and Fragments'],
    ['6a76d51e6ba8d6d1d3f8eef0', '1733 Wolf'],
    ['6a76d53af28570a9bf4e7a22', '1810 Volger'],
    ['6a76d54ff28570a9bf4e7bdc', '1827 Neue'],
    ['6a76d558f28570a9bf4e7c6e', '1863 Vita e Frammenti di Saffo'],
    ['69ae904414cd71fa8cd873c6', '1887 Wharton (VISIBLE)'],
    ['6a08ac390e77acb4f9309c88', '1895 Wharton (VISIBLE)'],
    ['6a08ac5e0e77acb4f9309d99', '1920 Wharton (VISIBLE)'],
  ]},

  // Multi-poet anthologies. Sappho is a constituent, not the work — filing these
  // under `sappho:fragmenta` would claim an edition of Sappho that they are not.
  { work_id: 'local:c:greek-lyric:anacreon-sappho-anthology', work_title: 'Anacreon and Sappho (anthology)', author_id: 'anacreon', container: true, books: [
    ['6a76d5156ba8d6d1d3f8ee80', '1713 Works of Anacreon and Sappho'],
    ['6a76d52af28570a9bf4e785d', '1760 Fawkes — Anacreon, Sappho, Bion, Moschus, Musaeus'],
    ['6a76d532f28570a9bf4e79ba', '1770 Anacreon / Sappho / Alcaeus, Greek'],
    ['6a76d541f28570a9bf4e7b35', '1826 Anacreontea + Sappho + Erinna'],
  ]},

  // Gassendi's own Latin composition — not a rendering of a Greek work, so it
  // joins his cluster, not Epicurus's. Title page (preview OCR p1): "PHILOSOPHIÆ
  // EPICURI SYNTAGMA, CONTINENS Canonicam, Physicam, ET Ethicam. Authore V. Cl.
  // PETRO GASSENDI".
  { work_id: 'local:a:pierre-gassendi:philosophiae-epicuri-syntagma', work_title: 'Philosophiae Epicuri Syntagma', author_id: 'pierre-gassendi', books: [
    ['6a76d4ade4fbf6807f1964dd', '1668 — Gassendi on the Canonic, Physics and Ethics of Epicurus'],
  ]},

  // The Herculaneum series is deliberately minted PER VOLUME (23 books, one id
  // each: `…:tomus-N` / `…:collectio-altera-YYYY`, from the 2026-06-26 hand-mint
  // backfill). That is an existing curated convention, so this volume joins it
  // rather than the series being collapsed under casebook #5. IA's title was the
  // generic series name; the title page (preview OCR p7) reads "HERCULANENSIUM
  // VOLUMINUM QUAE SUPERSUNT — TOMUS II", which is what identifies it.
  { work_id: 'local:n:herculanensium-voluminum-quae-supersunt:tomus-ii', work_title: 'Herculanensium Voluminum quae Supersunt, Tomus II', author_id: 'accademia-ercolanese',
    retitle: 'Herculanensium Voluminum quae Supersunt, Tomus II', books: [
    ['6a76d4be6ba8d6d1d3f8e511', '1793 GRI copy — joins the 1809 printing of the same volume'],
  ]},

  { work_id: 'local:c:greek-lyric:melic-corpus', work_title: 'The Greek melic poets (collected fragments)', author_id: 'sappho', container: true, books: [
    ['6a76d569f28570a9bf4e7d48', '1918 Petersen, Lyric Songs of the Greeks'],
    ['6a08aa0a0e77acb4f93080bd', 'Loeb 142, Greek Lyric I: Sappho and Alcaeus'],
    ['69e7479285f786e884a48dfb', 'Lobel & Page, Poetarum Lesbiorum Fragmenta'],
    ['6a76d55ff28570a9bf4e7ce5', '1917 Diehl, Supplementum Lyricum'],
  ]},
];

// ── Run ─────────────────────────────────────────────────────────────────────
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const books = db.collection('books');
const authors = db.collection('authors');

const backup = { at: new Date().toISOString(), authors: [], books: [] };
let aChanged = 0, bChanged = 0, bSkipped = 0;

console.log('══ AUTHORS ═══════════════════════════════════════════════════════');
for (const a of AUTHORS) {
  const existing = await authors.findOne({ _id: a._id });
  if (existing) backup.authors.push(existing);
  const label = a.op === 'fix' ? `FIX  ${a.was} → ${a.wikidata_id}` : `CREATE ${a.wikidata_id}`;
  if (a.op === 'fix' && !existing) { console.log(`  ! ${a._id}: expected an existing doc to fix, found none — SKIPPED`); continue; }
  if (a.op === 'fix' && existing.wikidata_id !== a.was) {
    console.log(`  ! ${a._id}: expected wikidata_id=${a.was}, found ${existing.wikidata_id} — SKIPPED (someone else changed it)`);
    continue;
  }
  console.log(`  ${APPLY ? '✓' : '·'} ${a._id.padEnd(26)} ${label}`);
  console.log(`      ${a.note}`);
  if (APPLY) {
    await authors.updateOne({ _id: a._id }, {
      $set: {
        canonical_name: a.canonical_name,
        slug: a._id,
        wikidata_id: a.wikidata_id,
        variants: a.variants,
        variant_slugs: a.variants.map(v => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
        source: 'hand-adjudicated-2026-08-08',
        anchor_correction: a.op === 'fix' ? { was: a.was, reason: a.note } : undefined,
      },
      $setOnInsert: { book_count: 0, viaf_id: null, entity_ids: [], built_at: new Date().toISOString() },
    }, { upsert: true });
  }
  aChanged++;
}

for (const m of AUTHOR_MERGES) {
  const from = await authors.findOne({ _id: m.from });
  if (!from) { console.log(`  = merge ${m.from}: not present, nothing to do`); continue; }
  backup.authors.push(from);
  const n = await books.countDocuments({ author_id: m.from });
  console.log(`  ${APPLY ? '✓' : '·'} MERGE ${m.from} → ${m.to}  (${n} books relinked)`);
  if (APPLY) {
    await books.updateMany({ author_id: m.from }, { $set: { author_id: m.to } });
    await authors.updateOne({ _id: m.from }, { $set: { merged_into: m.to, merge_run: 'greek-five-2026-08-08' } });
  }
}

console.log('\n══ WORKS ═════════════════════════════════════════════════════════');
for (const w of WORKS) {
  console.log(`\n▸ ${w.work_id}  —  ${w.work_title}${w.container ? '   [CONTAINER — never badge]' : ''}`);
  for (const [id, why] of w.books) {
    const b = await books.findOne({ id }, { projection: { id: 1, title: 1, work_id: 1, work_id_source: 1, author_id: 1, work_title: 1 } });
    if (!b) { console.log(`    MISSING ${id} — ${why}`); bSkipped++; continue; }
    backup.books.push({ id: b.id, work_id: b.work_id ?? null, work_title: b.work_title ?? null, work_id_source: b.work_id_source ?? null, author_id: b.author_id ?? null });

    // Never silently overwrite a non-local-mint work_id someone curated, unless
    // this cluster explicitly names it as a verified-equivalent id to promote.
    const promotable = (w.promote_from || []).includes(b.work_id);
    const heldSource = b.work_id_source && !/^local-mint$/.test(b.work_id_source);
    if (b.work_id && b.work_id !== w.work_id && heldSource && !promotable) {
      console.log(`    ! HELD  ${id} has ${b.work_id} (${b.work_id_source}) — not overwriting. ${why}`);
      bSkipped++; continue;
    }
    const from = b.work_id ?? '(none)';
    if (b.work_id === w.work_id && b.author_id === w.author_id) { console.log(`    = ${id} already correct — ${why}`); bSkipped++; continue; }
    console.log(`    ${APPLY ? '✓' : '·'} ${id}  ${String(from).slice(0, 46).padEnd(46)} → ${w.work_id}   ${why}`);
    if (APPLY) {
      const r = await books.updateOne({ id }, { $set: {
        work_id: w.work_id,
        work_title: w.work_title,
        work_id_source: /^Q\d+$/.test(w.work_id) ? 'work-merge:hand-adjudicated' : 'hand-mint',
        work_id_confidence: 'high',
        author_id: w.author_id,
        ...(w.container ? { is_container: true } : {}),
        ...(w.retitle ? { title: w.retitle } : {}),
      }});
      if (r.modifiedCount !== 1) { console.log(`      ! modifiedCount=${r.modifiedCount}`); }
    }
    bChanged++;
  }
}

const path = `scripts/output/greek-five-workid-backup-2026-08-08.json`;
if (APPLY) { writeFileSync(path, JSON.stringify(backup, null, 2)); console.log(`\nBackup → ${path}`); }
console.log(`\n${APPLY ? 'Applied' : 'Would change'}: ${aChanged} author docs, ${bChanged} books.  Skipped/already-correct: ${bSkipped}.`);
await c.close();
