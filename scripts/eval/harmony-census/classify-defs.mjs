// PRIOR ART: scripts/eval/fragment-sort/classify.mjs (#7065) — rules first, residue read by eye; it sorts attributions
// against a fragment list, which a concept does not have. Its shingle helpers (fragment-sort/shingle.mjs) group repeated
// formulations here. none fits #7117 as it was.
//
// Sort every harvested definitional window (harvest.mjs def-* lanes) into:
//   form   S  "harmony is X"            (the definiens follows)
//          N  "X is called harmony"     (the definiens precedes: a naming definition)
//          D  "the definition of harmony …"
//          P  "X is (a) harmony"        (harmony predicated of something else: the soul, virtue, the world)
//   kind   definition | predication | description ("harmony is pleasing / found in / necessary") | noise
//   fam    multi-label, from the definiens: F1 ratio/consonance, F2 diversity-in-a-whole / opposites, F3 order/rank,
//          F4 balance/temperament/mean, F5 social concord; F6 = none of them.
// Rules run on the ORIGINAL-language window; our English translation of the page is the fallback (and is recorded,
// so a reader can see both). Apparatus (<meta>, <note>, <gloss>, <vocab> …) is never matched.
// Usage: node classify-defs.mjs <harvest-dir> <out.jsonl>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fold } from '../fragment-sort/shingle.mjs';

