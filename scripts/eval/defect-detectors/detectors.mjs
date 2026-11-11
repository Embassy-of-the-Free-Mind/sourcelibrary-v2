// PRIOR ART: scripts/lib/page-integrity.mjs (sourceLanguageCount, readingLength, translationReasoningLeak — reused),
// scripts/lib/same-language.mjs englishSource (reused), scripts/audit/translation-page-boundary.mjs boundarySignals (reused).
/**
 * Defect detectors, one per page-error-taxonomy class (.claude/docs/page-error-taxonomy.md). Model-free.
 * Each entry: { name, classes (the taxonomy classes it targets), score(row, book) → number, higher = more suspect }.
 * row = { page, prev, next } with { ocr, tr, type }; book = { freq } (folded OCR word counts for the whole book).
 * ADD A DETECTOR: append an entry; run.mjs scores every entry against every class on the same labelled set,
 * so a new rule is compared with the old ones (and with any model screen's cached scores) the same way.
 */
import { sourceLanguageCount, readingLength, translationReasoningLeak } from '../../lib/page-integrity.mjs';
import { englishSource } from '../../lib/same-language.mjs';
import { boundarySignals } from '../../audit/translation-page-boundary.mjs';

const TAGS_DROP = /<(summary|keywords|meta|vocab|image-desc|language|script|page-type|header|footer|pagenum|sig|catchword)[^>]*>[\s\S]*?<\/\1>/gi;
const body = (t) => String(t || '').replace(/&nbsp;/g, ' ').replace(TAGS_DROP, ' ');
const plain = (t) => body(t).replace(/<(note|gloss|margin)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
const langTag = (ocr) => (String(ocr).match(/<(?:language|lang)>([^<]{1,80})<\/(?:language|lang)>/i)?.[1] || '').toLowerCase();

// Script mix: share of letters in each script. A Greek/Latin parallel page carries both in quantity.
function scriptShares(t) {
  const L = plain(t).match(/\p{L}/gu) || []; if (L.length < 200) return {};
  const c = { greek: 0, latin: 0, cjk: 0, deva: 0, hebrew: 0, arabic: 0 };
  for (const ch of L) {
    if (/\p{Script=Greek}/u.test(ch)) c.greek++; else if (/\p{Script=Latin}/u.test(ch)) c.latin++;
    else if (/\p{Script=Han}/u.test(ch)) c.cjk++; else if (/\p{Script=Devanagari}/u.test(ch)) c.deva++;
    else if (/\p{Script=Hebrew}/u.test(ch)) c.hebrew++; else if (/\p{Script=Arabic}/u.test(ch)) c.arabic++;
  }
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v / L.length]));
}
const PARALLEL_MARKERS = /\[(?:left|right)\s+column|column-break|corresponds to the (?:latin|greek)|greek text (?:is|corresponds)|latin (?:version|translation) (?:of|reads)|the (?:greek|latin) (?:column|text) (?:above|beside|opposite)/i;

// Negations by source language (whole words / characters), and in the English.
const NEG = {
  latin: /\b(?:non|ne|nec|neque|nihil|nil|nullus|nulla|nullum|nunquam|numquam|haud|nemo|neutiquam|minime)\b/giu,
  greek: /(?:^|[^\p{L}])(?:οὐ|οὐκ|οὐχ|μή|μὴ|οὐδέ|οὐδὲ|μηδέ|μηδὲ|οὐδείς|οὐδεὶς|μηδείς|οὐδέν|οὐδὲν|οὔτε|μήτε|οὐδαμῶς)(?=[^\p{L}]|$)/giu,
  french: /\b(?:ne|n'|pas|point|jamais|aucun|aucune|rien|nul|nulle|personne)\b/giu,
  italian: /\b(?:non|né|mai|nessuno|niente|nulla)\b/giu,
  german: /\b(?:nicht|kein|keine|keinen|keinem|niemals|nie|nichts|weder)\b/giu,
  spanish: /\b(?:no|ni|nunca|jamás|nada|nadie|ninguno)\b/giu,
  chinese: /[不無无非未莫勿弗毋否]/gu,
  sanskrit: /(?:^|[\s।])(?:न|मा|नैव|नापि|नहि|नो)(?=[\s।]|$)/gu,
};
const NEG_EN = /\b(?:not|no|never|nor|neither|none|nothing|nobody|cannot|without|n't)\b|n't\b/gi;
const negLang = (tag) => Object.keys(NEG).find((k) => tag.includes(k)) || (tag.includes('hindi') ? 'sanskrit' : null);

// Hedged notes: the translator explaining a reading (T10 fix rule in the taxonomy).
const HEDGE = /\b(?:likely|possibly|probably|perhaps|may (?:be|refer|mean)|might be|seems to|appears to be|misprint|corrupt(?:ion|ed)?|obscure|unclear|uncertain|plausible|presumably|a variant|scribal error|typo)\b/i;

export const DETECTORS = [
  { name: 'parallel', classes: ['T11'], score({ page }) {
    const s = scriptShares(page.ocr), tag = langTag(page.ocr);
    const multi = sourceLanguageCount(page.ocr) > 1 || ((s.greek || 0) > 0.15 && (s.latin || 0) > 0.15);
    if (!multi) return 0;
    const src = readingLength(plain(page.ocr)), out = readingLength(plain(page.tr));
    const r = src ? out / src : 0;                   // one column rendered ≈ 0.5–0.7 of a two-column source
    return 1 + (PARALLEL_MARKERS.test(page.tr) ? 2 : 0) + Math.abs(Math.log((r || 0.01) / 0.6)) + (tag ? 0 : 0);
  } },
  { name: 'long-s', classes: ['O6', 'O8'], score({ page }, book) {
    const tag = langTag(page.ocr); if (/greek|chinese|sanskrit|hebrew|arabic|tibetan|japanese/.test(tag)) return 0;
    const f = book?.freq || {}; let hits = 0;
    const words = String(plain(page.ocr)).normalize('NFC').toLowerCase().match(/\p{L}+/gu) || [];
    for (const w of new Set(words)) {
      if (!w.includes('f') || w.length < 4) continue;
      for (let i = 0; i < w.length; i++) if (w[i] === 'f') {
        const v = w.slice(0, i) + 's' + w.slice(i + 1);
        if ((f[v] || 0) >= 3 && (f[v] || 0) >= 3 * (f[w] || 0)) { hits++; break; }
      }
    }
    return hits;
  } },
  { name: 'negation', classes: ['T8', 'O6'], score({ page }) {
    const lang = negLang(langTag(page.ocr)); if (!lang) return 0;
    const ns = (plain(page.ocr).match(NEG[lang]) || []).length, ne = (plain(page.tr).match(NEG_EN) || []).length;
    return Math.abs(ns - ne) / Math.sqrt(ns + ne + 1);
  } },
  { name: 'seam', classes: ['T5', 'T4', 'T15'], score({ page, prev, next }) {
    const s = boundarySignals({ page, prev, next });
    return ['dupNext', 'dupPrev', 'carried', 'ocrNext', 'anchorsNext', 'anchorsPrev'].filter((k) => s[k]).length;
  } },
  { name: 'hedged-notes', classes: ['T10', 'T7'], score({ page }) {
    const notes = String(page.tr).match(/<(?:note|gloss)[^>]*>[\s\S]*?<\/(?:note|gloss)>/gi) || [];
    const unclear = (String(page.ocr).match(/<unclear/gi) || []).length;
    return notes.filter((n) => HEDGE.test(n)).length + 0.5 * Math.min(unclear, 4) * (notes.length ? 1 : 0);
  } },
  { name: 'model-reply', classes: ['T17', 'O15'], score({ page }) { return translationReasoningLeak(page.tr) ? 1 : 0; } },
  { name: 'english-source', classes: ['T12'], score({ page }) { const e = englishSource(page.ocr); return e.judged && e.english ? 1 + e.share : 0; } },
];
