/**
 * Rule-based Latin morphology for dictionary lookup — deliberately honest
 * about being heuristic. Two jobs:
 *
 *  1. Import time: generate inflected-form paradigms for Lewis & Short
 *     entries (nouns from declension+genitive, verbs from principal parts,
 *     adjectives from headword shape) to build the `lexicon_lemma_map`
 *     collection. Over-generation is acceptable: every generated form maps
 *     back to its own entry key, so junk forms are unreachable noise, not
 *     wrong answers.
 *
 *  2. Query time: irregular-form table + suffix-swap candidate generation as
 *     a fallback tier when a form isn't in the map.
 *
 * All inputs and outputs are NORMALIZED strings (see normalize.ts) — v→u,
 * j→i, no diacritics. Tables below are written in normalized orthography.
 */

// ---------------------------------------------------------------------------
// Irregular forms (query-time tier). form → lemma headwords (normalized).
// ---------------------------------------------------------------------------

const IRR: Record<string, string[]> = {};
function irr(lemma: string, forms: string) {
  for (const f of forms.split(/\s+/)) {
    if (!f) continue;
    (IRR[f] ||= []).push(lemma);
  }
}

irr(
  'sum',
  `sum es est sumus estis sunt eram eras erat eramus eratis erant ero eris erit
   erimus eritis erunt fui fuisti fuit fuimus fuistis fuerunt fueram fuerat
   fuerant fuero fuerit fuerint sim sis sit simus sitis sint essem esses esset
   essemus essetis essent forem fores foret forent esse fuisse fore futurus
   futura futurum futuri futurae futuro futuram futuros futuras futurorum
   futurarum futuris este esto`
);
irr(
  'possum',
  `possum potes potest possumus potestis possunt poteram poterat poterant
   potero poterit poterunt potui potuit potuerunt potuerat potuerit possim
   possit possint possem posset possent posse potuisse potens potentis potenti
   potentem potente potentes potentium potentibus`
);
irr(
  'uolo',
  `uolo uis uult uolt uolumus uultis uolunt uolebam uolebat uolebant uolam
   uolet uolent uolui uoluit uoluerunt uelim uelis uelit uelimus uelitis
   uelint uellem uelles uellet uellent uelle uoluisse uolens uolentis uolenti
   uolentem uolentes`
);
irr('nolo', `nolo non-uis nolumus nolunt nolebat nolui noluit nolim nolit nollem nollet nolle noli nolite nolens`);
irr('malo', `malo mauis mauult malumus mauultis malunt malebat malui maluit malim malit mallem mallet malle`);
irr(
  'fero',
  `fero fers fert ferimus fertis ferunt ferebam ferebat ferebant feram feret
   ferent tuli tulisti tulit tulimus tulistis tulerunt tuleram tulerat tulero
   tulerit feram ferat ferant ferrem ferret ferrent ferre tulisse ferens
   ferentis ferenti ferentem ferentes ferentibus latus lata latum lati latae
   lato latam latos latas latorum latarum latis feror fertur feruntur ferri
   fer ferte`
);
irr(
  'eo1',
  `eo is it imus itis eunt ibam ibas ibat ibamus ibatis ibant ibo ibis ibit
   ibimus ibitis ibunt ii iui iit iuit iimus ierunt iuerunt ieram ierat ierant
   iero ierit eam eas eat eamus eatis eant irem ires iret iremus iretis irent
   ire isse iuisse iens euntis eunti euntem euntes euntium euntibus itum itus
   ita iturus itura iturum i ite`
);
irr('fio', `fio fis fit fimus fitis fiunt fiebam fiebat fiebant fiam fiet fient fiam fiat fiant fierem fieret fierent fieri factus facta factum facti factae facto factam factos factas factorum factarum factis`);
irr('edo1', `edo edis est edimus editis edunt edi esse esum`);

