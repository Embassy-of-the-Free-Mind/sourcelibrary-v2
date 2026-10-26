// PRIOR ART: .claude/docs/concept-aliases/add-daimon-2026-10-12.mjs — adds ONE hand-judged node
// with the same mechanical guards; this is the same method for a theme of thirteen nodes, so it
// carries a table per concept instead of one. finalize-2026-09-11.mjs needs the bridge index.
//
// The psychoactives theme (#7398). Candidates: the period vocabulary a research session met while
// tracing visionary plants through the corpus (Sahagún, Costa, Orta/Clusius, Belon, Weyer,
// Krasheninnikov, Bibra), plus the spellings the corpus itself uses. Evidence: for each candidate,
// the first rows of GET /api/search?pages_only=true&q=<term> on 2026-10-26, read by the judging
// session (Claude Opus, one judge, no second judge) against JUDGE-RUBRIC.md. Search is fuzzy, so a
// term whose rows were mostly other words (Korean names for "bang", a Nubian temple for "dakka")
// is rejected or kept to `related`, whatever the dictionaries say.
//
//   node .claude/docs/concept-aliases/add-psychoactives-2026-10-26.mjs <evidence.jsonl>   # rebuilds both files
import fs from 'node:fs';

const HERE = new URL('.', import.meta.url);
const DATA = new URL('../../../src/data/concept-aliases.json', HERE);
const OUT = new URL('verdicts-psychoactives-2026-10-26.jsonl', HERE);
const THEME = 'psychoactives';
const FLOOR = 0.7;
const MESO = 'Native American & Mesoamerican';

