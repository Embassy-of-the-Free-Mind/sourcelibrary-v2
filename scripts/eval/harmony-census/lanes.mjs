// PRIOR ART: scripts/eval/fragment-sort/term-harvest.mjs (#7065) harvests one NAME from the laptop's English FTS mirror;
// a concept census needs definitional SENTENCES in each original language, on the box, so the anchors live here and
// harvest.mjs runs them through Atlas Search (pages_search, the index the /api/search page lane uses). none fits #7117.
//
// A lane = one Atlas Search operator (cheap, token level) that finds candidate pages + one PCRE run server-side over
// the raw field ($regexFindAll), whose matches come back as windows. Atlas `lucene.standard` does not stem or fold
// diacritics, so every inflected or accented form the regex wants must also be in the search query.

const text = (path, words) => ({ text: { path, query: words.join(' ') } });
const phrases = (path, list) => ({ compound: { should: list.map((query) => ({ phrase: { query, path } })), minimumShouldMatch: 1 } });
const termRegex = (path, query) => ({ regex: { path, query, allowAnalyzedField: true } });

const OCR = 'ocr.data', TR = 'translation.data';
// Early prints are often OCR'd with the long s (ſ): "harmonia eſt", "conſonantia". Atlas does not fold it, so OCR
// regexes take [sſ] for every literal s (escapes such as \\s are left alone) and queries carry the ſ forms too.
const ls = (re) => re.replace(/(\\)?s/g, (m, bs) => (bs ? m : '[sſ]'));
const lsWords = (words) => [...new Set([...words, ...words.map((w) => w.replace(/s/g, 'ſ'))])];

// ── A. Definition census ──────────────────────────────────────────────────────────────────────────────────────────
// Each regex matches the place where harmony (or its near-synonyms concord, consonance) is the SUBJECT of a
// definitional verb (is / is called / consists / is defined), or the object of "is called" / "they call".
const LA_SUBJ = '(?:h?armoni(?:a|ae|æ|am)|concordi(?:a|ae|æ|am)|consonanti(?:a|ae|æ|am)|symphoni(?:a|ae|æ|am))';
const LA_PART = '(?:autem|vero|enim|igitur|ergo|itaque|quidem|quoque|ipsa|nam|etiam|tamen|siquidem|proprie|ut|sic)';
const LA = `${LA_SUBJ}(?:[ ,]+${LA_PART}){0,2}[ ,]+(?:nihil (?:aliud )?(?:est|sit)|nil aliud|est|sit|esse|dicitur|dicatur|vocatur|appellatur|nominatur|nuncupatur|definitur|definiri)\\b`
  + `|(?:dicitur|vocatur|appellatur|nominatur|nuncupatur|vocant|appellant|vocamus|appellamus|dicunt)[ ,]+${LA_SUBJ}\\b`
  + `|defini\\w+[^.;]{0,40}${LA_SUBJ}|${LA_SUBJ}[^.;]{0,30}defini\\w+`;

const GR_SUBJ = '(?:[ἁἀαἉἈΑ]ρμον|[σΣ]υμφων)[ιίίἰ](?:α|η|ᾳ|ῃ)';
const GR_PART = '(?:δ[έὲ]|γ[άὰ]ρ|μ[έὲ]ν|ο[ὖυ]ν|τοίνυν|ἄρα|τ[οό]ι|δή)';
const GR = `${GR_SUBJ}[\\s,]+(?:${GR_PART}[\\s,]+){0,2}(?:ἐστ|εστ|εἶναι|εἰναι|ειναι|καλε[ῖι]ται|λ[έε]γεται|ὁρ[ιί]ζ|οριζ)`
  + `|(?:καλε[ῖι]ται|λ[έε]γεται|καλο[ῦυ]σι[νv]?|ὀνομάζ[^\\s]{0,6})[\\s,]+${GR_SUBJ}`
  + `|${GR_SUBJ}[^\\s,.;·]{0,3}[\\s,]+(?:ὅρος|ὁρισμ)|[ἁἀα]ρμονίαν[\\s,]+(?:${GR_PART}[\\s,]+){0,2}(?:εἶναι|εἰναι)`;