// Pronouns & determiners — the highest-frequency words in any Latin text.
irr('hic', `hic haec hoc huius huic hunc hanc hi hae horum harum his hos has`);
irr('qui1', `qui quae quod cuius cui quem quam quo qua quorum quarum quibus quos quas quicumque quaecumque quodcumque`);
irr('quis1', `quis quid cuius cui quem quo`);
irr('is', `is ea id eius ei eum eam eo ii ei eae eorum earum iis eis eos eas idem`);
irr('ille', `ille illa illud illius illi illum illam illo illorum illarum illis illos illas`);
irr('iste', `iste ista istud istius isti istum istam isto istorum istarum istis istos istas`);
irr('ipse', `ipse ipsa ipsum ipsius ipsi ipsum ipsam ipso ipsorum ipsarum ipsis ipsos ipsas`);
irr('idem', `idem eadem eiusdem eidem eundem eandem eodem eadem eidem eorundem earundem eisdem iisdem eosdem easdem`);
irr('ego', `ego mei mihi me mecum nos nostri nostrum nobis nobiscum`);
irr('tu', `tu tui tibi te tecum uos uestri uestrum uobis uobiscum`);
irr('sui', `sui sibi se sese secum`);
irr('nemo', `nemo neminis nemini neminem`);
irr('quisquam', `quisquam quidquam quicquam cuiusquam cuiquam quemquam quicquid quidquid`);
irr('nihil', `nihil nihilum nihili nihilo nil`);
irr('duo', `duo duae duorum duarum duobus duabus duos duas`);
irr('tres', `tres tria trium tribus`);
irr('unus', `unus una unum unius uni unam uno`);
irr('alius', `alius alia aliud alius alii aliud aliam alio aliorum aliarum aliis alios alias`);
irr('uterque', `uterque utraque utrumque utriusque utrique utrumque utramque utroque`);
irr('quisque', `quisque quaeque quodque quidque cuiusque cuique quemque quamque quoque`);
irr('quidam', `quidam quaedam quoddam quiddam cuiusdam cuidam quendam quandam quodam quadam quorundam quarundam quibusdam quosdam quasdam`);

// Irregular comparison — the classical suppletives.
irr('bonus', `melior melioris meliori meliorem meliore meliores meliorum melioribus melius optimus optima optimum optimi optimae optimo optimam optimos optimas optimorum optimarum optimis optime`);
irr('malus3', `peior peioris peiorem peiores peiorum peioribus peius pessimus pessima pessimum pessimi pessimae pessimo pessimis pessime`);
irr('magnus', `maior maioris maiori maiorem maiore maiores maiorum maioribus maius maximus maxima maximum maximi maximae maximo maximam maximos maximorum maximis maxime`);
irr('paruus', `minor minoris minorem minores minorum minoribus minus minimus minima minimum minimi minimae minimo minimis minime`);
irr('multus', `plus pluris plura plurium pluribus plures plurimus plurima plurimum plurimi plurimae plurimo plurimis plurimum`);

/** Irregular-forms lookup. Returns candidate lemma headwords (normalized). */
export function irregularLemmas(normalizedWord: string): string[] {
  return IRR[normalizedWord] ?? [];
}

// ---------------------------------------------------------------------------
// Shared paradigm ending tables (normalized orthography).
// ---------------------------------------------------------------------------

const DECL_1 = ['a', 'ae', 'am', 'as', 'arum', 'is'];
const DECL_2_MASC = ['us', 'i', 'o', 'um', 'e', 'os', 'orum', 'is'];
const DECL_2_NEUT = ['um', 'i', 'o', 'a', 'orum', 'is'];
const DECL_3_ENDINGS = ['is', 'i', 'em', 'e', 'es', 'um', 'ium', 'ibus', 'a', 'ia'];
const DECL_4 = ['us', 'ui', 'um', 'u', 'uum', 'ibus'];
const DECL_5 = ['es', 'ei', 'em', 'e', 'erum', 'ebus'];
const ADJ_212 = ['us', 'a', 'um', 'i', 'ae', 'o', 'am', 'os', 'as', 'orum', 'arum', 'is', 'e'];