// concept → { tradition?, stem?, V: [term_key, tier, confidence, reason] }
const NODES = {
  opium: { V: [
    ['opium', 'variant', 0.95, 'Headword: Bibra "Opium"; Browne 1799 "Opium (Ar. Aphiúm) ... carried to excess in Constantinople".'],
    ['opio', 'variant', 0.9, 'Latin ablative / Spanish form: Costa "Del Opio"; Brunfels "cum Opio ... makes the sick rest and sleep".'],
    ['ὄπιον', 'variant', 0.9, 'The Greek word: Opiologia 1739 "Opium ... dictum ὄπιον, ἀπὸ τοῦ ὀποῦ"; Pseudo-Galen "opium ὄπιον (opion)".'],
    ['افيون', 'variant', 0.9, 'Arabic afyūn: Clusius Exotica "The Arabs use the Greek word Ofiun ... افيون"; Avicenna\'s Canon recipes.'],
    ['afyun', 'variant', 0.85, 'Transliteration of افيون: Storehouse of Medicaments "this is called afyun opium"; a Persian medical recueil.'],
    ['afyūn', 'variant', 0.75, 'Diacritic transliteration: Avicenna\'s Canon "afyūn opium"; one row is an index entry, so the floor is close.'],
    ['ofiom', 'variant', 0.8, 'Costa 1578: "Why the Arabs call Opium Ofiom"; Opiologia on the name.'],
    ['amfiam', 'equivalent', 0.8, 'Orta\'s Indo-Portuguese name: Colóquios "bangue ... and what is called amfiam opium"; Venette "Maslach of the Turks ... Amfiam".'],
    ['鴉片', 'variant', 0.9, 'Chinese yāpiàn: Haiguo tuzhi on "the ban on opium" and "the Evils of the Opium Trade"; Wuli xiaoshi on collecting the latex.'],
    ['阿片', 'equivalent', 0.7, 'The other CJK spelling; its rows are weaker (a 阿芙蓉 entry, a Bengali opium recipe), so labelled, not silent.'],
    ['aphion', 'related', 0.65, 'Monardes "the Turks use this Aphio ... they take the Aphion and sleep", but the other rows are Greek lexicon noise (apheidia, Ophion).'],
    ['masschlach', 'related', 0.65, 'Weyer 1568: "The common Turks call it Masschlach"; the Turkish opium electuary (maslach), not the drug itself, and the other rows are fuzzy noise.'],
    ['laudanum', 'related', 0.85, 'A preparation: Croll "Laudanum, or Nepenthes"; Cooke on laudanum habits. Not every laudanum held opium.'],
    ['papaver', 'related', 0.8, 'The plant: Herbarius 1485 "Papaver magsamen"; Dioscorides commentaries.'],
    ['poppy', 'related', 0.8, 'The plant, mostly garden and field poppies in the rows (Hill, Parkinson).'],
    ['meconium', 'reject', 0.85, 'Ancient name for poppy juice, but every row here is the infant\'s first stool (Portal, Aristotle, Wepfer).'],
  ] },
  cannabis: { V: [
    ['cannabis', 'variant', 0.95, 'Headword: Seidenschnur 1803 on intoxicating preparations; Dioscorides "Cannabis hemp"; Bibra "Cannabis indica".'],
    ['κάνναβις', 'variant', 0.9, 'The Greek word: Dioscorides (Wellmann) "κάνναβις· φυτὸν εὔχρηστον τῷ βίῳ"; glossaries.'],
    ['大麻', 'variant', 0.8, 'Chinese dàmá, hemp: Sancai tuhui, Zhiwu mingshi tukao "Hemp original: 大麻". Mostly the fibre and seed plant.'],
    ['hemp', 'equivalent', 0.75, 'The English name of the same plant (herbals "Canapus Hemp"), though most rows are about fibre; labelled.'],
    ['bangue', 'equivalent', 0.85, 'The Indo-Portuguese name: Orta/Clusius "DE BANGVE ... almost similar to Hemp"; Costa\'s chapter; Baudelaire "in India, bangie".'],
    ['bhang', 'equivalent', 0.85, 'The Hindi name: Indian Hemp Drugs Commission "Another preparation of the bhang is majum"; O\'Shaughnessy.'],
    ['ganja', 'equivalent', 0.8, 'Hemp Drugs Commission "the most recent work on ganja"; Rumphius "Ganja sativa ... similarity with Cannabis".'],
    ['hashish', 'equivalent', 0.8, 'The resin preparation under its Arabic name: Moreau "On Hashish and Mental Alienation"; Baudelaire; Bibra.'],
    ['haschisch', 'equivalent', 0.8, 'German/French spelling: Bibra "Haschisch. Cannabis indica"; de Sacy on the Haschischin.'],
    ['hachisch', 'equivalent', 0.8, 'French spelling: Moreau de Tours "les feuilles du hachisch"; Leclerc\'s Histoire de la médecine arabe.'],
    ['gunjah', 'related', 0.65, 'O\'Shaughnessy\'s spelling of ganja, but Sanskrit guñjā (the Abrus seed weight) shares it in Lilavati and the Brihat Samhita.'],
    ['churrus', 'related', 0.8, 'The hand-gathered resin: O\'Shaughnessy and Bibra "A resin then sweats from the leaves ... called Churrus". A preparation.'],
    ['charas', 'related', 0.6, 'The same resin (Hemp Drugs Commission "By smoking charas"), but other rows are a Latin dictionary and Hebrew.'],
    ['axix', 'related', 0.65, 'Costa: "The Arabs call this Bangue, Axix"; the other rows are Latin axis.'],
    ['bang', 'reject', 0.9, 'Rows are Korean personal names (Bang-seok, Bang-u) and Maya vocabulary.'],
    ['dakka', 'reject', 0.8, 'Rows are the Nubian temple at Dakka and Yoruba vocabulary; one Cooke row on the dakka pipe.'],
    ['asarath', 'reject', 0.9, 'Costa\'s Turkish name, but every row is a biblical name list or a necromantic handbook.'],
    ['bengi', 'reject', 0.85, 'Seidenschnur\'s Persian "Bengi", but Tragus gives Bengi as Averroes\' name for white hellebore, and a Bantu kinship term.'],
  ] },
  henbane: { V: [
    ['henbane', 'variant', 0.95, 'Headword: Bauhin "Hyoscyamus ... Bilsenkraut"; Brunfels\' Hyoscyamus rhapsody; the Albertus herbal.'],
    ['hyoscyamus', 'equivalent', 0.95, 'Latin name: Brunfels "On Hyoscyamus ... Henbane"; Dioscorides commentaries; Bauhin.'],
    ['hyoscyami', 'equivalent', 0.9, 'Genitive of hyoscyamus: Gesner\'s commentaries, a Bengal dispensatory, Weyer\'s henbane juice.'],
    ['ὑοσκύαμος', 'equivalent', 0.9, 'Greek: Brunfels "NOMENCLATURES Greek, ὑοσκύαμος"; Dioscorides (Wellmann) "Henbane original".'],
    ['bilsenkraut', 'equivalent', 0.9, 'German: the Albertus herbal "Henbane (Bilsam-Kraut)"; Bauhin "All. Bilsenkraut".'],
    ['bilsam', 'equivalent', 0.75, 'Older German: Hildegard\'s Physica "henbane (that is bilsam)"; one noise row (Llull letter tables).'],
    ['jusquiame', 'equivalent', 0.9, 'French: Bauhin "Franç. Jusquiame jaune"; Flora of Switzerland "la Jusquiame noire".'],
    ['insana', 'reject', 0.9, 'Herba insana is a Latin name for henbane, but every row is the adjective "mad" (Cicero, Statius, the Charaka).'],
  ] },
  mandrake: { V: [
    ['mandrake', 'variant', 0.95, 'Headword: Frazer "Jacob and the Mandrakes"; Bauhin "MANDRAKE Male"; Mattioli\'s female mandragora.'],
    ['mandragora', 'variant', 0.9, 'Latin form of the same word: Bauhin, the 1486 Latin herbal, Lémery.'],
    ['μανδραγόρας', 'variant', 0.9, 'Greek: Dioscorides 1499 "drunk with wine ... deceives people by creating brave visions"; Plutarch on cooling drugs.'],
    ['mandragore', 'variant', 0.85, 'French/Latin oblique form: Lémery "Mandragores"; the Apuleius herbal "Name of the Herb: Mandragore".'],
    ['alraun', 'equivalent', 0.85, 'German: Fuchs "Mandragora / Alraun"; Grimm "ALRAUN (MANDRAKE)". The word also names the root-manikins, which are still the mandrake.'],
    ['alraune', 'equivalent', 0.85, 'Plural/variant of Alraun, same rows (Horst\'s Zauberbibliothek, Grimm).'],
    ['dudaim', 'related', 0.8, 'The Hebrew plant of Genesis 30, read as mandrakes (Fuchs, Scheuchzer), but its identification is disputed in the rows themselves.'],
  ] },
  belladonna: { V: [
    ['belladonna', 'variant', 0.95, 'Headword: Fuchs "De Malis insanis ... Belladonna"; Mattioli "HERB BEAUTIFUL LADY"; Cooke on the name.'],
    ['tollkirsche', 'equivalent', 0.8, 'German: Flora of Switzerland "Wolfskirsche, Tollkraut deadly nightshade"; Fuchs "Dollöpffel".'],
    ['dwale', 'equivalent', 0.8, 'Old English: Gerard "Solanum Lethale. Dwale, or deadly Nightshade"; Parkinson.'],
    ['atropa', 'related', 0.7, 'The Linnaean genus (Atropa belladonna, but also Atropa mandragora in the Encyclopédie), and a cipher-table row in Trithemius.'],
    ['solanum somniferum', 'related', 0.8, 'Porta\'s and Weyer\'s ointment ingredient, "sleepy nightshade" (Parkinson, Bauhin); not certainly belladonna.'],
    ['solanum manicum', 'related', 0.75, 'The "mad-making nightshade" of Dioscorides, identified with datura or belladonna by different herbalists.'],
    ['strychnos manicus', 'related', 0.7, 'Faber\'s "Strychnomania" on belladonna poisoning; Strychnos is also the nux-vomica genus (Rumphius rows).'],
    ['nightshade', 'related', 0.7, 'The family name in English: common, sleepy and deadly nightshade are different plants in Parkinson.'],
  ] },
  datura: { V: [
    ['datura', 'variant', 0.95, 'Headword: Orta\'s Colóquios; Bibra "Datura stramonium. Datura metel"; Fuchs "Datura Stramonia".'],
    ['stramonium', 'equivalent', 0.9, 'Latin: Fuchs "Datura Stramonia, or Spiny Apple"; Hernández "Tlapatl, Stramonium"; Cooke.'],
    ['thorn-apple', 'equivalent', 0.85, 'English: Cooke "very common species of thorn-apple over the peninsula of India"; Tabernaemontanus.'],
    ['dutroa', 'equivalent', 0.85, 'Indo-Portuguese: Rumphius "By the Portuguese, it is called Dutroa"; Linschoten "Of the herb Dutroa".'],
    ['dutra', 'equivalent', 0.7, 'Rumphius "the folly excited by the Dutra"; other rows are a Provençal glossary and a Brazilian novel.'],
    ['tlapatl', 'equivalent', 0.85, 'Nahuatl: Sahagún "tlapatl ... drives them mad permanently"; Hernández "Tlapatl, Stramonium".'],
    ['chamico', 'equivalent', 0.7, 'Quechua/Peruvian: Cobo "Of the Chamico", the datura of Peru; one noise row in Chwolsohn.'],
    ['toloache', 'related', 0.6, 'The Mexican name; no row shows the word itself (Cooke on dhatoora, Maya boundary texts).'],
    ['曼陀羅', 'related', 0.6, 'Li Shizhen\'s datura ("drunk, it makes people laugh and dance"), but the same characters are the Buddhist mandārava flower in the Lotus Sutra.'],
  ] },
  ololiuhqui: { tradition: MESO, V: [
    ['ololiuhqui', 'variant', 0.95, 'Headword: Sahagún XI.7 "seed called ololiuhqui ... intoxicates and drives people mad"; the 1634 Confessionario.'],
    ['ololiuqui', 'variant', 0.95, 'Spelling: Hernández "Cap. XIV. Ololiuqui"; Sahagún.'],
    ['coatl xoxouhqui', 'equivalent', 0.85, 'Sahagún\'s other name for the plant: "an herb called coatl xoxouhqui ... a seed called ololiuhqui".'],
    ['morning glory', 'related', 0.6, 'The plant family (Chinese qianniuzi seed); most rows are poetry and Chinese materia medica.'],
  ] },
  peyote: { tradition: MESO, V: [
    ['peyote', 'variant', 0.95, 'Headword: Klüver "Peyote is the general commercial term"; Dorsey on the Arapaho rite.'],
    ['peyotl', 'variant', 0.95, 'Nahuatl: Sahagún "called peyotl ... frightful visions, or laughable ones"; the 1634 Confessionario.'],
    ['mescal buttons', 'equivalent', 0.85, 'Klüver "the misleading name mescal buttons"; Prentiss & Morgan 1895.'],
    ['anhalonium', 'equivalent', 0.8, 'The old genus: "Anhalonium Lewinii (Mescal Buttons)"; Crowley\'s rows use it for peyote too.'],
    ['mescal', 'related', 0.6, 'Also the agave and its liquor (Zuni Breadstuff on mescal roasting); only some rows mean peyote.'],
  ] },
  teonanacatl: { tradition: MESO, V: [
    ['teonanacatl', 'variant', 0.95, 'Headword: Sahagún XI "Those who eat them see visions and feel a faintness of heart".'],
    ['nanacatl', 'related', 0.8, 'Nahuatl "mushroom" in general: the merchants\' feast "small black mushrooms, which they call nanacatl"; chimalnanacatl.'],
  ] },
  'fly agaric': { V: [
    ['fly agaric', 'variant', 0.95, 'Headword: Bibra "Fly Agaric. Amanita muscaria"; Bulliard; Hussey.'],
    ['amanita muscaria', 'equivalent', 0.95, 'Latin binomial: Gleditsch 1753; Persoon\'s Synopsis; Bibra.'],
    ['agaricus muscarius', 'equivalent', 0.95, 'Linnaean name: Sowerby "AGARICUS MUSCARIUS"; Cooke "FLY MUSHROOM. Agaricus (Amanita) muscarius".'],
    ['fungus muscarius', 'equivalent', 0.85, 'Pre-Linnaean Latin: Sterbeeck "Fungus muscarius miniatus"; Schaeffer "the fungus muscarius (fly-fungus)".'],
    ['fliegenpilz', 'equivalent', 0.85, 'German: Lenz\'s mycology "the Fly Agaric (Fliegenpilz)".'],
    ['muchumor', 'equivalent', 0.8, 'Russian, as the Siberian trade name: Strahlenberg 1738 "called, in the Russian Tongue, Muchumor"; Bibra.'],
    ['mukhomor', 'reject', 0.5, 'No row prints this spelling; all hits are fuzzy matches on the Latin names.'],
  ] },
  cohoba: { tradition: MESO, V: [
    ['cohoba', 'variant', 0.95, 'Headword: Eden\'s Decades "pouder of the herbe cauled Cohobba ... they see the"; Pané in Brasseur\'s Landa; Kircher.'],
    ['cagioba', 'equivalent', 0.85, 'Pané\'s spelling: "the vision he had in the intoxication of the cagioba, which he inhaled".'],
    ['yopo', 'related', 0.6, 'The Orinoco snuff from the same tree (Cooke, after Humboldt); other rows are a Korean place name.'],
    ['cojoba', 'reject', 0.85, 'Rows are alchemical "cohob" (redistillation) and catechu, not the snuff.'],
  ] },
  darnel: { V: [
    ['darnel', 'variant', 0.95, 'Headword: Mattioli "Darnel ... notorious for its ability to intoxicate"; Lyte "Of Iuray or Darnell".'],
    ['lolium', 'equivalent', 0.75, 'Latin: Dioscorides "On Lolium (Darnel)"; Lémery. The genus also holds ryegrass (Flora of Switzerland), so labelled.'],
    ['ivraie', 'equivalent', 0.8, 'French: Nynauld "darnel original: ivraie"; Dodoens; one row is the parable of the tares.'],
    ['taumellolch', 'equivalent', 0.85, 'German "reeling darnel": Tabernaemontanus "Lulch. Lolium"; Alexander of Tralles.'],
    ['zizania', 'related', 0.7, 'The tares of the Gospel parable (Ortus sanitatis "Zizania tares/darnel"), and Chinese wild rice.'],
    ['tares', 'related', 0.6, 'Almost every row is the parable of the wheat and the tares.'],
  ] },
  "witches' ointment": { V: [
    ["witches' ointment", 'variant', 0.95, 'Headword: Scot "ointments made and used for the transportation of witches"; Murray; Nynauld.'],
    ['witches ointment', 'variant', 0.9, 'Unpunctuated form of the headword, same rows.'],
    ['lamiarum unguenta', 'equivalent', 0.9, 'Porta 1560 "Lamiarum vnguenta"; Godelmann quoting Porta; the index of Weyer\'s De praestigiis.'],
    ['unguenta lamiarum', 'equivalent', 0.9, 'Word order of the same phrase: Porta, Godelmann, Guazzo.'],
    ['hexensalbe', 'equivalent', 0.9, 'German: Soldan "Woraus dann die Hexensalbe gemacht"; Grimm "die gewöhnliche hexensalbe".'],
    ['flying ointment', 'equivalent', 0.85, 'Modern English: Summers "that flying ointment"; Murray; Hansen\'s Quellen.'],
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
for (const [concept, { tradition, V }] of Object.entries(NODES)) {
  const stem = fold(concept).replace(/[^a-z]/g, '').slice(0, 4);
  const entry = { concept, theme: THEME, ...(tradition ? { tradition } : {}), variants: [], equivalents: [], related: [], rejected: 0 };
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

data._meta.psychoactives = '2026-10-26: thirteen concepts (theme "psychoactives") for #7398 — candidates from the period vocabulary of a visionary-plants research session, each checked against live keyword-search rows by one Claude judge; .claude/docs/concept-aliases/add-psychoactives-2026-10-26.mjs';
fs.writeFileSync(DATA, JSON.stringify(data, null, 1) + '\n');
if (evPath) fs.writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
