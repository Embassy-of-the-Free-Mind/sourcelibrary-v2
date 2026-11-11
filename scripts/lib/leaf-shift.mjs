// PRIOR ART: scripts/audit/translation-leaf-shift.mjs (#5021, PR #6683) — this is its classifier,
// moved here unchanged so the block translation lanes can run it at write time; the audit imports
// it back. scripts/lib/block-drift.mjs catches a CLAUSE moved across one boundary by letter case;
// it cannot see a whole leaf shifted, which is what this reads, from the numbers a leaf prints.
/**
 * leaf-shift — is a page's English the NEXT or PREVIOUS leaf's text? Pure functions, no I/O.
 * The method, its controls and its limits are documented in scripts/audit/translation-leaf-shift.mjs.
 */
import { stripMarkupTags } from './strip-markup-tags.mjs';
import { classifyLanguageContent } from './language-content-classify.mjs';

export const MIN_VALUE = 10;
export const BRACKET_MIN = 100;
export const MAX_VALUE = 99999;
export const MIN_RUN = 2;
export const HEAD_LINE_MAX = 90;
export const STRONG_MIN = 30;
export const MAX_GAP = 2;
export const NAME_MIN_VOTES = 2;
// Absorption (#5021, Derek 2026-11-03): thresholds on log length ratios, see absorptionsOf.
export const ABSORB_OWN_MIN = 0.5;
export const ABSORB_TWO_MAX = 0.2;
export const ABSORB_SRC_MIN = 300;
export const ABSORB_LOOKAHEAD = 3;
// One block's pages are written one by one, milliseconds apart (Postel 178/179: 41 ms; the next block
// 5 min later), so "same translation.updated_at" means within this many ms.
export const ABSORB_SAME_BLOCK_MS = 2000;
// Page types whose English legitimately runs long or short against the leaf (an index, an apparatus).
export const ABSORB_SKIP_TYPES = new Set(['index', 'errata', 'title-page', 'blank', 'bibliography', 'contents', 'toc', 'glossary', 'apparatus', 'archived-spread', 'digitizer-insert', 'illustration']);

// Zero code point of each decimal-digit block we expect in the corpus.
const DIGIT_ZEROS = [
  0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66,
  0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90,
  0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10,
];
const DIGIT_MAP = new Map();
for (const z of DIGIT_ZEROS) for (let d = 0; d < 10; d++) DIGIT_MAP.set(String.fromCodePoint(z + d), String(d));
const NON_ASCII_DIGIT = new RegExp(`[${[...DIGIT_MAP.keys()].join('')}]`, 'gu');
/** Digits of any numeral system → ASCII digits. */
export const foldDigits = s => String(s || '').replace(NON_ASCII_DIGIT, ch => DIGIT_MAP.get(ch));

const CJK_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CJK_UNIT = { 十: 10, 百: 100, 千: 1000 };
/** 一百七十三 → 173, 廿三 → 23, 一七三 → 173. null when the run is not a number. */
export function cjkNumber(run) {
  const s = run.replace(/廿/g, '二十').replace(/卅/g, '三十');
  if (![...s].some(ch => ch in CJK_UNIT)) {
    if ([...s].length < 2) return null;
    return Number([...s].map(ch => CJK_DIGIT[ch]).join(''));
  }
  let total = 0;
  let cur = null;
  for (const ch of s) {
    if (ch in CJK_DIGIT) cur = CJK_DIGIT[ch];
    else {
      total += (cur ?? 1) * CJK_UNIT[ch];
      cur = null;
    }
  }
  return total + (cur ?? 0);
}

const ROMAN_RE = /(?<![\p{L}\p{N}])(?=[MDCLXVI]{3,})M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})(?![\p{L}\p{N}])/gu;
const ROMAN_VAL = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const ROMAN_WORDS = new Set(['MIX', 'DIV', 'CIV', 'LIV', 'VIM', 'DIM', 'MID', 'LID', 'DID', 'MIL', 'CCC', 'MMM', 'XXX', 'III']);
function romanValue(s) {
  let v = 0;
  for (let i = 0; i < s.length; i++) {
    const a = ROMAN_VAL[s[i]];
    const b = ROMAN_VAL[s[i + 1]] || 0;
    v += a < b ? -a : a;
  }
  return v;
}

