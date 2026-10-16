// PRIOR ART: none for Maya — scripts/audit/es-edition-quality.mjs and translation-leaf-shift.mjs compare DIGIT numerals
// between two texts; scripts/lib/dehyphenate.mjs only lists English number words. Neither reads a vigesimal number word.
/**
 * Yucatec Maya number words → values, and English numbers → values, so a page's Maya numerals can be checked against
 * its English (#6559: a sermon's *lahu oxkal catac oxpel* "fifty-three" was translated "thirty-three").
 *
 * The grammar is Beltrán de Santa Rosa, *Arte de el idioma maya* (1746; our 1859 ed. 6a9f3fa483c3b522416e48fa
 * pp. 217–225), cross-checked with Motul vol. 2 p. 158 ("Cincuenta: lahuyoxkal"):
 *   - units 1–19: hun ca ox can ho uac uuc uaxac bolon lahun buluc lahca oxlahun canlahun holhun uaclahun uuclahun
 *     uaxaclahun bolonlahun (the final -n of -lahun drops in compounds: oxlahu-, holhu-).
 *   - whole scores: N-kal = N × 20 (hunkal 20, cakal 40, oxkal 60, hokal 100, lahunkal 200, oxlahukal 260).
 *   - a unit counted INTO a score: U [tu|y] N-kal = U + (N − 1) × 20 (huntukal 21, lahucakal 30, oxlahutukal 33,
 *     lahuyoxkal 50, huntucankal 61). A bare "tukal" is into the second score.
 *   - bak = 400 (hunbak, cabak; "hotubak" 500 = 5 × 20 into the second 400); pic = 1000 by Beltrán's own usage (§312;
 *     originally 8,000 — a phrase with pic is reported, never auto-judged).
 *   - catac / ca tac = "and": a larger number catac a smaller one adds (hunbak catac lahuyoxkal = 450).
 *   - a unit with a counting particle (ox-pel, ca-tul, ox-ten …) counts things; a y- prefix makes an ordinal (yoxppel).
 * Orthography is folded first: accents dropped, ꝑ → pp, v → u, k/c and other letters kept as printed.
 */
const UNITS = [
  ['bolonlahun', 19], ['uaxaclahun', 18], ['uuclahun', 17], ['uaclahun', 16], ['holhun', 15], ['canlahun', 14], ['oxlahun', 13],
  ['lahca', 12], ['buluc', 11], ['lahun', 10], ['bolon', 9], ['uaxac', 8], ['uuc', 7], ['uac', 6], ['ho', 5], ['can', 4], ['ox', 3], ['ca', 2], ['hun', 1],
];
// Each unit as a regex alternative: -lahun may lose its n (oxlahu-), bolon/hun/can may end in m (bolom, hum, cam).
const unitAlt = (u) => u.replace(/lahun$/, 'lahu[nm]?').replace(/hun$/, 'hu[nm]?').replace(/^bolon$/, 'bolo[nm]').replace(/^can$/, 'ca[nm]').replace(/^lahca$/, 'lah?ca');
const UNIT_RE = UNITS.map(([u]) => `(?:${unitAlt(u)})`);
const unitValue = (s) => { for (let i = 0; i < UNITS.length; i++) if (new RegExp(`^${UNIT_RE[i]}$`).test(s)) return UNITS[i][1]; return null; };
const U = `(?:${UNIT_RE.join('|')})`;
const CLASSIFIERS = 'ppel|pel|tul|ten|tzuc|cot|kin';

export function foldMaya(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ꝑ/g, 'pp').replace(/v/g, 'u').replace(/ƀ/g, 'b');
}

