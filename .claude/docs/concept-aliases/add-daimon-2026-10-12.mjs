// PRIOR ART: .claude/docs/concept-aliases/finalize-2026-09-11.mjs — finalises the eight judges'
// verdicts for the first 62 concepts from a bridge index that lived on one laptop; it cannot add
// a single concept. This applies the same mechanical guards (0.7 floor, stem retag, malformed
// keys) to one hand-judged node whose candidates came from an issue, not from the bridge index.
//
// The daimōn node (#4251). Candidates: the worked node in the feedback behind #4251 (UNTRUSTED —
// every term re-checked), plus the spellings the corpus itself uses. Evidence: for each
// candidate, the first rows of GET /api/search?pages_only=true&q=<term> on 2026-10-12, read by
// the judging session (Claude Opus, one judge, no second judge) against JUDGE-RUBRIC.md.
// A candidate whose rows did not show the sense was rejected whatever the issue said.
//
//   node .claude/docs/concept-aliases/add-daimon-2026-10-12.mjs <evidence.jsonl>   # rebuilds both files
import fs from 'node:fs';

const HERE = new URL('.', import.meta.url);
const DATA = new URL('../../../src/data/concept-aliases.json', HERE);
const OUT = new URL('verdicts-daimon-2026-10-12.jsonl', HERE);
const CONCEPT = 'daimōn';
const FLOOR = 0.7;

