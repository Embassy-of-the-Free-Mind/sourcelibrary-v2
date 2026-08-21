#!/usr/bin/env node
/**
 * ft-screening-triage.mjs — the SCREENING judgements, recorded as code. (#3459)
 *
 * The reference-set search (ft-reference-set-search.mjs) retrieves candidates and
 * refuses to decide the arguable ones: it marks them `unresolved`, which blocks a
 * `none_found` verdict. This file is where that decision gets made, and it is
 * checked in rather than done in a chat window for one reason — a screening
 * judgement is a claim about a public badge, so it must be attributable,
 * reviewable, and re-runnable.
 *
 * Each entry below is a judgement about ONE work, keyed on the work title as it
 * appears in our catalogue, with the reason written out. Nothing here flips a
 * badge; `--apply` writes the screening into `search_efforts` so the derived
 * verdict updates, and the public flag still moves only through the
 * sign-off-gated reconcile (#2933).
 *
 * THE CRITICAL DISTINCTION, and why so many entries are `first_complete`
 * ---------------------------------------------------------------------
 * A prior PARTIAL translation does not defeat "first COMPLETE English
 * translation". Several candidates here are exactly that, and lumping them in
 * with real priors would demote badges that are actually defensible:
 *
 *   - Flamsteed's *Historia Coelestis Britannica* — the catalogued English item
 *     is "The preface to ...", a preface, not the work.
 *   - Fludd's *Utriusque Cosmi Historia* — "The temple of music" is one section
 *     of an enormous compendium.
 *   - Servius on Virgil — "commentary on Book four" is one book of twelve.
 *   - Bélidor's *Architecture hydraulique* — "The mills of Bélidor" is a selection.
 *   - Avicenna's *Canon* — "The general principles" is Book I.
 *   - Witelo's *Perspectiva* — "liber secundus et tertius" is books 2-3.
 *
 * And some are simply different works that share an author, which the retrieval
 * layer cannot know: Euclid's *Optics* vs his *Phaenomena*; Jacopo Alighieri's
 * metrical index vs illustrations for his father's Comedy.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ft-screening-triage.mjs            # report
 *   node scripts/eval/ft-screening-triage.mjs --apply    # write screening
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { withMongo } from '../lib/mongo.mjs';
import { SCREEN, deriveVerdict, latestEffortPerBook } from '../lib/search-effort.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');
const APPLY = process.argv.includes('--apply');
const DATE = new Date().toISOString().slice(0, 10);

/**
 * PRIOR — a complete English translation of this work demonstrably predates
 * ours. These badges are not defensible and are recommended for demotion.
 */