/**
 * Derive oblique-stem candidates from headword + printed genitive suffix
 * (e.g. corpus + "oris" → corpor-). Dictionary suffix conventions are not
 * fully deterministic, so this over-generates candidates; junk stems produce
 * junk forms that map to the right entry and are simply never queried.
 */
export function obliqueStems(head: string, genSuffix: string): string[] {
  const gs = genSuffix;
  const out = new Set<string>();
  let tail = '';
  if (gs.endsWith('is')) tail = gs.slice(0, -2);
  else if (gs.endsWith('i')) tail = gs.slice(0, -1);
  else if (gs.endsWith('us') || gs.endsWith('ei') || gs.endsWith('ae')) tail = '';
  else return [];

  // Rule 1: strip a known nominative ending, append the suffix stem-tail.
  for (const strip of ['us', 'is', 'es', 'er', 'ir', 'or', 'en', 'on', 'o', 'x', 's', 'e', 'a', 'um', '']) {
    if (strip && !head.endsWith(strip)) continue;
    if (!strip && !tail) continue; // bare headword handled by caller
    const stem = head.slice(0, head.length - strip.length) + tail;
    if (stem.length >= 2) out.add(stem);
  }
  // Rule 2: printed convention "ager, gri" — replace from the last
  // occurrence of the suffix's first letter.
  if (tail) {
    const idx = head.lastIndexOf(tail[0]);
    if (idx > 0) out.add(head.slice(0, idx) + tail);
  }
  // Rule 3: the "suffix" is really a full genitive form ("rex, regis").
  if (tail && gs.length >= 4 && gs[0] === head[0]) out.add(tail);
  if (!tail) out.add(head.replace(/(us|es|ae|a|um)$/, ''));
  return [...out];
}

/**
 * Reverse-nominative stem guesses for 3rd-declension entries that carry no
 * genitive in the source data (rex → reg-/rec-, corpus → corpor-, …).
 * Over-generates; see note at top.
 */
export function guessThirdDeclStems(head: string): string[] {
  const out = new Set<string>();
  const rules: Array<[RegExp, string[]]> = [
    [/x$/, ['g', 'c']],
    [/as$/, ['at']],
    [/us$/, ['or', 'er', 'ur']],
    [/is$/, ['']],
    [/es$/, ['', 'it']],
    [/o$/, ['on', 'in']],
    [/en$/, ['in']],
    [/ut$/, ['it']],
    [/er$/, ['r']],
    [/or$/, ['or']],
    [/(b|l|n|r)s$/, ['$1']],
  ];
  for (const [re, tails] of rules) {
    if (!re.test(head)) continue;
    for (const t of tails) {
      const stem = head.replace(re, t.startsWith('$') ? '$1' : t);
      if (stem.length >= 2 && stem !== head) out.add(stem);
    }
  }
  return [...out];
}

export function nounForms(head: string, declension: number, genSuffix: string | undefined): string[] {
  const forms = new Set<string>([head]);
  const add = (stem: string, endings: string[]) => {
    for (const e of endings) forms.add(stem + e);
  };
  switch (declension) {
    case 1:
      if (head.endsWith('a')) add(head.slice(0, -1), DECL_1);
      break;
    case 2:
      if (head.endsWith('us')) add(head.slice(0, -2), DECL_2_MASC);
      else if (head.endsWith('um')) add(head.slice(0, -2), DECL_2_NEUT);
      else if (genSuffix) for (const s of obliqueStems(head, genSuffix)) add(s, ['i', 'o', 'um', 'orum', 'os', 'is', 'e']);
      break;
    case 3:
      if (genSuffix) for (const s of obliqueStems(head, genSuffix)) add(s, DECL_3_ENDINGS);
      else for (const s of guessThirdDeclStems(head)) add(s, DECL_3_ENDINGS);
      break;
    case 4:
      if (head.endsWith('us')) add(head.slice(0, -2), DECL_4);
      else if (head.endsWith('u')) add(head.slice(0, -1), ['u', 'us', 'ua', 'uum', 'ibus']);
      break;
    case 5:
      if (head.endsWith('es')) add(head.slice(0, -2), DECL_5);
      break;
  }
  return [...forms];
}