// [term_key, tier, confidence, reason]
const V = [
  ['daimon', 'variant', 0.95, 'Transliteration of the headword: Proclus on the Alcibiades, "the daimon is the logos ... it moves everything".'],
  ['daimones', 'variant', 0.9, 'Plural: Proclus, "to make daimones parts of the souls"; scholia gloss "daimones divine beings".'],
  ['δαίμων', 'variant', 0.95, 'The Greek headword: Plotinus, "spirit daimon original: δαίμων ... guiding principle or guardian".'],
  ['δαίμονες', 'variant', 0.9, 'Greek plural: Maximus scholia, "demons original: δαίμονες (daimones)".'],
  ['daemon', 'variant', 0.95, 'Latin spelling of the same word: Ficino "DE ANIMA ET DAEMONE", Iamblichus "the daemon of Socrates".'],
  ['daemons', 'variant', 0.95, 'Plural of daemon: Iamblichus, "the third are the daemons who distribute the actions of divine souls".'],
  ['daemones', 'variant', 0.9, 'Latin plural, same passages as daemons (Iamblichus, Pimander with Proclus).'],
  ['dæmon', 'variant', 0.9, 'Ligature spelling: Asclepius volume, "a divine dæmon spirit or guardian entity".'],
  ['demon', 'equivalent', 0.75, 'The later English rendering of the same word: Psellus "On Demons" in Ficino\'s Iamblichus; many translators keep daemon to avoid its malevolent sense, so label the hit.'],
  ['demons', 'equivalent', 0.75, 'Plural rendering: Maximus scholia translate δαίμονες as "demons"; Aquinas De malo on demons and bodies.'],
  ['démon', 'equivalent', 0.7, 'French rendering: Calmet "Demon (Démon)"; French Ficino "Chasse-Démon Fuga Daemonum".'],
  ['guardian spirit', 'equivalent', 0.75, 'A translator\'s English for daemon in its tutelary sense: Ficino "DE ANIMA ET DAEMONE" rendered "ON THE SOUL AND THE GUARDIAN SPIRIT"; Agrippa III.22.'],
  ['daimonion', 'related', 0.8, 'The neuter/diminutive, a distinct word: Socrates\' divine sign in Plato, "demon" in the Gospels. Adjacent, not the same term.'],
  ['δαιμόνιον', 'related', 0.8, 'Greek of daimonion: Gospel lectionary "the demon original: δαιμόνιον"; Plotinus "guiding spirit".'],
  ['daemonium', 'related', 0.75, 'Latin daimonion: Fernel, "a certain divine thing which he calls a daemonium" (Cicero on Socrates).'],
  ['demonio', 'related', 0.6, 'Latin ablative / Romance form of daemonium: Albertus, "male a demonio vexatur".'],
  ['genius', 'related', 0.8, 'Beaumont: "What the Latins called a Genius, the Greeks called a Daemon"; Perotti "Genius tutelar spirit". Kept out of expansion: the word also means talent (Reuchlin, "genio talent").'],
  ['genii', 'related', 0.8, 'Plural, unambiguous: Boissard after Servius, "when we are born, we obtain two Genii".'],
  ['genie', 'related', 0.7, 'French genius: French Agrippa, "the same genie", glossed personal guardian spirit.'],
  ['cacodaemon', 'related', 0.85, 'The evil daemon specifically: Crater Hermetis "cacodaemon evil spirit"; Agrippa "Cacodaemones evil spirits".'],
  ['kakodaimon', 'related', 0.8, 'Greek of cacodaemon: Plotinus, "the evil daimon, or more kakodaimon".'],
  ['evil spirit', 'related', 0.7, 'English for cacodaemon in Agrippa; also the Babylonian utukku limnu (Thompson). A subclass, and a broad phrase.'],
  ['familiar spirit', 'related', 0.65, 'Beaumont "Familiar Spirits"; Proclus "familiar daemons". The early-modern personal spirit, adjacent.'],
  ['tutelary spirit', 'related', 0.6, 'Used for the daemon (Wilkins) and for Chinese altar spirits (Legge\'s Mencius): two senses under one phrase.'],
  ['shedim', 'related', 0.85, 'Hebrew analogue: Maimonides, "ke-shedim like demons"; Agrippa on demons and the Anakim.'],
  ["se'irim", 'related', 0.8, 'Hebrew analogue: Gikatilla, "the Se\'irim demons or goat-spirits"; Zohar citing Isaiah 13:21.'],
  ['jinn', 'related', 0.9, 'Arabic analogue: Lane, chapter "Demonology. Angels and Jinn"; Hughes on Iblis among the Jinn.'],
  ['jinni', 'related', 0.85, 'Singular of jinn: Conway, "Jinni ... supernatural spirits in Islamic mythology".'],
  ['djinn', 'related', 0.8, 'French/German spelling of jinn: Wellhausen "Spirits and Specters"; de Sacy on the Druze.'],
  ['جن', 'related', 0.65, 'Arabic script jinn (al-Jahiz, "بالجن والشياطين"); the same letters also spell "went mad" in a legal text, so not for expansion.'],
  ['shaitan', 'related', 0.75, 'Qur\'an: "a rebellious Satan (Shaitan)"; a Sanskrit-Persian glossary pairs bhūta-preta-piśāca with Shaitan.'],
  ['shayatin', 'related', 0.85, 'al-Jahiz: "the jinn hidden beings, ghilan ogres/demons, and shayatin devils".'],
  ['ifrit', 'related', 0.8, 'Ikhwan al-Safa: "Efrit, a powerful class of demons among the Genii"; Thousand and One Nights.'],
  ['daeva', 'related', 0.9, 'Avestan analogue: Burnouf, "the stem daeva demon or false god"; the Vendidad is the law against them.'],
  ['daevas', 'related', 0.9, 'Plural: "the Daevas, which in Zoroastrianism are malevolent spirits or false gods" (Kleuker\'s Zend-Avesta).'],
  ['druj', 'related', 0.85, 'Justi\'s Bundahishn: "Druj, name of a class of evil spirits ranking below the Dews"; Darmesteter\'s Druj Nasu.'],
  ['mara', 'related', 0.7, 'Buddhist analogue: Drukpa Kunley, "it is a mara. Do not think that a mara must be something with staring eyes". The string also matches unrelated Latin and Greek.'],
  ['bdud', 'related', 0.9, 'Tibetan for māra: Khamtrul "lha yi bu\'i bdud"; Derge Tengyur "the mara of the aggregates original: phung po\'i bdud".'],
  ["lha 'dre", 'related', 0.75, 'Tibetan gods-and-demons: Drukpa Kunley, "local gods and spirits lha dre cause harm".'],
  ['preta', 'related', 0.75, 'Lotus Sutra: "a yaksha nature spirit, a rakshasa, a preta hungry ghost"; a class of the dead rather than a daimon.'],
  ['asura', 'related', 0.8, 'Shurangama Sutra on the classes of Asura; Burnouf on Zend ahura against Sanskrit asura "spirit/demon".'],
  ['rakshasa', 'related', 0.85, 'Mahabharata: "a wicked-natured Rakshasa, who wishes to devour your flesh"; Ramayana.'],
  ['yaksha', 'related', 0.8, 'Kathasaritsagara: "the Yaksha nature-spirit named Dhumaketu"; guardians of treasure and sacred sites.'],
  ['pishacha', 'related', 0.85, 'Kleuker: "pishacha, evil spirits"; Derge Kangyur rite to summon "all the Pishachas".'],
  ['bhuta', 'related', 0.7, 'Wilkins: "Bhuta ... attendants of Siva, Bhuta Natha Lord of Spirits"; in Abhinavagupta the same word is "element".'],
  ['鬼神', 'related', 0.85, 'Chinese ghosts-and-gods: Wubei zhi, "supernatural manifestations original: 鬼神 (guǐshén)"; Lotus Sutra 天龍鬼神.'],
  ['餓鬼', 'related', 0.75, 'Chinese for preta: Lotus Sutra "hungry ghosts"; Chinŏnjip "Mantra for Summoning Hungry Ghosts".'],
  ['귀신', 'related', 0.7, 'Korean gwisin: Kukcho kosa, a face "like a ghost (귀신)". One vernacular row only.'],
  ['oni', 'related', 0.65, 'Thunberg: "Oni is the name for a Devil". Three letters, so it also matches inside unrelated words.'],
  ['dämon', 'reject', 0.3, 'No German row: every hit was a fuzzy match on Latin daemon.'],
  ['agathodaemon', 'reject', 0.8, 'In this corpus a proper name: the legendary alchemical author, and a toast in Aristophanes.'],
  ['eudaimonia', 'reject', 0.9, 'Happiness / flourishing (Maximus, Plotinus). Shares the root, not the sense.'],
  ['numen', 'reject', 0.8, 'Divine power or will (Kircher, "outflow of the Numen"); no row uses it for a daimon.'],
  ['שדים', 'reject', 0.8, 'Homograph: the rows are "breasts" (Complutensian Polyglot) and "ploughed fields" (Pagnini).'],
  ['sheidim', 'reject', 0.4, 'Rows match se\'irim and Ishim passages, not this spelling.'],
  ['iblis', 'reject', 0.95, 'A proper name (rubric rule 2).'],
  ['marid', 'reject', 0.9, 'No row in the sense: a recipe ingredient, a coin legend.'],
  ['klesha', 'reject', 0.9, 'Mental afflictions, not beings (Nagarjuna, Yoga Philosophy).'],
  ['gdon', 'reject', 0.5, 'No Tibetan row: hits were fuzzy matches in Greek Gospels.'],
  ['gcod', 'reject', 0.8, 'A practice (Chöd, "cutting"), and the same syllable in the Diamond Cutter\'s title.'],
  ['鬼', 'reject', 0.5, 'Single character: the search returns nothing for it alone, and it occurs in every compound.'],
  ['神', 'reject', 0.9, 'God or spirit in general, and a single character.'],
  ['도깨비', 'reject', 0.6, 'No Korean row: the three hits are Chinese divination pages.'],
  ['yokai', 'reject', 0.5, 'No row uses the word; hits are tales of fox and cat spirits.'],
  ['dev', 'reject', 0.9, 'Abbreviation noise ("Dev." for Devatā-saṃyutta, "Devotion").'],
  ['devs', 'reject', 0.95, 'Latin DEVS, God.'],
  ['dews', 'reject', 0.95, 'English dews, and deuterias wine.'],
];