const DE_SUBJ = '(?:Harmonie|Harmonia|Eintracht|Zusammenstimmung|Einklang|Zusammenklang|Wohlklang)';
const DE = `${DE_SUBJ}[ ,]+(?:(?:aber|also|nun|denn|eigentlich|selbst|überhaupt|demnach|daher)[ ,]+){0,2}(?:ist|sey|sei|heißt|heisst|heiszt|bedeutet|besteht|nennt man|nennet man|wird (?:genannt|definirt|definiert|erklärt))\\b`
  + `|(?:nennt man|nennet man|heißt|heisst|nennen wir|genannt)[ ,]+(?:die |eine )?${DE_SUBJ}\\b|(?:Definition|Erklärung|Begriff) der (?:Harmonie|Eintracht)`;

const FR_SUBJ = '(?:harmonie|concorde|consonn?ance)';
const FR = `${FR_SUBJ}[ ,]+(?:(?:donc|donq|doncques|ainsi|proprement|aussi|même|mesme)[ ,]+){0,2}(?:est|n['’]est|consiste|signifie|se (?:dit|prend|définit|definit)|s['’]appelle)\\b`
  + `|(?:appelle|appellent|appellons|appelons|nomme|nomment|nommée|appellée|appelée)[ ,]+(?:l['’]|une |la )?${FR_SUBJ}|d[ée]finition de (?:l['’])?${FR_SUBJ}`;

const IT_SUBJ = '(?:h?armonia|concordia|consonanza)';
const IT = `${IT_SUBJ}[ ,]+(?:(?:dunque|adunque|propriamente|ancora|poi|veramente|non)[ ,]+){0,2}(?:è|é|e['’]|altro non è|non è altro|consiste|si (?:dice|chiama|definisce|diffinisce|piglia)|significa|sia)`
  + `|(?:chiamano|chiamiamo|chiamasi|dicesi|detta|chiamata|si chiama)[ ,]+(?:l['’]|la |una )?${IT_SUBJ}|(?:dif|de)finizione d(?:ell['’]|ella )${IT_SUBJ}`;

const ES_SUBJ = '(?:h?armon[íi]a|concordia|consonancia)';
const ES = `${ES_SUBJ}[ ,]+(?:(?:pues|propiamente|no)[ ,]+){0,2}(?:es|consiste|se (?:dize|dice|llama|define|difine)|significa|no es otra cosa)\\b`
  + `|(?:llaman|llamamos|llamada|dicha|se llama|se dize)[ ,]+(?:la |una )?${ES_SUBJ}\\b`;

const NL = '(?:harmonie|eendracht|eendragt)[ ,]+(?:is|bestaat|noemt men)\\b|(?:noemt men|genaamd)[ ,]+(?:de )?(?:harmonie|eendracht)\\b';

// Chinese: "he is …" (和者 / 和也者), "is called he" (謂之和), the soup (和如羹), Shi Bo (和實生物), Analects (和而不同),
// Yanzi on he vs tong (和與同異), and Shi Bo's own definition (以他平他謂之和).
const ZH_LIST = ['和者', '和也者', '謂之和', '谓之和', '和如羹', '和實生物', '和实生物', '和而不同', '和與同異', '和与同异', '以他平他'];
const ZH = '和也?者|謂之和|谓之和|和如羹|和實生物|和实生物|和而不同|和與同異|和与同异|以他平他';

// English (our translations of every language, and English-language originals). A determiner directly before the
// subject ("the harmony is …", "this concord was …") is a description of one harmony, not a definition of harmony.
const EN_SUBJ = '(?:harmony|concord|consonance|attunement|harmonia)';
const EN = `(?<!the |this |that |its |his |her |their |our |your |my |a |whose |which |of |such |same |perfect |sweet |in |and )\\b${EN_SUBJ}(?:,?\\s+(?:then|therefore|thus|however|indeed|moreover|again|properly|in general|itself|truly|accordingly|in fact|in short|strictly|so|now|i say|properly speaking|they say|according to \\w+),?){0,2}\\s+(?:is|consists|means|signifies|denotes|may be defined|can be defined|is defined|is nothing|is said to be|is called)\\b`
  + `|\\b(?:is|are|be) (?:called|named|termed|defined as) (?:a |an |the )?${EN_SUBJ}\\b|\\bdefinition of (?:harmony|concord|consonance)\\b`
  + `|\\b(?:harmony|concord|consonance) (?:may|can|must|should) be defined\\b|\\bwhat (?:harmony|concord|consonance) is\\b`
  + `|\\b(?:they|we|he|some|others|who) (?:call|calls|called|define|defines|defined) (?:it |this |that )?(?:a |the )?(?:harmony|concord|consonance)\\b`;