export function adjectiveForms(head: string): string[] {
  const forms = new Set<string>([head]);
  const add = (stem: string, endings: string[]) => {
    for (const e of endings) forms.add(stem + e);
  };
  if (head.endsWith('us')) {
    const stem = head.slice(0, -2);
    add(stem, ADJ_212);
    add(stem, ['ior', 'ioris', 'iori', 'iorem', 'iore', 'iores', 'iorum', 'ioribus', 'ius']); // comparative
    add(stem, ['issimus', 'issima', 'issimum', 'issimi', 'issimae', 'issimo', 'issimam', 'issimis', 'issime']); // superlative
    forms.add(stem + 'e'); // adverb
  } else if (head.endsWith('is')) {
    const stem = head.slice(0, -2);
    add(stem, ['is', 'e', 'em', 'i', 'es', 'ia', 'ium', 'ibus', 'iter', 'ior', 'ioris', 'iorem', 'iores', 'issimus', 'issime']);
  } else if (head.endsWith('er')) {
    add(head, ['i', 'o', 'um', 'os', 'orum', 'is']);
    // Both stem shapes: pulcher → pulchr-a, but alter → alter-a keeps the e.
    for (const stem of [head.slice(0, -2) + 'r', head]) {
      add(stem, ['a', 'um', 'i', 'ae', 'o', 'am', 'os', 'as', 'orum', 'arum', 'is', 'e']);
    }
  } else if (head.endsWith('x')) {
    // ferax, feracis — 3rd declension in -x, one termination.
    const stem = head.slice(0, -1) + 'c';
    add(stem, ['is', 'i', 'em', 'e', 'es', 'ia', 'ium', 'ibus', 'ior', 'ioris', 'iorem', 'iores', 'issimus', 'issima', 'issimum', 'issime', 'iter']);
  } else if (head.endsWith('ns')) {
    const stem = head.slice(0, -2) + 'nt';
    add(stem, ['is', 'i', 'em', 'e', 'es', 'ium', 'ibus', 'ia', 'er']);
  }
  return [...forms];
}

// ---------------------------------------------------------------------------
// Verb paradigms.
// ---------------------------------------------------------------------------

const PERFECT_ENDINGS = [
  'i', 'isti', 'it', 'imus', 'istis', 'erunt', 'ere',
  'eram', 'eras', 'erat', 'eramus', 'eratis', 'erant',
  'ero', 'erit', 'erimus', 'eritis', 'erint',
  'erim', 'eris',
  'isse', 'issem', 'isses', 'isset', 'issemus', 'issetis', 'issent',
];

interface ConjTable {
  active: string[];
  passive: string[];
  infinitives: string[];
  imperatives: string[];
  participleStems: string[]; // present participle: stem+ns / stem+nt-…
  gerundStem: string; // +ndum etc.
}

