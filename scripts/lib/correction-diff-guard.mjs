/**
 * PRIOR ART: scripts/audit/ocr-negation-flip-candidates.mjs (#6142: two stored reads of a page, a word that differs only
 * by negation-carrying characters — a worklist script with top-level Mongo, so its `indel` idea is re-stated here, not
 * imported); scripts/lib/tibetan-yatags-guard.mjs (the shape this copies: a correction's risky changes are found by a
 * diff against its draft, held until a check of the image confirms them, and every unconfirmed change is put back to the
 * draft before the write); scripts/lib/longs-orthography.mjs (pageHabit / HABIT_PAIRS: the ſ-as-f tells; its applyLongS
 * needs the #5924 lexicon model, which is not on the writing boxes, so the long-s pass here repairs only forms that are
 * never words); scripts/lib/ocr-long-s-retry.mjs foldLongS (house convention: ſ stored as s); scripts/lib/glm-digit-repair.mjs
 * (number tokens between two reads of one page, but it repairs Kraken from GLM and has no negation/expansion side).
 *
 * correction-diff-guard.mjs — guards on a CORRECTED transcription against the draft it corrects (#7567 E3).
 *
 * A corrector (agy Flash low with the image, arm c of #7567: a GPU draft corrected) may change a word for the better or
 * for the worse, and the changes that hurt a reader most are the ones that flip what a sentence says: a negation added
 * or dropped (non, nicht, not, ne…pas, mai), a number or date changed, an abbreviation expanded into a different word.
 * `correctionDiffs(draft, next, {lang})` finds those changes; a page with any is held until an image check says, per
 * change, whether the correction or the draft is what the page prints (`applyDiffVerdicts`): a change the check
 * confirms stays, a change it gives to the draft is put back, and a change it cannot decide holds the page.
 *
 * `longSPass(text, {lang, convention})` is the long-s pass on the corrected text: it repairs the ſ-as-f forms that are
 * never words in the page's language (eft → est, ift → ist, fhall → shall) and, when the library's text for the page
 * writes no ſ, folds ſ to s (house convention). It changes nothing else.
 */

export const NEGATIONS = Object.freeze({
  la: ['non', 'nec', 'neque', 'ne', 'nihil', 'nil', 'nullus', 'nulla', 'nullum', 'nulli', 'nullae', 'nullo', 'nullis', 'nullam', 'nullos', 'nullas', 'nullius',
    'nunquam', 'numquam', 'haud', 'nemo', 'neminem', 'nemini', 'nequaquam', 'nequiquam', 'minime', 'nisi', 'ni', 'nondum', 'nusquam', 'neutiquam'],
  en: ['not', 'no', 'nor', 'never', 'none', 'nothing', 'neither', 'nought', 'naught', 'nay', 'cannot', 'nobody', 'nowhere', 'nere', 'ne'],
  de: ['nicht', 'nit', 'nichts', 'nichz', 'kein', 'keine', 'keinen', 'keinem', 'keiner', 'keines', 'nie', 'niemals', 'nimmer', 'niemand', 'niemands', 'weder', 'nirgend', 'nirgends', 'keineswegs'],
  fr: ['ne', 'n', 'pas', 'point', 'jamais', 'rien', 'aucun', 'aucune', 'nul', 'nulle', 'ni', 'non', 'nullement', 'guere', 'gueres'],
  it: ['non', 'ne', 'mai', 'niente', 'nulla', 'nessuno', 'nessuna', 'nessun', 'neanche', 'nemmeno', 'neppure', 'niuno', 'niuna', 'veruno', 'veruna', 'punto'],
});
// "ne" is a pronoun/particle in Italian as often as a negation; Italian "né" folds to "ne" too. Kept: a flag goes to
// the image check, it never refuses on its own.

