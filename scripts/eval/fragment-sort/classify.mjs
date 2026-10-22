// PRIOR ART: scripts/eval/ (INDEX.md lib table) — no fuzzy fragment/incipit matcher; src/lib text helpers fold for search, not for Greek n-gram overlap. none fits #7065.
// Sort every candidate attribution (fetch-originals.mjs output) against the DK reference (build-reference.mjs):
//   1. noise      — name collision or label (Philolaches, "Philolaic" = Copernican system, ...)
//   2. text match — character 12-gram overlap of the ORIGINAL-language OCR with a reference entry
//                   (Greek folded: no accents/breathings, final sigma; Latin folded: u/v, i/j, ae/oe)
//   3. theme      — English translation context against hand rules naming a DK entry (fallback only)
//   4. unmatched  — the residue, to be read by eye
// Usage: node classify.mjs <reference.json> <figure:44|47> <orig.jsonl> <out.jsonl>
import fs from 'node:fs';
import { fold, makeFolded, makeShingles } from './shingle.mjs';
export { fold };

const [REF, FIG, IN, OUT] = process.argv.slice(2);
const K = 12;
// A text match needs >= MIN_COVER folded characters of the page covered by shared 12-grams, with one run of
// at least MIN_RUN (a single technical phrase such as "sesquitertia proportio" is not a quotation). The short
// hand keys instead need KEY_COVER of their own length.
const MIN_COVER = 40, MIN_RUN = 24, KEY_COVER = 0.4;

