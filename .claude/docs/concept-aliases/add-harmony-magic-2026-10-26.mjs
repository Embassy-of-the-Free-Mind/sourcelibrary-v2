// PRIOR ART: .claude/docs/concept-aliases/add-psychoactives-2026-10-26.mjs — the same table-per-
// concept builder (0.7 floor, stem retag, cross-concept clash guard); this adds per-node themes.
// Candidates for the harmony nodes come from the harmony-kb lexicon (JDerekLomas/harmony-kb,
// ideas/lexicon.md), which keeps harmony, concord, consonance and resonance apart on purpose:
// folding concordia into harmony is the Spinoza/Kropotkin translation trap that page documents.
//
// Nine concepts (#7408): harmony, concord, consonance, music of the spheres, resonance (theme
// "harmony"); sympathy, magic, natural magic, doctrine of signatures (theme "magic"). Evidence: for
// each candidate, the first rows of GET /api/search?pages_only=true&q=<term> on 2026-10-26, read by
// the judging session (Claude Opus, one judge, no second judge) against JUDGE-RUBRIC.md.
//
//   node .claude/docs/concept-aliases/add-harmony-magic-2026-10-26.mjs <evidence.jsonl>   # rebuilds both files
import fs from 'node:fs';

const HERE = new URL('.', import.meta.url);
const DATA = new URL('../../../src/data/concept-aliases.json', HERE);
const OUT = new URL('verdicts-harmony-magic-2026-10-26.jsonl', HERE);
const FLOOR = 0.7;

