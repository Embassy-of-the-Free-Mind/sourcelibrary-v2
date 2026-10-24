/**
 * Read a request typed in plain words into catalogue filters.
 *
 * "Latin books on plague remedies printed before 1600" becomes
 * language Latin · printed until 1600 · about "plague remedies". Everything is
 * read against the library's own vocabulary — its languages, its subjects —
 * with no model call, so it costs nothing, answers instantly, and cannot
 * invent a filter the catalogue does not have. Whatever it cannot place is
 * left as the topic, which the full-text search then answers.
 *
 * The page shows every filter this produces as a removable chip and fills
 * Advanced search with it, so a misreading is visible and one click to undo.
 *
 * PRIOR ART: PR #4236 (/api/catalog/ask) did this with gemini-3.1-flash-lite;
 * shelved with the rest of that PR. The search bar (as opposed to the Ask bar)
 * uses this too, with `stems: false`, so a name typed into it is never taken
 * for a subject.
 */

export interface RequestVocabulary {
  /** Catalogue language labels, as filtered on (`books_catalog.language`). */
  languages: string[];
  /** Subject ids with their display labels. */
  categories: { value: string; label: string }[];
}

export interface ReadRequest {
  languages: string[];
  yearMin?: number;
  yearMax?: number;
  category?: string;
  hasTranslation?: boolean;
  firstTranslation?: boolean;
  /** A name after "by"; resolve it against the author index before use. */
  authorQuery?: string;
  /** What is left: the words to search for. */
  topic: string;
}

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20,
};
const ERAS: [RegExp, number | undefined, number | undefined][] = [
  [/\bincunabula\b/, undefined, 1500],
  [/\brenaissance\b/, 1400, 1600],
  [/\b(medieval|middle ages)\b/, undefined, 1450],
  [/\bearly modern\b/, 1500, 1750],
  [/\benlightenment\b/, 1680, 1800],
];
const STOP = new Set(('i im want wanted looking look find show give me some any anything all books book works work texts text ' +
  'writings writing treatises treatise on about of the a an in and or for to with from that which are is was were by printed ' +
  'written published edition editions please something things stuff related regarding concerning have has been there what can you do').split(' '));
const ALIASES: [RegExp, string][] = [
  [/\b(kabbal\w*|cabal\w*|qabal\w*)\b/, 'jewish-kabbalah'],
  [/\brosicrucian\w*\b/, 'rosicrucianism'],
];
/** A capitalised mid-sentence word only counts as a subject when it reads like one (Alchemical, Hermetic). */
const SUBJECT_ENDING = /(al|ic|ics|y|ism|ist|ists|ian|ians|ies|ine|ing)$/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function readRequest(text: string, vocab: RequestVocabulary, opts: { stems?: boolean } = {}): ReadRequest {
  const stems = opts.stems !== false;
  const out: ReadRequest = { languages: [], topic: '' };
  let t = ` ${text.toLowerCase().replace(/[“”"?!]/g, ' ')} `;
  const cut = (re: RegExp | string) => { t = t.replace(re, ' '); };
  let m: RegExpMatchArray | null;

  // Reading status
  if ((m = t.match(/\b(first[- ]time translations?|first translations?|never (been )?translated before|translated for the first time)\b/))) {
    out.firstTranslation = true; cut(m[0]);
  }
  if ((m = t.match(/\b((that|which) (have|has) been translated|translated( into english)?|in english translation|english translations?|translations?|readable in english|in english)\b/))) {
    out.hasTranslation = true; cut(m[0]);
  }

  // Dates
  if ((m = t.match(/\bbetween (\d{3,4}) and (\d{3,4})\b/)) || (m = t.match(/\b(\d{3,4})\s*(?:-|–|to)\s*(\d{3,4})\b/))) {
    out.yearMin = +m[1]; out.yearMax = +m[2]; cut(m[0]);
  } else if ((m = t.match(/\b(before|until|prior to|earlier than|up to) (\d{3,4})\b/))) {
    out.yearMax = +m[2]; cut(m[0]);
  } else if ((m = t.match(/\b(after|since|later than|from) (\d{3,4})\b/))) {
    out.yearMin = +m[2]; cut(m[0]);
  } else if ((m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)[- ]?(?:c\.?|cent\.?|century)\b/))
    || (m = t.match(new RegExp(`\\b(${Object.keys(ORDINALS).join('|')})[- ]century\\b`)))) {
    const c = ORDINALS[m[1]] ?? +m[1];
    out.yearMin = (c - 1) * 100; out.yearMax = (c - 1) * 100 + 99; cut(m[0]);
  } else if ((m = t.match(/\b(1[0-9])00s\b/))) {
    out.yearMin = +`${m[1]}00`; out.yearMax = +`${m[1]}99`; cut(m[0]);
  } else if ((m = t.match(/\b(1[0-9]{2})0s\b/))) {
    out.yearMin = +`${m[1]}0`; out.yearMax = +`${m[1]}9`; cut(m[0]);
  } else {
    for (const [re, a, b] of ERAS) if ((m = t.match(re))) { out.yearMin = a; out.yearMax = b; cut(m[0]); break; }
  }

  // "by X" names an author; the original capitals tell a name from a word.
  if ((m = text.match(/\b(?:by|of|from)\s+([A-Z][\p{L}'.-]+(?:\s+(?:de|von|van|da|di|of|[A-Z][\p{L}'.-]+))*)/u))) {
    out.authorQuery = m[1];
    cut(new RegExp(`\\b(by|of|from)\\s+${escapeRe(m[1].toLowerCase())}\\b`));
  } else if ((m = t.match(/\b(?:anything|everything|all) by ([\p{L}'.-]+(?: [\p{L}'.-]+)?)/u))) {
    out.authorQuery = m[1]; cut(m[0]);
  }

  // Languages, by their names in the catalogue
  for (const lang of vocab.languages) {
    const re = new RegExp(`\\b${escapeRe(lang.toLowerCase())}\\b`);
    if (re.test(t)) { out.languages.push(lang); cut(re); }
  }

  // One subject: a whole label, then a known alias, then (Ask only) a word
  // that starts like a one-word label ("alchemical" → Alchemy).
  const cats = vocab.categories.slice().sort((a, b) => b.label.length - a.label.length);
  for (const c of cats) {
    const lab = c.label.toLowerCase();
    if (t.includes(` ${lab} `)) { out.category = c.value; cut(new RegExp(`\\b${escapeRe(lab)}\\b`)); break; }
  }
  if (!out.category) {
    for (const [re, id] of ALIASES) {
      if (re.test(t) && cats.some((c) => c.value === id)) { out.category = id; cut(re); break; }
    }
  }
  if (!out.category && stems) {
    for (const c of cats) {
      if (c.label.includes(' ') && !c.label.includes('&')) continue;
      const w = c.label.toLowerCase().split(/\s|&/)[0];
      const stem = w.slice(0, Math.max(5, w.length - 3));
      const re = new RegExp(`\\b${escapeRe(stem)}\\w*\\b`);
      const hit = t.match(re);
      if (!hit) continue;
      // "Paracelsus" is a name, not the subject Paracelsian.
      const named = new RegExp(`(^|\\s)${escapeRe(hit[0][0].toUpperCase() + hit[0].slice(1))}\\b`).test(text);
      if (named && !SUBJECT_ENDING.test(hit[0])) continue;
      out.category = c.value; cut(re); break;
    }
  }

  out.topic = t.split(/\s+/).filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w)).join(' ');
  return out;
}
