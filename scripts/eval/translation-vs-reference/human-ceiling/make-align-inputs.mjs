#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t1/draw-pages.mjs and translation-vs-reference/t2/ (#5695) draw pages and cut ONE
// reference per page; neither names a second translator. scripts/eval/experiments/2026-10-01-translation-recitation-
// pilot-5523.md pairs two translators for 7 Gutenberg works but at chapter level, not cut to our pages. This lists
// the T1/T2 pages for which a second, independent public-domain translation exists and writes the aligner inputs.
/** Human ceiling (#5762): pick the T1/T2 pages that have a second independent PD translator (B) and write one aligner input per group. */
/**
 *   node scripts/eval/translation-vs-reference/human-ceiling/make-align-inputs.mjs \
 *        --t1 /root/sl-eval-archive/xlref-2026-10/xlref-t1/records-2.jsonl \
 *        --t2 /root/sl-eval-archive/xlref-2026-10/xlref-t2/records-arms.jsonl --out <dir> [--group 7]
 * Writes <dir>/in-<G>.jsonl (source page + translation A + the hint for B; never our English) and <dir>/selected.json.
 * The hint is where to LOOK; the aligner decides whether B is independent of A and may skip the page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, writeJsonl, itemId } from '../common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const OUT = opt('out'); const GROUP = Number(opt('group', 7));
if (!OUT || !opt('t1') || !opt('t2')) { console.error('--t1, --t2 and --out are required'); process.exit(1); }

// key = last 6 hex of book_id + ':' + page_number. Pages of T1/T2 not listed have no second PD translator we know of
// (Taylor-only Neoplatonica, ANF/NPNF-only fathers, single early-modern Englishings) or an A that is in copyright.
export const HINTS = {
  // ── Greek (T2) ──
  '4b93b8:150': 'Thomas M. Johnson, Proclus\' Metaphysical Elements (1909), props. 88-90; archive.org',
  '4b168d:129': 'Alexander Wilder, Theurgia or The Egyptian Mysteries (1911), Part II ch. VII-ish; esotericarchives.com / archive.org / Wikisource',
  '909ff2:123': 'Meredith Hanmer, The Auncient Ecclesiasticall Histories (1577; EEBO-TCP), Socrates Scholasticus Book II. NOTE A (Zenos) revises the Bohn translation; Hanmer is independent',
  'd772e7:291': 'Frederick Crombie, Origen Against Celsus (ANF 4, 1885), the same passage of Contra Celsum that Philocalia ch. 20 excerpts; CCEL / newadvent',
  '5ea3a8:659': 'Meredith Hanmer, The Auncient Ecclesiasticall Histories (1577; EEBO-TCP), Socrates Scholasticus',
  '917f1b:116': 'C. E. Rolt, Dionysius the Areopagite on the Divine Names and the Mystical Theology (1920), DN 4.16; CCEL / Gutenberg',
  'bc7d4c:296': 'Charles Thomson, The Septuagint Bible (1808), Deuteronomy 25-26; archive.org / thomsonbible sites',
  'bc8c0b:121': 'Young\'s Literal Translation (1862/1898) or Weymouth NT (1903), Matthew 16:4-9 (independent of the RV/ASV line; do NOT use KJV/RV)',
  '81286a:231': 'Robert Sinker, Testaments of the Twelve Patriarchs (ANF 8, 1871), Naphtali 9 / Gad 1; CCEL / newadvent',
  '6cfc2c:283': 'Henry Holcroft, The History of the Warres of the Emperour Justinian (1653; EEBO-TCP), Persian War II',
  '430c9c:153': 'Henry Holcroft, The History of the Warres of the Emperour Justinian (1653; EEBO-TCP), Persian War I',
  '42d7c7:139': 'The New History of Count Zosimus (1684; EEBO-TCP), Book II. CHECK whether the 1814 text (A) is a revision of 1684; if it is, skip',
  '916e4c:385': 'W. R. Paton, Polybius Histories (Loeb 1922), IV.10-11; LacusCurtius (penelope.uchicago.edu)',
  'd3d160:285': 'G. Booth, The Historical Library of Diodorus the Sicilian (1700; repr. 1814), XI.20-21; archive.org / EEBO-TCP',
  '1d29be:426': 'H. L. Jones, Strabo Geography (Loeb vol. VII, 1930), XV.1 — the passages the Onesicritus fragments quote; LacusCurtius',
  '6e13d3:194': 'H. C. Hamilton & W. Falconer, The Geography of Strabo (Bohn 1854-57), IX.2.26-29; Perseus / Gutenberg',
  '4307b0:136': 'J. G. Frazer, Pausanias\'s Description of Greece (1898), or A. R. Shilleto (1886; Gutenberg), IV.9-10',
  '96231b:615': 'George Rawlinson, The History of Herodotus (1858-60), IV.15-17; classics.mit.edu / Gutenberg; or A. D. Godley (Loeb 1920; Perseus)',
  '94711f:614': 'Benjamin Jowett, Thucydides (1881), V.35-36; Perseus / classicpersuasion; or Hobbes 1629',
  'f5470c:99': 'Edward Berwick, The Life of Apollonius of Tyana (1809), VII.26-27; archive.org',
  '6d4a6c:195': 'H. G. Dakyns, Hellenica (1890-97; Gutenberg #1174), VII.5.21-22',
  'c52565:515': 'Stephen Gaselee, Achilles Tatius (Loeb 1917); archive.org; or Anthony Hodges 1638 (EEBO-TCP)',
  '19a3b5:340': 'E. P. Coleridge, The Argonautica of Apollonius Rhodius (prose, 1889), or A. S. Way (1901); archive.org',
  '44b377:673': 'Lang, Leaf & Myers, The Iliad (1883; Gutenberg #3059), or A. T. Murray (Loeb 1924; Perseus), XXIV.451-475',
  'ddb092:355': 'Gilbert Murray, The Rhesus of Euripides (1913; Gutenberg), or A. S. Way (Loeb 1912), lines 715-744',
  '962d53:314': 'A. M. Harmon, Lucian vol. III (Loeb 1921), On Salaried Posts in Great Houses 2-3; archive.org / Wikisource; or Francklin 1780 / Tooke 1820',
  '9179f7:189': 'A. M. Harmon, Lucian vol. II (Loeb 1915), Icaromenippus 15-18; archive.org / Wikisource / Gutenberg; or Francklin 1780 / Tooke 1820',
  '961a97:367': 'Davies & Vaughan, The Republic of Plato (1852; Gutenberg / archive.org), or Thomas Taylor (1804), IX 571c-572b',
  '1b4e3d:89': 'Thomas Taylor, The Physics of Aristotle (1806), or Wicksteed & Cornford (Loeb 1929), IV.10 218a-b; archive.org',
  '2cf673:163': 'Kenneth Sylvan Guthrie, Plotinos: Complete Works (1918; Gutenberg), Enn. II.5.5; or Thomas Taylor',
  '737f80:588': 'C. D. Yonge, Diogenes Laertius, Lives (Bohn 1853), VII (Chrysippus, list of works); Gutenberg / classicpersuasion',
  '6d0f99:64': 'J. D. Chambers, The Theological and Philosophical Works of Hermes Trismegistus (1882), Poemandres X; or Walter Scott, Hermetica vol. I (1924), Libellus X.13-15; archive.org / sacred-texts. NOT Everard (from Latin)',
  'a33f12:232': 'F. H. Colson & G. H. Whitaker, Philo vol. III (Loeb 1930), De Plantatione 26-33; archive.org',
  'e86f6b:397': 'Thomas Stanley, The History of Philosophy (1656; EEBO-TCP), "The Doctrine of Plato delivered by Alcinous", ch. 7',
  '5f8f3a:847': 'E. T. Withington, Hippocrates vol. III (Loeb 1928), On Joints 78-79; archive.org',
  '90ae35:66': 'Philemon Holland, The Philosophie, commonlie called the Morals (1603; EEBO-TCP), Symposiaques book I, proem',
  '45a8df:318': 'H. N. Fowler, Moralia vol. X (Loeb 1936; LacusCurtius, copyright not renewed), Precepts of Statecraft 13-14; or Philemon Holland 1603 (EEBO-TCP)',
  'e27928:144': 'C. W. King, Plutarch\'s Morals: Theosophical Essays (1882; sacred-texts / Gutenberg), Isis and Osiris 52-53; or G. R. S. Mead, Thrice-Greatest Hermes vol. I (1906)',
  // ── Latin (T1) ──
  '5603c8:136': 'J. H. Oxon, Paracelsus his Archidoxis (1660; EEBO-TCP)',
  '77872d:218': 'The Triumphant Chariot of Antimony (1660, I. H. Oxon; or 1678 with Kirkringius\'s annotations; EEBO-TCP)',
  'cae0e3:81': 'John French, A New Light of Alchymie (1650; EEBO-TCP), the parable in the treatise of Mercury / Sulphur',
  '0416bc:29': 'J. H. Oxon, Paracelsus his Aurora, & Treasure of the Philosophers (1659; EEBO-TCP)',
  '324e95:107': 'John Everard, Hermes Trismegistus his second book called Asclepius (1657; EEBO-TCP), or Walter Scott, Hermetica vol. I (1924), Asclepius 19-20',
  'cae1c9:159': 'John Everard, Asclepius (1657; EEBO-TCP), or Walter Scott, Hermetica vol. I (1924), Asclepius 29',
  'bf0e81:213': 'P. Fleury Mottelay, William Gilbert On the Loadstone and Magnetic Bodies (1893; Gutenberg / archive.org), Book V ch. 2-3',
  '26cd3c:151': 'The Anatomical Exercises of Dr. William Harvey (1653; EEBO-TCP), ch. XII',
  'a51e75:98': 'William Wood, Novum Organum (1831, in Montagu; revised Devey 1902 = Gutenberg #45988), I.70; or G. W. Kitchin (1855)',
  'de1de2:473': 'Anatomical Exercitations concerning the Generation of Living Creatures (1653; EEBO-TCP), Exercitation 54-55',
  'bef758:274': 'William Wood / Devey, Novum Organum (Gutenberg #45988), II.36; or Kitchin 1855',
  '6a1dc9:175': 'Sir Arthur Gorges, The Wisedome of the Ancients (1619; EEBO-TCP / Gutenberg), Prometheus',
  '6a2793:237': 'William Rawley, History Naturall and Experimentall of Life and Death (1638; EEBO-TCP)',
  'b48a36:75': 'R. G., The Naturall and Experimentall History of Winds (1653; EEBO-TCP)',
  '04d284:499': 'John C. Ager, The True Christian Religion (1906-07; sacred-texts / swedenborg sites), nn. 828-833. CHECK it is a fresh translation, not a revision of A\'s line',
  '61e685:331': 'John Faulkner Potts, Arcana Coelestia (1905-10; sacred-texts), nn. 4712-4715. CHECK independence from the Clowes line; if Potts is only a revision of Clowes, record independent:"partial"',
  'c70f53:209': 'John Faulkner Potts, Arcana Coelestia (1905-10; sacred-texts), nn. 3222-3224. Same independence check',
  'd7aa52:309': 'William Wood / Devey, Novum Organum (Gutenberg #45988), II.42-43; or Kitchin 1855',
  'dc727d:552': 'Peter Shaw, A New Method of Chemistry (2nd ed. 1741), Processes 77-79; archive.org',
  '3249e0:198': 'A. E. Waite, The Hermetic Museum vol. II (1893), The New Chemical Light, second part concerning Sulphur; archive.org b24927363_0002 / sacred-texts',
  '89f0c0:180': 'Ralph Robinson, Utopia (1551; Gutenberg / Lupton 1895), Book II, Of sciences, craftes and occupations',
  '45adbb:62': 'Gilbert Burnet, Utopia (1684; Gutenberg #2130), Book I',
  '45ae6a:196': 'White Kennett, Moriae Encomium / The Praise of Folly (1683; Gutenberg / archive.org), or Thomas Chaloner 1549 (EEBO-TCP)',
  '8646f6:223': 'H. M., The Colloquies, or Familiar Discourses of Desiderius Erasmus (1671; EEBO-TCP), The Penitent Virgin; or L\'Estrange 1680 if it has this colloquy',
  '5e857c:165': 'Henry Beveridge, Institutes of the Christian Religion (1845; CCEL / Gutenberg), II.11.3-5; or Thomas Norton 1561',
  '8659be:184': 'Nathaniel Wanley, A Discourse of Constancy (1670; EEBO-TCP), or R. G. 1654, Book II ch. 26',
  '024476:216': 'John Morrice et al., The Rights of War and Peace (1738; Liberty Fund online), or William Evats 1682 (EEBO-TCP), II.10. NOT Campbell 1814 (abridged)',
  '473399:93': 'Richard Eden, The Decades of the Newe Worlde (1555; EEBO-TCP / Arber 1885), Third Decade book I',
  'c8e9d5:505': 'John Healey, Of the Citie of God (1610; EEBO-TCP / archive.org), XIX.23',
  'e93a30:420': 'Philemon Holland, The Historie of the World (1601; EEBO-TCP / penelope.uchicago.edu/holland), XXVIII',
  '0a1afd:87': 'Andrew P. Peabody, Cicero De Officiis (1883; Gutenberg / archive.org), or Cyrus Edmonds (Bohn 1850), II.27-30',
  '09ab64:305': 'W. V. Cooper, The Consolation of Philosophy (1902; CCEL / Gutenberg), V prose 3; or "I. T." 1609',
  '6b7fa9:358': 'Joseph Gwilt, The Architecture of Marcus Vitruvius Pollio (1826; LacusCurtius), X.6 (Gwilt numbers chapters differently: look for the water-screw)',
  '067a81:98': 'Richard Challoner, The Following of Christ (1737), or Croft & Bolton (1940, CCEL — check licence), III.3',
  '866ee7:452': 'Thomas Lodge, The Workes of Lucius Annaeus Seneca (1614; EEBO-TCP), Naturall Questions VII.25',
};

const rows = [...readJsonl(opt('t2')), ...readJsonl(opt('t1'))];
const key = (r) => `${String(r.book_id).slice(-6)}:${r.page_number}`;
const picked = rows.filter((r) => HINTS[key(r)] && !r.reference_meta.private);
const missing = Object.keys(HINTS).filter((k) => !rows.some((r) => key(r) === k));
if (missing.length) { console.error(`hint keys with no record: ${missing.join(', ')}`); process.exit(1); }
const items = picked.map((r) => ({
  id: itemId(r), track: r.track, lang: r.lang, work: r.work || r.book?.title || r.title || null,
  a: { title: r.reference_meta.title, translator: r.reference_meta.translator, year: r.reference_meta.year, located: r.reference_meta.located, url: r.reference_meta.url || null, style: r.reference_meta.style },
  b_hint: HINTS[key(r)], source_text: r.source_text, a_text: r.reference_text,
}));
fs.mkdirSync(OUT, { recursive: true });
const groups = [];
for (let g = 0; g * GROUP < items.length; g++) {
  const G = String.fromCharCode(65 + g);
  writeJsonl(path.join(OUT, `in-${G}.jsonl`), items.slice(g * GROUP, (g + 1) * GROUP));
  groups.push({ group: G, ids: items.slice(g * GROUP, (g + 1) * GROUP).map((x) => x.id) });
}
fs.writeFileSync(path.join(OUT, 'selected.json'), JSON.stringify({ n: items.length, by_lang: Object.fromEntries(['Greek', 'Latin'].map((l) => [l, items.filter((x) => x.lang === l).length])), not_selected: rows.length - items.length, groups }, null, 1));
console.log(`${items.length} pages with a candidate second translator (of ${rows.length}) → ${groups.length} groups in ${OUT}`);