const PRIOR = [
  // ── 2026-08-04 pass: catalogue-backed candidates that had never been read ──
  // Each names the prior edition the search actually retrieved. Every one is a
  // work continuously in English long before our translation.
  ['Organon', 'Aristotle. Owen\'s Bohn "Organon" (1853) is the complete Organon in English.'],
  ['The Odes of Pindar', 'Pindar. "The odes of Pindar" (1947); English since Moore (1852) and Sandys\' Loeb (1915).'],
  ['The Tragedies of Sophocles', 'Sophocles. Plumptre, "The tragedies of Sophocles" (1865), complete.'],
  ['Selected Tragedies of Aeschylus, Sophocles, and Euripides', 'All three tragedians complete in English well before 1863 ("The tragedies of Aeschylus", 1863).'],
  ['The Complete Works of Plato', 'Plato. Cooper, "Complete works" (1997); Jowett complete from 1871.'],
  ['The Complete Works of Plato Translated by Marsilio Ficino', 'The WORK is Plato\'s corpus, complete in English (Jowett 1871, Cooper 1997). Ficino\'s Latin is a witness, not a barrier.'],
  ['De coelesti hierarchia', 'Pseudo-Dionysius. Parker, "The works of Dionysius the Areopagite" (1976 repr.); Luibheid\'s Complete Works (1987).'],
  ['Pseudo-Dionysius Areopagita Schriften (German 1823)', 'Same work as De coelesti hierarchia — English via Parker and Luibheid.'],
  ['Anthology of Martial\'s Epigrams', 'Martial. "The epigrams of Martial" (1897); Bohn prose translation earlier still.'],
  ['Metaphysica / Aristotle, Hebrew translation (Or. 4771)', 'The work is Aristotle\'s Metaphysics — English long established ("The metaphysics", 1991; Ross 1908). The Hebrew is a transmission witness.'],
  ['Aristotelis Metaphysicorum libri XIV (Bessarion trans.)', 'As above — Bessarion\'s Latin renders a work already complete in English.'],
  ['On Animals (De Animalibus)', 'Matched 240 "Historia animalium." — Aristotle\'s History of Animals, English from 1862 (Cresswell).'],
  ['The Soul, or Rational Psychology', 'Swedenborg, Psychologia rationalis → "The soul" (1887).'],
  ['Timaeus, Asclepius, De deo Socratis, De mundo (VLQ 10)', 'Timaeus complete in English (Cornford, "Plato\'s cosmology", 1937; Jowett earlier); the other three items likewise.'],
  ['Neyphug Thor bu Legs bshad gser phreng', 'Tsongkhapa. Sparham, "Golden garland of eloquence" (2008) is a complete English rendering of Legs bshad gser phreng.'],
  ['De formula honestae vitae', 'pseudo-Seneca. Whittington\'s "A frutefull worke" (1546) is a complete rendering. 10 duplicate book records carry this badge.'],
  ['De Officiis', 'Cicero. Nicholas Grimald, "Thre bokes of duties" (1556), complete; reprinted 1558.'],
  ['Plutarchi Chaeronensis Moralia', 'Plutarch. 1561 "Three morall treatises" is partial, but Goodwin\'s "Plutarch\'s morals" (1870) is the complete Moralia.'],
  ['Στοιχεῖα (Elements)', 'Euclid. Billingsley (1570) from the Latin; Heath (1908/1955) directly from the Greek — so even "first from the Greek" fails.'],
  ['Complete Works of Euclid, Vol. 5 (Elements, Scholia)', 'Same as Στοιχεῖα — Heath covers the Elements complete from the Greek.'],
  ['De consolatione philosophiae', 'Boethius. English since Alfred; "Fiue bookes of philosophicall comfort" (1609) is a complete early modern rendering.'],
  ['The Iliad of Homer', 'Homer. Chapman\'s complete Iliad, 1609/1611.'],
  ['The Iliad and Odyssey of Homer', 'Homer. Chapman: Iliad 1611, Odysses 1614 — both complete.'],
  ['Magia Naturalis', 'Della Porta. "Natural magick" (1658) is the complete twenty books.'],
  ['Della Porta Magia Naturalis (German 1713)', 'Same work as above; the 1658 English precedes this German edition regardless.'],
  ['Tractatus theologico-politicus', 'Spinoza. "A treatise partly theological, and partly political" (1689), complete.'],
  ['Epigrammata', 'Martial. "Epigrams of Martial, Englished" (1695); complete Bohn edition 1877.'],
  ['Poetics', 'Aristotle. English since 1775; many complete translations follow.'],
  ['Divina Commedia', 'Dante. English complete since Cary (1814); Longfellow 1867.'],
  ['Gītagovinda', 'Jayadeva. Edwin Arnold, "The Indian Song of Songs" (1884); Barbara Stoler Miller (1977).'],
  ['Epistulae morales ad Lucilium', 'Seneca. Gummere\'s complete Loeb (1917-25); "Seneca\'s letters to Lucilius" 1932.'],
  ['Institutio Christianae religionis', 'Calvin. Norton\'s English Institutes 1561; Battles/McNeill 1960.'],
  ['Ko-i Genji Monogatari (校異源氏物語), Vol. 1', 'Murasaki. Waley (1925-33) and Seidensticker (1976) are complete.'],
  ['Genji Monogatari Ekotoba (源氏物語絵詞), Vol. 3', 'Same work as above.'],
  ['Genji Monogatari Ekotoba (源氏物語絵詞), Vol. 1', 'Same work as above.'],
  ['Works and Days with the Commentary of Proclus', 'Hesiod. The Works and Days has complete English translations well before 1959.'],
  ['De architectura', 'Vitruvius. English complete since Newton (1771); Morgan 1914.'],
  ['Nicomachean Ethics (with Averroes\' Commentary)', 'Aristotle. Complete English since the 17th c.; the Averroes commentary is the novel part, not the Ethics.'],
  ['Epistolae', 'Ficino. The School of Economic Science translation of the Letters is complete and ongoing from 1975.'],
  ['Platon : Gorgias', 'Plato. Complete English Gorgias since Jowett (1871).'],
  ['Metaphysics and Ethics', 'Aristotle. Both texts have long-standing complete English translations.'],
  ['The New Thoughts of Galileo', 'Galileo. "Dialogues concerning two new sciences" — Crew/de Salvio 1914, complete.'],
  ['Institutio Theologica', 'Proclus. E. R. Dodds, "The Elements of Theology" (1933), complete with facing Greek.'],
  ['Isagoge', 'Porphyry. Complete English translations well before 2003 (Warren 1975).'],
  ['Mimiambi', 'Herodas. Complete English since Knox/Headlam (1922).'],
  ['Geography', 'Strabo. Jones\'s complete Loeb Geography (1917-32).'],
  ['De subtilitate', 'Cardano. The 2013 Forrester translation is complete — and predates ours.'],
  ['Logical Works', 'Zabarella. "On methods" (2013) covers the logical works in English.'],
  ['Timaeus, Asclepius, De deo Socratis, De mundo (VLQ 10)', 'Plato/Apuleius. Cornford\'s "Plato\'s cosmology" (1937) is a complete Timaeus; the Apuleius texts also have English versions.'],
];