// concept → { tradition?, stem?, V: [term_key, tier, confidence, reason] }
const NODES = {
  harmony: { theme: 'harmony', V: [
    ['harmony', 'variant', 0.95, 'Headword: "OF HARMONY AND MELODY" (Hindu Music); Schelling "Harmony Melody Rhythm"; Capella\'s Harmonia.'],
    ['harmonious', 'variant', 0.85, 'Adjective: Pernety "Magnete Naturæ Sympathicè Harmonico"; the Peiwen yunfu entry for 和 rendered "Harmonious".'],
    ['harmonia', 'variant', 0.95, 'Latin/Greek transliteration: Kircher\'s Ars magna consoni "harmonic temperament of all things"; Capella.'],
    ['ἁρμονία', 'variant', 0.95, 'The Greek word: Philo index "ἁρμονία harmony"; a Byzantine miscellany "πᾶσα πόλις ἁρμονία τίς ἐστιν".'],
    ['harmonie', 'variant', 0.9, 'French/German: Kepler\'s Opera index "Harmony of aspects"; Harmonices mundi V.'],
    ['armonia', 'variant', 0.75, 'Italian: rows render "Harmony"; one row is Boccaccio\'s Armonia, daughter of Gelo, a person.'],
    ['гармония', 'variant', 0.7, 'Russian loan of ἁρμονία: Eckartshausen in Russian "Supreme harmony ... like musical tones"; the other rows are fuzzy English.'],
    ['和諧', 'equivalent', 0.7, 'Chinese héxié: the Pianzi leibian heading "Harmony of the Multitudes"; weak rows, so labelled.'],
    ['Zusammenstimmung', 'equivalent', 0.7, 'German "tuning together", Wolff\'s and Kant\'s word for harmony (harmony-kb lexicon); the rows are Swedenborg and Meier on Disharmonie.'],
    ['συναρμογή', 'related', 0.8, 'A fitting-together, the joinery root of harmonia: Iamblichus\'s Nicomachus "συναρμογά τις a certain harmony". A translation trap, not the word.'],
    ['Einklang', 'related', 0.75, '"One-sound", unison: Gleichen "Einklang unison or resonance"; Eckartshausen "strings tuned alike". The foil to harmony, not harmony.'],
    ['太和', 'related', 0.8, 'Supreme Harmony, a name for the Way (Zhang Zai), and the Hall of Supreme Harmony (Doré). A specific concept, not the general word.'],
    ['iʿtilāf', 'reject', 0.9, 'Every row is ikhtilāf, disagreement (Nev\'î "The Science of Disagreement"; the Manār commentary on consensus).'],
  ] },
  concord: { theme: 'harmony', V: [
    ['concord', 'variant', 0.95, 'Headword: Aristotle NE IX.6 "CONCORD likewise appears to pertain to friendship"; the Paradise of the Soul chapter on Concord.'],
    ['concordia', 'variant', 0.95, 'Latin: Alciato\'s emblem CONCORDIA; Wissowa on the cult of Concordia; Albert\'s De concordia.'],
    ['concorde', 'variant', 0.8, 'French: Omnis ars "concord is a union"; one row is the concordat with Rome.'],
    ['ὁμόνοια', 'equivalent', 0.9, 'Greek "same mind": Beza\'s lexicon "ὁμονοέω I agree"; the Corona glossary "concordia ... ὁμόνοια".'],
    ['homonoia', 'equivalent', 0.9, 'Transliteration: Aristotle MS "a definition of concord homonoia"; a Greek-Latin dictionary.'],
    ['Eintracht', 'equivalent', 0.8, 'German: Alciato\'s "Insurmountable Concord"; masonic lodge names.'],
    ['Übereinstimmung', 'related', 0.65, 'Agreement or correspondence in general (Lipps, Jaspers); concord only in some rows.'],
    ['согласие', 'related', 0.65, 'Russian co-voicing: rows are "by common consent" and Khomyakov; consent as often as concord (harmony-kb lexicon trap 1).'],
    ['concordance', 'related', 0.75, 'Llull\'s concordantia "needs plurality" and Bible concordances (Glauch): a homograph split.'],
  ] },
  consonance: { theme: 'harmony', V: [
    ['consonance', 'variant', 0.95, 'Headword: Euler\'s Tentamen on degrees of harmony; Mersenne; Bragdon "THE LAW OF CONSONANCE".'],
    ['consonantia', 'variant', 0.9, 'Latin: Ptolemy\'s Harmonics "the excesses of the consonantiae"; Praetorius.'],
    ['Konsonanz', 'variant', 0.85, 'German: Lipps "Das Wesen der musikalischen Konsonanz"; Autolycus volume "De consonantiis".'],
    ['symphonia', 'equivalent', 0.85, 'Arbeau: "this Greek word symphonia means consonance"; Macrobius "symphoniae consonances"; Guido.'],
    ['συμφωνία', 'equivalent', 0.75, 'Greek, but it also means agreement (Bonitz\'s Aristotle index "uno ore perhibent"); musical rows in Wallis and Meibom.'],
    ['concentus', 'related', 0.65, 'Singing together, the sound of mixed voices (harmony-kb lexicon); the rows are dictionary entries.'],
    ['consonant intervals', 'related', 0.75, 'A phrase for the intervals themselves (Helmholtz, Iamblichus\'s fourth, Bragdon\'s ratios).'],
  ] },
  'music of the spheres': { theme: 'harmony', V: [
    ['music of the spheres', 'variant', 0.95, 'Headword: Cicero\'s Dream of Scipio "this loud and sweet sound"; Macrobius\' commentary; Hall.'],
    ['harmony of the spheres', 'equivalent', 0.9, 'The same idea in other words: Shakespeare quoted "Such harmony is in immortal souls"; Heath on Aristarchus.'],
    ['musica mundana', 'equivalent', 0.9, 'Boethius\'s term: Fludd "On the Music of the Spheres (De Musica mundana)"; Roger Bacon; Agrippa.'],
    ['celestial harmony', 'equivalent', 0.8, 'Ficino "the heavens are composed with harmonic reason and move harmonically"; Beaumont on Apollonius hearing it.'],
    ['harmonia mundi', 'equivalent', 0.75, 'Giorgi\'s De harmonia mundi; Capella. The phrase also means the world\'s harmony in general, so labelled.'],
    ['harmonices mundi', 'related', 0.75, 'Kepler\'s title (Harmonices mundi liber III), a work rather than the concept.'],
    ['sphärenharmonie', 'reject', 0.5, 'No row prints the word; hits are fuzzy matches on Latin and English.'],
    ['musica coelestis', 'reject', 0.6, 'Rows are Hucbald\'s table of contents and Lassus motets ("pleni sunt coeli"), not the concept.'],
  ] },
  sympathy: { theme: 'magic', V: [
    ['sympathy', 'variant', 0.9, 'Headword in the cosmological sense (Libavius, Saltzmann); many English rows mean compassion (The Mental Cure), which the related list does not fix.'],
    ['sympathia', 'variant', 0.95, 'Latin: Saltzmann\'s De sympathia "two things joined by a bond of love"; the 1665 disputation on occult qualities.'],
    ['sympatheia', 'variant', 0.9, 'Transliteration: Scott\'s Hermetica notes "sympathy toward the second god"; Plotinus.'],
    ['συμπάθεια', 'variant', 0.9, 'Greek: Libavius "The word συμπαθείας is used differently by physicians and natural philosophers"; Sextus in Scott.'],
    ['sympathie', 'variant', 0.85, 'French/German: Reinhardt\'s Kosmos und Sympathie cited by Bidez; Eckartshausen; also human sympathy (Nudow).'],
    ['antipathy', 'related', 0.85, 'The opposite pole: Goclenius "Antipathy ... consensus"; Sibly\'s Key to Physic.'],
    ['antipathia', 'related', 0.85, 'Latin: Libavius "DE ANTIPATHIA QVADAM RARA"; Erasmus Francisci on sympathies and antipathies.'],
    ['sympathy and antipathy', 'related', 0.8, 'The paired doctrine: Meindl\'s disputation "What is the cause of Antipathy and Sympathy?"; the Geoponika book XV.'],
    ['occult qualities', 'related', 0.8, 'The scholastic explanation sympathy was filed under: Charleton "OCCULT QUALITIES made MANIFEST"; the Diadem of the Sages.'],
    ['qualitates occultae', 'related', 0.8, 'Latin: the 1665 Disputatio qua qualitates occultae; Thomasius.'],
  ] },
  resonance: { theme: 'harmony', V: [
    ['resonance', 'variant', 0.95, 'Headword: Helmholtz "PHASES OF WAVES CAUSED BY RESONANCE"; Tyndall "CONDITIONS OF RESONANCE"; Tesla.'],
    ['resonantia', 'variant', 0.85, 'Latin: Augustine De musica commentary; Kircher\'s Magnes "magnetism of music".'],
    ['Resonanz', 'variant', 0.9, 'German: Helmholtz "Analysis of sounds by sympathetic resonance"; Tesla in German.'],
    ['sympathetic vibration', 'equivalent', 0.85, 'Tyndall "SYMPATHETIC VIBRATIONS"; Schott "Sympathetic harmony through a Musical instrument"; Malcolm on Galileo.'],
    ['同聲相應', 'equivalent', 0.85, 'Yijing "Like sounds respond to each other" (Lülü chanwei); the Huainanzi strings: strike the gong and the other gong answers.'],
    ['感應', 'equivalent', 0.75, 'Stimulus and response (ganying): Zhu Xi "like wind comes, the tree moves"; Liu Zongzhou "resonance and response".'],
    ['ganying', 'related', 0.65, 'Transliteration of 感應; most rows are the Taishang ganying pian title and Legge\'s bibliography.'],
    ['mitklingen', 'related', 0.6, 'German "sounding with": Helmholtz and Chladni rows, but only partly the word.'],
    ['echo', 'related', 0.6, 'Reflected sound, not answering vibration (Schott on Echo, Bacon\'s Sylva); also the nymph.'],
    ['strings resonate', 'reject', 0.5, 'A search phrase, not a term.'],
    ['unison strings', 'reject', 0.5, 'A search phrase, not a term.'],
  ] },
  magic: { theme: 'magic', V: [
    ['magic', 'variant', 0.95, 'Headword: Thorndike "Definition of magic"; Böhme\'s Clavis "The Magia, or Magic, is the Spirit of the Will".'],
    ['magia', 'variant', 0.95, 'Latin: Abramelin "what the true Magia is"; Porta "What Magia means by name"; Summum bonum.'],
    ['magie', 'variant', 0.9, 'French/German: Doutté "Magie et religion"; Windelband.'],
    ['μαγεία', 'variant', 0.8, 'Greek: Lectius\' dissertation on Eusebius "MAGIC"; Psellus\' Chronographia "used ... for magic". One row is an amulet book.'],
    ['Zauberei', 'equivalent', 0.85, 'German: Paracelsus "Sorcery original: Zauberey is also good and highly esteemed"; Bodin\'s Demonomania.'],
    ['سحر', 'equivalent', 0.85, 'Arabic siḥr: Wellhausen "The Arabic term for magic is sihr"; the Infancy Gospel "manifest sorcery".'],
    ['sihr', 'equivalent', 0.85, 'Transliteration: Wellhausen; Doutté "Islamisation of magic"; Zwemer.'],
    ['sorcery', 'related', 0.8, 'The malefic branch: Lea "SORCERY AND OCCULT ARTS"; Bodin. Narrower than magic.'],
    ['goetia', 'related', 0.85, 'Agrippa "ON GOETIA AND NECROMANCY"; the Lesser Key. A kind of magic.'],
    ['witchcraft', 'related', 0.8, 'The 1736 Witchcraft Act; Talbot "OJJE OR WITCHCRAFT". Adjacent, and a legal category.'],
    ['enchantment', 'related', 0.75, 'Lévi "ENCHANTMENTS AND SPELLS"; Swedenborg. A kind of magical act.'],
    ['巫術', 'related', 0.7, 'Chinese shamanic arts: de Groot "SORCERY AMONG THE NATIVES OF HAINAN"; leishu entries on 巫.'],
  ] },
  'natural magic': { theme: 'magic', V: [
    ['natural magic', 'variant', 0.95, 'Headword: Agrippa "ON NATURAL MAGIC ... the highest peak of natural philosophy"; Barrett\'s Magus; Porta.'],
    ['magia naturalis', 'variant', 0.95, 'Latin title of Porta\'s and Hildebrand\'s books; Posner.'],
    ['magie naturelle', 'equivalent', 0.9, 'French: the 1571 Magie naturelle; the French Agrippa.'],
    ['natürliche Magie', 'equivalent', 0.75, 'German: the Rosicrucian Exposed "natural magic and ... divine magic"; rows show the sense more than the spelling.'],
    ['occult philosophy', 'related', 0.8, 'Agrippa\'s frame, wider than natural magic (it adds celestial and ceremonial magic).'],
    ['philosophia occulta', 'related', 0.8, 'Latin title of Agrippa; Holberg\'s satire.'],
    ['secrets of nature', 'related', 0.7, 'The books-of-secrets genre (Lemnius, Alexis): adjacent, often the same content.'],
  ] },
  'doctrine of signatures': { theme: 'magic', V: [
    ['doctrine of signatures', 'variant', 0.95, 'Headword: Croll\'s "ON SIGNATURES"; Gaffarel\'s Curiosities on Crollius.'],
    ['signatura rerum', 'equivalent', 0.95, 'Böhme\'s De signatura rerum; Paracelsus "DE SIGNATVRA RERVM Naturalium".'],
    ['signatures of things', 'equivalent', 0.85, 'English Böhme "Signatura Rerum: or the signature of all things"; Henry More.'],
    ['signatura', 'related', 0.7, 'Mostly Böhme and Paracelsus, but also the printer\'s signature (Beardsley).'],
    ['Signatur', 'related', 0.6, 'Paracelsus\' Astronomia magna on the kinds of signature; other rows are seals and blank pages.'],
    ['signatures', 'reject', 0.85, 'Rows are signed documents and gathering signatures (Huexotzingo, Ximénez).'],
  ] },
};