export const DEF_LANES = [
  { id: 'def-la', family: 'def', lang: 'la', field: OCR, search: text(OCR, lsWords(['harmonia', 'harmoniae', 'harmoniam', 'harmoniæ', 'armonia', 'armoniae', 'armoniam', 'concordia', 'concordiae', 'concordiam', 'concordiæ', 'consonantia', 'consonantiae', 'consonantiam', 'consonantiæ', 'symphonia', 'symphoniae', 'symphoniam'])), regex: ls(LA)},
  { id: 'def-grc', family: 'def', lang: 'grc', field: OCR, search: termRegex(OCR, '[ἁἀαἉἈΑσΣ][ρυ][μφ][οω]ν[ιίίἰ][αηᾳῃ]ν?'), regex: GR },
  { id: 'def-de', family: 'def', lang: 'de', field: OCR, search: text(OCR, lsWords(['Harmonie', 'Harmonia', 'Eintracht', 'Zusammenstimmung', 'Einklang', 'Zusammenklang', 'Wohlklang'])), regex: ls(DE)},
  { id: 'def-fr', family: 'def', lang: 'fr', field: OCR, search: text(OCR, lsWords(['harmonie', 'concorde', 'consonance', 'consonnance'])), regex: ls(FR)},
  { id: 'def-it', family: 'def', lang: 'it', field: OCR, search: text(OCR, lsWords(['armonia', 'harmonia', 'concordia', 'consonanza'])), regex: ls(IT)},
  { id: 'def-es', family: 'def', lang: 'es', field: OCR, search: text(OCR, lsWords(['armonía', 'armonia', 'harmonía', 'harmonia', 'concordia', 'consonancia'])), regex: ls(ES)},
  { id: 'def-nl', family: 'def', lang: 'nl', field: OCR, search: text(OCR, lsWords(['harmonie', 'eendracht', 'eendragt'])), regex: ls(NL)},
  { id: 'def-zh', family: 'def', lang: 'zh', field: OCR, search: phrases(OCR, ZH_LIST), regex: ZH, opts: '' },
  { id: 'def-en-ocr', family: 'def', lang: 'en', field: OCR, search: text(OCR, lsWords(['harmony', 'concord', 'consonance', 'attunement'])), regex: ls(EN)},
  { id: 'def-en-tr', family: 'def', lang: 'en', field: TR, search: text(TR, ['harmony', 'concord', 'consonance', 'attunement', 'harmonia']), regex: EN },
];

// ── B. Five resonance / sympathy topoi ───────────────────────────────────────────────────────────────────────────
// Anchors only; topoi.mjs decides which telling a window is (one sympathy window can be the magnet, the clocks or
// the sympathetic powder).
const SYM_EN = ['sympathy', 'sympathies', 'sympathetic', 'sympathetical', 'sympathetically', 'antipathy', 'antipathies', 'antipathetic', 'antipathetical', 'sympathize', 'sympathise'];
const SYM_OR = ['sympathia', 'sympathiae', 'sympathiam', 'sympathiæ', 'sympathica', 'sympathicus', 'sympatheticum', 'sympathetico', 'sympathetica', 'antipathia', 'antipathiae', 'antipathiam', 'antipathiæ', 'sympathie', 'sympathies', 'sympathique', 'antipathie', 'antipathies', 'simpatia', 'simpatie', 'antipatia', 'antipatie', 'Sympathie', 'Antipathie', 'sympathetische', 'sympathetischen', 'συμπάθεια', 'συμπάθειαν', 'συμπαθείας', 'συμπαθεια', 'ἀντιπάθεια', 'ἀντιπάθειαν', 'simpatía', 'antipatía'];
const SYM_RE = 's[iy]mpat[hií]|antipat[hií]|συμπ[αά]θ|[αἀ]ντιπ[αά]θ';

