// PRIOR ART: src/data/concept-aliases.json + scripts/lib/concept-aliases-skos.mjs (#4725/#4741 —
// the curated vocabulary for SEARCH expansion; it says which renderings are equivalent, not which
// are loaded); scripts/audit/translation-bridging.mjs and detect-fabricated-translation.mjs
// (page-level fabrication, not word choice); src/lib/word-alignment.ts (span pairs, but generated
// lazily on read: 12 of ~8,600 translated pages carry them across the 14 evidence books of #7475,
// measured 2026-10-27, so they can refine a hit but cannot be the detector).
/**
 * Loaded-term renderings (#7475): a neutral or technical source word (δαίμων, 巫, veneficium, magus,
 * vidyā) rendered with the loaded English an intermediary language carries in ("demon", "sorcery",
 * "witchcraft", "magician", "magic").
 *
 * The predicate pairs a SOURCE match on the page's OCR with a LOADED match on its translation when
 * the two sit at about the same relative position on the page (|Δ| <= window, default 0.2 of the
 * stripped text length). Where the page carries `word_alignment.pairs`, an aligned pair overrides
 * position: a pair whose source span holds the term and whose target holds the loaded word is an
 * `aligned` hit; a pair whose source holds the term and whose target does NOT suppresses the
 * position hit for that occurrence.
 *
 * Not flagged: books whose language is English (nothing to inherit from); a class's
 * `skip_collections` (Christian/demonology shelves, where the author means an evil spirit); a
 * loaded word whose nearby English (±120 chars) keeps the transliteration ("daimon (demon)") — the
 * translator glossed; and, per class, a loaded word right after an evil-qualifier ("evil demons").
 *
 * A WORK LIST, never an authority. "demon" is right where the source means an evil spirit.
 */
import { readFileSync } from 'node:fs';
import { stripEditorialWrappers } from './strip-editorial-wrappers.mjs';

// A translator's note keeping the term ("a 'daemon' is a guiding spirit, not an evil 'demon'")
// can sit ~90 chars from the word it explains; 120 covers the measured case.
const GLOSS_WINDOW = 120;

const WATCHLIST_PATH = new URL('./loaded-term-watchlist.json', import.meta.url);

/** Accent fold for Latin/Greek only: Devanagari vowel signs are marks too and must survive. */
export function foldText(text) {
  return (text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ς/g, 'σ')
    .toLowerCase();
}

export function loadWatchlist(path = WATCHLIST_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return raw.classes.map((c) => ({
    ...c,
    sourceRe: new RegExp(c.source, 'gu'),
    loadedRe: new RegExp(c.loaded, 'gi'),
    glossRe: c.gloss ? new RegExp(c.gloss, 'i') : null,
    exemptBeforeRe: c.exempt_before ? new RegExp(c.exempt_before, 'i') : null,
  }));
}

/**
 * Classes that apply to a book of this language and these collections (empty when the book is
 * never screened). `skip_collections` drops a class on Christian/demonology shelves, where the
 * author means an evil spirit and the loaded English is faithful.
 */
export function classesForLanguage(classes, language, collections = []) {
  const lang = (language || '').trim();
  if (/^english$/i.test(lang)) return [];
  const cols = new Set(collections || []);
  return classes.filter((c) => {
    if (c.skip_collections && c.skip_collections.some((k) => cols.has(k))) return false;
    if (c.languages && !c.languages.some((l) => l.toLowerCase() === lang.toLowerCase())) return false;
    if (c.not_languages && c.not_languages.some((l) => l.toLowerCase() === lang.toLowerCase())) return false;
    return true;
  });
}

function matchesWithPos(re, text) {
  re.lastIndex = 0;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    out.push({ start: m.index, text: m[0] });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

const ctx = (text, start, len, pad = 50) =>
  text.slice(Math.max(0, start - pad), Math.min(text.length, start + len + pad)).replace(/\s+/g, ' ').trim();

/**
 * Screen one page. Returns one hit per class at most (the closest-positioned pair), each
 * { class, mode: 'aligned'|'position', source, loaded, source_ctx, loaded_ctx, delta }.
 */
export function screenPage({ ocr, translation, alignment }, classes, { window = 0.2 } = {}) {
  const src = stripEditorialWrappers(ocr || '');
  const tr = stripEditorialWrappers(translation || '');
  if (!src.trim() || !tr.trim()) return [];
  const srcF = foldText(src);
  const trF = foldText(tr);
  // NFD folding can shift offsets on accented text; positions are used as ratios of the folded
  // string's own length, so the ratio stays comparable, and contexts are cut from the folded text.
  const hits = [];
  for (const c of classes) {
    const sMatches = matchesWithPos(c.sourceRe, srcF);
    if (!sMatches.length) continue;
    const lMatches = matchesWithPos(c.loadedRe, trF).filter((l) => {
      if (c.exemptBeforeRe && c.exemptBeforeRe.test(trF.slice(Math.max(0, l.start - 30), l.start))) return false;
      if (!c.glossRe) return true;
      const near = trF.slice(Math.max(0, l.start - GLOSS_WINDOW), l.start + l.text.length + GLOSS_WINDOW);
      return !c.glossRe.test(near);
    });
    if (!lMatches.length) continue;

    // Alignment, when present, is the stronger witness.
    const pairs = Array.isArray(alignment) ? alignment : [];
    let aligned = null;
    let anyPairCoversTerm = false;
    for (const p of pairs) {
      const ps = foldText(p.s);
      c.sourceRe.lastIndex = 0;
      if (!c.sourceRe.test(ps)) continue;
      anyPairCoversTerm = true;
      c.loadedRe.lastIndex = 0;
      const pt = foldText(p.t);
      if (c.loadedRe.test(pt) && !(c.glossRe && c.glossRe.test(pt))) { aligned = p; break; }
    }
    if (aligned) {
      hits.push({
        class: c.id, mode: 'aligned', source: aligned.s, loaded: aligned.t,
        source_ctx: aligned.s, loaded_ctx: aligned.t, delta: 0,
      });
      continue;
    }
    // Every aligned occurrence of the term went to neutral English: trust the alignment.
    if (anyPairCoversTerm) continue;

    let best = null;
    for (const s of sMatches) {
      const sr = s.start / srcF.length;
      for (const l of lMatches) {
        const d = Math.abs(sr - l.start / trF.length);
        if (d <= window && (!best || d < best.delta)) best = { s, l, delta: d };
      }
    }
    if (!best) continue;
    hits.push({
      class: c.id, mode: 'position', source: best.s.text, loaded: best.l.text,
      source_ctx: ctx(srcF, best.s.start, best.s.text.length),
      loaded_ctx: ctx(trF, best.l.start, best.l.text.length),
      delta: Math.round(best.delta * 1000) / 1000,
    });
  }
  return hits;
}

/** Server-side prefilters so a shelf scan only ships pages that can possibly hit. */
export const TRANSLATION_PREFILTER = /demon|devil|fiend|sorcer|witch|wizard|warlock|magic|conjur/i;
export const OCR_PREFILTER = /δα.μ|ΔΑ.Μ|d[aæe]+mon|dämon|démon|鬼|巫|覡|術|蠱|venefic|malefic|μάγ|μαγ|ΜΑΓ|mag(us|i|orum|os|um)\b|vidy|विद्य|māy|maya|माया|मायय/i;
