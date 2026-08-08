#!/usr/bin/env node
/**
 * Acquisition batch: Epicurus, Longinus, Sappho, Sextus Empiricus, Polybius.
 *
 * Sourced 2026-08-08 via the canonical loop in .claude/docs/import-workflow.md:
 * enumerated from Internet Archive with scripts/import/enumerate-dedupe-source.ts
 * (one query per author), deduped against the whole catalog on source_fingerprint,
 * then subject-filtered by hand. Keyword enumeration was extremely noisy here —
 * "Sappho" alone returned Daudet's novel, Bret Harte's short stories and four
 * printings of Grillparzer's tragedy; "Epicurus" returned Anatole France and a
 * shelf of garden essays. None of that is in this list.
 *
 * Selection rule: the Greek original first, then the editions and translations
 * that carried the text into later thought — Hervet's Latin Sextus (which put
 * ancient scepticism into Montaigne and Descartes), Boileau's Longinus (which
 * made the Sublime a European idea), Casaubon's Polybius, Charleton's first
 * English Epicurus. Modern scholarship *about* these authors is excluded; so is
 * anything published after 1929, for copyright.
 *
 * All 40 items were probed against archive.org/metadata before listing: none is
 * lending-restricted, all have downloadable page images.
 *
 * Imports land HIDDEN (the route sets visible:false + hidden:true). Flip to
 * visible only after an OCR/translation QA pass — see the import-workflow doc.
 *
 * `lang` is the EDITION's language and `orig` the SOURCE WORK's — they are two
 * different fields and the route wants both. Do not pass the edition language as
 * `original_language`: resolveLanguage() nulls original_language when it equals
 * language (FRBR work == manifestation), which also leaves is_translation false,
 * and classifyTextRole() then returns 'original' for ANY non-English scan. The
 * first run of this script made that mistake and filed Boileau's French Longinus,
 * Gori's Italian Longinus, Hervet's Latin Sextus and Huart's French Sextus as
 * original-language sources. Repaired by
 * scripts/maintenance/fix-greek-five-language-roles.mjs.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/greek-five-authors-batch.mjs --dry-run
 *   node scripts/import/greek-five-authors-batch.mjs --commit
 */

const COMMIT = process.argv.includes('--commit');
const CRON_SECRET = process.env.CRON_SECRET;
if (COMMIT && !CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }
const BASE = 'https://sourcelibrary.org/api/import/ia';