/**
 * FIRST_COMPLETE — the catalogued English item is genuinely PARTIAL, so a
 * "first COMPLETE English translation" claim survives. These should be
 * re-labelled rather than demoted, and the prior credited.
 */
const FIRST_COMPLETE = [
  ['Paracelsus\'s Surgical Books and Writings', 'The catalogued English item is "Selected writings" — an anthology, not the surgical works entire.'],
  ['Twelve Books of Letters and Lectures', 'Poliziano. The I Tatti "Letters" (2006) is volume one (Books I-IV), not all twelve.'],
  ['Historia Coelestis Britannica Vol. 1', 'The only English item is "The preface to Flamsteed\'s Historia" — a preface, not the work.'],
  ['Historia Coelestis Britannica Vol. 2', 'As Vol. 1 — preface only.'],
  ['Historia Coelestis Britannica Vol. 3', 'As Vol. 1 — preface only.'],
  ['Utriusque Cosmi Historia', '"The temple of music" is one section of Fludd\'s compendium, not the whole.'],
  ['Servius the Grammarian, Commentaries on the Poems of Virgil, Vol. III', '"Commentary on Book four" is one book of twelve.'],
  ['Commentary on the Poems of Virgil, Vol. I', 'As above — Book four only.'],
  ['In Vergilii carmina commentarii, Vol. II', 'As above — Book four only.'],
  ['Hydraulic Architecture, Volume One, Part One', '"The mills of Bélidor" is a selection, not the complete Architecture hydraulique.'],
  ['Hydraulic Architecture, Volume One, Part Two', 'As above — selection only.'],
  ['Hydraulic Architecture, Volume Two, Part One', 'As above — selection only.'],
  ['Hydraulic Architecture, Volume 2, Part 2', 'As above — selection only.'],
  ['al-Qānūn fī al-Ṭibb', '"The general principles of Avicenna\'s Canon" is Book I of five.'],
  ['Optics', 'Witelo. "Perspectivae liber secundus et tertius" is books 2-3 of ten.'],
  ['Margarita philosophica', '"Natural philosophy epitomised" renders part of Reisch, not the whole Margarita.'],
  ['Aristotle with John Philoponus Commentary on Prior Analytics', 'The Aristotle text is long translated; the Philoponus commentary is the untranslated part.'],
  ['Complete Works of Euclid, Vol. 6 (Optics, Catoptrics, etc.)', 'The catalogued item is the ARABIC version of the Optics in English — a different transmission line.'],
  ['A Little Book on Colors', 'Telesio. "On colours" (2002) — verify whether complete before finalising; provisionally partial.'],
];

/**
 * NOT_A_PRIOR — retrieval was right about the author, wrong about the work.
 * These are false positives and must not touch the badge.
 */