/** Value of ONE numeral word (spaces already removed), or null. Returns { value, ordinal, kind }. */
export function mayaWordValue(w) {
  w = foldMaya(w).replace(/[^a-zɔħ]/g, '').replace(/yokal$/, 'yhokal'); // Beltrán's hutuyokal (81) = hun tu y-hokal
  if (!w) return null;
  // whole score / whole 400 / 1000, by a single unit multiplier: prefer this parse (oxlahukal = 260, not 3 into the 10th).
  // (bare "yokal"/"y okal" is yoklal "because", never 100: hokal is written with its h)
  let m = w.match(new RegExp(`^y?(${U})(kal|bak|pic)$`));
  if (m && unitValue(m[1]) != null && w !== 'yhokal') return { value: unitValue(m[1]) * { kal: 20, bak: 400, pic: 1000 }[m[2]], kind: m[2] };
  // a unit counted into a score: U (tu|tuy|y|u)? N? kal|bak
  m = w.match(new RegExp(`^(${U})(tu|tuy|y|u)?(${U})?(kal|bak)$`));
  if (m && (m[2] || m[3])) {
    const u = unitValue(m[1]); const n = m[3] ? unitValue(m[3]) : 2;
    if (u == null || n == null || n < 2) return null;
    if (m[4] === 'kal') return { value: u + (n - 1) * 20, kind: 'kal' };
    return { value: u * 20 + (n - 1) * 400, kind: 'bak' };
  }
  // a unit with a counting particle; y- = ordinal
  m = w.match(new RegExp(`^(y)?(${U})(${CLASSIFIERS})$`));
  if (m && unitValue(m[2]) != null) return { value: unitValue(m[2]), ordinal: !!m[1], kind: 'classifier' };
  return null;
}

