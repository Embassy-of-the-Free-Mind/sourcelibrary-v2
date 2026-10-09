// PRIOR ART: scripts/eval/tengyur-arms/negcheck.py — Tibetan only, Python, tuned on the tengyur-ref labels (lexicalised
// compounds excluded, a Lord-as-speaker role cue). This is the plain version for every #5695 language: a negation word
// list per language and the same sliding window, no tuning and no role cue, so its Tibetan figures are a floor for that script.
/** D1 (#5695 extra test): negation markers in the source vs the English, per language. $0. */
import { cleanEnglish, cleanSource } from './run-detectors.mjs';

const words = (list) => new RegExp(`^(${list})$`, 'iu');
// Space-delimited languages: a token is a negation if it matches. Lists are deliberately short and unambiguous.
const LEX = {
  Latin: words('non|nō|ñ|nec|neque|neq;|nihil|nil|nihilo|nullus|nulla|nullum|nulli|nullo|nullam|nullis|nullius|nunquam|numquam|nusquam|haud|nemo|neminem|nemini|minime|nequaquam|neutiquam|nondum|necdum|nequit|nequeunt|nolo|noli|nolite|nisi|sine|absque'),
  // Greek is matched after accents are removed but breathings kept, so οὐ (not) stays apart from οὗ (of whom) and οὖν (so).
  Greek: words('οὐ|οὐκ|οὐχ|οὐχι|οὐδ\\p{L}*|οὐτε|οὐθ\\p{L}*|οὐποτε|οὐπω|οὐκετι|μη|μηδ\\p{L}*|μητε|μηκετι|μηποτε|μηπω|ἀνευ|χωρις'.normalize('NFD')),
  German: words('nicht|nit|kein\\p{L}*|nie|niemals|nimmer\\p{L}*|nichts|weder|ohne|niemand\\p{L}*'),
  French: words("ne|n'\\p{L}*|ni|sans|non|nul|nulle|aucun|aucune"),
  Italian: words('non|né|senza|niente|nulla|nessun\\p{L}*|mai|neanche|nemmeno|nè'),
  Spanish: words('no|ni|sin|nunca|jamás|nada|nadie|ningun\\p{L}*|ningún|tampoco'),
  Dutch: words('niet|geen|gheen|nooit|noch|zonder|sonder|niets|niemand|nimmer|nimmermeer'),
  Hebrew: words('לא|ולא|שלא|דלא|בלא|לאו|אין|ואין|שאין|אינו|אינה|אינם|אינן|איני|בלי|מבלי|בל|בלתי|לבלתי|לית|ליכא'),
  Arabic: words('لا|ولا|فلا|لم|ولم|فلم|لن|ولن|ليس|وليس|ليست|غير|بغير|بلا|دون|بدون|عدم'),
  Persian: words('نه|نی|نیست|نیستم|نیستی|نیستند|نبود|نباشد|نشد|نکرد|ندارد|ندارم|نتوان|نمی\\p{L}*|بی|هیچ|مه'),
  Sanskrit: words('न|नहि|नैव|नो|मा|नापि|नच|विना|ऋते|na|nahi|naiva|no|mā|nāpi|vinā|ṛte'),
  Pali: words("na|no|mā|natthi|n'atthi|neva|nāpi|vinā|nāhaṃ|nālaṃ"),
};
LEX['Ancient Greek'] = LEX['Byzantine Greek'] = LEX.Greek; LEX.Aramaic = LEX.Hebrew;
const EN = words("not|no|never|nor|neither|none|nothing|nobody|nowhere|without|cannot|unless|\\p{L}+n't");
const CHAR_NEG = { Chinese: /[不無无非未勿莫弗毋否匪罔]/u };
const TIB_NEG = new Set(['མ', 'མི', 'མེད', 'མིན']);

const fold = (t, lang) => {
  let s = t.normalize('NFD');
  if (/Greek/.test(lang)) s = s.replace(/[̀́͂̈ͅ]/g, '');
  else if (/Hebrew|Aramaic/.test(lang)) s = s.replace(/[֑-ׇ]/g, '');
  else if (/Arabic|Persian/.test(lang)) s = s.replace(/[ً-ٰٟـ]/g, '');
  else s = s.normalize('NFC');
  return s.replace(/ſ/g, 's').toLowerCase();
};
/** Positions (0–1 along the page) of the negation markers in a text. */
export function negationPositions(text, lang, english = false) {
  if (!english && CHAR_NEG[lang]) { const ch = [...text.replace(/\s+/g, '')]; return ch.map((c, i) => (CHAR_NEG[lang].test(c) ? i / ch.length : -1)).filter((x) => x >= 0); }
  if (!english && lang === 'Tibetan') { const sy = text.replace(/\{[^}]*\}/g, '').split(/[་།༎\s]+/).filter(Boolean); return sy.map((s, i) => (TIB_NEG.has(s) ? i / sy.length : -1)).filter((x) => x >= 0); }
  const re = english ? EN : LEX[lang]; if (!re) return null;
  const w = fold(text, english ? 'English' : lang).split(/[^\p{L}\p{M};']+/u).filter(Boolean);
  return w.map((x, i) => (re.test(x) ? i / w.length : -1)).filter((x) => x >= 0);
}
const WIDTH = 0.30, STEP = 0.04; // negcheck.py's window
/** {src_neg, en_neg, page_diff, window}: page_diff is |source count − English count|; window is the largest such gap in any 30 % window of the page. */
export function negationScore(lang, source, english) {
  const a = negationPositions(cleanSource(source), lang), b = negationPositions(cleanEnglish(english), lang, true);
  if (!a) return null;
  let win = 0;
  for (let s = 0; s <= 1 - WIDTH + 1e-9; s += STEP) { const c = (p) => p.filter((x) => x >= s && x < s + WIDTH).length; win = Math.max(win, Math.abs(c(a) - c(b))); }
  return { src_neg: a.length, en_neg: b.length, page_diff: Math.abs(a.length - b.length), window: win };
}