const NOT_A_PRIOR = [
  ['Euclid\'s Optics', 'Matched "Euclid\'s Phaenomena" — a DIFFERENT work by Euclid.'],
  ['Jacopo Dante, Metrical Index to his Father\'s Comedy', 'Matched "The illustrations for Dante\'s Divine comedy" — a different work entirely.'],
  ['Carceri d\'Invenzione (Imaginary Prisons)', 'Piranesi\'s Carceri is a print series, not a text; there is nothing to translate.'],
  ['Introduction à l\'Histoire du Buddhisme Indien', 'Matched "Legends of Indian Buddhism" — a different Burnouf work. (Buffetrille/Lopez translated the Introduction in 2010, so re-check separately.)'],
  ['Adagiorum Desiderii Erasmi Roterodami epitome', 'Matched "The plea of reason, religion and humanity" (1813), which is not the Adagia. Erasmus\'s Adages DO exist in English (CWE 31-36) — re-screen against that, not this record.'],
  ['Roger Bacon Alchemical Compendium', 'Matched a truncated "Bacon :" record with a French source language — not a reliable identification.'],
  ['Unpublished Works of Roger Bacon (Opus Tertium, Opus Minus, Compendium Studii)', 'As above — the "Bacon :" record is not identifiable as this work.'],
  ['The Philosophy of Roger Bacon', 'As above.'],
  ['Les  fables egyptiennes et grecques dévoilées & réduites au même principe, avec une explication des hiéroglyphes, et de la guerre de Troye / Tome premier.', 'Matched "An alchemical treatise on the great art" — needs a positive identification before any claim; not established.'],
  ['Les  fables egyptiennes et grecques dévoilées & réduites au même principe, avec une explication des hiéroglyphes, et de la guerre de Troye / Tome second.', 'As Tome premier — not established.'],
];

/** Everything else in the inconclusive set stays unresolved pending research. */
const UNRESOLVED_NOTE = 'not screened in this pass — remains unresolved by design';

const SCREEN_FOR = new Map();
for (const [work, reason] of PRIOR) SCREEN_FOR.set(work, { screen: SCREEN.PRIOR, reason });
for (const [work, reason] of FIRST_COMPLETE) SCREEN_FOR.set(work, { screen: SCREEN.PARTIAL, reason });
for (const [work, reason] of NOT_A_PRIOR) SCREEN_FOR.set(work, { screen: SCREEN.DIFFERENT_WORK, reason });