const BOOKS = [
  // ── EPICURUS ───────────────────────────────────────────────────────────────
  // Held already: Usener's Epicurea, Bailey's Extant Remains, Vogliano's
  // Herculaneum scripta, Gassendi's De Vita et Moribus, Charleton's Physiologia,
  // Gassendi's Animadversiones on Diogenes Laertius X.
  { id: 'bim_early-english-books-1641-1700_epicvrvss-morals-_epicurus_1656', title: "Epicurus's Morals, Collected and Faithfully Englished", author: 'Epicurus (tr. Walter Charleton)', year: 1656, lang: 'English', orig: 'Greek' },
  { id: 'bim_early-english-books-1641-1700_philosophi-epicuri-synt_gassendi-pierre_1668', title: 'Philosophiae Epicuri Syntagma', author: 'Pierre Gassendi', year: 1668, lang: 'Latin', orig: null },
  { id: 'epicurussmorals00descgoog', title: "Epicurus's Morals, with a Life by Saint-Evremond", author: 'Epicurus (tr. John Digby)', year: 1712, lang: 'English', orig: 'Greek' },
  { id: 'gri_33125008560068', title: 'Herculanensium Voluminum quae supersunt', author: 'Accademia Ercolanese', year: 1793, lang: 'Latin', orig: 'Greek' },
  { id: 'epicurifragment00rosigoog', title: 'Epicuri Fragmenta librorum II et XI De Natura, ex voluminibus papyraceis Herculanensibus', author: 'Epicurus (ed. Carlo Rosini)', year: 1818, lang: 'Greek', orig: 'Greek' },
  { id: 'metrodoriepicure00metruoft', title: 'Metrodori Epicurei Fragmenta', author: 'Metrodorus of Lampsacus (ed. Alfred Koerte)', year: 1890, lang: 'Greek', orig: 'Greek' },

  // ── LONGINUS ───────────────────────────────────────────────────────────────
  // Held already: the 1636 Greek/Latin Peri Hypsous, Manuzio's 1555 Aldine,
  // an e-rara Greek-Latin, and Boileau's collected Oeuvres diverses.
  { id: 'bim_early-english-books-1641-1700_an-essay-upon-sublime_longinus-dionysius_1698', title: 'An Essay upon Sublime, translated from the Greek of Dionysius Longinus Cassius', author: 'Longinus', year: 1698, lang: 'English', orig: 'Greek' },
  { id: 'bim_eighteenth-century_the-works-of-dionysius-l_longinus_1712', title: 'The Works of Dionysius Longinus, On the Sublime', author: 'Longinus (tr. Leonard Welsted)', year: 1712, lang: 'English', orig: 'Greek' },
  { id: 'bub_gb_61A1tk93QXwC', title: 'Traite du Sublime, ou du Merveilleux dans le Discours', author: 'Longinus (tr. Nicolas Boileau-Despreaux)', year: 1733, lang: 'French', orig: 'Greek' },
  { id: 'bub_gb_tEepGVRfALMC', title: 'Trattato del Sublime di Dionisio Longino', author: 'Longinus (tr. Anton Francesco Gori)', year: 1737, lang: 'Italian', orig: 'Greek' },
  { id: 'dionysiuslongin00smitgoog', title: 'Dionysius Longinus On the Sublime, with Notes and Observations', author: 'Longinus (tr. William Smith)', year: 1752, lang: 'English', orig: 'Greek' },
  { id: 'dionysiuslongin03longgoog', title: 'Dionysius Longinus On the Sublime: In Greek, together with the English Translation', author: 'Longinus', year: 1810, lang: 'Greek', orig: 'Greek' },
  { id: 'onsublimechiefly00long', title: 'On the Sublime, chiefly from the text of Weiske', author: 'Longinus (ed. Benjamin Weiske)', year: 1838, lang: 'Greek', orig: 'Greek' },
  { id: 'onsublimegreekte00long', title: 'On the Sublime: the Greek Text edited after the Paris Manuscript', author: 'Longinus (ed. W. Rhys Roberts)', year: 1907, lang: 'Greek', orig: 'Greek' },

  // ── SAPPHO ─────────────────────────────────────────────────────────────────
  // Held already: Wharton's Memoir/Text (three printings), Lobel & Page's
  // Poetarum Lesbiorum Fragmenta, Loeb 142, Edmonds's Lyra Graeca II, Haines.
  { id: 'bim_eighteenth-century_the-works-of-anacreon-a_anacreon_1713', title: 'The Works of Anacreon and Sappho, done from the Greek by several hands', author: 'Anacreon; Sappho', year: 1713, lang: 'English', orig: 'Greek' },
  { id: 'bub_gb_MPfo6Gvxga8C', title: 'Sapphus, Poetriae Lesbiae, Fragmenta et Elogia', author: 'Sappho (ed. Johann Christian Wolf)', year: 1733, lang: 'Greek', orig: 'Greek' },
  { id: 'worksofanacreons00fawkuoft', title: 'The Works of Anacreon, Sappho, Bion, Moschus and Musaeus', author: 'Anacreon; Sappho; Bion; Moschus (tr. Francis Fawkes)', year: 1760, lang: 'English', orig: 'Greek' },
  { id: 'bim_eighteenth-century_works-hai-tou-anakreo_sappho_1770', title: 'Hai tou Anakreontos Odai, kai ta tes Sapphous, kai ta tou Alkaiou leipsana', author: 'Anacreon; Sappho; Alcaeus', year: 1770, lang: 'Greek', orig: 'Greek' },
  { id: 'sapphvslesbiaeca00sapp', title: 'Sapphus Lesbiae Carmina et Fragmenta', author: 'Sappho (ed. Heinrich Friedrich Magnus Volger)', year: 1810, lang: 'Greek', orig: 'Greek' },
  { id: 'anacreontisquae00anacgoog', title: 'Anacreontis quae feruntur Carmina; Sapphus et Erinnae Fragmenta', author: 'Anacreon; Sappho; Erinna', year: 1826, lang: 'Greek', orig: 'Greek' },
  { id: 'sapphonismytile00neuegoog', title: 'Sapphonis Mytilenaeae Fragmenta', author: 'Sappho (ed. Christian Friedrich Neue)', year: 1827, lang: 'Greek', orig: 'Greek' },
  { id: 'vitaeframmentidi00sapp', title: 'Vita e Frammenti di Saffo da Mitilene', author: 'Sappho', year: 1863, lang: 'Greek', orig: 'Greek' },
  { id: 'supplementumlyri00diehuoft', title: 'Supplementum Lyricum: neue Bruchstucke von Archilochus, Alcaeus, Sappho, Corinna, Pindar, Bacchylides', author: 'Ernst Diehl (ed.)', year: 1917, lang: 'Greek', orig: 'Greek' },
  { id: 'cu31924026456735', title: 'The Lyric Songs of the Greeks: the extant fragments of Sappho, Alcaeus, Anacreon and the melic poets', author: 'Sappho; Alcaeus; Anacreon (tr. Walter Petersen)', year: 1918, lang: 'English', orig: 'Greek' },

  // ── SEXTUS EMPIRICUS ───────────────────────────────────────────────────────
  // Held already: Fabricius's 1718 Opera, Stephanus's 1562 Hypotyposes,
  // Patrick's 1899 Outlines, a 15th-c Greek manuscript (ljs380), Mutschmann's
  // Teubner Opera vols 1-2.
  { id: 'bub_gb_RyhI9DhB82sC', title: 'Adversus Mathematicos, hoc est adversus eos qui profitentur disciplinas', author: 'Sextus Empiricus (tr. Gentian Hervet)', year: 1569, lang: 'Latin', orig: 'Greek' },
  { id: 'bub_gb_duVWlm_RcoIC', title: 'Sexti Empirici Opera quae extant (Greek and Latin)', author: 'Sextus Empiricus', year: 1621, lang: 'Greek', orig: 'Greek' },
  { id: 'leshipotiposeso00sextgoog', title: 'Les Hipotiposes, ou Institutions Pirroniennes de Sextus Empiricus, en trois livres', author: 'Sextus Empiricus (tr. Claude Huart)', year: 1725, lang: 'French', orig: 'Greek' },
  { id: 'sextusempiricus00bekkgoog', title: 'Sexti Empirici Opera (Greek text)', author: 'Sextus Empiricus (ed. Immanuel Bekker)', year: 1842, lang: 'Greek', orig: 'Greek' },
  { id: 'adversusdogmatic0000sext', title: 'Adversus Dogmaticos libros quinque (Adversus Mathematicos VII-XI) continens', author: 'Sextus Empiricus (ed. Hermann Mutschmann)', year: 1914, lang: 'Greek', orig: 'Greek' },

  // ── POLYBIUS ───────────────────────────────────────────────────────────────
  // Held already: Vat.gr.124 (10th-c MS), bsb00034261 (15th-c MS), the 1521
  // Latin Historiae, Sheeres/Dryden's English, Shuckburgh vol. 2, Casaubon's
  // commentary on Book I.
  { id: 'ita-bnc-mag-00001152-001', title: 'Ek tou hektou ton Polybiou, peri tes politeias (Historiae VI, on the Roman constitution)', author: 'Polybius', year: 1539, lang: 'Greek', orig: 'Greek' },
  { id: 'bub_gb_MnM46WGJ0kwC', title: 'Polybiou tou Lykorta Megalopolitou Historion ta sozomena (Historiae, Greek and Latin)', author: 'Polybius (ed. Isaac Casaubon)', year: 1609, lang: 'Greek', orig: 'Greek' },
  { id: 'historiarumquaes03polyuoft', title: 'Historiarum quae supersunt', author: 'Polybius (ed. Johann August Ernesti)', year: 1763, lang: 'Greek', orig: 'Greek' },
  { id: 'generalhistoryof01poly', title: 'The General History of Polybius, in Five Books, Vol. 1', author: 'Polybius (tr. James Hampton)', year: 1772, lang: 'English', orig: 'Greek' },
  { id: 'polybiimegalopo00polygoog', title: 'Polybii Megalopolitani Historiarum quidquid superest', author: 'Polybius (ed. Johannes Schweighauser)', year: 1789, lang: 'Greek', orig: 'Greek' },
  { id: 'historiarumexcer00polyuoft', title: 'Historiarum Excerpta Vaticana in titulo De Sententiis', author: 'Polybius', year: 1829, lang: 'Greek', orig: 'Greek' },
  { id: 'polybiihistoria00dbgoog', title: 'Polybii Historiarum Reliquiae, Graece et Latine, cum indicibus', author: 'Polybius (ed. Ludwig Dindorf)', year: 1839, lang: 'Greek', orig: 'Greek' },
  { id: 'historyofachaean00polyuoft', title: 'The History of the Achaean League, as contained in the remains of Polybius', author: 'Polybius (ed. W. W. Capes)', year: 1888, lang: 'Greek', orig: 'Greek' },
  { id: 'selectionsfrompo00polyuoft', title: 'Selections from Polybius', author: 'Polybius (ed. J. L. Strachan-Davidson)', year: 1888, lang: 'Greek', orig: 'Greek' },
  { id: 'polybiihistoriae02poly', title: 'Polybii Historiae, Vol. 2 (Teubner)', author: 'Polybius (ed. Theodor Buettner-Wobst)', year: 1889, lang: 'Greek', orig: 'Greek' },
  { id: 'historiespolybi01hultgoog', title: 'The Histories of Polybius, Vol. 1', author: 'Polybius (tr. Evelyn S. Shuckburgh)', year: 1889, lang: 'English', orig: 'Greek' },
];