const UNISON = ['unison', 'unisons', 'unisonus', 'unisona', 'unisonum', 'unisono', 'unisoni', 'unisonae', 'unisonas', 'unisonis', 'unisonantia', 'unisonanza', 'unisson', 'unissons', 'Einklang', 'Unisono', 'unisonance'];
// Chunqiu fanlu's 鼓其宮則他宮應之 … 五音比而自鳴; Shen Kuo's paper riders (紙人) on the answering string (應絃); 律呂正義 絃相應
const ZH_STR2 = ['他宮應之', '宮則他宮', '五音比而自鳴', '自鳴', '紙人', '纸人', '應絃', '应弦', '絃相應', '弦相应'];
const ZH_STR = ['宮動', '角動', '宫动', '同聲相應', '同聲相和', '同声相应', '同声相和', '同類相動', '同类相动', '鼓宮', '鼓宫'];

const WOLF_RE_EN = 'wol(?:f|ves)[\\s\\S]{0,250}?(?:drum|tabor|timbrel|tambour|tympan|string|lute|lyre|harp|gut)|(?:drum|tabor|timbrel|tambour|tympan)[\\s\\S]{0,250}?wol(?:f|ves)';
const WOLF_RE_LA = 'lup[a-z]*[\\s\\S]{0,200}?(?:tympan|chord|fid[ie]|nerv|cithar|lyr)|(?:tympan|chord|cithar|lyr)[a-z]*[\\s\\S]{0,200}?lup[a-z]';
const WOLF_RE_VN = '(?:lup[oi]\\b|loups?\\b|wolf)[\\s\\S]{0,200}?(?:tambur|tambour|trommel|pauke|paucke|corde|saite)|(?:tambur|tambour|trommel|pauke|paucke)[\\s\\S]{0,200}?(?:lup[oi]\\b|loups?\\b|wolf)';

const MAG_EN = ['lodestone', 'lodestones', 'loadstone', 'loadstones', 'load-stone', 'magnet', 'magnets', 'magnes'];
const MAG_LA = ['magnes', 'magnetis', 'magnetem', 'magnete', 'magneti', 'magnetica', 'magneticus', 'magneticum', 'calamita', 'aimant', 'Magnet', 'Magnetstein', 'μαγνῆτις', 'μάγνης', 'Ἡρακλεία'];
const ZH_MAG = ['慈石', '磁石'];

const SALVE_EN = 'weapon[- ]?salve|weapon[- ]ointment|armary unguent|unguentum armarium|salve (?:of|for) (?:the )?weapons?|anoint\\w* the (?:weapon|sword|blade)|ointment[^.]{0,80}weapon|weapon[^.]{0,80}ointment|powder of sympathy|sympathetic(?:al)? (?:powder|ointment|cure|unguent)';
const SALVE_OR = 'unguent[a-z]*[^.]{0,40}(?:armari|armor|teli|telor|sympath)|(?:armari|sympathetic)[a-z]*[^.]{0,20}unguent|pulv[a-z]*[^.]{0,20}sympath|waffen-?salb|sympathetisch[a-z]* (?:pulver|cur|salb)|onguent[^.]{0,30}arm|poudre (?:de )?sympath|unguento[^.]{0,30}arm|polvere (?:di )?simpat';

const CLOCK_EN = '(?:two|both|pair of|the) (?:clocks|pendulums|pendula|timepieces|watches)[\\s\\S]{0,300}?(?:sympath|agree|together|same time|keep time|in step|consent|correspond)';