await withMongo(async (db) => {
  const coll = db.collection('search_efforts');
  // Screening decisions are DURABLE, stored separately from the effort they were
  // first applied to. An effort is immutable and a new reference-set snapshot or
  // code version mints a new one — so attaching judgements only to an effort
  // means every re-run silently discards them. Observed: adding Wikidata created
  // a new generation and dropped all 45 demote decisions on the floor.
  //
  // A judgement is about a (work, prior record) pair, not about a run, so it is
  // keyed that way and re-applied by the search on every subsequent generation.
  // That is what makes this a living, correctable census rather than a snapshot.
  const decisions = db.collection('screening_decisions');
  const all = await coll.find({}, {
    projection: { effort_id: 1, book_id: 1, run_at: 1, verdict: 1, proposition: 1, candidates: 1, searchable: 1 },
  }).toArray();
  const current = latestEffortPerBook(all);
  const efforts = current.filter((e) => e.verdict === 'inconclusive');
  console.log(`search_efforts rows: ${all.length} across all generations`);
  console.log(`current generation (latest per book): ${current.length}`);
  console.log(`...of which inconclusive: ${efforts.length}\n`);

  // ── A JUDGEMENT THAT MATCHES NOTHING MUST BE LOUD ────────────────────────
  //
  // Decisions are keyed on an EXACT work title. Five of the first sixty were
  // transcribed from truncated console output — "Complete Works of Euclid,
  // Vol. 6 (Optics, Catoptrics)" against a real title ending "…, etc.)" — and so
  // matched no book at all. They were written, reviewed, applied, and silently
  // did nothing: the books stayed `unresolved` and looked simply unscreened.
  //
  // It fails in the safe direction (unresolved blocks `none_found`, so no false
  // claim), which is exactly why it survived unnoticed — the only cost is real
  // human judgement quietly discarded. Same shape as every other defect here:
  // silent, and toward leaving the question open.
  //
  // A key that can never be consumed is a bug in this file, so say so.
  const workKeys = new Set(current.map((e) => e.proposition.match(/of "([^"]+)"/)?.[1]).filter(Boolean));
  const inert = [...SCREEN_FOR.keys()].filter((k) => !workKeys.has(k));
  if (inert.length) {
    console.error(`\n⚠️  ${inert.length} screening decision(s) match NO book in the current generation.`);
    console.error('   These are inert — the judgement is recorded and will never be applied.');
    console.error('   Fix the key to the exact `work_title || title`, or remove the entry:\n');
    for (const k of inert) console.error(`     ${JSON.stringify(k)}`);
    console.error('');
    if (APPLY) {
      throw new Error(`refusing to --apply with ${inert.length} inert decision(s): fix the keys first`);
    }
  } else {
    console.log(`✅ all ${SCREEN_FOR.size} screening decisions match a real work key\n`);
  }

  const tally = { prior: 0, first_complete: 0, not_a_prior: 0, unscreened: 0 };
  const updates = [];
  const rows = [];

  for (const e of efforts) {
    const work = e.proposition.match(/of "([^"]+)"/)?.[1] ?? '';
    const decision = SCREEN_FOR.get(work);
    if (!decision) {
      tally.unscreened++;
      rows.push({ work, book_id: e.book_id, decision: 'unscreened', reason: UNRESOLVED_NOTE });
      continue;
    }

    const candidates = e.candidates.map((c) => (
      c.screen === SCREEN.UNRESOLVED
        ? { ...c, screen: decision.screen, reason: `[screened ${DATE}] ${decision.reason}`, screened_at: new Date() }
        : c
    ));
    const verdict = deriveVerdict({ candidates, searchable: e.searchable });

    if (decision.screen === SCREEN.PRIOR) tally.prior++;
    else if (decision.screen === SCREEN.PARTIAL) tally.first_complete++;
    else tally.not_a_prior++;

    rows.push({ work, book_id: e.book_id, decision: decision.screen, verdict, reason: decision.reason });
    updates.push({
      updateOne: {
        filter: { effort_id: e.effort_id },
        update: { $set: { candidates, verdict, screened_at: new Date(), screened_by: 'ft-screening-triage' } },
      },
    });
  }

  console.log('─── Screening outcome ────────────────────────────────────────');
  console.log(`  PRIOR (badge not defensible — recommend demote) : ${tally.prior}`);
  console.log(`  PARTIAL prior only (first_complete stands)      : ${tally.first_complete}`);
  console.log(`  NOT a prior (retrieval false positive)          : ${tally.not_a_prior}`);
  console.log(`  left unresolved on purpose                      : ${tally.unscreened}`);
  console.log('\n  A partial prior does NOT defeat "first complete". Collapsing the');
  console.log('  middle row into the first would demote defensible badges.');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `ft-screening-triage-${DATE}.json`);
  fs.writeFileSync(out, JSON.stringify({ date: DATE, tally, rows }, null, 2));
  console.log(`\nWrote ${out}`);

  if (!APPLY) {
    console.log('REPORT ONLY — no screening written. Re-run with --apply.');
    return;
  }
  // Persist the judgements first, so they survive the next re-run regardless of
  // what happens to this generation's efforts.
  await decisions.createIndex({ work: 1 }, { unique: true });
  const decisionDocs = [...SCREEN_FOR.entries()].map(([work, d]) => ({
    updateOne: {
      filter: { work },
      update: {
        $set: {
          work,
          screen: d.screen,
          reason: d.reason,
          decided_at: new Date(),
          decided_by: 'ft-screening-triage',
        },
      },
      upsert: true,
    },
  }));
  await decisions.bulkWrite(decisionDocs, { ordered: false });
  console.log(`Persisted ${decisionDocs.length} durable screening decisions.`);

  let n = 0;
  for (let i = 0; i < updates.length; i += 500) {
    const res = await coll.bulkWrite(updates.slice(i, i + 500), { ordered: false });
    n += res.modifiedCount;
  }
  console.log(`APPLIED — ${n} efforts screened. NO badge was changed; demotes still need sign-off.`);
});