// Endings are applied to the present stem (headword minus -o / -or).
const CONJ: Record<string, ConjTable> = {
  '1': {
    active: ['o', 'as', 'at', 'amus', 'atis', 'ant', 'abam', 'abas', 'abat', 'abamus', 'abatis', 'abant',
      'abo', 'abis', 'abit', 'abimus', 'abitis', 'abunt', 'em', 'es', 'et', 'emus', 'etis', 'ent',
      'arem', 'ares', 'aret', 'aremus', 'aretis', 'arent'],
    passive: ['or', 'aris', 'atur', 'amur', 'amini', 'antur', 'abar', 'abaris', 'abatur', 'abamur', 'abamini', 'abantur',
      'abor', 'aberis', 'abitur', 'abimur', 'abimini', 'abuntur', 'er', 'eris', 'etur', 'emur', 'emini', 'entur',
      'arer', 'areris', 'aretur', 'aremur', 'aremini', 'arentur'],
    infinitives: ['are', 'ari'],
    imperatives: ['a', 'ate', 'ator', 'antor'],
    participleStems: ['ans|ant'],
    gerundStem: 'and',
  },
  '2': {
    // stem already ends in e (uide-)
    active: ['o', 's', 't', 'mus', 'tis', 'nt', 'bam', 'bas', 'bat', 'bamus', 'batis', 'bant',
      'bo', 'bis', 'bit', 'bimus', 'bitis', 'bunt', 'am', 'as', 'at', 'amus', 'atis', 'ant',
      'rem', 'res', 'ret', 'remus', 'retis', 'rent'],
    passive: ['or', 'ris', 'tur', 'mur', 'mini', 'ntur', 'bar', 'baris', 'batur', 'bamur', 'bamini', 'bantur',
      'bor', 'beris', 'bitur', 'bimur', 'bimini', 'buntur', 'ar', 'aris', 'atur', 'amur', 'amini', 'antur',
      'rer', 'reris', 'retur', 'remur', 'remini', 'rentur'],
    infinitives: ['re', 'ri'],
    imperatives: ['', 'te', 'tor', 'ntor'],
    participleStems: ['ns|nt'],
    gerundStem: 'nd',
  },
  '3': {
    active: ['o', 'is', 'it', 'imus', 'itis', 'unt', 'ebam', 'ebas', 'ebat', 'ebamus', 'ebatis', 'ebant',
      'am', 'es', 'et', 'emus', 'etis', 'ent', 'as', 'at', 'amus', 'atis', 'ant',
      'erem', 'eres', 'eret', 'eremus', 'eretis', 'erent'],
    passive: ['or', 'eris', 'itur', 'imur', 'imini', 'untur', 'ebar', 'ebaris', 'ebatur', 'ebamur', 'ebamini', 'ebantur',
      'ar', 'aris', 'atur', 'amur', 'amini', 'antur',
      'erer', 'ereris', 'eretur', 'eremur', 'eremini', 'erentur'],
    infinitives: ['ere', 'i'],
    imperatives: ['e', 'ite', 'ito', 'itor', 'untor'],
    participleStems: ['ens|ent'],
    gerundStem: 'end',
  },
  '3io': {
    // stem ends in i (capi-); imperfect-subjunctive/infinitive drop it (cap-ere)
    active: ['o', 's', 't', 'mus', 'tis', 'unt', 'ebam', 'ebas', 'ebat', 'ebamus', 'ebatis', 'ebant',
      'am', 'es', 'et', 'emus', 'etis', 'ent', 'as', 'at', 'amus', 'atis', 'ant'],
    passive: ['or', 'tur', 'mur', 'mini', 'untur', 'ebar', 'ebatur', 'ebantur', 'ar', 'atur', 'antur'],
    infinitives: [],
    imperatives: ['', 'te'],
    participleStems: ['ens|ent'],
    gerundStem: 'end',
  },
  '4': {
    active: ['o', 's', 't', 'mus', 'tis', 'unt', 'ebam', 'ebas', 'ebat', 'ebamus', 'ebatis', 'ebant',
      'am', 'es', 'et', 'emus', 'etis', 'ent', 'as', 'at', 'amus', 'atis', 'ant',
      'rem', 'res', 'ret', 'remus', 'retis', 'rent'],
    passive: ['or', 'ris', 'tur', 'mur', 'mini', 'untur', 'ebar', 'ebatur', 'ebantur', 'ar', 'atur', 'antur',
      'rer', 'retur', 'rentur'],
    infinitives: ['re', 'ri'],
    imperatives: ['', 'te', 'unto'],
    participleStems: ['ens|ent'],
    gerundStem: 'end',
  },
};

