// PRIOR ART: src/data/concept-aliases.json (#4695) pairs 62 concepts with their forms in
// other scripts — a LOOKUP TABLE for known words, not a transliterator, so it cannot check an
// arbitrary quoted phrase; it is used here as the positive-control set instead (tests).
// scripts/lib/page-terms-parse.mjs foldForQuoteMatch() folds Latin orthography only and by
// design never touches another script. src/lib/non-latin-* has no romaniser. None can answer
// "is this romanised phrase on this Greek/Devanagari/Tibetan/Arabic/Hebrew page".
/**
 * Skeleton transliteration for QUOTE MATCHING (#4777, the `script` tier).
 *
 * A translation note says `original: "alloprosallon"` and the page prints ἀλλοπρόσαλλος. A
 * substring match cannot see that these are the same word, so the verifier reported it as
 * uncheckable — 55% of everything the old boolean called "unverified" (measured 2026-09-13 on
 * 114K notes: Devanagari 42%, Greek 23%, Tibetan 10%, Arabic 9%, Han 7%, Hebrew 6%).
 *
 * Romanisation varies in exactly the places a faithful transliterator is precise — vowel
 * quality and length, aspiration marks, Latinised endings (-os/-us), ai/ae, k/c, ph/f — so this
 * does NOT reproduce any standard scheme. It reduces BOTH sides to a per-script skeleton: the
 * page's letters go through a per-script letter map, the note's Latin letters through the
 * matching per-script fold, and the two skeletons are compared. Two skeleton styles:
 *
 *   cv  consonants kept, every vowel RUN collapsed to one marker `V` — for scripts that write
 *       their vowels (Greek, Cyrillic) or imply them regularly (Devanagari's inherent a). The
 *       marker keeps syllable shape, which is what makes a short Greek word checkable at all.
 *   c   consonants only — for scripts that do not write short vowels (Arabic, Hebrew, Syriac)
 *       and for Tibetan, whose inherent vowel sits after the root letter of a stack, a position
 *       this module does not parse.
 *
 * A note skeleton that is a substring of the page skeleton (or whose leading 80% is, for
 * inflection) matches. Lossy on purpose, in the direction that costs precision, and the tests
 * carry NEGATIVE controls (a note against a different page of the same script) so a later
 * "improvement" that makes it looser goes red. A minimum consonant count guards the short-word
 * false positive; the shuffled-pair false-positive rate per script is measured in the PR.
 *
 * Covered: Greek, Devanagari, Tibetan, Arabic (+Persian/Ottoman/Urdu letters), Hebrew, Syriac,
 * Cyrillic. NOT covered (no letter-to-sound map exists without a dictionary): Han, Kana,
 * Hangul; a Latin quote against those stays `script`. Follows non-latin-text-operations.md:
 * nothing here is a storage or display key — it exists only to compare.
 */

const VOWEL_RUN = /[aeiou]+/g;

function stripMarks(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
}

/** The note side: lowercase, marks stripped, apostrophes removed, hyphens become word breaks
 *  (Wylie "Mar-me-mdzad" is three syllables; a doubled letter must not collapse across them). */