/** Never words in the language: the f-form of an s-word (ſ read as f). Folded keys (v→u, j→i), value = the s-form. */
export const LONG_S_TELLS = Object.freeze({
  la: { eft: 'est', funt: 'sunt', effe: 'esse', fed: 'sed', ipfe: 'ipse', ipfa: 'ipsa', ipfum: 'ipsum', quafi: 'quasi', poteft: 'potest', fic: 'sic', fua: 'sua', fuo: 'suo', fuum: 'suum', nifi: 'nisi', poft: 'post', fibi: 'sibi', femper: 'semper', fub: 'sub', ifta: 'ista', ifte: 'iste', fecundum: 'secundum', fuper: 'super', fupra: 'supra', caufa: 'causa', ficut: 'sicut', fiue: 'siue', feu: 'seu', eiufdem: 'eiusdem', ipfius: 'ipsius' },
  en: { fhall: 'shall', muft: 'must', firft: 'first', thefe: 'these', thofe: 'those', himfelf: 'himself', itfelf: 'itself', themfelves: 'themselves', fuch: 'such', alfo: 'also', fome: 'some', faid: 'said', fhould: 'should', moft: 'most', againft: 'against', reafon: 'reason', becaufe: 'because', hiftory: 'history', defire: 'desire' },
  de: { ift: 'ist', fich: 'sich', fey: 'sey', feyn: 'seyn', folche: 'solche', folches: 'solches', diefe: 'diese', diefer: 'dieser', diefes: 'dieses', alfo: 'also', felbft: 'selbst', fonft: 'sonst', fondern: 'sondern', fagt: 'sagt', fehr: 'sehr', laffen: 'lassen', wefen: 'wesen', erften: 'ersten', felbs: 'selbs' },
  // real words left out on purpose: en fame, fay; fr fous, fuis, fur (au fur et à mesure)
  fr: { eft: 'est', fes: 'ses', fon: 'son', fans: 'sans', ainfi: 'ainsi', auffi: 'aussi', chofe: 'chose', chofes: 'choses', mefme: 'mesme', cefte: 'ceste', ceft: 'cest', fuiet: 'suiet' },
  it: { fono: 'sono', fua: 'sua', fuo: 'suo', fuoi: 'suoi', fue: 'sue', fopra: 'sopra', fenza: 'senza', fempre: 'sempre', cofa: 'cosa', cofe: 'cose', ftato: 'stato', effere: 'essere', quefto: 'questo', quefta: 'questa', ftesso: 'stesso', fteffo: 'stesso' },
});

export const LANG_OF = (s) => {
  const t = String(s || '').toLowerCase();
  return /^(la|lat)/.test(t) ? 'la' : /^(en|eng)/.test(t) ? 'en' : /^(de|ger|deu)/.test(t) ? 'de' : /^(fr|fre|fra)/.test(t) ? 'fr' : /^(it|ita)/.test(t) ? 'it' : null;
};

const fold = (w) => w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ſ/g, 's').replace(/v/g, 'u').replace(/j/g, 'i');

// ── tokens with their offsets, body text only ─────────────────────────────────

/** Metadata / description tags whose contents are not the printed text (the transcription header and notes). */
const META_TAGS = ['scan-quality', 'language', 'script', 'page-type', 'page-num', 'columns', 'meta', 'vocab', 'warning', 'image-desc', 'note', 'detected-images', 'split-position', 'lang'];
const META_RE = new RegExp(`<(${META_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?</\\1>`, 'g');