const PARTICIPLE_NT_ENDINGS = ['is', 'i', 'em', 'e', 'es', 'ium', 'ibus', 'ia'];
const GERUND_ENDINGS = ['us', 'a', 'um', 'i', 'ae', 'o', 'am', 'os', 'as', 'orum', 'arum', 'is'];

/**
 * Attach an abbreviated principal-part token ("aui", "xi", "ct") to the
 * present stem. Dictionary abbreviation conventions vary, so this returns
 * several candidates (see over-generation note at top).
 */
export function principalPartStems(head: string, token: string): string[] {
  const presStem = head.replace(/or?$/, '');
  const out = new Set<string>();
  if (token.length >= 4 && token[0] === head[0]) out.add(token); // full form, e.g. "uidi"
  out.add(presStem + token);
  if (presStem.length > 2) out.add(presStem.slice(0, -1) + token);
  if (presStem.length > 3) out.add(presStem.slice(0, -2) + token);
  return [...out].filter((s) => s.length >= 3);
}

export function verbForms(
  head: string,
  conjugation: 1 | 2 | 3 | 4,
  perfectStems: string[],
  supineStems: string[]
): string[] {
  const deponent = head.endsWith('or');
  const presStem = head.replace(/or?$/, '');
  const io3 = conjugation === 3 && presStem.endsWith('i');
  const table = CONJ[io3 ? '3io' : String(conjugation)];
  const forms = new Set<string>([head]);
  const add = (stem: string, endings: string[]) => {
    for (const e of endings) forms.add(stem + e);
  };

  add(presStem, table.active);
  add(presStem, table.passive);
  add(presStem, table.infinitives);
  add(presStem, table.imperatives);
  for (const p of table.participleStems) {
    const [nom, oblique] = p.split('|');
    forms.add(presStem + nom);
    add(presStem + oblique, PARTICIPLE_NT_ENDINGS);
  }
  add(presStem + table.gerundStem, GERUND_ENDINGS);
  if (io3) {
    // cap-ere, cap-erem, cap-eris…
    const short = presStem.slice(0, -1);
    add(short, ['ere', 'erem', 'eres', 'eret', 'eremus', 'eretis', 'erent', 'eris', 'erer', 'eretur', 'i', 'e', 'ite']);
  }
  for (const ps of perfectStems) {
    add(ps, PERFECT_ENDINGS);
    // Syncopated perfects: amauisse → amasse, amauerunt → amarunt;
    // audiuisse → audisse, audiuerunt → audierunt.
    if (ps.endsWith('au')) {
      add(ps.slice(0, -2), ['asse', 'assem', 'asses', 'asset', 'assemus', 'assetis', 'assent',
        'asti', 'astis', 'arunt', 'aram', 'aras', 'arat', 'aramus', 'arant', 'aro', 'arit', 'arint']);
    } else if (ps.endsWith('iu')) {
      add(ps.slice(0, -1), ['sse', 'ssem', 'sset', 'ssent', 'sti', 'stis', 'erunt', 'erat', 'erant', 'ero', 'erit']);
    }
  }
  for (const ss of supineStems) {
    add(ss, GERUND_ENDINGS); // perfect participle: -us -a -um…
    add(ss + 'ur', GERUND_ENDINGS); // future participle: -urus…
    forms.add(ss + 'u');
    forms.add(ss + 'um');
  }
  if (deponent) forms.add(head);
  return [...forms].filter((f) => f.length >= 2);
}

// ---------------------------------------------------------------------------
// Query-time fallback: suffix-swap candidate headwords for an unknown form.
// ---------------------------------------------------------------------------