export const TOPOS_LANES = [
  { id: 'sym-tr', family: 'topos', lang: 'en', field: TR, search: text(TR, SYM_EN), regex: SYM_RE },
  { id: 'sym-ocr', family: 'topos', lang: '*', field: OCR, search: text(OCR, [...SYM_EN, ...SYM_OR]), regex: SYM_RE },
  { id: 'sym-ocr-ls', family: 'topos', lang: '*', field: OCR, search: text(OCR, [...SYM_EN, ...SYM_OR].filter((w) => w.includes('s')).map((w) => w.replace(/s/g, 'ſ'))), regex: ls(SYM_RE) },
  { id: 'str-ocr', family: 'topos', lang: '*', field: OCR, search: text(OCR, UNISON), regex: 'unis{1,2}on|einklang' },
  { id: 'str-tr', family: 'topos', lang: 'en', field: TR, search: text(TR, ['unison', 'unisons']), regex: 'unison' },
  { id: 'str-zh', family: 'topos', lang: 'zh', field: OCR, search: phrases(OCR, ZH_STR), regex: ZH_STR.join('|'), opts: '' },
  { id: 'str-zh2', family: 'topos', lang: 'zh', field: OCR, search: phrases(OCR, ZH_STR2), regex: ZH_STR2.join('|'), opts: '' },
  { id: 'wolf-tr', family: 'topos', lang: 'en', field: TR, search: text(TR, ['wolf', 'wolves', "wolf's", 'wolfskin']), regex: WOLF_RE_EN },
  { id: 'wolf-ocr-en', family: 'topos', lang: 'en', field: OCR, search: text(OCR, ['wolf', 'wolves', "wolf's", 'wolfskin']), regex: WOLF_RE_EN },
  { id: 'wolf-la', family: 'topos', lang: 'la', field: OCR, search: text(OCR, ['lupus', 'lupi', 'lupo', 'lupum', 'luporum', 'lupinus', 'lupina', 'lupinae', 'lupino', 'lupinis', 'lupinum', 'lupinam', 'lupinarum', 'lupinorum']), regex: WOLF_RE_LA },
  { id: 'wolf-vern', family: 'topos', lang: '*', field: OCR, search: text(OCR, ['lupo', 'lupi', 'loup', 'loups', 'Wolf', 'Wolfs', 'Wolfes', 'Wolffs', 'Wölfe']), regex: WOLF_RE_VN },
  { id: 'mag-tr', family: 'topos', lang: 'en', field: TR, search: text(TR, MAG_EN), regex: 'lo[a]?d-?stone|magnet|magnes' },
  { id: 'mag-ocr', family: 'topos', lang: '*', field: OCR, search: text(OCR, [...MAG_EN, ...MAG_LA]), regex: 'lo[a]?d-?stone|magne[st]|calamit|aimant|μαγν|μάγν' },
  { id: 'mag-zh', family: 'topos', lang: 'zh', field: OCR, search: phrases(OCR, ZH_MAG), regex: '[慈磁]石', opts: '' },
  { id: 'salve-tr', family: 'topos', lang: 'en', field: TR, search: text(TR, ['weapon', 'weapons', 'weapon-salve', 'salve', 'ointment', 'unguent', 'powder']), regex: SALVE_EN },
  { id: 'salve-ocr', family: 'topos', lang: '*', field: OCR, search: text(OCR, ['weapon-salve', 'weapon', 'unguentum', 'unguenti', 'unguento', 'armarium', 'armarii', 'Waffensalbe', 'Waffen-Salbe', 'onguent', 'unguento', 'poudre', 'polvere', 'pulvis', 'pulveris', 'pulvere', 'sympatheticus', 'sympatheticum', 'sympathetischen', 'sympathetische']), regex: SALVE_OR + '|' + SALVE_EN },
  { id: 'clock-tr', family: 'topos', lang: 'en', field: TR, search: text(TR, ['clocks', 'pendulums', 'pendula', 'timepieces']), regex: CLOCK_EN },
  { id: 'clock-ocr', family: 'topos', lang: '*', field: OCR, search: text(OCR, ['clocks', 'pendulums', 'horloges', 'pendules', 'horologia', 'horologiis', 'Uhren', 'orologi', 'pendula']), regex: '(?:clocks|pendul|horloge|horolog|uhren|orologi)[\\s\\S]{0,300}?(?:sympath|simpat|consens|accord|ensemble|zusammen)' },
];

// ── Cross-cultural resonance table (Derek's note, 2026-10-22): native terms not covered above ───────────────────
export const XC_LANES = [
  { id: 'xc-kanno', family: 'xc', lang: 'ja', field: OCR, search: phrases(OCR, ['感応', '感應', '感通']), regex: '感[応應通]', opts: '' },
  { id: 'xc-humours', family: 'xc', lang: 'en', field: TR, search: text(TR, ['humours', 'humors', 'humour', 'humor', 'bile', 'phlegm']), regex: '(?:strings?|zir|bamm|mathna|mathlath|lute)[\\s\\S]{0,200}?(?:humou?rs?|bile|phlegm)|(?:humou?rs?|bile|phlegm)[\\s\\S]{0,200}?(?:strings?|zir|bamm|mathna|mathlath|lute)' },
  { id: 'xc-nada', family: 'xc', lang: 'en', field: TR, search: text(TR, ['nada', 'nāda', 'anahata', 'anāhata', 'taraf', 'tarab', 'sympathetic']), regex: 'n[aā]da\\b|an[aā]hata|\\btaraf|sympathetic strings?' },
];

export const LANES = [...DEF_LANES, ...TOPOS_LANES, ...XC_LANES];