const WORD_RE = /[a-zA-ZÀ-ÿĀ-žɔƆħĦꝑꝐƀ'’]+/g;
/** OCR with the transcriber's own markup removed: <vocab>/<warning>/<image-desc>/… blocks dropped, <unclear> unwrapped. */
export function cleanMayaOcr(text) {
  return String(text || '')
    .replace(/<(vocab|warning|image-desc|meta|note|header|footer|page-num|sig|scan-quality|language|script|page-type|catchword)\b[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<\/?[a-z-]+[^>]*>/g, '');
}
/**
 * Every Maya numeral phrase in a text. Up to 4 words separated only by spaces or a hyphen may join into one numeral
 * (lahu oxkal, hun tu yox kal); a following catac / ca tac + numeral is added. A bare unit with no score or particle is
 * NOT a phrase (hun = "a", ca = "when"). `alt` is the value with pic read as 8,000 (its pre-colonial value, kept by
 * Motul and the Chilam Balam books) where Beltrán reads 1,000. Returns [{ text, value, alt, ordinal, kind, index }].
 */
export function findMayaNumbers(text) {
  text = String(text);
  const toks = [...text.matchAll(WORD_RE)].map((m) => ({ w: m[0], f: foldMaya(m[0]), i: m.index, end: m.index + m[0].length }));
  const tight = (a) => toks[a + 1] && /^[\s-]*$/.test(text.slice(toks[a].end, toks[a + 1].i));
  const out = [];
  const parseAt = (i) => {
    if (i >= toks.length) return null;
    for (let k = 4; k >= 1; k--) {
      if (i + k > toks.length) continue;
      let ok = true; for (let x = i; x < i + k - 1; x++) if (!tight(x)) { ok = false; break; }
      if (!ok) continue;
      const v = mayaWordValue(toks.slice(i, i + k).map((t) => t.f).join(''));
      if (v && !(k > 1 && v.kind === 'classifier')) return { ...v, alt: v.kind === 'pic' ? v.value * 8 : v.value, k }; // ca ten = "when I", not caten "twice"
    }
    return null;
  };
  for (let i = 0; i < toks.length; i++) {
    const a = parseAt(i);
    if (!a) continue;
    let value = a.value; let alt = a.alt; let j = i + a.k; let kind = a.kind;
    while (j < toks.length) {
      // juxtaposed descending terms above 400 add with no catac (Beltrán §312: hunpic holhutubak catac oxtuyoxkal = 1743)
      const jx = value >= 400 && tight(j - 1) ? parseAt(j) : null;
      if (jx && jx.kind !== 'classifier' && jx.value < value) { value += jx.value; alt += jx.alt; j += jx.k; kind = 'catac'; continue; }
      // catac / ca tac + a smaller numeral (or a bare unit, which is a number here: catac ox)
      if (!/^[\s,-]*$/.test(text.slice(toks[j - 1].end, toks[j].i))) break;
      let c = 0;
      if (toks[j].f === 'catac' || toks[j].f === 'catacil') c = 1;
      else if (toks[j].f === 'ca' && toks[j + 1]?.f === 'tac' && tight(j)) c = 2;
      if (!c || !toks[j + c] || !/^[\s-]*$/.test(text.slice(toks[j + c - 1].end, toks[j + c].i))) break;
      const u = unitValue(toks[j + c].f);
      const b = parseAt(j + c) || (u != null ? { value: u, alt: u, k: 1 } : null);
      if (!b || b.value >= value) break;
      value += b.value; alt += b.alt; j += c + b.k; kind = 'catac';
      // the added term may run on: catac lahun bolontul = 10 + 9 (Mt 18:12, cankal catac lahun bolontul = 99)
      let run = b.value;
      while (j < toks.length && tight(j - 1)) {
        const t = parseAt(j) || (unitValue(toks[j].f) != null ? { value: unitValue(toks[j].f), alt: unitValue(toks[j].f), k: 1 } : null);
        if (!t || t.value >= run) break;
        value += t.value; alt += t.alt; run = t.value; j += t.k;
      }
    }
    out.push({ text: text.slice(toks[i].i, toks[j - 1].end), value, alt, ordinal: !!a.ordinal && kind === 'classifier', kind: alt !== value ? 'pic' : kind, index: toks[i].i });
    i = j - 1;
  }
  return out;
}

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
  fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90, hundredth: 100, thousandth: 1000 };
const OTHER = { both: 2, twice: 2, pair: 2, thrice: 3, dozen: 12, score: 20 };
const wordVal = (w) => { const i = SMALL.indexOf(w); return i >= 0 ? i : TENS[w] ?? null; };

/** Set of every number an English text states: digits, number words (fifty-three, three hundred and sixty-five), ordinals. */
export function englishNumbers(text) {
  const s = String(text).toLowerCase();
  const out = new Set();
  for (const m of s.matchAll(/\d[\d,]*/g)) out.add(Number(m[0].replace(/,/g, '')));
  // "hundredfold" is a hundred; "thousands of" / "hundreds of" state the order of magnitude
  for (const [w, v] of [['hundreds', 100], ['thousands', 1000], ['scores', 20]]) if (s.includes(w)) out.add(v);
  const toks = s.replace(/([a-z])fold\b/g, '$1').split(/[^a-z]+/).filter(Boolean);
  let cur = null; let total = 0;
  const flush = () => { if (cur != null || total) out.add(total + (cur ?? 0)); cur = null; total = 0; };
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (ORD[w] != null) { const base = (total + (cur ?? 0)); out.add(base + ORD[w]); if (base) out.add(base); cur = null; total = 0; continue; }
    if (OTHER[w] != null) { out.add(OTHER[w]); if (w === 'score' && cur) out.add(cur * 20); flush(); continue; }
    const v = wordVal(w);
    if (v != null) {
      const joins = cur != null && ((cur >= 100 && cur % 100 === 0 && v < 100) || (cur % 10 === 0 && cur % 100 >= 20 && v < 10));
      if (joins) cur += v; else { if (cur != null) flush(); cur = v; }
      continue;
    }
    if (w === 'hundred') { cur = (cur ?? 1) * 100; continue; }
    if (w === 'thousand') { total += (cur ?? 1) * 1000; cur = null; continue; }
    if (w === 'and' && (cur != null || total) && (wordVal(toks[i + 1]) != null)) continue;
    if (w === 'a' && (toks[i + 1] === 'hundred' || toks[i + 1] === 'thousand')) { cur = 1; continue; }
    flush();
  }
  flush();
  return out;
}

/** The English page body with <summary>/<keywords> removed (they restate, they do not translate). */
export const englishBody = (t) => String(t || '').replace(/<(summary|keywords)>[\s\S]*?<\/\1>/g, '');
