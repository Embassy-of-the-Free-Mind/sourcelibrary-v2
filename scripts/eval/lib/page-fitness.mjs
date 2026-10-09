// PRIOR ART: scripts/eval/audit-pareto-samples.mjs (#6304) defined these checks inline; they move here
// unchanged so the #6331 set builder (scripts/eval/canon-ref-6331/build-set.mjs) runs the same checks
// on a new set before any arm exists, instead of a second copy drifting from the first.
/**
 * page-fitness.mjs — text heuristics for "is this page body text in the chart's language?" (#6304 checks 1–2)
 * and the famous-title screen (check 6). Pure functions, no I/O.
 */
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';

const r3 = x => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);

export const SCRIPTS = { Latin: /\p{Script=Latin}/u, Greek: /\p{Script=Greek}/u, Hebrew: /\p{Script=Hebrew}/u, Arabic: /\p{Script=Arabic}/u, Han: /\p{Script=Han}/u,
  Tibetan: /\p{Script=Tibetan}/u, Devanagari: /\p{Script=Devanagari}/u, Syriac: /\p{Script=Syriac}/u, Armenian: /\p{Script=Armenian}/u,
  Sinhala: /\p{Script=Sinhala}/u, Myanmar: /\p{Script=Myanmar}/u, Thai: /\p{Script=Thai}/u, Khmer: /\p{Script=Khmer}/u, Bengali: /\p{Script=Bengali}/u, Kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/u };
export const stripTags = s => stripMarkupTags(String(s || '').replace(/<(meta|note|image-desc|figure|warning|scan-quality|language|page-type|columns|detected-images|vocab|summary|keywords)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '), ' ');
export function scriptShares(text) {
  const c = {}; let n = 0;
  for (const ch of stripTags(text)) { if (!/\p{L}/u.test(ch)) continue; n++; for (const [k, re] of Object.entries(SCRIPTS)) if (re.test(ch)) { c[k] = (c[k] || 0) + 1; break; } }
  const sh = {}; for (const [k, v] of Object.entries(c)) sh[k] = r3(v / n);
  return { letters: n, shares: sh, top: Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null };
}
export const STOP = {
  Latin: 'est et quod cum qui quae ut sed enim autem vel uel sunt esse hoc etiam quam nec atque ab ad ex ita quia siue sive eius ac igitur ergo', English: 'the and of that is which with this be it was are from by have not',
  German: 'der die und das ist nicht mit den sich auch ein eine zu von dem des wie auf daß dass oder', French: 'le les et des est que qui une dans pour du au pas sont il elle ce sur ou',
  Italian: 'il che di non per una del della sono gli con nel si delle alla come ma questo', Spanish: 'el que y los las en es por con del se una para como su al',
  Dutch: 'het een en van dat niet zijn met die op voor wordt ook als aan bij',
};
export const STOPSETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(' '))]));
export function langid(text) {
  const toks = stripTags(text).toLowerCase().match(/\p{Script=Latin}+/gu) || [];
  const hits = {}; for (const [k, s] of Object.entries(STOPSETS)) hits[k] = toks.filter(t => s.has(t)).length;
  const top = Object.entries(hits).sort((a, b) => b[1] - a[1])[0];
  return { tokens: toks.length, hits, top: top[1] ? top[0] : null };
}
export const CJK = /^(Han|Tibetan|Kana)$/;
export const EXPECT_SCRIPT = { Latin: ['Latin'], English: ['Latin'], German: ['Latin'], French: ['Latin'], Italian: ['Latin'], Dutch: ['Latin'], Spanish: ['Latin'], Greek: ['Greek'],
  Hebrew: ['Hebrew'], Aramaic: ['Hebrew', 'Syriac'], Arabic: ['Arabic'], Persian: ['Arabic'], Sanskrit: ['Devanagari', 'Latin', 'Bengali'], Pali: ['Latin', 'Sinhala', 'Myanmar', 'Thai', 'Khmer', 'Devanagari'],
  Chinese: ['Han'], Tibetan: ['Tibetan'], Armenian: ['Armenian'], Syriac: ['Syriac'] };
export const LATIN_LANGS = new Set(Object.keys(STOP));

/** Checks 1–2 on a text that is the page: kind and language/script. Returns { m, hard[], soft[] }. */
export function pageChecks(text, lang, { pageType } = {}) {
  const sc = scriptShares(text), li = langid(text);
  const raw = stripTags(text);
  const digits = (raw.match(/\d/g) || []).length, nonSpace = raw.replace(/\s/g, '').length || 1;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const shortLines = lines.filter(l => l.length < 25).length;
  const expScripts = EXPECT_SCRIPT[lang] || [];
  const expShare = expScripts.reduce((s, k) => s + (sc.shares[k] || 0), 0);
  const cjk = CJK.test(expScripts[0] || '');
  const minLetters = cjk ? 100 : 300;
  const m = { letters: sc.letters, top_script: sc.top, expected_script_share: r3(expShare), latin_share: sc.shares.Latin || 0, digit_share: r3(digits / nonSpace),
    short_line_share: lines.length ? r3(shortLines / lines.length) : null, lang_top: li.top, lang_hits: li.hits, page_type: pageType ?? null };
  const hard = [], soft = [];
  if (sc.letters < minLetters / 3) hard.push('near-empty');
  else if (sc.letters < minLetters) soft.push('short');
  if (pageType && !/^(text|body|content|null)$/i.test(pageType)) soft.push(`page-type:${pageType}`);
  if (m.digit_share > 0.2) soft.push('numeric');
  if (expScripts.length && expShare < 0.4) hard.push(`script:${sc.top}`);
  else if (expScripts.length && !expScripts.includes('Latin') && (sc.shares.Latin || 0) >= 0.25) soft.push('mixed-latin');
  if (LATIN_LANGS.has(lang) && li.top && li.top !== lang) {
    const own = li.hits[lang] || 0, other = li.hits[li.top];
    if (other >= 8 && other >= 2 * own) hard.push(`language:${li.top}`);
    else if (other >= 6 && other >= 1.3 * own) soft.push(`language?:${li.top}`);
  }
  if (!LATIN_LANGS.has(lang) && expScripts.includes('Latin') && ['English', 'German', 'French', 'Italian'].includes(li.top) && li.hits[li.top] >= 10) hard.push(`language:${li.top}`);
  return { m, hard, soft };
}

// Famous texts: a published English is widely reproduced, so a model may recall it (check 6).
export const FAMOUS = /utopia|principia|revolutionibus|aene|vergil|virgil|biblia|bible|vulgat|psalm|evangel|confession|consolatio|metamorph|iliad|ilias|odyss|homer|plato|platon|timae|aristot|euclid|bhagavad|gita|dhammapada|analect|論語|道德|老子|孫子|孟子|大學|中庸|quran|koran|qur|masnavi|mathnawi|rumi|hafez|hafiz|rubai|khayyam|talmud|mishna|zohar|perplex|dante|commedia|principe|machiavel|quixot|montaigne|essais|descartes|spinoza|thesen|luther|hermes|hermetic|pimander|poimandres|galen|hippocrat|thucydid|herodot|plutarch|augustin|boethius|cicero|caesar|gallico|seneca|lucret|ovid|tacit|xenophon|sophocl|euripid|aeschyl|epictet|marcus aurel|heart sutra|shurangama|楞嚴|金剛|法華|心經|avatamsaka|lankavatara|yoga sutra|upanishad|ramayana|mahabharata|shakuntala|kalidasa|meghaduta|gulistan|bustan|shahnameh|shahnama|ibn sina|avicenna|averro|maimonides|gita|tao te/i;