const SUFFIX_SWAPS: Array<[string, string[]]> = [
  ['ibus', ['', 'is', 's', 'us']],
  ['orum', ['us', 'um', 'i']],
  ['arum', ['a']],
  ['erunt', ['o', 'i']],
  ['issent', ['o']],
  ['isset', ['o']],
  ['isse', ['o']],
  ['issimus', ['us', 'is']],
  ['issima', ['us', 'is']],
  ['issimum', ['us', 'is']],
  ['ionis', ['io']],
  ['ione', ['io']],
  ['ionem', ['io']],
  ['iones', ['io']],
  ['ionum', ['io']],
  ['ionibus', ['io']],
  ['atur', ['o', 'or']],
  ['antur', ['o', 'or']],
  ['etur', ['eo', 'o', 'eor']],
  ['itur', ['o', 'io']],
  ['untur', ['o']],
  ['abat', ['o']],
  ['ebat', ['eo', 'o']],
  ['abant', ['o']],
  ['ebant', ['eo', 'o']],
  ['auit', ['o']],
  ['euit', ['eo']],
  ['iuit', ['io']],
  ['atus', ['o', 'us']],
  ['ata', ['o', 'us']],
  ['atum', ['o', 'us']],
  ['ati', ['o', 'us']],
  ['atis', ['o', 'a', 'us']],
  ['ntis', ['ns', 'o']],
  ['ntem', ['ns', 'o']],
  ['ntes', ['ns', 'o']],
  ['ntia', ['ns', 'o']],
  ['ntium', ['ns', 'o']],
  ['ndi', ['o', 'us']],
  ['ndo', ['o', 'us']],
  ['ndum', ['o', 'us']],
  ['nda', ['o', 'us']],
  ['are', ['o']],
  ['ari', ['o', 'or']],
  ['ere', ['eo', 'o']],
  ['ire', ['io']],
  ['amus', ['o']],
  ['emus', ['eo', 'o']],
  ['imus', ['o', 'io']],
  ['atis', ['o']],
  ['etis', ['eo', 'o']],
  ['itis', ['o', 'io']],
  ['ant', ['o']],
  ['ent', ['eo', 'o']],
  ['unt', ['o']],
  ['iunt', ['io']],
  ['at', ['o', 'a']],
  ['et', ['eo', 'o']],
  ['it', ['o', 'io', 'eo']],
  ['as', ['o', 'a']],
  ['es', ['o', 'eo', 'is', 'es', '']],
  ['is', ['is', '', 's', 'us', 'o', 'a']],
  ['ae', ['a']],
  ['am', ['a', 'o']],
  ['a', ['a', 'um', 'us']],
  ['os', ['us']],
  ['um', ['us', 'um', 'a', '']],
  ['o', ['us', 'um', 'o']],
  ['i', ['us', 'um', '', 'is', 'o']],
  ['em', ['is', '', 's']],
  ['e', ['is', 'us', '']],
  ['u', ['us']],
  ['us', ['us']],
];

/**
 * Long-s OCR error variants: early modern ſ is routinely misread as f
 * ("fpiffandi" for spissandi, "refina" for resina). Generate f→s
 * substitution variants, bounded to 15 combinations. Lowest-confidence tier.
 */
export function longSVariants(word: string): string[] {
  const positions: number[] = [];
  for (let i = 0; i < word.length && positions.length < 4; i++) if (word[i] === 'f') positions.push(i);
  if (!positions.length) return [];
  const out: string[] = [];
  for (let mask = 1; mask < 1 << positions.length; mask++) {
    const chars = word.split('');
    for (let b = 0; b < positions.length; b++) if (mask & (1 << b)) chars[positions[b]] = 's';
    out.push(chars.join(''));
  }
  return out;
}

/** Candidate headwords for an unknown normalized form, best-guess order. */
export function suffixSwapCandidates(word: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([word]);
  for (const [suffix, replacements] of SUFFIX_SWAPS) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, word.length - suffix.length);
    if (stem.length < 2) continue;
    for (const r of replacements) {
      const cand = stem + r;
      if (cand.length >= 2 && !seen.has(cand)) {
        seen.add(cand);
        out.push(cand);
      }
    }
  }
  return out;
}