const fold = (s) => s.normalize('NFC').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
const nonLatin = (s) => /[^\p{Script=Latin}\p{P}\p{N}\s]/u.test(s);
const MALFORMED = (k) => /[()（）]/.test(k) || /^[-–—]\s/.test(k) || /\s[—–]\s/.test(k) || /[:;]/.test(k);

const evPath = process.argv[2];
const evidence = new Map();
if (evPath) for (const l of fs.readFileSync(evPath, 'utf8').trim().split('\n')) { const r = JSON.parse(l); evidence.set(fold(r.q), (r.ev || []).slice(0, 3).map((e) => ({ book_id: e.book_id, page: e.page, snippet_type: e.type, snippet: e.snip }))); }

const stem = fold(CONCEPT).replace(/[^a-z]/g, '').slice(0, 4);
const entry = { concept: CONCEPT, theme: 'spirits', tradition: 'Greek', variants: [], equivalents: [], related: [], rejected: 0 };
const verdicts = [];
for (const [term_key, judged, confidence, reason] of V) {
  let tier = judged, note = null;
  if (tier !== 'reject' && MALFORMED(term_key)) { tier = 'reject'; note = 'malformed key'; }
  else if ((tier === 'variant' || tier === 'equivalent') && confidence < FLOOR) { tier = 'related'; note = `below ${FLOOR} floor`; }
  else if (tier === 'variant' && !nonLatin(term_key) && !fold(term_key).replace(/[^a-z]/g, '').includes(stem)) { tier = 'equivalent'; note = 'retagged: different-language rendering, expand with label'; }
  verdicts.push({ term_key, verdict: judged, tier, confidence, reason, ...(note ? { note } : {}), ...(evPath ? { evidence: evidence.get(fold(term_key)) || [] } : {}) });
  const row = { term: term_key, confidence, reason, ...(note ? { note } : {}) };
  if (tier === 'variant') entry.variants.push(row);
  else if (tier === 'equivalent') entry.equivalents.push(row);
  else if (tier === 'related') entry.related.push(row);
  else entry.rejected++;
}

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
data.concepts = data.concepts.filter((c) => c.concept !== CONCEPT).concat(entry);
data._meta.daimon = '2026-10-12: one concept (theme "spirits") for #4251 — candidates from the issue\'s worked node, each checked against live keyword-search rows by one Claude judge; .claude/docs/concept-aliases/add-daimon-2026-10-12.mjs';
fs.writeFileSync(DATA, JSON.stringify(data, null, 1) + '\n');
if (evPath) fs.writeFileSync(OUT, JSON.stringify({ concept: CONCEPT, judged: '2026-10-12', verdicts }) + '\n');
console.log(CONCEPT, { variants: entry.variants.length, equivalents: entry.equivalents.length, related: entry.related.length, rejected: entry.rejected });