export const META_TAGS = 'scan-quality|language|script|page-type|columns|detected-images|vocab|warning|meta|image-desc|figure|summary|keywords';
export const HEAD_TAGS = 'page-num|header|sig|footer|catchword';
export const tagBlock = names => new RegExp(`<(${names})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi');

/**
 * Split a layer into its running head and its body. The head is the <page-num>/<header>/<sig>
 * tags plus a short first line that carries a number (an untagged running head, as on the
 * shifted Śakuntalā pages: "277 || Act VII || 299").
 */
export function splitLayer(text) {
  let s = String(text || '').replace(tagBlock(META_TAGS), ' ');
  const head = [];
  s = s.replace(tagBlock(HEAD_TAGS), (_, __, inner) => {
    head.push(inner);
    return '\n';
  });
  s = stripMarkupTags(s, ' ');
  const lines = s.split('\n');
  const first = lines.findIndex(l => l.trim());
  if (first >= 0) {
    const l = lines[first].trim();
    const f = foldDigits(l).replace(/[*#>_~\s]+/g, ' ').trim();
    // A running head opens or closes on a bare number; a verse line closes on ॥N॥ and is body.
    if (f.length <= HEAD_LINE_MAX && (/^[-–—|\s]*\d+(?!\d)/.test(f) || /\d[\s.|-]*$/.test(f))) {
      head.push(l);
      lines[first] = '';
    }
  }
  return { head: head.join('\n'), body: lines.join('\n') };
}

/** Every number in a text, as a Set of integers within [MIN_VALUE, MAX_VALUE]. */
export function numbersIn(text, { brackets = true } = {}) {
  const out = new Set();
  const s = foldDigits(text);
  for (const m of s.matchAll(/\d+/g)) {
    const v = Number(m[0]);
    if (v < MIN_VALUE || v > MAX_VALUE || m[0].length > 5) continue;
    if (brackets && v < BRACKET_MIN) {
      const before = s.slice(Math.max(0, m.index - 2), m.index).trimEnd().slice(-1);
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 2).trimStart()[0];
      if (/[([{（【〔]/.test(before || '') || /[)\]}）】〕]/.test(after || '')) continue;
    }
    out.add(v);
  }
  for (const m of s.matchAll(/[〇零一二兩两三四五六七八九十百千廿卅]{2,}/gu)) {
    const v = cjkNumber(m[0]);
    if (v != null && Number.isFinite(v) && v >= MIN_VALUE && v <= MAX_VALUE) out.add(v);
  }
  for (const m of s.matchAll(ROMAN_RE)) {
    if (!m[0] || ROMAN_WORDS.has(m[0])) continue;
    const v = romanValue(m[0]);
    if (v >= MIN_VALUE && v <= MAX_VALUE) out.add(v);
  }
  return out;
}

// Words that open sentences, in the languages the corpus is mostly in and in English: never names.
const NAME_STOP = new Set(`this that these those there then than when where which while what with from into upon unto have hath were will would shall should could also thus here
after before since because though although therefore however moreover whereas wherefore again other another every each such some many most more much only even
they their them your yours ours this book chapter page part note notes verse section first second third fourth fifth sixth table plate figure vol volume
item haec hoc hic illa ille ipse quae quod quia quoniam quum cum sed etiam enim autem igitur ergo nunc tunc unde inde sic ita atque neque nam vero tamen
esse sunt erat fuit dein deinde praeterea postea primo secundo tertio caput liber cap lib pars
diese dieser dieses dies der die das den dem des eine einer eines ein und oder aber auch denn doch noch nicht wenn als wie wird werden wurde sind ist
nach durch über unter zwischen gegen ohne sondern sowie dass daß weil also kapitel seite theil teil buch
dans pour avec sans mais donc puis ainsi comme leur leurs cette ces sont elle elles nous vous ils chapitre livre
questo questa quello quella sono della delle degli dello nella nelle come anche perche perché però cosi così
este esta estos estas pero como para porque entonces donde capitulo capítulo`.split(/\s+/));
/** Fold a token for comparison across languages: no marks, lower case, first five letters
 *  (Galeni / Galenus / Galen, Plinius / Plinii; inflected source names against English ones). */
export const foldName = w => w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().slice(0, 5);
/**
 * Capitalised tokens of a text (names, places, titles): an upper-case letter and three or more
 * lower-case ones. Dropped: stop-listed sentence openers, and any word the same text also writes in
 * lower case (a capital it owes to its place in the sentence). Folded with foldName.
 */
export function namesIn(text) {
  const s = stripMarkupTags(String(text || ''), ' ');
  const lower = new Set();
  for (const m of s.matchAll(/(?<![\p{L}])\p{Ll}[\p{Ll}\p{M}]{3,}/gu)) lower.add(m[0].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());
  const out = new Set();
  for (const m of s.matchAll(/(?<![\p{L}])\p{Lu}[\p{Ll}\p{M}]{3,}(?![\p{L}])/gu)) {
    const full = m[0].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (NAME_STOP.has(full) || lower.has(full)) continue;
    out.add(foldName(m[0]));
  }
  return out;
}

const EMPTY = new Set();
const votes = (eng, own, a, b) => [...eng].filter(n => own.has(n) && !a.has(n) && !b.has(n));

/**
 * Classify each page of one book.
 * @param {{page_number:number, ocr:string, tr:string, pv?:string}[]} pages  sorted by page_number
 * @param {{rule?: 'strict'|'gappy', names?: boolean}} [opts]  rule: how votes make a run (strict is
 *   the write-time gate's, unchanged; gappy is the audit's, see gappyRuns). names: also compute the
 *   capitalised-token vote (nameCls) and the runs where it fills the pages numbers leave silent.
 *   absorb: also find absorbing pages (absorptionsOf); pages may carry enChars (a withheld page's
 *   length), updated (translation.updated_at, ISO) and page_type.
 */
export function classifyBook(pages, { rule = 'strict', names = false, absorb = false } = {}) {
  // A page with neither a transcription nor an English (a leaf OCR never reached) is not a leaf the
  // translator saw, so it is not a neighbour: n-1 and n+1 are the nearest pages that carry text, and
  // runs are adjacent by `pos`, not page_number. Cicero, De natura deorum 1546 (#8464): pp.57-58 and
  // 61-63 had no OCR, a block slipped one slot over the rest, and p.56's English was p.59's leaf, which
  // a page_number neighbour (an empty p.57) could never vote for.
  const rows = pages.filter(p => String(p.ocr || '').trim() || String(p.tr || '').trim()).map((p, pos) => {
    const o = splitLayer(p.ocr);
    const t = splitLayer(p.tr);
    return {
      pos,
      page_number: p.page_number,
      pv: p.pv ?? null,
      translated: !!(p.tr && p.tr.trim()),
      oBody: numbersIn(o.body),
      oHead: numbersIn(o.head, { brackets: false }),
      tBody: numbersIn(t.body),
      tHead: numbersIn(t.head, { brackets: false }),
      ...(names ? { oNames: namesIn(o.body), tNames: namesIn(t.body) } : {}),
      ...(absorb ? { enLen: p.enChars ?? String(p.tr || '').length, srcLen: String(p.ocr || '').length, upd: p.updated ?? null, ptype: p.page_type ?? null } : {}),
    };
  });
  for (const r of rows) {
    const P = rows[r.pos - 1];
    const N = rows[r.pos + 1];
    const cls = (eng, own, prev, next, drop = EMPTY) => {
      const e = new Set([...eng].filter(n => !drop.has(n)));
      const v = { own: votes(e, own, prev, next), next: votes(e, next, own, prev), prev: votes(e, prev, own, next) };
      let c = 'none';
      if (v.own.length + v.next.length + v.prev.length) {
        if (v.next.length && !v.own.length && !v.prev.length) c = 'next';
        else if (v.prev.length && !v.own.length && !v.next.length) c = 'prev';
        else if (v.own.length && !v.next.length && !v.prev.length) c = 'own';
        else c = 'mixed';
      }
      return { c, v };
    };
    if (!r.translated) {
      r.cls = 'untranslated';
      r.hdr = 'untranslated';
      continue;
    }
    // The body verdict ignores every number that is in a running head of N, N-1 or N+1.
    const heads = new Set([...r.oHead, ...r.tHead, ...(P?.oHead || []), ...(N?.oHead || [])]);
    const b = cls(r.tBody, r.oBody, P?.oBody || EMPTY, N?.oBody || EMPTY, heads);
    r.cls = b.c;
    r.votes = b.v;
    // Own numbers the transcription prints and the English lacks: a shifted page loses them.
    r.ownMissing = [...r.oBody].filter(n => !heads.has(n) && !r.tBody.has(n) && !(P?.oBody || EMPTY).has(n) && !(N?.oBody || EMPTY).has(n)).length;
    r.hdr = cls(r.tHead, r.oHead, P?.oHead || EMPTY, N?.oHead || EMPTY).c;
    if (names) {
      const nv = cls(r.tNames, r.oNames, P?.oNames || EMPTY, N?.oNames || EMPTY);
      r.nameVotes = nv.v;
      // One shared name is chance (a name recurs a few leaves on); a direction needs NAME_MIN_VOTES.
      r.nameCls = nv.c === 'next' || nv.c === 'prev' ? (nv.v[nv.c].length >= NAME_MIN_VOTES ? nv.c : 'none') : nv.c;
    }
  }
  const strict = strictRuns(rows);
  const runs = rule === 'gappy' ? gappyRuns(rows, 'cls') : strict;
  // A gappy run that holds a strong strict run is strong: widening a run over a weak voter must not
  // demote what the 2026-10-13 rule called tier A (Hussiten Krieg 412-414 → 412-417).
  if (rule === 'gappy') for (const g of runs) if (!g.strong && strict.some(x => x.strong && x.dir === g.dir && x.start >= g.start && x.end <= g.end)) g.strong = true;
  // The name signal (#5021): a page the numbers leave silent takes its capitalised-token verdict.
  if (names) for (const r of rows) r.cls2 = r.cls === 'none' && r.nameCls ? r.nameCls : r.cls;
  const runsNames = names ? gappyRuns(rows, 'cls2') : undefined;
  const absorptions = absorb ? absorptionsOf(rows) : undefined;
  const count = key => rows.reduce((a, r) => ((a[r[key]] = (a[r[key]] || 0) + 1), a), {});
  return { rows, runs, ...(absorb ? { absorptions } : {}), ...(rule === 'gappy' ? { strictRuns: strict } : {}), ...(names ? { runsNames, nameClasses: count('nameCls') } : {}), classes: count('cls'), hdrClasses: count('hdr') };
}

/**
 * ABSORPTION (#5021; Derek's session 2026-11-03, tested on the controls). A block slide starts with one
 * page whose English holds its OWN leaf and the NEXT one: from there on every page carries its
 * successor. With k = the book's median log(EN chars / SRC chars) over text pages (SRC >= ABSORB_SRC_MIN),
 * page n absorbs when it and n+1 were written in one block (translation.updated_at within
 * ABSORB_SAME_BLOCK_MS) and
 *   |log EN(n) - k - log SRC(n)| > ABSORB_OWN_MIN  and  |log EN(n) - k - log(SRC(n) + SRC(n+1))| < ABSORB_TWO_MAX.
 * It needs no printed number and no letter case, so it reaches caseless scripts. It is a CANDIDATE
 * generator, not a verdict: an index or apparatus page whose English expands, and bilingual or heavily
 * annotated editions (Śakuntalā: 30 hits, 2 corroborated, on 2026-11-03), fire it too. So index and
 * apparatus page types are skipped, and `corroborated` lists the pages n+1..n+ABSORB_LOOKAHEAD that vote
 * next or prev, and n itself when it votes next (by number, or by name where the numbers are silent).
 * The audit reports an absorption as found only when that list is non-empty. Measured 2026-11-03:
 * 3 of 4 controls, and 40 of 59 corroborated pages outside the number runs real by Opus with the scans.
 */
function absorptionsOf(rows) {
  const textLike = r => r.translated && !ABSORB_SKIP_TYPES.has(r.ptype) && r.srcLen >= ABSORB_SRC_MIN && r.enLen > 0;
  const ratios = rows.filter(textLike).map(r => Math.log(r.enLen / r.srcLen)).sort((a, b) => a - b);
  if (ratios.length < 5) return [];
  const k = ratios[Math.floor(ratios.length / 2)];
  const out = [];
  for (const r of rows) {
    const N = rows[r.pos + 1];
    if (!textLike(r) || !N || !N.translated || !r.upd || !N.upd || Math.abs(Date.parse(r.upd) - Date.parse(N.upd)) > ABSORB_SAME_BLOCK_MS) continue;
    const own = Math.log(r.enLen) - k - Math.log(r.srcLen);
    const two = Math.log(r.enLen) - k - Math.log(r.srcLen + N.srcLen);
    if (Math.abs(own) <= ABSORB_OWN_MIN || Math.abs(two) >= ABSORB_TWO_MAX) continue;
    const corroborated = [];
    // n itself counts when it votes next: an absorbing page prints its successor's numbers (Corpus p.82).
    for (let d = 0; d <= ABSORB_LOOKAHEAD; d++) {
      const q = rows[r.pos + d];
      let c = q && (q.cls === 'next' || q.cls === 'prev' ? q.cls : q.nameCls === 'next' || q.nameCls === 'prev' ? q.nameCls : null);
      if (d === 0 && c !== 'next') c = null;
      if (c) corroborated.push({ p: q.page_number, c, by: q.cls === c ? 'numbers' : 'names' });
    }
    out.push({ p: r.page_number, k: Math.round(k * 100) / 100, own: Math.round(own * 100) / 100, two: Math.round(two * 100) / 100, corroborated });
  }
  return out;
}

/** The 2026-10-13 rule: >= MIN_RUN adjacent page_numbers that all vote one direction. */
function strictRuns(rows) {
  const runs = [];
  for (const dir of ['next', 'prev']) {
    let run = [];
    const flush = () => {
      if (run.length >= MIN_RUN) runs.push({ dir, start: run[0].page_number, end: run[run.length - 1].page_number, length: run.length, pv: [...new Set(run.map(r => r.pv))], strong: run.every(r => r.ownMissing >= 1 && Math.max(...r.votes[dir]) >= STRONG_MIN), pages: run.map(r => ({ p: r.page_number, n: r.votes[dir], ownMissing: r.ownMissing })) });
      run = [];
    };
    for (const r of rows) {
      if (r.cls === dir && (!run.length || run[run.length - 1].pos === r.pos - 1)) run.push(r);
      else {
        flush();
        if (r.cls === dir) run.push(r);
      }
    }
    flush();
  }
  return runs;
}

/**
 * The gappy rule (#5021, 2026-11-03). A run is a window of page_numbers in which >= MIN_RUN pages
 * vote one direction, NO page votes the other direction, `own` or `mixed`, and silent pages (class
 * `none`: no vote, NO claim) may sit between two voting pages, at most MAX_GAP of them in a row.
 * A block translator that slipped one leaf leaves the leaves with no printed numbers silent, so a
 * strict adjacency rule misses the run (Karl Grosherzog pp.16-20 vote next, -, next, -, prev).
 * A `next` run may END on one `prev` page: the last page of a slipped block has only the previous
 * leaf's leftovers (footnotes) to carry, so it votes back (Karl p.20 = p.19's footnotes). The tail
 * does not count toward MIN_RUN. `strict` says whether the run holds a 2026-10-13-rule run
 * (adjacent votes, no gap), so the old flags are a subset of the new by construction.
 * `cls` names the row field to read: 'cls' (numbers) or 'cls2' (numbers, names where silent).
 */
function gappyRuns(rows, cls = 'cls') {
  const runs = [];
  const voteOf = (r, dir) => (r.votes?.[dir]?.length ? r.votes[dir] : r.nameVotes?.[dir] || []);
  for (const dir of ['next', 'prev']) {
    let run = [];
    let tail = null;
    const flush = () => {
      if (run.length >= MIN_RUN) {
        const voters = run;
        const all = tail ? [...voters, tail] : voters;
        let strict = false;
        for (let i = 1; i < voters.length; i++) if (voters[i].pos === voters[i - 1].pos + 1) strict = true;
        runs.push({
          dir, start: voters[0].page_number, end: all[all.length - 1].page_number, length: all[all.length - 1].page_number - voters[0].page_number + 1,
          voting: voters.length, ...(tail ? { tail: tail.page_number } : {}), strict,
          pv: [...new Set(all.map(r => r.pv))],
          strong: voters.every(r => r.ownMissing >= 1 && r.votes?.[dir]?.length && Math.max(...r.votes[dir]) >= STRONG_MIN),
          byName: voters.filter(r => r[cls] === dir && r.cls !== dir).map(r => r.page_number),
          pages: all.map(r => ({ p: r.page_number, n: voteOf(r, r === tail ? (dir === 'next' ? 'prev' : 'next') : dir), ownMissing: r.ownMissing, ...(r.cls !== r[cls] ? { by: 'names' } : {}) })),
        });
      }
      run = [];
      tail = null;
    };
    const near = r => run.length && r.pos - run[run.length - 1].pos - 1 <= MAX_GAP;
    for (const r of rows) {
      const c = r[cls];
      if (c === 'none') {
        if (run.length && r.pos - run[run.length - 1].pos > MAX_GAP) flush();
        continue;
      }
      if (c === dir) {
        if (!near(r)) flush();
        run.push(r);
        continue;
      }
      if (dir === 'next' && c === 'prev' && near(r) && run.length >= MIN_RUN) {
        tail = r;
        flush();
        continue;
      }
      flush();
    }
    flush();
  }
  return runs;
}

/**
 * The write-time gate (#5021): does a parsed block carry a run of ≥ MIN_RUN consecutive pages whose
 * English votes only for the NEXT (or only the PREVIOUS) leaf's printed numbers? `pages` in block
 * order (page_number, ocr.data); `translations` the parser's Map<page_number, text>. Returns the
 * runs, empty when the block is clean or casts no vote. The block's first and last pages have one
 * neighbour missing, so a run there is seen only from its inner pages.
 *
 * A block translator that shifted by one leaf keeps each page's running head and writes the next
 * leaf's body (Śakuntalā pp.291-294; De Fato Declinando p.30 on prompt v13, 2026-10-05), so a
 * block that comes back complete passes every length and parse check. This reads the body.
 */
export function blockLeafShiftRuns(pages, translations) {
  const rows = pages.map(p => ({ page_number: p.page_number, ocr: p.ocr?.data || '', tr: translations.get(p.page_number) || '' }));
  return classifyBook(rows).runs;
}

// ── the language of one transcription (moved from scripts/audit/leaf-shift-screen-5021.mjs for #8399) ──

const SCRIPTS = Object.entries({ Latin: /\p{Script=Latin}/gu, Greek: /\p{Script=Greek}/gu, Cyrillic: /\p{Script=Cyrillic}/gu, Han: /\p{Script=Han}/gu, Kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/gu,
  Hangul: /\p{Script=Hangul}/gu, Tibetan: /\p{Script=Tibetan}/gu, Devanagari: /\p{Script=Devanagari}/gu, Arabic: /\p{Script=Arabic}/gu, Hebrew: /\p{Script=Hebrew}/gu, Syriac: /\p{Script=Syriac}/gu,
  Coptic: /\p{Script=Coptic}/gu, Armenian: /\p{Script=Armenian}/gu, Georgian: /\p{Script=Georgian}/gu, Ethiopic: /\p{Script=Ethiopic}/gu, Myanmar: /\p{Script=Myanmar}/gu, Thai: /\p{Script=Thai}/gu });
/**
 * The language of one transcription, $0: its dominant script, and for Latin script the stopword language
 * (scripts/lib/language-content-classify.mjs) when it reaches 5% of 40+ words, else 'latin-script-other'.
 * null when the page has too little text to say.
 */
export function windowLang(text) {
  const t = splitLayer(text).body;
  const counts = SCRIPTS.map(([k, re]) => [k, (t.match(re) || []).length]).sort((a, b) => b[1] - a[1]);
  if (counts[0][1] < 60) return null;
  if (counts[0][0] === 'Kana' || (counts[0][0] === 'Han' && counts.find(([k]) => k === 'Kana')[1] > counts[0][1] * 0.15)) return 'Japanese';
  if (counts[0][0] !== 'Latin') return counts[0][0];
  const c = classifyLanguageContent(t);
  return c.words >= 40 && c.score >= 0.05 ? c.dominant : 'latin-script-other';
}