const fold = (s) => s.normalize('NFC').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
const nonLatin = (s) => /[^\p{Script=Latin}\p{P}\p{N}\s]/u.test(s);
const MALFORMED = (k) => /[()（）]/.test(k) || /^[-–—]\s/.test(k) || /\s[—–]\s/.test(k) || /[:;]/.test(k);

const evPath = process.argv[2];
const evidence = new Map();
if (evPath) for (const l of fs.readFileSync(evPath, 'utf8').trim().split('\n')) { const r = JSON.parse(l); evidence.set(fold(r.q), (r.ev || []).slice(0, 3).map((e) => ({ book_id: e.book_id, page: e.page, snippet_type: e.type, snippet: e.snip }))); }

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const owned = new Map(); // folded term → concept, across the whole file, so no key lands in two concepts
for (const c of data.concepts) if (!(c.concept in NODES)) for (const k of [c.concept, ...c.variants.map((r) => r.term), ...c.equivalents.map((r) => r.term)]) owned.set(fold(k), c.concept);

const out = [];
for (const [concept, { theme, tradition, V }] of Object.entries(NODES)) {
  const stem = fold(concept).replace(/[^a-z]/g, '').slice(0, 4);
  const entry = { concept, theme, ...(tradition ? { tradition } : {}), variants: [], equivalents: [], related: [], rejected: 0 };
  const verdicts = [];
  for (const [term_key, judged, confidence, reason] of V) {
    let tier = judged, note = null;
    const clash = owned.get(fold(term_key)) === concept ? undefined : owned.get(fold(term_key));
    if (tier !== 'reject' && MALFORMED(term_key)) { tier = 'reject'; note = 'malformed key'; }
    else if (tier !== 'reject' && tier !== 'related' && clash) { tier = 'related'; note = `already a key of "${clash}"`; }
    else if ((tier === 'variant' || tier === 'equivalent') && confidence < FLOOR) { tier = 'related'; note = `below ${FLOOR} floor`; }
    else if (tier === 'variant' && !nonLatin(term_key) && !fold(term_key).replace(/[^a-z]/g, '').includes(stem)) { tier = 'equivalent'; note = 'retagged: different-language rendering, expand with label'; }
    verdicts.push({ term_key, verdict: judged, tier, confidence, reason, ...(note ? { note } : {}), ...(evPath ? { evidence: evidence.get(fold(term_key)) || [] } : {}) });
    const row = { term: term_key, confidence, reason, ...(note ? { note } : {}) };
    if (tier === 'variant') entry.variants.push(row);
    else if (tier === 'equivalent') entry.equivalents.push(row);
    else if (tier === 'related') entry.related.push(row);
    else entry.rejected++;
    if (tier === 'variant' || tier === 'equivalent') owned.set(fold(term_key), concept);
  }
  data.concepts = data.concepts.filter((c) => c.concept !== concept).concat(entry);
  out.push({ concept, judged: '2026-10-26', verdicts });
  console.log(concept, { variants: entry.variants.length, equivalents: entry.equivalents.length, related: entry.related.length, rejected: entry.rejected });
}

data._meta.harmony_magic = '2026-10-26: nine concepts (themes "harmony" and "magic") for #7408 — candidates from the harmony-kb lexicon and the occult-philosophy vocabulary, each checked against live keyword-search rows by one Claude judge; .claude/docs/concept-aliases/add-harmony-magic-2026-10-26.mjs';
fs.writeFileSync(DATA, JSON.stringify(data, null, 1) + '\n');
if (evPath) fs.writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