function latinBase(s) {
  return stripMarks(s).toLowerCase().replace(/[’'ʿʾ‘`ʼ.]/g, '').replace(/[-‐‑–—\s]+/g, ' ').trim();
}

/** Consonant-only skeleton: vowels out, doubled consonants collapsed WITHIN a word, words joined. */
function skelC(s) {
  return s.split(' ').map(w => w.replace(VOWEL_RUN, '').replace(/([^#])\1+/g, '$1')).join('');
}
/** Consonant + vowel-marker skeleton: doubled consonants collapsed within a word, each vowel run → `V`. */
function skelCV(s) {
  return s.split(' ').map(w => w.replace(/([^aeiou#])\1+/g, '$1').replace(VOWEL_RUN, 'V')).join('');
}

/** Consonants in a skeleton (everything that is not the vowel marker). */
function consonants(skel) {
  return skel.replace(/V/g, '').length;
}


// ---------------------------------------------------------------------------------------------
// Greek
const GREEK = {
  'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'e', 'θ': 'th', 'ι': 'i', 'κ': 'k',
  'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't',
  'υ': 'y', 'φ': 'ph', 'χ': 'ch', 'ψ': 'ps', 'ω': 'o', 'ϐ': 'b', 'ϑ': 'th', 'ϕ': 'ph', 'ϝ': 'w',
  'ϛ': 'st', 'ϟ': 'k', 'ϡ': 's',
};
function greekPage(text) {
  const src = stripMarks(text).toLowerCase().replace(/γ(?=[γκξχ])/g, 'ν');
  const out = [];
  for (const ch of src) out.push(GREEK[ch] ?? (/\p{Script=Greek}/u.test(ch) ? '' : ch));
  return out.join('');
}
function greekFold(s) {
  return skelCV(
    latinBase(s)
      .replace(/ph/g, 'f').replace(/th/g, 't').replace(/[ck]h/g, 'k').replace(/rh/g, 'r')
      .replace(/x/g, 'ks').replace(/c/g, 'k').replace(/y/g, 'i').replace(/w/g, 'v').replace(/h/g, ''),
  );
}

// ---------------------------------------------------------------------------------------------
// Devanagari (Sanskrit / Hindi / Marathi / Nepali). A consonant not followed by a vowel sign or
// a virama carries the inherent `a`; the vowel's quality is irrelevant since it becomes `V`.
const DEVA_C = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'c', 'छ': 'ch', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 's',
  'ष': 's', 'स': 's', 'ह': 'h', 'ळ': 'l',
};
const DEVA_V = { 'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ri', 'ॠ': 'ri', 'ऌ': 'li', 'ए': 'e', 'ऐ': 'e', 'ओ': 'o', 'औ': 'o', 'ऑ': 'o' };
const DEVA_SIGN = /[ा-ौॢॣॕ-ॗ]/u;   // vowel signs (incl. ॄ ॢ ॣ)
const DEVA_VIRAMA = '्';
function devaPage(text) {
  const chars = [...String(text || '').normalize('NFC')];
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (DEVA_C[ch] !== undefined) {
      out.push(DEVA_C[ch]);
      const next = chars[i + 1];
      if (next === DEVA_VIRAMA) { i++; continue; }
      if (next !== undefined && DEVA_SIGN.test(next)) { i++; out.push('a'); continue; }
      if (next === '़') { i++; }                                       // nukta: same letter
      out.push('a');
      continue;
    }
    if (DEVA_V[ch] !== undefined) { out.push(DEVA_V[ch]); continue; }
    if (ch === 'ं' || ch === 'ँ') { out.push('n'); continue; }   // anusvara, candrabindu
    if (ch === 'ः') { out.push('h'); continue; }                        // visarga
    if (ch === '।' || ch === '॥') { out.push(' '); continue; }
    if (/\p{Script=Devanagari}/u.test(ch)) continue;
    out.push(ch);
  }
  return out.join('');
}
function devaFold(s) {
  return skelCV(
    latinBase(s)
      .replace(/sh/g, 's').replace(/ch/g, 'c').replace(/x/g, 'ks').replace(/z/g, 'j').replace(/w/g, 'v')
      .replace(/ph/g, 'p').replace(/f/g, 'p').replace(/h/g, '').replace(/m/g, 'n').replace(/q/g, 'k'),
  );
}
/** y as a glide: sandhi writes "saṅkrānty-avadhi" for saṅkrānti-avadhi, so in this variant it
 *  joins the vowel run on both sides (y is a real consonant in yoga/yajña, hence a variant). */
function devaFoldGlide(s) { return devaFold(s).replace(/y/g, 'V').replace(/V+/g, 'V'); }

// ---------------------------------------------------------------------------------------------
// Tibetan (Wylie letters; subjoined forms U+0F90–U+0FBC map to their base letter)
const TIB = {
  'ཀ': 'k', 'ཁ': 'kh', 'ག': 'g', 'ང': 'ng', 'ཅ': 'c', 'ཆ': 'ch', 'ཇ': 'j', 'ཉ': 'ny', 'ཏ': 't', 'ཐ': 'th',
  'ད': 'd', 'ན': 'n', 'པ': 'p', 'ཕ': 'ph', 'བ': 'b', 'མ': 'm', 'ཙ': 'ts', 'ཚ': 'tsh', 'ཛ': 'dz', 'ཝ': 'w',
  'ཞ': 'zh', 'ཟ': 'z', 'འ': '', 'ཡ': 'y', 'ར': 'r', 'ལ': 'l', 'ཤ': 'sh', 'ཥ': 'sh', 'ས': 's', 'ཧ': 'h',
  'ཨ': '', 'ཊ': 't', 'ཋ': 'th', 'ཌ': 'd', 'ཎ': 'n',
};
function tibPage(text) {
  const out = [];
  for (const ch of String(text || '').normalize('NFC')) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0f90 && cp <= 0x0fbc) { out.push(TIB[String.fromCodePoint(cp - 0x50)] ?? ''); continue; }
    if (TIB[ch] !== undefined) { out.push(TIB[ch]); continue; }
    if (cp === 0x0f0b || cp === 0x0f0c || cp === 0x0f0d || cp === 0x0f0e || cp === 0x0f14) { out.push(' '); continue; }
    if (/\p{Script=Tibetan}/u.test(ch)) continue;                         // vowel signs and marks
    out.push(ch);
  }
  return out.join('');
}
function tibFold(s) {
  return skelC(
    latinBase(s)
      .replace(/tsh/g, 'ts').replace(/zh/g, 'z').replace(/sh/g, 's').replace(/ch/g, 'c').replace(/ph/g, 'p')
      .replace(/th/g, 't').replace(/kh/g, 'k').replace(/dz/g, 'z').replace(/w/g, 'v').replace(/h/g, ''),
  );
}

// ---------------------------------------------------------------------------------------------
// Arabic script (Arabic, Persian, Ottoman Turkish, Urdu letters)
const ARAB = {
  'ا': '', 'أ': '', 'إ': '', 'آ': '', 'ء': '', 'ؤ': '', 'ئ': '', 'ى': '', 'ة': '', 'ب': 'b', 'ت': 't', 'ث': 't',
  'ج': 'j', 'ح': 'h', 'خ': 'k', 'د': 'd', 'ذ': 'd', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 's', 'ص': 's', 'ض': 'd',
  'ط': 't', 'ظ': 'z', 'ع': '', 'غ': 'g', 'ف': 'f', 'ق': 'k', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h',
  'و': 'v', 'ي': 'y', 'پ': 'p', 'چ': 'c', 'ژ': 'z', 'گ': 'g', 'ک': 'k', 'ی': 'y', 'ڭ': 'n', 'ھ': 'h', 'ۀ': '',
  'ں': 'n', 'ٹ': 't', 'ڈ': 'd', 'ڑ': 'r', 'ے': '',
};
function arabPage(text) {
  const out = [];
  for (const ch of stripMarks(text)) {
    if (ARAB[ch] !== undefined) { out.push(ARAB[ch]); continue; }
    if (ch === 'ـ') continue;                                            // tatweel
    if (/[،؛؟۔]/u.test(ch)) { out.push(' '); continue; }
    if (/\p{Script=Arabic}/u.test(ch)) continue;
    out.push(ch);
  }
  return out.join('');
}
function arabBase(s) {
  return latinBase(s)
    .replace(/th/g, 't').replace(/dh/g, 'd').replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/sh/g, 's')
    .replace(/ch/g, 'c').replace(/zh/g, 'z').replace(/ph/g, 'f').replace(/q/g, 'k').replace(/w/g, 'v')
    .replace(/x/g, 'ks').replace(/h(?=\s|$)/g, '');                      // ة / -ah endings
}
function arabFold(s) { return skelC(arabBase(s)); }
/** Matres lectionis: ي and و are consonants in "yarak"/"Mawla" but long vowels in "Ibn Sīnā";
 *  the second variant drops them on BOTH sides so either reading can match. */
function arabFoldNoMatres(s) { return skelC(arabBase(s).replace(/[yv]/g, '')); }

// ---------------------------------------------------------------------------------------------
// Hebrew. ח/כ against the romanisers' h/ch/kh/k is the ambiguous set ("chesed" is ח, "massecheth"
// is כ — and "massecheth challah" carries both in one phrase), so a note "ch" becomes the
// placeholder `#`, which matches either h or k on the page. Everything else is consonantal.
const HEB = {
  'א': '', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z', 'ח': 'h', 'ט': 't', 'י': 'y',
  'כ': 'k', 'ך': 'k', 'ל': 'l', 'מ': 'm', 'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': '', 'פ': 'p',
  'ף': 'p', 'צ': 'ts', 'ץ': 'ts', 'ק': 'k', 'ר': 'r', 'ש': 's', 'ת': 't',
};
function hebPage(text) {
  const out = [];
  for (const ch of stripMarks(text)) {
    if (HEB[ch] !== undefined) { out.push(HEB[ch]); continue; }
    if (/[־׀׃׳״]/u.test(ch)) { out.push(' '); continue; }
    if (/\p{Script=Hebrew}/u.test(ch)) continue;
    out.push(ch);
  }
  return out.join('');
}
function hebBase(s) {
  return latinBase(s)
    .replace(/sh/g, 's').replace(/t[sz]/g, 'ts').replace(/th/g, 't').replace(/ph/g, 'p').replace(/f/g, 'p')
    .replace(/w/g, 'v').replace(/q/g, 'k').replace(/x/g, 'ks');
}
function hebFold(s) { return skelC(hebBase(s).replace(/kh/g, 'k').replace(/ch/g, '#').replace(/c/g, 'k').replace(/h(?=\s|$)/g, '')); }
function hebFoldNoMatres(s) { return skelC(hebBase(s).replace(/kh/g, 'k').replace(/ch/g, '#').replace(/c/g, 'k').replace(/h(?=\s|$)/g, '').replace(/[yv]/g, '')); }

// ---------------------------------------------------------------------------------------------
// Syriac (consonantal, like Hebrew)
const SYR = {
  'ܐ': '', 'ܒ': 'b', 'ܓ': 'g', 'ܕ': 'd', 'ܗ': 'h', 'ܘ': 'v', 'ܙ': 'z', 'ܚ': 'h', 'ܛ': 't', 'ܝ': 'y', 'ܟ': 'k',
  'ܠ': 'l', 'ܡ': 'm', 'ܢ': 'n', 'ܣ': 's', 'ܤ': 's', 'ܥ': '', 'ܦ': 'p', 'ܧ': 'p', 'ܨ': 'ts', 'ܩ': 'k', 'ܪ': 'r',
  'ܫ': 's', 'ܬ': 't',
};
function syrPage(text) {
  const out = [];
  for (const ch of stripMarks(text)) {
    if (SYR[ch] !== undefined) { out.push(SYR[ch]); continue; }
    if (/\p{Script=Syriac}/u.test(ch)) continue;
    out.push(ch);
  }
  return out.join('');
}

// ---------------------------------------------------------------------------------------------
// Cyrillic
const CYR = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y',
  'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f',
  'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sh', 'ъ': '', 'ы': 'i', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
  'і': 'i', 'ѣ': 'e', 'ѳ': 'f', 'ѵ': 'i', 'ѡ': 'o', 'ѧ': 'ya', 'ѫ': 'u', 'ґ': 'g', 'є': 'e', 'ї': 'i', 'ў': 'u',
  'ђ': 'dj', 'ј': 'y', 'љ': 'l', 'њ': 'n', 'ћ': 'c', 'џ': 'dz',
};
function cyrPage(text) {
  const out = [];
  for (const ch of stripMarks(text).toLowerCase()) out.push(CYR[ch] ?? (/\p{Script=Cyrillic}/u.test(ch) ? '' : ch));
  return out.join('');
}
function cyrFold(s) {
  return skelCV(
    latinBase(s)
      .replace(/shch/g, 's').replace(/zh/g, 'z').replace(/kh/g, 'k').replace(/ch/g, 'c').replace(/sh/g, 's')
      .replace(/ts/g, 'c').replace(/ph/g, 'f').replace(/th/g, 't').replace(/w/g, 'v').replace(/j/g, 'y').replace(/h/g, ''),
  );
}

// ---------------------------------------------------------------------------------------------

/** Each covered script: how to detect it on a page, romanise the page, and fold a Latin string
 *  (one or more folds; any may match). */
export const SCRIPTS = {
  Greek: { re: /\p{Script=Greek}/u, page: greekPage, folds: [greekFold], style: 'cv' },
  // Sanskrit writes compounds as one word and the note quotes a member of it (saṅkrānti-avadhi
  // inside saurastasaṅkrāntyavadhi…), so a Devanagari match may start anywhere in a word —
  // measured false positives 2.1% without the word-start rule, against 1.6% with it.
  Devanagari: { re: /\p{Script=Devanagari}/u, page: devaPage, folds: [devaFold, devaFoldGlide], style: 'cv', anyStart: true },
  Tibetan: { re: /\p{Script=Tibetan}/u, page: tibPage, folds: [tibFold], style: 'c' },
  // A note may quote the bare word while the page carries it with a proclitic (و ف ب ل ك, ال): a
  // word start is also allowed after those letters.
  Arabic: { re: /\p{Script=Arabic}/u, page: arabPage, folds: [arabFold, arabFoldNoMatres], style: 'c', clitics: /^[vfbkl]{1,2}/ },
  Hebrew: { re: /\p{Script=Hebrew}/u, page: hebPage, folds: [hebFold, hebFoldNoMatres], style: 'c', clitics: /^[vbklmsh]{1,2}/ },
  Syriac: { re: /\p{Script=Syriac}/u, page: syrPage, folds: [hebFold, hebFoldNoMatres], style: 'c' },
  Cyrillic: { re: /\p{Script=Cyrillic}/u, page: cyrPage, folds: [cyrFold], style: 'cv' },
};

/** Scripts the verifier cannot romanise; a Latin quote against one of these stays `script`. */
const UNCOVERED_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Ethiopic}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Thai}\p{Script=Coptic}\p{Script=Mongolian}]/u;

/**
 * Skeleton the page in script `name` with fold index `i`, word by word.
 *
 * Only the page's NON-Latin text is skeletonised. A Latin-script quote on the page's Latin
 * text was already tried by substring; letting that text into a vowel-collapsed skeleton
 * matched "blockish" to any English page holding a b-l-V-k-V-s word (measured: Greek-page
 * false positives 22% on the shuffled control before Latin letters were dropped).
 *
 * Returns the joined skeleton plus the offsets at which a page WORD begins, so a note can be
 * required to start on a word boundary: "ktb" inside "mktbh" is not the word kitāb.
 */
export function pageSkeleton(name, ocrText, i = 0) {
  const s = SCRIPTS[name];
  const foreign = String(ocrText || '').replace(/<[^>]+>/g, ' ').replace(/[\p{Script=Latin}\d]+/gu, ' ');
  const starts = new Set();
  let str = '';
  for (const word of s.page(foreign).split(/[\s\p{P}]+/u)) {
    if (!word) continue;
    const k = s.folds[i](word);
    if (!k) continue;
    starts.add(str.length);
    const cl = s.clitics && k.match(s.clitics);
    if (cl) for (let j = 1; j <= cl[0].length && j < k.length; j++) starts.add(str.length + j);
    str += k;
  }
  return { str, starts };
}

/**
 * Minimum consonants before a note skeleton may match at all — below this, uncheckable.
 *
 * Chosen on the shuffled-page control (each note against a different page of the same
 * script; 40,117 real `script`-tier notes, 2026-09-13), with the word-start requirement on.
 * False-positive rate at 3 / 4 consonants: Devanagari 2.9 / 1.6%, Greek 9.8 / 1.2%, Arabic
 * 10.8 / 3.4%, Hebrew 5.7 / 0.0%, Syriac 7.2 / 1.3%, Tibetan 6.4 / 5.0% (its control is
 * inflated by genuinely shared vocabulary — "sangs rgyas" is on most pages). Conversion of
 * the tier at 4: 49% translit, 21% absent, 30% still uncheckable; at 3 it is 60% translit
 * but a tenth of the Arabic and Greek hits would be chance. Per-style so a later measurement
 * can move one without the other.
 */
export const MIN_CONSONANTS = { cv: Number(process.env.SKEL_MIN_CV || 4), c: Number(process.env.SKEL_MIN_C || 4) };

/** `#` in a note skeleton is "h or k" (Hebrew ח/כ); everything else is literal. */
function skeletonRe(q) {
  return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/#/g, '[hk]'), 'g');
}
/** Is `q` in the page skeleton, starting where a page word starts? */
function containsAtWordStart(page, q, anyStart = false) {
  const re = skeletonRe(q);
  let m;
  while ((m = re.exec(page.str))) {
    if (anyStart || page.starts.has(m.index)) return true;
    re.lastIndex = m.index + 1;
  }
  return false;
}

/**
 * Does the romanised `quote` occur on `ocrText` once both are reduced to a skeleton?
 *
 * Returns { matched: true, script, tier } on a hit; { matched: false, uncovered: true } when the
 * page carries a script this module cannot romanise, or the quote is too short to judge (so a
 * miss is not evidence); { matched: false, uncovered: false } when every non-Latin script on the
 * page was checked and the quote is not there.
 *
 * The inflection (stem) rule: the leading 80% of the skeleton. For the `cv` style the vowel
 * markers carry shape, so a 5-unit skeleton with 3 consonants is enough ("hesychian" against
 * ἡσυχία); for the consonant-only style five consonants are required, as in verifyQuote.
 */
export function skeletonMatch(quote, ocrText) {
  const text = String(ocrText || '');
  let uncovered = UNCOVERED_RE.test(text);
  for (const [name, s] of Object.entries(SCRIPTS)) {
    if (!s.re.test(text)) continue;
    for (let i = 0; i < s.folds.length; i++) {
      const q = s.folds[i](quote);
      const nC = consonants(q);
      if (nC < MIN_CONSONANTS[s.style]) { uncovered = true; continue; }
      const page = pageSkeleton(name, text, i);
      if (containsAtWordStart(page, q, s.anyStart)) return { matched: true, script: name, tier: 'full' };
      const stemOk = s.style === 'cv' ? q.length >= 5 : nC >= 5;
      if (stemOk) {
        const stem = q.slice(0, Math.max(4, Math.floor(q.length * 0.8)));
        if (containsAtWordStart(page, stem, s.anyStart)) return { matched: true, script: name, tier: 'stem' };
      }
    }
  }
  return { matched: false, uncovered };
}