/** Word and number tokens of the printed text, with UTF-16 offsets: [{t, f, a, b}] (t raw, f folded). */
export function tokens(text) {
  const s = String(text || '');
  const mask = new Uint8Array(s.length);
  for (const m of s.matchAll(META_RE)) mask.fill(1, m.index, m.index + m[0].length);
  for (const m of s.matchAll(/<[^<>\n]{0,200}>/g)) mask.fill(1, m.index, m.index + m[0].length);
  const out = [];
  for (const m of s.matchAll(/[\p{L}\p{M}\p{N}ꝑꝓꝗꝙꝯꝰ⁹ᵈᵉ&;'’]+/gu)) {
    if (mask[m.index]) continue;
    let t = m[0].replace(/^['’;]+|['’;]+$/g, ''); if (!t) continue;
    const a = m.index + m[0].indexOf(t);
    // French elision (n'est, qu'il): the elided word is its own token
    for (const part of t.split(/(?<=^[nNlLdDsScCjJmMtT]|^[qQ]u)['’]/)) {
      const off = a + t.indexOf(part);
      if (part) out.push({ t: part, f: fold(part.replace(/['’]/g, '')), a: off, b: off + part.length });
    }
  }
  return out;
}

/** Token alignment (LCS on folded tokens): hunks [{ai, aj, bi, bj}] where A[ai..aj) became B[bi..bj). */
export function diffHunks(A, B) {
  const n = A.length, m = B.length;
  // trim common prefix/suffix, then LCS on the middle (pages are ≤ ~1,500 tokens; the middle is usually far smaller)
  let p = 0; while (p < n && p < m && A[p].f === B[p].f) p++;
  let q = 0; while (q < n - p && q < m - p && A[n - 1 - q].f === B[m - 1 - q].f) q++;
  const a = A.slice(p, n - q), b = B.slice(p, m - q), N = a.length, M = b.length;
  if (N * M > 6e6) return [{ ai: p, aj: n - q, bi: p, bj: m - q }];   // pathological: one hunk
  const L = Array.from({ length: N + 1 }, () => new Uint16Array(M + 1));
  for (let i = N - 1; i >= 0; i--) for (let j = M - 1; j >= 0; j--) L[i][j] = a[i].f === b[j].f ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const hunks = []; let i = 0, j = 0, open = null;
  const close = () => { if (open) { hunks.push({ ai: p + open.ai, aj: p + i, bi: p + open.bi, bj: p + j }); open = null; } };
  while (i < N || j < M) {
    if (i < N && j < M && a[i].f === b[j].f) { close(); i++; j++; continue; }
    open ??= { ai: i, bi: j };
    if (j >= M || (i < N && L[i + 1][j] >= L[i][j + 1])) i++; else j++;
  }
  close();
  return hunks;
}

const ROMAN = /^(?=[MDCLXVI])M{0,4}(CM|CD|D?C{0,4})(XC|XL|L?X{0,4})(IX|IV|V?I{0,4})$/;
const RV = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const romanValue = (r) => { let v = 0; for (let i = 0; i < r.length; i++) { const a = RV[r[i]], b = RV[r[i + 1]] || 0; v += a < b ? -a : a; } return v; };
/**
 * A number token's VALUE, as a string (11 and XI are one number): digits as written (separators out), a Roman numeral
 * of 2+ letters in capitals, or a lower-case one ending in j (xij, iiij); null if not a number.
 */
export function numberKey(t) {
  // letters and digits in one token (3m, q2, 2m) is an abbreviation glyph read as a digit (ꝫ, ꝛ), not a number
  if (/\p{N}/u.test(t)) { if (/\p{L}/u.test(t)) return null; const d = t.replace(/[^0-9]/g, ''); return d ? String(Number(d)) : t.replace(/[^\p{N}]/gu, ''); }
  if (t.length >= 2 && t === t.toUpperCase() && ROMAN.test(t)) return String(romanValue(t));
  if (/^[ivxlcdm]*[ij]$/.test(t) && t.length >= 2 && /j$/.test(t)) { const r = t.toUpperCase().replace(/J$/, 'I'); return ROMAN.test(r) ? String(romanValue(r)) : null; }
  return null;
}

const ABBR = /[̃̄̅̆̑ͣ-ͯꝑꝓꝗꝙꝯꝰ⁹ᵈᵉ;~]/u;
const ABBR_BASE = (t) => t.normalize('NFD').replace(/f/g, 's').replace(/[ꝑꝓ]/g, 'p').replace(/[ꝗꝙ]/g, 'q').replace(/[ꝯꝰ⁹;~]/g, '').replace(/[ᵈ]/g, 'd').replace(/[ᵉ]/g, 'e').replace(/\p{M}/gu, '').toLowerCase().replace(/ſ/g, 's').replace(/v/g, 'u').replace(/j/g, 'i');
const isSubseq = (x, y) => { let k = 0; for (const ch of y) if (ch === x[k]) k++; return k === x.length; };

const ctx = (T, i, j) => T.slice(Math.max(0, i), Math.min(T.length, j)).map((x) => x.t).join(' ');

/**
 * The flip-risk changes from `draft` to `next`: only hunks of ≤ MAX_HUNK tokens a side are looked at, and a hunk of the token diff is flagged for a negation only when the
 * PAGE's count of that negation word changes, and for a number only when the page's count of that number does. `lang`: la | en | de | fr | it (Latin negations are checked on every
 * page: Latin quotations stand in vernacular books). Returns { flags: [{kind, i, draft, next, context_draft,
 * context_next, a:[start,end], b:[start,end]}], hunks } — kind is 'negation' | 'number' | 'expansion'; `a`/`b` are the
 * hunk's character spans in draft / next, so a change can be put back exactly.
 */
/** Abbreviated negations of early print, by their letters with the marks taken off: nõ / nō / n̄ = non, nl / nich̄ = nihil. */
const ABBR_NEG = Object.freeze({ n: 'non', no: 'non', nl: 'nihil', nich: 'nihil', nichl: 'nihil', nil: 'nihil', nq: 'neque', nec: 'nec', nu: 'nunquam' });

export const MAX_HUNK = 3;

export function correctionDiffs(draft, next, { lang } = {}) {
  const A = tokens(draft), B = tokens(next);
  const NEG0 = new Set([...(NEGATIONS[lang] || []), ...NEGATIONS.la].map(fold));
  // a token is the negation it spells, or — written with an abbreviation mark — the negation its letters abbreviate,
  // so expanding nõ to non is not a negation added
  // Counted as ONE class: nec → neque or nullū → nullam changes the word, not the sense. A truncated or abbreviated
  // form (nunq, nullū, nequaquã) is the negation it begins.
  const NEGW = [...NEG0].filter((w) => w.length >= 4);
  const negOf = (x) => {
    if (NEG0.has(x.f)) return 'NEG';
    const base = ABBR_BASE(x.t).replace(/[^\p{L}]/gu, '');
    if (ABBR.test(x.t.normalize('NFD')) && ABBR_NEG[base]) return 'NEG';
    return base.length >= 4 && NEGW.some((w) => w.startsWith(base) || base.startsWith(w)) ? 'NEG' : null;
  };
  const hunks = diffHunks(A, B);
  const flags = [];
  const span = (T, i, j, other) => (i < j ? [T[i].a, T[j - 1].b] : other);
  const bag = (T, i, j, f) => { const m = new Map(); for (let k = i; k < j; k++) { const v = f(T[k]); if (v != null) m.set(v, (m.get(v) || 0) + 1); } return m; };
  const sameBag = (x, y) => x.size === y.size && [...x].every(([k, v]) => y.get(k) === v);
  const diffKeys = (x, y) => [...new Set([...x.keys(), ...y.keys()])].filter((k) => (x.get(k) || 0) !== (y.get(k) || 0));
  // Page-level counts decide whether a change is a change at all: a page number the draft has in the body and the
  // correction moves into <page-num>, or a "non" the alignment shifted to the next hunk, leaves the page's count as it was.
  // Numbers are counted over the WHOLE text (tags included); negations over the printed text.
  const allNums = (t) => { const m = new Map(); for (const x of String(t || '').matchAll(/[\p{L}\p{N}]+/gu)) { const k = numberKey(x[0]); if (k != null) m.set(k, (m.get(k) || 0) + 1); } return m; };
  const numChanged = new Set(diffKeys(allNums(draft), allNums(next)));
  // a lone 7 in Latin or German print is usually the Tironian et (⁊) read as a digit: not a number change
  if (lang === 'la' || lang === 'de') numChanged.delete('7');
  const negChanged = new Set(diffKeys(bag(A, 0, A.length, negOf), bag(B, 0, B.length, negOf)));
  for (const h of hunks) {
    // a flip is LOCAL: a word or three changed inside text that otherwise agrees. A longer hunk is a re-read of a passage
    // (a garbled draft read again), which the image judge checks as omission / addition, not this guard.
    if (h.aj - h.ai > MAX_HUNK || h.bj - h.bi > MAX_HUNK) continue;
    // a spacing fix (Bacchinon → Bacchi non, ne quidem → nequidem) changes no letters: never a flag
    if (A.slice(h.ai, h.aj).map((x) => x.f).join('') === B.slice(h.bi, h.bj).map((x) => x.f).join('')) continue;
    // spans to swap back: a hunk with one side empty takes the separator before it on both sides (from the end of the
    // previous token), so putting a dropped word back also puts back its space
    let a = span(A, h.ai, h.aj, null), b = span(B, h.bi, h.bj, null);
    if (!a || !b) {
      if (h.ai > 0 && h.bi > 0) { a = [A[h.ai - 1].b, a ? a[1] : A[h.ai - 1].b]; b = [B[h.bi - 1].b, b ? b[1] : B[h.bi - 1].b]; }
      else { const ae = h.aj < A.length ? A[h.aj].a : String(draft).length, be = h.bj < B.length ? B[h.bj].a : String(next).length; a = [a ? a[0] : ae, ae]; b = [b ? b[0] : be, be]; }
    }
    const base = { draft: ctx(A, h.ai, h.aj), next: ctx(B, h.bi, h.bj), context_draft: ctx(A, h.ai - 4, h.aj + 4), context_next: ctx(B, h.bi - 4, h.bj + 4), a, b };
    const negA = bag(A, h.ai, h.aj, negOf), negB = bag(B, h.bi, h.bj, negOf);
    // a negation prefix added or dropped on one word (in-/un-/non-), the #6142 shape for Latin script
    const prefixFlip = h.aj - h.ai === 1 && h.bj - h.bi === 1 && (() => {
      const x = A[h.ai].f, y = B[h.bi].f; const [s, l] = x.length < y.length ? [x, y] : [y, x];
      return l.length >= 6 && ['in', 'im', 'un', 'non', 'ir', 'il'].some((pf) => l === pf + s);
    })();
    if ((!sameBag(negA, negB) && diffKeys(negA, negB).some((k) => negChanged.has(k))) || prefixFlip) flags.push({ kind: 'negation', ...base });
    const numA = bag(A, h.ai, h.aj, (x) => numberKey(x.t)), numB = bag(B, h.bi, h.bj, (x) => numberKey(x.t));
    if (!sameBag(numA, numB) && diffKeys(numA, numB).some((k) => numChanged.has(k))) flags.push({ kind: 'number', ...base });
    // an abbreviation in the draft written out as a word whose letters do not contain the abbreviation's
    for (let k = h.ai; k < h.aj; k++) {
      if (!ABBR.test(A[k].t.normalize('NFD'))) continue;
      const baseA = ABBR_BASE(A[k].t).replace(/[^\p{L}]/gu, '');
      const nextWords = B.slice(h.bi, h.bj).map((x) => x.f.replace(/f/g, 's'));
      // a misread draft letter inside the abbreviation is common (GPU drafts of incunabula); a different FIRST letter as
      // well is a different word
      if (nextWords.length && !nextWords.some((w) => isSubseq(baseA, w) || w[0] === baseA[0])) { flags.push({ kind: 'expansion', ...base }); break; }
    }
  }
  flags.forEach((f, i) => { f.i = i; });
  return { flags, hunks: hunks.length };
}

/**
 * Put the draft back where the image check did not confirm the correction. `verdicts`: [{i, winner}] for the flags of
 * correctionDiffs(draft, next) — winner 'next' (the correction is what the page prints: keep), 'draft' (put the draft's
 * words back), anything else (undecided). Returns { text, kept, reverted, undecided }; text is null when any flag is
 * undecided or has no verdict (the page is held). Overlapping flags of one hunk share its fate: a hunk goes back to the
 * draft if any of its flags is given to the draft.
 */
export function applyDiffVerdicts(draft, next, flags, verdicts) {
  const v = new Map((verdicts || []).map((x) => [x.i, x.winner]));
  const undecided = flags.filter((f) => !['next', 'draft'].includes(v.get(f.i)));
  const back = new Map();
  for (const f of flags) if (v.get(f.i) === 'draft') back.set(`${f.b[0]}:${f.b[1]}`, f);
  const kept = flags.filter((f) => v.get(f.i) === 'next' && !back.has(`${f.b[0]}:${f.b[1]}`)).length;
  if (undecided.length) return { text: null, kept, reverted: back.size, undecided: undecided.length };
  let out = String(next);
  for (const f of [...back.values()].sort((x, y) => y.b[0] - x.b[0])) out = out.slice(0, f.b[0]) + String(draft).slice(f.a[0], f.a[1]) + out.slice(f.b[1]);
  return { text: out, kept, reverted: back.size, undecided: 0 };
}

/**
 * The long-s pass. `convention`: the text the library serves for the page now (its ſ usage is the convention kept).
 * Repairs LONG_S_TELLS forms (whole words, case kept; tags and metadata untouched) and folds ſ → s when `convention`
 * has no ſ. Returns { text, tells: [{from, to}], folded }.
 */
export function longSPass(text, { lang, convention = '' } = {}) {
  const s = String(text || ''); const tells = [];
  const T = LONG_S_TELLS[lang] || {};
  const skip = new Uint8Array(s.length);
  for (const m of s.matchAll(META_RE)) skip.fill(1, m.index, m.index + m[0].length);
  for (const m of s.matchAll(/<[^<>\n]{0,200}>/g)) skip.fill(1, m.index, m.index + m[0].length);
  let out = s.replace(/[\p{L}\p{M}]+/gu, (w, off) => {
    if (skip[off]) return w;
    const to = T[fold(w)]; if (!to) return w;
    // keep the case and the u/v, i/j spelling of the original: only the f that stands for ſ changes
    const fs = [...w]; const want = [...to];
    if (fs.length !== want.length) return w;
    const r = fs.map((ch, k) => (fold(ch) === 'f' && want[k] === 's' ? (ch === 'F' ? 'S' : 's') : ch)).join('');
    if (r !== w) tells.push({ from: w, to: r });
    return r;
  });
  let folded = 0;
  if (!/ſ/.test(String(convention))) out = out.replace(/ſ/g, () => { folded++; return 's'; });
  return { text: out, tells, folded };
}