async function importOne(b, attempt = 1) {
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CRON_SECRET}` },
      body: JSON.stringify({ ia_identifier: b.id, title: b.title, author: b.author, year: b.year, language: b.lang, ...(b.orig ? { original_language: b.orig } : {}) }),
      signal: AbortSignal.timeout(180000),
    });
    const data = await res.json();
    if (res.ok && data.success) return { id: b.id, ok: true, pages: data.pagesCreated, bookId: data.bookId };
    if (res.status === 409) return { id: b.id, ok: false, dupe: true, err: `already held (${data.bookId || data.existingId || '?'})` };
    if (attempt < 3 && /timed out|MongoNetwork|ECONN|502|504/i.test(JSON.stringify(data))) {
      await new Promise(r => setTimeout(r, 5000));
      return importOne(b, attempt + 1);
    }
    return { id: b.id, ok: false, err: data.error || data.details || JSON.stringify(data).slice(0, 140) };
  } catch (e) {
    if (attempt < 3) { await new Promise(r => setTimeout(r, 5000)); return importOne(b, attempt + 1); }
    return { id: b.id, ok: false, err: e.message };
  }
}

async function main() {
  console.log(`${COMMIT ? 'IMPORT' : 'DRY-RUN'} — ${BOOKS.length} editions (Epicurus, Longinus, Sappho, Sextus Empiricus, Polybius)\n`);
  if (!COMMIT) { BOOKS.forEach(b => console.log(`  · ${String(b.year).padEnd(5)} ${b.lang.padEnd(8)} ${b.title.slice(0, 70)}`)); return; }
  const results = [];
  for (const b of BOOKS) {
    const r = await importOne(b);
    results.push(r);
    console.log(`  ${r.ok ? '✓' : '✗'} ${b.id.slice(0, 42).padEnd(42)} ${r.ok ? `${r.pages}p → ${r.bookId}` : (r.dupe ? 'DUPE ' : 'ERR ') + r.err}`);
    await new Promise(r => setTimeout(r, 2500));
  }
  const ok = results.filter(r => r.ok);
  console.log(`\nDone: ${ok.length}/${results.length} imported, ${ok.reduce((s, r) => s + (r.pages || 0), 0)} pages.`);
  const dupes = results.filter(r => r.dupe);
  if (dupes.length) console.log(`Already held (${dupes.length}): ${dupes.map(r => r.id).join(', ')}`);
  const failed = results.filter(r => !r.ok && !r.dupe);
  if (failed.length) console.log(`FAILED (${failed.length}): ${failed.map(r => `${r.id} — ${r.err}`).join('; ')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
