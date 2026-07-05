/**
 * Shared mapping: Wikidata claims → Source Library tradition buckets and
 * coarse occupation groups (#2979 occupation/tradition slice).
 *
 * Used by scripts/maintenance/fetch-wikidata-claims.mjs (label harvest) and
 * scripts/maintenance/build-canonical-entities.mjs (doc assembly). Matching is
 * on ENGLISH LABELS (lowercased substring), not QIDs — labels are stable for
 * these categories and it keeps the tables readable/extensible.
 */

/**
 * Entity-level tradition from claims. Priority:
 *   1. religion (P140) where it is decisive (Judaism/Islam/Indian/East-Asian
 *      religions, Greco-Roman paganism). Christianity is NOT decisive (spans
 *      most buckets) and Buddhism is deliberately left to language (Indian vs
 *      Tibetan/Chinese Buddhism split).
 *   2. native language (P103) — Plato's native Ancient Greek → classical,
 *      regardless of which translations of him we hold. (Sparse on Wikidata:
 *      ~3% of our persons carry it — hence the citizenship tier.)
 *   3. country of citizenship (P27), decisive polities only — Ancient Rome →
 *      classical, Ming dynasty → east_asian, Kingdom of Judah → jewish.
 *      European states deliberately return null here: the book-language
 *      fallback already lands those on 'european'.
 * Returns one of the site's tradition keys, or null (caller falls back to the
 * book-language rollup).
 */
export function traditionFromClaims({ religions = [], nativeLanguages = [], citizenships = [] }) {
  for (const r of religions) {
    const l = (r.label || '').toLowerCase();
    if (!l) continue;
    if (l.includes('judaism') || l.includes('jewish')) return 'jewish';
    if (l.includes('islam') || l.includes('sunni') || l.includes('shia') || l.includes('sufi')) return 'islamic';
    if (l.includes('hinduism') || l.includes('jainism') || l.includes('sikhism')) return 'indian';
    if (l.includes('taoism') || l.includes('daoism') || l.includes('confucian') || l.includes('shinto')) return 'east_asian';
    if (l.includes('ancient roman religion') || l.includes('ancient greek religion') ||
        l.includes('religion in ancient greece') || l.includes('greco-roman')) return 'classical';
  }
  for (const lang of nativeLanguages) {
    const t = nativeLanguageToTradition(lang.label);
    if (t) return t;
  }
  for (const c of citizenships) {
    const t = citizenshipToTradition(c.label);
    if (t) return t;
  }
  return null;
}

/** Citizenship (P27) label → tradition, decisive polities only (else null). */
export function citizenshipToTradition(label) {
  const l = (label || '').toLowerCase();
  if (!l) return null;
  if (l.includes('ancient rome') || l.includes('roman empire') || l.includes('roman republic') ||
      l.includes('classical athens') || l.includes('ancient greece') || l.includes('sparta') ||
      l.includes('byzantine') || l.includes('macedon')) return 'classical';
  if (l.includes('caliphate') || l.includes('ottoman') || l.includes('al-andalus') ||
      l.includes('safavid') || l.includes('seljuk') || l.includes('mamluk') ||
      l.includes('timurid') || l.includes('mughal') || l.includes('ayyubid') ||
      l.includes('qajar') || l.includes('nasrid')) return 'islamic';
  if (l.includes('dynasty') || l.includes('imperial china') || l.includes('western han') ||
      l.includes('eastern han') || l === 'china' || l.includes("people's republic of china") ||
      l === 'japan' || l.includes('joseon') || l === 'korea' || l.includes('tibet') ||
      l === 'vietnam' || l.includes('mongol empire')) return 'east_asian';
  if (l === 'india' || l.includes('british raj') || l.includes('maurya') ||
      l.includes('gupta empire') || l.includes('vijayanagara') || l.includes('maratha')) return 'indian';
  if (l.includes('kingdom of judah') || l.includes('kingdom of israel') || l.includes('judea')) return 'jewish';
  if (l.includes('ancient egypt') || l.includes('assyria') || l.includes('babylon') ||
      l.includes('achaemenid') || l.includes('sasanian') || l.includes('parthian') ||
      l.includes('phoenicia') || l.includes('sumer')) return 'near_eastern';
  return null;
}