// Names and ethnics are not evidence of a text ("Philolai Pythagorici", "Archytas Tarentinus"): cut the text at
// them so no shingle spans one.
const NAMES = /\S*(?:philola|archyt|pythagor|tarent|croton|φιλολα|ἀρχυτ|αρχυτ|πυθαγορ|ταραντ|κροτων)\S*/giu;
const NAMES_FOLDED = /(philola|archyt|pythagor|tarent|croton|φιλολα|αρχυτ|πυθαγορ|ταραντ|κροτων)/;
const folded = makeFolded(NAMES);
const shingles = makeShingles(folded, K, NAMES_FOLDED);
const stripOcr = (s) => s.replace(/<(scan-quality|language|lang|script|page-type|vocab|meta|page-num|header|sig|image-desc|summary|keywords|warning|context|columns|gloss)\b[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<\/?[a-z][a-z-]*[^>]*>/gi, ' ');

const ref = JSON.parse(fs.readFileSync(REF, 'utf8')).filter((e) => e.dk == FIG || (e.ref || '').startsWith(`DK ${FIG}`) || (FIG == 47 && /Archytas/.test(e.ref || e.id)));
// The DK entry text includes Diels' German frame and Greek source citations; drop shingles that sit in more
// than 3 entries so a shared formula cannot carry a match.
const index = new Map();
const entryShingles = new Map();
for (const e of ref) { const sh = shingles(e.text); entryShingles.set(e.id, sh); for (const g of sh) { if (!index.has(g)) index.set(g, new Set()); index.get(g).add(e.id); } }
for (const [g, ids] of index) if (ids.size > 3) index.delete(g);
const byId = new Map(ref.map((e) => [e.id, e]));
const keyLen = new Map(ref.map((e) => [e.id, Math.max(1, folded(e.text).length)]));

// Runs of the page string covered by shingles shared with one entry: total coverage, longest run, the text.
function runs(pageFolded, id) {
  const sh = entryShingles.get(id);
  let cover = 0, longest = 0, cur = null; const parts = [];
  for (let i = 0; i + K <= pageFolded.length; i++) {
    const g = pageFolded.slice(i, i + K);
    if (index.get(g)?.has(id) && sh.has(g)) { if (cur && i <= cur.e) cur.e = i + K; else { cur = { s: i, e: i + K }; parts.push(cur); } }
  }
  for (const r of parts) { cover += r.e - r.s; longest = Math.max(longest, r.e - r.s); }
  return { cover, longest, text: parts.map((r) => pageFolded.slice(r.s, r.e)).join(' | ').slice(0, 300) };
}
const passes = (id, m) => (byId.get(id).section === 'H' ? m.cover / keyLen.get(id) >= KEY_COVER && m.longest >= Math.min(24, 0.6 * keyLen.get(id)) : m.cover >= MIN_COVER && m.longest >= MIN_RUN);

const NOISE = {
  44: [
    [/philolach|philolac[eh]s|philolacon/i, 'name collision: Philolaches/Philolacon (Plautus etc.)'],
    [/philolaic|philola[ie]an|philolaean/i, 'label: "Philolaic" = Copernican/heliocentric system'],
    [/philolal/i, 'word: philolalos ("talkative")'],
    [/proper name|love of the people/i, 'lexicon entry for the name'],
    [/corinth|thebans|nomothet|legislator|lawgiver|gave laws/i, 'name collision: Philolaus of Corinth, lawgiver of Thebes (Arist. Pol. II 12)'],
    [/philolaus the younger|younger philolaus|philolaus junior|system of the world, book|dissertation on the system/i, 'name collision: Boulliau, Philolaus sive dissertatio de vero systemate mundi (1639) / Reuchlin\'s "younger Philolaus"'],
    [/nicetas and philolaus|kinsmen/i, 'name collision: Synesius\' young kinsman Philolaus'],
    [/redivivus|systemate mundi|as philolaus (thinks|speaks)/i, 'name collision: Boulliau\'s Philolaus (1639), cited as "Philolaus redivivus"'],
    [/by jupiter,? ?" said philolaus|what philolaus had said|filolaus/i, 'name collision: Philolaus of Citium in Philostratus, Life of Apollonius IV 36-37'],
  ],
  47: [
    [/archytas (of|the) (mytilene|musician|architect|poet)|archytas of amphissa|euphorion or archytas|euphronius or archytas|the crane/i, 'name collision: another Archytas (of Amphissa, poet; Athen. III 82a)'],
    [/genitive|archyta[es]?\s*,\s*(europ|eurot)|in -?tas|in tas\b/i, 'grammar example (declension of the name)'],
    [/\bille\b|"that archytas|that archytas of tarentum,? ?"|famous alexander/i, 'grammar example (Valla, ille of eminence)'],
  ],
};

// Theme rules on the English context: [regex, DK id, status]. First hit wins; ordered specific → general.
const THEMES = {
  44: [
    [/claudian|mamert|incorporeal (life|harmony)|soul is (put|placed|joined) (in|into) the body (by|through) number/i, 'DK 44 B22', 'spurious'],
    [/(ruler|leader|governor) of (all|everything)|god is one,? (eternal|always)|one,? eternal,? (stable|immovable|unmoved)/i, 'DK 44 B20', 'spurious'],
    [/(world|cosmos|universe).{0,40}(indestructible|incorruptible|imperishable|eternal)/i, 'DK 44 B21', 'spurious'],
    [/body.{0,30}(tomb|sepulch|prison)|(tomb|sepulch).{0,30}(soul|body)|buried in the body/i, 'DK 44 B14', 'spurious'],
    [/suicide|kill (himself|oneself|ourselves)|(guard|garrison|prison|watch-?post).{0,60}(god|soul)|cebes|simmias/i, 'DK 44 B15', 'spurious'],
    [/god the monad|matter the dyad/i, 'RESIDUE (a): God = monad, matter = dyad, credited to Philolaus (Gohory 1550); paraphrase of B8 / Aet. I 3', 'unmatched'],
    [/(say|says|call|calls) it (is )?(a )?"?harmony/i, 'DK 44 A23 (soul = harmony, doxographic list)', 'testimonium'],
    [/harmony.{0,80}(numbers?|proportion)/i, 'DK 44 B6 / A24 paraphrase (harmony through number)', 'testimonium'],
    [/held harmony|philolaus harmoniam/i, 'DK 44 A23', 'testimonium'],
    [/worthwhile to remember also the things that philolaus/i, 'DK 44 B14 (Clement, Latin)', 'spurious'],
    [/olympiodorus|temple.{0,60}turn|turn (not )?back/i, 'RESIDUE: Pythagorean symbolon "entering a temple, do not turn back", credited to Philolaus by Olympiodorus (in Phaed.)', 'unmatched'],
    [/semnai|gods of the underworld|lawful heroes/i, 'RESIDUE: Golden Verses line 3 credited to Philolaus (Postel 1551)', 'unmatched'],
    [/consonances|two octaves|two fifths/i, 'RESIDUE: ban on parallel octaves/fifths credited to Philolaus (Bermudo 1555)', 'unmatched'],
    [/mixing bowl|crater|krater/i, 'RESIDUE: Proclus in Tim.: Plato "following Philolaus" on the krater of Hephaestus (not in DK 1912)', 'unmatched'],
    [/voice of philolaus|from (the|his) tomb/i, 'Iambl. VP 139/148 (Eurytus hears Philolaus\' voice from the tomb); not in DK 44 1912', 'testimonium'],
    [/(prince|ruler|leader|author) (and \w+ )?of (all|the universe|everything)|one is god|there is one god|god.{0,30}(always one|ever singular|immovable|stable)/i, 'DK 44 B20 (via Philo, Opif. 100)', 'spurious'],
    [/no (beginning|principle).{0,80}infinite|if all things (are|were|be) infinite|nothing (will|would) be known/i, 'DK 44 B3', 'genuine'],
    [/(unit|monad).{0,40}\bone\b|\bone\b.{0,40}(unit|monad)/i, 'DK 44 A10', 'testimonium'],
    [/(infinite|unlimited).{0,40}limit|limit.{0,40}(infinite|unlimited)/i, 'DK 44 B1-2 / A9', 'genuine'],
    [/quadrangular|angle of (a|the) square|angle/i, 'DK 44 A14', 'testimonium'],
    [/aristarchus|copernic|heliocentr/i, 'DK 44 A21 (Copernican precursor)', 'testimonium'],
    [/unity.{0,40}(principle|beginning)|monad.{0,40}(principle|beginning)|one is the (principle|beginning)/i, 'DK 44 B8', 'spurious'],
    [/(infinite|unlimited) or (finite|limited)|(finite|limited) or (infinite|unlimited)|(finite|limited) and (infinite|unlimited)|(infinite|unlimited) and (finite|limited)/i, 'DK 44 B2 (via Boeth. arith. II 32)', 'genuine'],
    [/letter to philolaus|telauges/i, 'Diog. VIII 53/55 (Telauges\' letter to Philolaus)', 'testimonium'],
    [/(called|call|calls|named) it (a )?harmony|harmony.{0,30}(soul|anima)|(soul|anima).{0,60}harmon/i, 'DK 44 A23', 'testimonium'],
    [/(sun|light).{0,80}(glass|crystal|lens|mirror|vitreous)|(glass|crystal|lens).{0,60}sun|light is twofold/i, 'DK 44 A19', 'testimonium'],
    [/number.{0,40}(judge|criterion)|(judge|criterion).{0,40}number/i, 'DK 44 A29', 'testimonium'],
    [/philosophi\w* (through|by|with) numbers?|numbers?.{0,120}(aglaoph|orpheus|pythagoras)/i, 'number-philosophy genealogy (Pico, prisca theologia)', 'testimonium'],
    [/diesis|apotome|comma|schisma|semitone|divid\w* the tone|whole tone/i, 'DK 44 A26 / B6a', 'testimonium'],
    [/harmonic (mean|medi)|geometric(al)? harmony|cube.{0,40}harmon/i, 'DK 44 A24', 'testimonium'],
    [/brain|navel|genital|heart.{0,40}(soul|sensation)/i, 'DK 44 B13', 'genuine'],
    [/(limit|limited|limiting).{0,40}unlimited|unlimited.{0,40}limit/i, 'DK 44 B1-2', 'genuine'],
    [/(everything|all things) (that is )?known has number|without number nothing/i, 'DK 44 B4', 'genuine'],
    [/decad|number ten|tetractys|the ten /i, 'DK 44 B11 / A13', 'spurious'],
    [/speusippus/i, 'DK 44 A13', 'testimonium'],
    [/angle.{0,60}(god|saturn|cronus|mars|rhea|zeus|jupiter)/i, 'DK 44 A14', 'testimonium'],
    [/counter-?earth|antichth|anti-?earth|central fire|fire (in|at) the (middle|center|centre)|hearth of the (universe|world|all)/i, 'DK 44 A16-17', 'testimonium'],
    [/sun.{0,40}(glass|vitreous|crystal|mirror)/i, 'DK 44 A19', 'testimonium'],
    [/moon.{0,60}(inhabit|animals|plants|earth-?like|earthy)/i, 'DK 44 A20', 'testimonium'],
    [/(earth|globe).{0,120}(move|moves|moving|motion|revolv|rotat|circl|turn|orbit)|(move|motion|revolv|rotat|circl|turn).{0,80}(of )?the earth/i, 'DK 44 A21 (+Diog. VIII 85)', 'testimonium'],
    [/(fifty-nine|59|lix).{0,30}year|great year|year of .{0,20}days/i, 'DK 44 A22', 'testimonium'],
    [/soul.{0,40}harmon|harmon.{0,40}soul/i, 'DK 44 A23', 'testimonium'],
    [/(bought|buy|purchas|acquir|obtain)\w*.{0,100}(book|volume|treatise|writing)|(book|volume|treatise|writing)s?.{0,80}(bought|purchas)|minae|hundred min|plagiar|timaeus.{0,60}(copied|taken|from)/i, 'DK 44 A1 / A8', 'testimonium'],
    [/(first|he) (to )?(publish|divulg|made public|wrote down|put in writing|reveal)|secret.{0,60}(pythagor|doctrine)/i, 'DK 44 A1 / A8 (first to publish)', 'testimonium'],
    [/(put to death|killed|slain|murdered).{0,60}(tyran)|tyran\w*.{0,60}(put to death|killed)/i, 'DK 44 A1 (death)', 'testimonium'],
    [/archytas.{0,80}(pupil|disciple|student|hearer)|(teacher|master|taught|instructed).{0,60}archytas/i, 'DK 44 A3', 'testimonium'],
    [/(plato|democritus).{0,100}(went|travel|visit|heard|studied|associat|learn)|(went|travel|visit).{0,60}(italy|tarent).{0,80}philola/i, 'DK 44 A2 / A5', 'testimonium'],
    [/criterion|reason.{0,40}(kinship|akin)/i, 'DK 44 A29', 'testimonium'],
    [/heat|warm.{0,40}(body|seed)|bile|phlegm/i, 'DK 44 A27-28', 'testimonium'],
    [/flute|aulos|music/i, 'DK 44 A7', 'testimonium'],
    [/croton|tarent|pythagorean/i, 'DK 44 A (identity: "Philolaus the Pythagorean")', 'testimonium'],
  ],
  47: [
    [/categor|predicament|ten (universal|general|genera|kinds|terms)|on opposites/i, 'Ps.-Archytas Categories / On Opposites (DK 47 B9)', 'spurious'],
    [/(gold|silver).{0,80}(clay|mud|earth|dirt|dung)|(clay|mud).{0,80}(gold|silver)/i, 'UNMATCHED: gold-silver-clay saying', 'unmatched'],
    [/quartan|earwax|ear-wax|cerumen|heart (is taken,? )?(recently|freshly) extract|heart recently extracted/i, 'RESIDUE: amulets against quartan fever, "dixit Architas" (ps.-Albertus, De mirabilibus mundi; copied by Agrippa I.42)', 'unmatched'],
    [/perforated vessel|leaky (jar|vessel)|perforat/i, 'RESIDUE: Gorgias 493a leaky jar credited to Archytas and Plato (Ficino)', 'unmatched'],
    [/authors pythagoras, archytas|auctores habet/i, 'Censorinus, De die natali 4.3 (mankind has always existed: Pythagoras, Ocellus, Archytas); not in DK 1912', 'testimonium'],
    [/locri|ozol|wreaths of flowers/i, 'name collision: Archytas of Amphissa, poet (Plut. Quaest. Gr. 15)', 'noise'],
    [/themistius|peripatetic archytas|new work by the antiquity/i, 'Ps.-Archytas Categories: Themistius doubts the Pythagorean author (Valla)', 'spurious'],
    [/fourth chapter|archytas has revealed/i, 'Diog. VIII 80-81 (Archytas\' letter to Plato on Ocellus\' books)', 'testimonium'],
    [/words already cited/i, 'Ps.-Archytas on place (Simplicius; Patrizi)', 'spurious'],
    [/one unique disadvantage|disadvantage: poverty|poverty/i, 'RESIDUE: "the wise man\'s one disadvantage is poverty" (Alciati commentary 1661); no ancient source found', 'unmatched'],
    [/vows can be overcome|impiety for mortals/i, 'RESIDUE: fate cannot be overcome by vows, "Archytas and Heraclitus" (Arquatus 1494); no ancient source found', 'unmatched'],
    [/life of marcellus|syracuse.{0,80}besieged|drew .{0,40}ship/i, 'RESIDUE: Archimedes\' ship-hauling (Plut. Marc. 14) credited to Archytas (Daneau 1575)', 'unmatched'],
    [/need taught all things|offering to hermes/i, 'Plutarch fr. (Stobaeus): Archytas caps an inscription to Hermes, "Need taught all things"; not in DK 1912', 'testimonium'],
    [/wrote to him not to be proud|ornament sicily/i, 'Plut. Ad princ. inerud. 779d (Archytas\' advice to Dionysius); not in DK 1912', 'testimonium'],
    [/one and unity|unity.{0,30}cognate|τὸ ἓν καὶ ἡ μονὰς/i, 'Ps.-Archytas (Syrianus in Metaph.; Mullach): the one and the monad differ', 'spurious'],
    [/among whom was archytas|archytas of tarentum,? and that lysis/i, 'Diog. VIII 39-40 (Archytas escapes the fire at Croton)', 'testimonium'],
    [/events in nature|de eventibus/i, 'RESIDUE: "Archytas, De eventibus in natura" (Meffret 1488)', 'unmatched'],
    [/value gold and silver|clay from which/i, 'RESIDUE: Agathocles, not Archytas (German Cessolis "Archyloga"; mistranslated)', 'unmatched'],
    [/natural motion.{0,60}(proportion|equal)|proportion of equality/i, 'Arist. Probl. XVI 9, 915a25 (DK 47 A23a in later eds.)', 'testimonium'],
    [/universals?.{0,120}particular|particulars?.{0,120}universal/i, 'DK 47 B1 (incipit: knowing universals, seeing particulars)', 'genuine'],
    [/wisdom.{0,120}(sight|eye|human arts|stands as far)|book on wisdom|on wisdom/i, 'Ps.-Archytas On Wisdom (Iambl. Protr. 4)', 'spurious'],
    [/brontinus|intelligible.{0,40}sensible|two kinds of things/i, 'Ps.-Archytas On Intellect and Sensation (divided line; Ficino, via Iambl./Syrianus)', 'spurious'],
    [/good fortune|substance|essence|quality is that|archytas the elder/i, 'Ps.-Archytas (Stobaeus/Simplicius metaphysics, On the Good Man)', 'spurious'],
    [/discourse of archytas|raising children|education of children/i, 'Ps.-Archytas On the Upbringing of Children (Philostr. VA VI 31; DK 47 B9.6)', 'spurious'],
    [/(forty|sixty).{0,60}(killed|perish)|(killed|perish).{0,80}(escaped|few escaped)|few escaped|bared his throat/i, 'Diog. VIII 39-40 (Archytas escapes the fire at Croton)', 'testimonium'],
    [/doric/i, 'Archytas as canon of Doric prose (Lascaris, after Gregory of Corinth)', 'testimonium'],
    [/judge and an altar|judge and altar/i, 'DK 47 A12', 'testimonium'],
    [/villa|farm|estate|country house/i, 'DK 47 A7 (bailiff, Cic. rep. I 59)', 'testimonium'],
    [/images? (that )?mov|moving (statue|image)|effected by archytas|statue/i, 'DK 47 A10a (dove; Ficino\'s moving image)', 'testimonium'],
    [/fish.{0,60}(bone|spine)|(bone|spine).{0,40}fish/i, 'Aelian (anecdote: a fish without bones, a man without guile); not in DK 1912', 'testimonium'],
    [/πλαταγ|platage/i, 'DK 47 A10 (rattle)', 'testimonium'],
    [/hemicylind|eutocius/i, 'DK 47 A14-15 (doubling the cube)', 'testimonium'],
    [/varro|columell|agricultur|husbandry|geoponic/i, 'DK 47 B8 (On Agriculture, Varro / Columella)', 'doubtful'],
    [/magna graecia|great greece|crossed (over )?into italy|pontius/i, 'DK 47 A5 / A9 (Plato in Italy; Cato maior)', 'testimonium'],
    [/measurer|mensor/i, 'DK 47 A3 (Horace, Odes I 28)', 'testimonium'],
    [/which i have heard|our old men/i, 'Cic. Lael. 88 (DK 47 A7a later eds.)', 'testimonium'],
    [/angry|anger|wrath|ira[ts]|bailiff|steward|overseer|villic|farm.{0,60}(neglect|ruin)|(slave|servant)s?.{0,60}(punish|beat|flog)|punish.{0,60}(slave|servant|farm)/i, 'DK 47 A7 (bailiff)', 'testimonium'],
    [/ascend\w*.{0,40}(heaven|sky)|heaven.{0,120}(friend|companion|someone to tell|no one to tell|share)|pleasure.{0,60}(stars|heaven).{0,60}(friend|alone)/i, 'Cic. Lael. 88 (DK 47 A7a later eds.)', 'testimonium'],
    [/rattle|clapper|crepitac/i, 'DK 47 A10 (rattle)', 'testimonium'],
    [/dove|pigeon|wooden bird|bird.{0,40}(wood|fl[yie])|(fl[eyi]\w*|flying).{0,40}(wood|bird|dove|pigeon)|automat/i, 'DK 47 A10a (dove)', 'testimonium'],
    [/horace|sand|shore|matin|drown|shipwreck|buried|burial|tomb|grave/i, 'DK 47 A3 (Horace, Odes I 28)', 'testimonium'],
    [/(cube|delian|delos|altar).{0,80}(doubl|duplic)|doubl\w*.{0,40}cube|(mean|middle) proportional|proportional (mean|middle)|two means|semi-?cylind/i, 'DK 47 A14-15 (doubling the cube)', 'testimonium'],
    [/(stick|staff|rod|hand).{0,80}(outside|beyond|edge|extremity|outer)|(edge|extremity|outermost).{0,60}(heaven|world|universe).{0,80}(stick|staff|rod|hand)/i, 'DK 47 A24 (the stick at the edge)', 'testimonium'],
    [/arbiter|arbitrator|altar.{0,60}(refuge|wronged)/i, 'DK 47 A12', 'testimonium'],
    [/(wrote|writ).{0,60}wall|obscen|indecent|unseemly word/i, 'DK 47 A11', 'testimonium'],
    [/pleasure|voluptas|lust|sensual|bodily delight/i, 'DK 47 A9 (pleasure speech, Cic. Cato 39-41)', 'testimonium'],
    [/children|played with|slaves.{0,40}(play|feast|banquet)/i, 'DK 47 A8', 'testimonium'],
    [/enharmonic|chromatic|diatonic|tetrachord|genera|genus of|28:27|epogdo|superparticular|sesqui|harmonic mean|hippasus/i, 'DK 47 A16-19 (music theory)', 'testimonium'],
    [/(arithmetic|geometric).{0,60}(harmonic|subcontrary|mean)|three means|three (kinds of )?proportion/i, 'DK 47 B2', 'genuine'],
    [/(sound|noise|tone|pitch|voice).{0,120}(blow|strik|struck|motion|swift|quick|slow|high|low|sharp|deep)/i, 'DK 47 B1 (sound and motion)', 'genuine'],
    [/(geometry|astronomy|arithmetic|music|mathemat).{0,60}(sister|kindred|related)|sister sciences/i, 'DK 47 B1 (sister sciences)', 'genuine'],
    [/calculation|reckoning|computation.{0,60}(concord|strife|discord|sedition|rich|poor)/i, 'DK 47 B3-4', 'genuine'],
    [/(o|dear) (father )?archytas|plato (writes|wrote|says) to archytas|letter.{0,40}(to|from) archytas|archytas.{0,40}letter|(to|from) archytas.{0,40}letter|born for ourselves alone/i, 'Plato Ep. IX / XII and the Plato-Archytas letters (Diog. III 21-22, VIII 79-81)', 'testimonium'],
    [/(dionysius|rescue|saved (him|plato)|interceded|cleared him)|plato.{0,120}(visit|went|travel|tarent|italy|friend|learn|heard|great greece)|(visit|went|travel|travers).{0,80}(tarent|italy|archytas)|teacher of plato|plato.s teacher|learned .{0,30}from archytas|eudoxus/i, 'DK 47 A1 / A5 (Plato, Dionysius, pupils)', 'testimonium'],
    [/(reduc|resolv|refer)\w*.{0,80}(one|single|same).{0,40}principle|watch-?tower|lookout|high (place|vantage)/i, 'Ps.-Archytas On Wisdom (Iambl. Protr. 4)', 'spurious'],
    [/intellect and sens|mind and sens|judging powers/i, 'Ps.-Archytas On Intellect and Sensation (DK 47 B9.5)', 'spurious'],
    [/law and justice|law.{0,60}(harmony|soul)|(ruler|magistrat|king).{0,40}(law|lawful)|animate law|living law/i, 'Ps.-Archytas On Law and Justice', 'spurious'],
    [/(good|happy) man|happiness|moral education|(bring|rais)\w* up (children|the young)/i, 'Ps.-Archytas ethics (On the Good Man / On Moral Education)', 'spurious'],
    [/\bgod\b|divine|theion|creat\w* by god/i, 'Ps.-Archytas theology (Steuco etc.; no DK source)', 'spurious'],
    [/time.{0,40}(number|interval|motion)|matter and form|form and matter|definition.{0,40}(calm|stillness)|definitions/i, 'DK 47 A22 / ps.-Archytas metaphysics', 'spurious'],
    [/(mechanic|machine|engine|engineer)/i, 'DK 47 A1 (first mechanics, Diog. VIII 83) / B7', 'testimonium'],
    [/(general|command\w*|strateg|army|seven times|never defeated|governed|ruled tarent)/i, 'DK 47 A1 / A4 (general and statesman)', 'testimonium'],
    [/philolaus|eurytus|pythagor.{0,40}(disciple|pupil|school)/i, 'DK 47 / 44 A3 (pupil of Philolaus; Pythagorean)', 'testimonium'],
    [/geometr|mathemat|astronom|number|arithmet|music|harmon/i, 'DK 47 A6 / A19-21 (mathematician)', 'testimonium'],
  ],
};

// Reuchlin, De arte cabalistica (1517): "Philolaus" is the Pythagorean speaker beside Simon and Marranus.
// Reprinted with Galatino (1550, 1561, 1612, 1672), in the Basel Pico volumes and in Pistorius (1587).
const CHARACTER = { 44: /marran|\bsimon\b|cabal|kabbal|capnio/i, 47: null };

const near = (ctx, s) => {
  const i = ctx.toLowerCase().search(FIG == 44 ? /philola/ : /archyt/);
  return i < 0 ? s : ctx.slice(Math.max(0, i - 260), i + 300);
};

const rows = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const out = [];
for (const r of rows) {
  const res = { id: r.id, t: r.t, a: r.a, y: r.y, lang: r.lang, p: r.p, s: r.s };
  const eng = `${r.s} ${near(r.ctx, r.s)}`;
  let noise = (NOISE[FIG] || []).find(([re]) => re.test(r.s) || (re.test(eng) && !(FIG == 44 ? /philolaus/i : /archytas/i).test(r.s)));
  if (!noise && CHARACTER[FIG] && CHARACTER[FIG].test(r.ctx) && /(said|says|replied|responded|answered|asked|added|spoke|philolaus[,!?:]|, philolaus|o philolaus|i am philolaus|with me, philolaus|^\W*(and|then|to this|to that) philolaus|philolaus to th)/i.test(r.s))
    noise = [null, 'name collision: Philolaus the speaker in Reuchlin, De arte cabalistica'];
  // text match
  const pf = r.ocr ? folded(stripOcr(r.ocr)) : '';
  const cand = new Set();
  for (let i = 0; i + K <= pf.length; i++) for (const id of index.get(pf.slice(i, i + K)) || []) cand.add(id);
  const ranked = [...cand].map((id) => [id, runs(pf, id)]).filter(([id, m]) => passes(id, m))
    .sort((a, b) => (byId.get(b[0]).section === 'H') - (byId.get(a[0]).section === 'H') || b[1].cover - a[1].cover);
  const best = ranked[0];
  if (noise) Object.assign(res, { cls: 'noise', ref: noise[1], via: 'name' });
  else if (best) {
    let e = byId.get(best[0]);
    res.matched = best[1].text;
    // Mullach's "Alia Archytae fragmenta" mixes genuine B2 with the Simplician pseudo-Archytas: resolve by what matched.
    if (e.status === 'mullach-pool') {
      const m = best[1].text;
      const [st, ref] = /μεσαιδεεντι|μεσοτητων/.test(m) ? ['genuine', 'DK 47 B2 (via Mullach pool)'] : /predicament|ποιον|αντιστροφ|μοναδ|εναντι|τοισον|substanti/.test(m) ? ['spurious', 'Ps.-Archytas Categories / On Opposites (via Mullach pool)'] : ['testimonium', 'Archytas testimonium (via Mullach pool)'];
      Object.assign(e = { ...e }, { status: st, ref: `${ref} [${e.id}]` });
    }
    const st = e.status;
    const cls = st === 'genuine' ? 'known-genuine' : st === 'spurious' ? 'known-spurious' : st === 'doubtful' ? 'known-doubtful' : 'testimonium';
    Object.assign(res, { cls, ref: e.ref ? (e.ref.includes('[') ? e.ref : `${e.ref} [${e.id}]`) : e.id, via: 'text', score: best[1].cover, also: ranked.slice(1, 3).map((h) => `${h[0]}:${h[1].cover}`) });
  } else {
    // Residue labels (status 'unmatched') name one specific passage: match them on the sentence only, not the context.
    const th = (THEMES[FIG] || []).find(([re, , st]) => (st === 'unmatched' ? re.test(r.s) : re.test(eng)));
    if (th && th[2] !== 'unmatched') {
      const cls = th[2] === 'genuine' ? 'known-genuine' : th[2] === 'spurious' ? 'known-spurious' : th[2] === 'doubtful' ? 'known-doubtful' : th[2] === 'noise' ? 'noise' : 'testimonium';
      Object.assign(res, { cls, ref: th[1], via: 'theme(en)' });
    } else Object.assign(res, { cls: 'unmatched', ref: th ? th[1] : null, via: th ? 'theme(en)' : null });
    if (!r.ocr) res.noOcr = true;
  }
  // Residue triage, from reading every remaining row by eye (#7065): the Reuchlin dialogue reprints whose speaker
  // lines the CHARACTER rule missed, rows whose original OCR does not contain the name at all (the name entered in
  // translation, or the passage is on the facing page), and bare mentions in a list of names.
  if (res.cls === 'unmatched' && !res.ref) {
    const orig = stripOcr(r.ocr || '');
    if (FIG == 44 && /reuchlin|galatin|columna|pistorius|hoogstraten|duret/i.test(`${r.a} ${r.t}`) || (FIG == 44 && /pico/i.test(r.a || '') && CHARACTER[44].test(orig)))
      Object.assign(res, { cls: 'noise', ref: 'name collision: Philolaus the speaker in Reuchlin, De arte cabalistica', via: 'triage' });
    else if (!(FIG == 44 ? /philola|φιλολα|filola/i : /archyt|ἀρχύτ|αρχυτ|archit|ἀρχίτ/i).test(orig))
      Object.assign(res, { ref: 'triage: name not in the original OCR (translation artifact or facing page)', via: 'triage' });
    else Object.assign(res, { cls: 'noise', ref: 'triage: read; a mention with nothing attributed (list of names, grammar example, editor\'s note, garbled MS translation)', via: 'triage' });
  }
  out.push(res);
}
fs.writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
const tally = {}; for (const o of out) tally[`${o.cls}/${o.via}`] = (tally[`${o.cls}/${o.via}`] || 0) + 1;
console.log(`DK ${FIG}`, rows.length, 'passages', new Set(out.map((o) => o.id)).size, 'books', tally);