const [H, OUT] = process.argv.slice(2);
const cat = JSON.parse(fs.readFileSync(path.join(H, 'catalog.json'), 'utf8'));
const read = (lane) => { const f = path.join(H, `${lane}.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };

// ── apparatus ───────────────────────────────────────────────────────────────────────────────────────────────────
const APP_TAGS = 'meta|note|gloss|vocab|summary|keywords|warning|header|page-num|page-type|language|sig|context|script|columns|image-desc|scan-quality|lang';
const OPEN = new RegExp(`<(${APP_TAGS})\\b[^>]*>`, 'gi'), CLOSE = new RegExp(`</(${APP_TAGS})>`, 'gi');
// Is position `off` of `win` inside an apparatus element? (the window can start mid-element: a close with no open)
function insideApparatus(win, off) {
  const before = win.slice(0, off);
  let depth = 0, sawClose = false;
  for (const m of before.matchAll(new RegExp(`</?(${APP_TAGS})\\b[^>]*>`, 'gi'))) {
    if (m[0][1] === '/') { if (depth > 0) depth--; else sawClose = true; } else depth++;
  }
  if (depth > 0) return true;
  // window started inside an element: the first apparatus tag after the match is a close with no open before it
  if (!sawClose) { const after = win.slice(off); const o = after.search(OPEN), cl = after.search(CLOSE); if (cl >= 0 && (o < 0 || cl < o)) return true; }
  return false;
}
const stripApp = (s) => { let p; do { p = s; s = s.replace(new RegExp(`<(${APP_TAGS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), ' '); } while (s !== p); return s.replace(new RegExp(`</?(${APP_TAGS})\\b[^>]*>[\\s\\S]*$`, 'i'), ' ').replace(/<\/?[a-z][a-z-]*[^>]*>/gi, ' ').replace(/[#*|_]+/g, ' ').replace(/\$\^?\d+\$/g, ' ').replace(/\s+/g, ' ').trim(); };

// ── sentence around the match ───────────────────────────────────────────────────────────────────────────────────
// A colon ends the sentence before the match but not after it ("Harmonia est: …" puts the definiens after the colon).
// Classical Chinese is often unpunctuated, so a clause there is a short fixed span.
const BOUND = /[.!?。！？;；·:：]/, BOUND_POST = /[.!?。！？;；·]/;
function sentence(win, off, mlen, cjk) {
  const maxPre = cjk ? 14 : 320, maxPost = cjk ? 24 : 420;
  let s = off; while (s > 0 && !(BOUND.test(win[s - 1]) && s < off - 1) && off - s < maxPre) s--;
  let e = off + mlen; while (e < win.length && !BOUND_POST.test(win[e]) && e - off < maxPost) e++;
  return { pre: win.slice(s, off), m: win.slice(off, off + mlen), post: win.slice(off + mlen, e + 1) };
}

// ── forms ───────────────────────────────────────────────────────────────────────────────────────────────────────
const NAMING = /^(?:dicitur|vocatur|appellatur|nominatur|nuncupatur|vocant|appellant|vocamus|appellamus|dicunt|καλε|λ[έε]γεται|καλο|ὀνομάζ|nennt|nennet|heißt|heisst|nennen|genannt|appel|nomm|chiam|dicesi|detta|llam|dicha|se llama|se dize|noemt|genaamd|is called|are called|be called|is named|are named|is termed|are termed|they call|we call|he call|some call|others call|who call|謂之和|谓之和|以他平他)/i;
const DEFN = /defini|diffiniz|definiz|ὅρος|ὁρισμ|Definition|Erklärung|Begriff|définition|definition|what (harmony|concord|consonance) is|defined/i;
// "quae harmonia dicitur", "ἣ δὴ συμφωνία καλεῖται": a relative before "harmony is called" makes it a naming definition.
const REL_BEFORE = /(?:\b(?:quae|quæ|que|quod|qui|quam|id|ea|hoc|haec|hæc|illa|which|what|that)|ἣ|ἥ|ὃ|ὅ|ὅπερ|ἅπερ|τοῦτο|ταύτην)\s*(?:δὴ|&|et)?\s*$/i;
const CALLED_AFTER = /(?:dicitur|vocatur|appellatur|nominatur|nuncupatur|καλε[ῖι]ται|λ[έε]γεται|is called|is named)$/i;
function form(lane, m, pre = '') {
  if (/^[ἁἀα]ρμονίαν/.test(m) && /εἶναι|εἰναι|ειναι/.test(m)) return 'P';
  if (CALLED_AFTER.test(m) && REL_BEFORE.test(pre)) return 'N';
  if (lane === 'def-zh') return /謂之和|谓之和|以他平他/.test(m) ? 'N' : 'S';
  if (NAMING.test(m)) return 'N';
  if (DEFN.test(m)) return 'D';
  return 'S';
}

// ── kind: description and noise ─────────────────────────────────────────────────────────────────────────────────
const DESC = {
  en: /^[\s,]*(?:not |also |therefore |then |thus |only |always |often |now )?(?:found|produced|made|heard|caused|pleasing|pleasant|delightful|sweet|lost|broken|destroyed|restored|preserved|necessary|required|needed|good|better|best|beautiful|great|greater|greatest|seen|perceived|felt|maintained|kept|born|achieved|established|disturbed|wanting|lacking|there|here|present|possible|impossible|due|given|in |at |to be found|to be|so |more |most |very |too |as |like |hence|known|used|observed|heard|perfect|complete|wonderful|admirable|rare|easy|difficult|requisite|essential|indispensable|obtained|attained|secured|restored|wrought|effected|formed|created|composed\b(?! of))/i,
  la: /^[\s,]*(?:necessaria|utilis|grata|suavis|iucunda|jucunda|dulcis|bona|magna|maxima|perfecta|melior|optima|tanta|facta|reperta|inventa|servata|conservata|in |inter |apud |penes |ubi |quoque|etiam|tam |tanta|summa|mirabilis|admirabilis|pulcherrima|pulchra|digna|multa|nulla|nonnulla)/i,
  grc: /^[\s,]*(?:ἐν |καλ[ὴή]|ἀγαθ)/,
};
// English "harmony is …" defines only at the head of a clause. After an adjective ("gentle harmony is concentrated"), a
// subordinator ("when harmony is dissolved") or before a passive participle ("harmony is stirred") it describes.
const EN_HEAD_OK = /(?:^|[.,;:!?"“”'‘’()\[\]—–-]|\b(?:for|but|and|now|so|that|thus|hence|since|because|indeed|whereas|therefore|then|accordingly|namely|or|nor|yet|says|said|held|holds|thought|taught|believed|is|was))\s*$/i;
const EN_SUBORD = /\b(?:when|if|after|while|until|unless|whether|before|where|once|as soon as|whenever|wherever|till|lest)\s+$/i;
const EN_PASSIVE = /^[\s,]*(?:not |also |thereby |then |thus |only |now |always )?(?!(?:called|named|termed|defined|composed|compounded|constituted|formed|made up|described|understood|meant|said)\b)(?:[a-z]+ed|born|made|done|seen|known|found|heard|given|broken|torn|brought|kept|held|lost|begun|drawn|shown|taken|won|struck|sung|woven|bound|wrought)\b/i;
const NOISE = {
  // 和者 defines only at the head of a clause (after punctuation, 曰/云/註 "the note says", 夫/蓋/凡/故 …); after any
  // other character it is a compound: 唱和者 "those who join the song", 羲和者 (a name), 以定和者 "to fix the harmony".
  zh: /(?:^|[^\s，。、；：「『」』〇○曰云註注夫蓋盖凡故也則则所謂谓言])和(?:也)?者|和者(?:寡|少|鮮|鲜|甚|眾|众|数|數)/,
  // A place, a ship, a society, a hymn title, a person
  en: /\bconcord,? (?:massachusetts|new hampshire|mass\.|n\.h\.)|\bharmony society|\bthe concord\b(?! of)|\bformula of concord|\bbook of concord/i,
};

// ── families ────────────────────────────────────────────────────────────────────────────────────────────────────
const FAM = {
  en: [
    ['F1', /\b(?:ratios?|proportions?|proportional\w*|numbers?|numerical|consonan\w*|intervals?|octaves?|fifths?|fourths?|diapason|diapente|diatessaron|sounds?|tones?|voices?|pitch\w*|notes?|high and low|low and high|acute and grave|grave and acute|sharp and (?:flat|deep|low)|strings?|commensura\w*|melod\w*|music\w*|chords?|tune\w*|modulat\w*)\b/i],
    ['F2', /\b(?:opposites?|opposed|opposing|contrar\w*|discord\w*|dissimilar\w*|unlike|diverse|diversity|divers|different|differing|differences?|various|variet\w*|manifold|many|several|disparate|heterogeneous|reconcil\w*|unequal|inequality|dissonan\w*|plurality|multiplicity|dissent\w*|disagree\w*|much-mixed|unlikes?)\b/i],
    ['F3', /\b(?:order\w*|ranks?|arrangement|arranged|disposition|disposed|degrees?|hierarch\w*|series|sequence|structure|due place)\b/i],
    ['F4', /\b(?:temper\w*|means?|medium|middle|balanc\w*|equilibri\w*|equal\w*|moderat\w*|blend\w*|due measure|measured|symmetr\w*|mixtures?|mix\w*|mingl\w*|crasis|krasis|tempering|commixture|health\w*)\b/i],
    ['F5', /\b(?:citizens?|peoples?|city|cities|state|commonwealth|republic|society|social|friend\w*|peace\w*|love|wills?|minds?|hearts?|brothers?|brethren|famil\w*|household|husbands?|wives|wife|unanim\w*|like-minded|kingdoms?|nations?|rulers?|subjects|neighbou?rs?|men\b|church|christians|faithful)\b/i],
  ],
  la: [
    ['F1', /(?:proporti|ratio\b|rationes|rationis|numer|consonan|interval|diapason|diapente|diatessaron|sonor|soni\b|sonus|sonis|vocum|vocis|voces|tonor|tonus|toni\b|tonis|acut|grav|chord|nervor|cantus|cantu\b|melod|music|commensura|modulati)/i],
    ['F2', /(?:contrari|discord|dissimil|divers|differ|disparat|varia|varieta|multor|plurium|plura\b|ex pluribus|in unum|inaequal|inequal|dissonan|repugnant)/i],
    ['F3', /(?:ordin|ordo\b|series|gradu|gradib|dispositi|collocati)/i],
    ['F4', /(?:temper|medi[oau]|mediocrit|aequal|æqual|aequilib|æquilib|equal|moderati|mensur|commixt|crasis|symmetri|mixti|mixtur|sanita)/i],
    ['F5', /(?:civi[ul]|civium|civitat|popul|respublic|reipublic|societ|amicit|pax\b|pacis|pace\b|volunt|animorum|cordium|fratr|unanim|regn|fidel|hominum|ecclesi|coniug|coniux|domest|sodal)/i],
  ],
  grc: [
    ['F1', /(?:ἀριθμ|αριθμ|συμφων|διάστημ|διαστημ|φθόγγ|φθογγ|ὀξ[έε]ο[ςσ]|ὀξ[ὺύ]|βαρ[έύὺ]|διὰ πασῶν|χορδ|ἐπόγδο|ἡμιόλ|ἐπίτριτ|μουσικ|λόγ[οῳ]ν? τιν|λόγων)/],
    ['F2', /(?:ἐναντί|εναντι|διαφερ|διάφορ|διαφόρ|ἀνομοί|ανομοι|πολλ[ῶω]ν|πλειόν|ἀνίσ|δισσ|ἀντικειμ|ἀσυμφων)/],
    ['F3', /(?:τάξ|ταξ|τάγμ|σύνταξ|συνταξ|συντάξ)/],
    ['F4', /(?:κρᾶσ|κρασ|κράσ|μεσότ|μέσον|ἰσότ|ισοτ|συμμετρ|μέτρ|εὐκρασ|μῖξ|μίξ)/],
    ['F5', /(?:πόλε|πόλι|πολιτ|φιλί|φιλι|ὁμόνοι|ομονοι|εἰρήν|ειρην|δῆμ)/],
  ],
  de: [
    ['F1', /(?:verhältni|verhaltni|proportion|zahl|consonan|konsonan|interval|octav|oktav|quint|quart|töne|tönen|klang|klänge|stimmen|saite|akkord|accord|musik|melod)/i],
    ['F2', /(?:gegens|entgegen|verschied|mannigfalt|mannichfalt|vielheit|viele|vieler|widerstreit|ungleich|mehrer|dissonan)/i],
    ['F3', /(?:ordnung|rang\b|stufe|reihe|stellung|anordnung|gliederung)/i],
    ['F4', /(?:gleichgewicht|mitte\b|mittel|maß|maass|temperat|ebenmaß|gleichmaß|mässig|mäßig|mischung)/i],
    ['F5', /(?:bürger|volk|staat|gemeinde|freund|friede|liebe|herzen|gemüt|willen|brüder|menschen|eheleut)/i],
  ],
  fr: [
    ['F1', /(?:proportion|rapport|nombre|consonan|interval|octave|quinte|quarte|\bsons?\b|\btons?\b|voix|accords?\b|musique|cordes?\b|mélod|melod)/i],
    ['F2', /(?:contrair|oppos|divers|différ|differ|dissembl|plusieurs|variet|variét|dissonan|inégal|inegal)/i],
    ['F3', /(?:ordre|rang\b|disposition|arrangement|degré|degre|suite)/i],
    ['F4', /(?:tempér|temper|milieu|moyen|équilibr|equilibr|égalité|egalite|mesure|juste|mélange|melange)/i],
    ['F5', /(?:citoyen|peuple|état\b|etat\b|société|societe|amis?\b|amitié|paix|amour|cœur|coeur|volont|frère|frere|hommes)/i],
  ],
  it: [
    ['F1', /(?:proporzion|proportion|ragion|numer|consonan|interval|ottava|quinta|quarta|suon|voci|voce|tuon|corde|musica|canto)/i],
    ['F2', /(?:contrari|discord|divers|differen|dissimil|varie|molti|più cose|piu cose|dissonan|disugual)/i],
    ['F3', /(?:ordine|grado|gradi\b|disposizion|disposition)/i],
    ['F4', /(?:temper|mezzo|mediocr|egual|ugual|equilibr|misura|mescol)/i],
    ['F5', /(?:cittadin|popol|città|citta\b|stato\b|republica|repubblica|amici|pace|amor|cuori|volont|fratell|uomini|huomini)/i],
  ],
  es: [
    ['F1', /(?:proporci|razon|razón|número|numero|consonan|interval|octava|quinta|quarta|sonid|voces|\bvoz\b|cuerdas|música|musica|canto)/i],
    ['F2', /(?:contrari|discord|divers|diferen|dissimil|desigual|varie|muchos|muchas)/i],
    ['F3', /(?:orden|grado|disposici)/i],
    ['F4', /(?:templ|tempera|medio|igual|equilibr|medida|mezcl)/i],
    ['F5', /(?:ciudadan|pueblo|ciudad|estado|república|republica|amist|\bpaz\b|amor|coraz|voluntad|herman|hombres)/i],
  ],
  zh: [
    ['F1', /[聲声音律樂乐宮宫商角徵羽琴瑟]/],
    ['F2', /異|异|不同|相濟|相济|相成|五味|羹|以他|雜|杂|殊|相反|相生|生物/],
    ['F3', /[序秩]|禮|礼|位/],
    ['F4', /[平節节適适度均]|中和|調|调|齊|過不及|过不及|無過|无过/],
    ['F5', /[民國国君臣親亲家友]|兄弟|夫婦|夫妇|天下/],
  ],
};
FAM.nl = FAM.de;
const fams = (lang, s) => (FAM[lang] || FAM.en).filter(([, re]) => re.test(s)).map(([f]) => f);

// Classical Chinese definitions of 和 are mostly quotations of a few canonical loci; name the one a window quotes.
const ZH_LOCI = [
  [/中節謂之和|中节谓之和|和也者[，,]?天下之達道|和也者天下之达道/, 'Zhongyong 1 (emotions expressed in due measure = he; he = the universal path)'],
  [/和而不同|同而不和/, 'Analects 13.23 (junzi harmonious but not the same)'],
  [/和如羹|如羹|濟其不及|济其不及|以水濟水|以水济水|琴瑟之專壹|琴瑟之专一/, 'Zuozhuan Zhao 20 (Yanzi: he is like soup; tong is water added to water)'],
  [/和實生物|和实生物|同則不繼|同则不继|以他平他/, 'Guoyu, Zheng yu (Shi Bo: he begets things, tong does not continue; balancing one thing with another is he)'],
  [/樂者天地之和|乐者天地之和|大樂與天地同和|大乐与天地同和/, 'Yueji (music is the he of heaven and earth)'],
  [/禮之用[，,]?和為貴|礼之用和为贵/, 'Analects 1.12 (in ritual, he is most valued)'],
  [/和與同異|和与同异/, 'Zuozhuan Zhao 20 (he and tong differ)'],
  [/可否相濟|可否相济/, 'Zuozhuan Zhao 20 gloss (he = yes and no correcting each other)'],
  [/無乖戾之心|无乖戾之心/, 'Zhu Xi on Analects 13.23 (he = no perverse/contrary heart)'],
];
const zhLocus = (s) => { s = s.replace(/[\s>]/g, ''); return (ZH_LOCI.find(([re]) => re.test(s)) || [null, null])[1]; };

// subject lemma: harmonia / concordia / consonantia / symphonia / he
const lemma = (m) => /concord|eintracht|eendr/i.test(m) ? 'concordia' : /conson/i.test(m) ? 'consonantia' : /symphon|συμφων|zusammenstimm|einklang|zusammenklang|wohlklang/i.test(m) ? 'symphonia' : /和/.test(m) ? 'he' : /attune/i.test(m) ? 'harmonia' : 'harmonia';

const year = (b) => { const y = parseInt(b?.y, 10); if (y > 0 && y < 2100) return y; const m = String(b?.pub || '').match(/\b(1[0-9]\d\d|[5-9]\d\d)\b/); if (m) return +m[1]; const c = String(b?.pub || '').match(/(\d{1,2})(?:st|nd|rd|th) century/i); return c ? (+c[1] - 1) * 100 + 50 : null; };

// The English sentence on the translation that defines harmony (to read beside an OCR hit)
const EN_DEF = /[^.!?]*\b(?:harmony|concord|consonance|attunement|harmonia)\b[^.!?]*\b(?:is|consists|means|called|named|defined|definition)\b[^.!?]*[.!?]?|[^.!?]*\b(?:called|named|termed) (?:a |the )?(?:harmony|concord|consonance)\b[^.!?]*[.!?]?/i;

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const lanes = ['def-la', 'def-grc', 'def-de', 'def-fr', 'def-it', 'def-es', 'def-nl', 'def-zh', 'def-en-ocr', 'def-en-tr'];
const out = [], seenPage = new Set();
const tally = {};
for (const lane of lanes) {
  // the long s is folded once here so every rule below sees "est", not "eſt"
  const rows = read(lane).map((r) => ({ ...r, other: (r.other || '').replace(/ſ/g, 's'), w: r.w.map((w) => ({ ...w, win: w.win.replace(/ſ/g, 's'), match: w.match.replace(/ſ/g, 's') })) }));
  const lang = lane === 'def-en-tr' || lane === 'def-en-ocr' ? 'en' : lane.slice(4);
  for (const r of rows) {
    const key = `${r.id}:${r.p}`;
    // A page already defined in its original language is not counted again from its translation.
    if (lane === 'def-en-tr' && seenPage.has(key)) { tally['dup-of-original'] = (tally['dup-of-original'] || 0) + 1; continue; }
    const b = cat[r.id];
    let kept = 0;
    const seenSent = new Set();
    for (const w of r.w) {
      if (insideApparatus(w.win, w.off)) { tally.apparatus = (tally.apparatus || 0) + 1; continue; }
      const sn = sentence(w.win, w.off, w.match.length, lang === 'zh');
      const sig = sn.pre.slice(-40) + sn.m;
      if (seenSent.has(sig)) continue; seenSent.add(sig);
      const fm = form(lane, w.match, stripApp(sn.pre));
      const definiens = stripApp(fm === 'N' ? sn.pre : fm === 'D' ? sn.pre + ' ' + sn.post : sn.post);
      const sent = stripApp(sn.pre + sn.m + sn.post);
      let kind = fm === 'P' ? 'predication' : 'definition';
      // Latin: a genitive (concordiae est = "belongs to concord") or an accusative without esse is not the subject.
      const latCase = lang === 'la' && fm === 'S' && (/^\S*(?:ae|æ)\b/i.test(w.match) || (/^\S*am\b/i.test(w.match) && !/esse\b/i.test(w.match)));
      if (latCase) kind = 'noise';
      else if (NOISE[lang]?.test(w.win.slice(Math.max(0, w.off - 1), w.off + w.match.length + 3))) kind = 'noise';
      else if (NOISE.en.test(sent)) kind = 'noise';
      else if (fm === 'S' && DESC[lang]?.test(stripApp(sn.post))) kind = 'description';
      else if (lang === 'en' && fm === 'S' && (!EN_HEAD_OK.test(stripApp(sn.pre)) || EN_SUBORD.test(stripApp(sn.pre)) || EN_PASSIVE.test(stripApp(sn.post)))) kind = 'description';
      // "… harmonia est." with nothing after it: harmony is the predicate ("tecum mihi concordia est") or the clause ends.
      else if (definiens.replace(/[\s\p{P}]/gu, '').length < 4) kind = 'predication';
      let fam = fams(lang, definiens), via = 'orig';
      let en = null;
      if (lane !== 'def-en-tr' && lane !== 'def-en-ocr') {
        const tr = stripApp(r.other || '');
        const hit = tr.match(EN_DEF); en = hit ? hit[0].trim().slice(0, 500) : null;
        if (!fam.length && en) { fam = fams('en', en); via = 'en'; }
      }
      out.push({ lane, lang, id: r.id, p: r.p, t: b?.t, a: b?.a, y: year(b), blang: b?.lang, w: b?.w, form: fm, kind, lemma: lemma(w.match), fam: fam.length ? fam : ['F6'], via, locus: lang === 'zh' ? zhLocus(stripApp(w.win)) : undefined, sent: sent.slice(0, 700), definiens: definiens.slice(0, 400), en, fk: fold(definiens).slice(0, 200) });
      kept++;
    }
    if (kept && lane !== 'def-en-tr') seenPage.add(key);
  }
}
fs.writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
for (const o of out) { const k = `${o.lane}/${o.kind}`; tally[k] = (tally[k] || 0) + 1; }
console.log(out.length, 'windows', tally);