/** Native-language (P103) label → tradition. Order matters: specific first. */
export function nativeLanguageToTradition(label) {
  const l = (label || '').toLowerCase();
  if (!l) return null;
  if (l.includes('greek')) return 'classical';
  // P103 'Latin' in practice means Greco-Roman antiquity — medieval and early
  // modern scholars have vernacular native languages on Wikidata.
  if (l.includes('latin') && !l.includes('ladin')) return 'classical';
  if (l.includes('arabic') || l.includes('persian') || l.includes('turkish') || l.includes('pashto')) return 'islamic';
  if (l.includes('hebrew') || l.includes('yiddish') || l.includes('ladino') || l.includes('aramaic')) return 'jewish';
  if (l.includes('sanskrit') || l.includes('pali') || l.includes('prakrit') ||
      l.includes('tamil') || l.includes('telugu') || l.includes('hindi') ||
      l.includes('bengali') || l.includes('marathi') || l.includes('kannada') ||
      l.includes('malayalam') || l.includes('gujarati') || l.includes('punjabi') ||
      l.includes('urdu') || l.includes('kashmiri') || l.includes('odia')) return 'indian';
  if (l.includes('chinese') || l.includes('mandarin') || l.includes('cantonese') ||
      l.includes('japanese') || l.includes('korean') || l.includes('tibetan') ||
      l.includes('mongolian') || l.includes('manchu') || l.includes('vietnamese') ||
      l.includes('burmese') || l.includes('thai') || l.includes('javanese') ||
      l.includes('malay')) return 'east_asian';
  if (l.includes('coptic') || l.includes('egyptian') || l.includes('akkadian') ||
      l.includes('sumerian') || l.includes('syriac') || l.includes('geʿez') ||
      l.includes('geez') || l.includes('amharic') || l.includes('armenian') ||
      l.includes('georgian')) return 'near_eastern';
  if (l.includes('nahuatl') || l.includes('quechua') || l.includes('maya') ||
      l.includes('navajo') || l.includes('maori') || l.includes('aymara') ||
      l.includes('guaran')) return 'indigenous';
  // Any other attested native language (European vernaculars, English, …)
  return 'european';
}

/**
 * Coarse occupation groups for the timeline's "categories of people" lens.
 * Order = display order. An occupation label can hit several groups; an
 * entity's groups are the union over its P106 values.
 */
export const OCCUPATION_GROUPS = [
  { key: 'philosopher',  label: 'Philosophers',       match: ['philosoph', 'logician'] },
  { key: 'theologian',   label: 'Theologians & clergy', match: ['theolog', 'priest', 'bishop', 'pope', 'rabbi', 'imam', 'monk', 'nun', 'cleric', 'cardinal', 'pastor', 'missionary', 'preacher', 'friar', 'abbot', 'lama'] },
  { key: 'mystic',       label: 'Mystics & alchemists', match: ['mystic', 'alchemist', 'astrolog', 'occult', 'kabbal', 'magician', 'hermeticist', 'esoteric', 'diviner', 'prophet'] },
  { key: 'physician',    label: 'Physicians',          match: ['physician', 'surgeon', 'apothecary', 'doctor of medicine', 'medic'] },
  { key: 'scientist',    label: 'Scientists & mathematicians', match: ['mathematician', 'astronomer', 'physicist', 'chemist', 'naturalist', 'botanist', 'scientist', 'engineer', 'geographer', 'cartographer', 'zoologist', 'geologist', 'anatomist', 'inventor'] },
  { key: 'writer',       label: 'Writers & poets',     match: ['writer', 'poet', 'author', 'playwright', 'novelist', 'essayist', 'dramatist'] },
  { key: 'scholar',      label: 'Scholars & historians', match: ['historian', 'philolog', 'grammarian', 'lexicograph', 'librarian', 'professor', 'scholar', 'academic', 'translator', 'orientalist', 'linguist', 'antiquarian'] },
  { key: 'ruler',        label: 'Rulers & statesmen',  match: ['monarch', 'king', 'queen', 'emperor', 'sultan', 'caliph', 'sovereign', 'politician', 'statesman', 'diplomat', 'military', 'general', 'ruler', 'prince', 'duke', 'pharaoh', 'shah'] },
  { key: 'artist',       label: 'Artists & printers',  match: ['painter', 'sculptor', 'engraver', 'printmaker', 'architect', 'composer', 'musician', 'illustrator', 'artist', 'printer', 'publisher', 'bookseller', 'typograph'] },
];

/** P106 labels → sorted unique group keys. */
export function occupationGroupsFor(occupationLabels) {
  const keys = new Set();
  for (const label of occupationLabels) {
    const l = (label || '').toLowerCase();
    if (!l) continue;
    for (const g of OCCUPATION_GROUPS) {
      if (g.match.some((m) => l.includes(m))) keys.add(g.key);
    }
  }
  return OCCUPATION_GROUPS.map((g) => g.key).filter((k) => keys.has(k));
}
