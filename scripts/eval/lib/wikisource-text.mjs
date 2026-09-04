// PRIOR ART: none — scripts/eval/lib/ has metrics.mjs (scoring), sampling.mjs (Mongo),
// runners.mjs (model APIs), revision-source.mjs (provenance labels). Wikitext cleaning
// lived inline in harvest-wikisource-gt.mjs; extracted here so it can be imported and
// unit-tested WITHOUT executing the harvester (that module is top-level-await script
// code, so importing it ran a whole live harvest — observed 2026-09-04).
/**
 * Wikisource Page: wikitext → the transcribed text of the page.
 */

// Templates whose payload is scaffolding, not printed text: leader dots, floats, anchors,
// spacing, catalogue links, the proofread header itself. Derived from a census of every
// template occurring in the 120 pinned Wikisource references (2026-09-05), not guessed —
// each name below was read with its payloads before being listed.
const TEMPLATE_DROP = new Set([
  'seitenstatus', 'seitenstatus2', 'zitierempfehlung', 'zeile', 'idt', 'nop', 'absatz',
  'references', 'refl', 'fi', 'gbs', 'rubrik', 'gap', 'vgap', 'rule',
  'regula', 'ancora', 'anker', 'anchor', 'iwpage', 'seitelst', 'ppoem', 'initiumstilatum',
  'αρίθμηση burnet', '§',
  // FOOTNOTES. `<ref>…</ref>` is stripped further down, and these are the template spellings
  // of the same thing; they must go the same way or a page that migrates from one form to the
  // other appears to gain a paragraph. Both 2026-09-05 outliers were exactly that — a
  // validator moving a footnote between `<ref>` and {{CRef}} read as a 13.6% human correction.
  //
  // The exclusion itself is deliberate and it costs coverage: measured over the pinned set,
  // footnote words are recovered by the Gemini arm at 88.6% against a 97.9% body control, so
  // footnotes ARE printed on 9 of the 10 footnoted pages. The tenth carries a modern editorial
  // gloss ("frz. échapper, hier sinngemäß …") and no syntax distinguishes it. A reference
  // asserting text the page never printed is charged to the ENGINE and reads as a finding, so
  // the 0.7% of letters this drops is the cheaper error.
  'cref', 'anmerkung', 'anmerkung ws',
]);

// Hyphenation across a page break: `{{hws|greſ|congreſſum}}` — the FIRST argument is the
// fragment THIS page prints; the second is the whole word, which belongs to the next page.
// The general "longest argument" rule would import a word the page does not carry.
const KEEP_FIRST = new Set(['hws', 'hwe']);

const CSS_VALUE = /^[\s\d.,+-]*(?:em|px|pt|%|rem|ex)?\s*$/i;
const letterCount = (s) => (s.match(/\p{L}/gu) || []).length;

// Several templates take the same string twice — an unaccented sort/anchor key beside the
// accented form the page prints (`{{SimpleLeader|Αλεξιου ...|Ἀλεξίου ...}}`). Emitting both
// puts a line in the reference that the page prints once, and the engine is then charged for
// the copy it correctly did not produce.
const dedupeKey = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * One template occurrence → the text it puts on the page.
 *
 * DELETING the payload was the second reference-corruption bug of this bench (2026-09-05).
 * `{{SperrSchrift|D’Glocke het zwölfi gschlage}}` is not scaffolding: the page prints those
 * words, in letter-spaced type. Blanking the whole template removed printed text from the
 * reference — measured at 1.7% of German letters, 2.4% of Latin and 6.2% of Greek across the
 * pinned set, with single pages losing 40-67%. Under free-skip scoring that does not inflate
 * CER (the engine's extra words skip free) but it shrinks the reference the engine is scored
 * over, and the windowed metric charges the same words as interior junk.
 *
 * The bias is kept deliberately one-directional: when it is unclear whether a payload was
 * printed, DROP it. A reference asserting text the page never printed is charged to the
 * engine and looks like a finding; a reference missing text the page did print merely
 * measures less of the page. Named parameters (`|note=…`, `|style=…`) are configuration and
 * are dropped for the same reason; numbered ones (`|2=…`) are content and are kept.
 */
function templateText(inner) {
  const parts = inner.split('|');
  const name = parts[0].trim().replace(/\s+/g, ' ').toLowerCase();
  if (!name || TEMPLATE_DROP.has(name)) return ' ';
  const positional = parts.slice(1)
    .map(a => a.replace(/^\s*\d+\s*=/, ''))                       // `2=` is content, not config
    .filter(a => !/^\s*\p{L}[\p{L}\d _-]*\s*=/u.test(a))
    // Splitting on `|` also splits an embedded `[[File:x.jpg|480px]]` into fragments; the
    // filename is not printed text and neither is the size.
    .filter(a => !/^\s*\[\[\s*(?:file|image|datei|fichier|immagine|αρχείο)\s*:/i.test(a));
  if (!positional.length) return ' ';
  // EVERY qualifying positional argument, not just the longest: a table-of-contents line is
  // `{{SimpleLeader|17. Διήγησις Ἀπολλωνίου|248—276.|mright=6.00em}}`, and a heading is
  // `{{larger|0.1em|ΜΕΘΩΝΗ}}`. The letter and CSS filters below separate the printed argument
  // from the geometry in both cases, so there is no need to guess which slot holds the text.
  const seen = new Set();
  const printed = (KEEP_FIRST.has(name) ? positional.slice(0, 1) : positional)
    .filter(a => letterCount(a) >= 2 && !CSS_VALUE.test(a))
    .filter(a => { const k = dedupeKey(a); return seen.has(k) ? false : seen.add(k); });
  return printed.length ? ` ${printed.join(' ')} ` : ' ';
}

/**
 * Strip proofread scaffolding to leave the transcribed text.
 *
 * Templates must be resolved ITERATIVELY, innermost-out. One pass of /\{\{[^{}]*\}\}/ handles
 * only the innermost, so `{{κέντρο|{{μεγάλο|X}}}}` collapsed to a surviving `{{κέντρο| }}` —
 * which then sat in the reference and was scored against the OCR as if the page printed it.
 * Observed on el.wikisource; 25 of 146 harvested references carried residue. This is silent
 * REFERENCE corruption, the worst kind: the resulting mismatch looks like an engine failure,
 * so it is charged to the wrong party.
 *
 * `legacyTemplates: true` restores the older behaviour — blank the whole template, payload
 * included — and exists only so reference-error-rate.mjs can measure what that cost.
 */
export function cleanPageText(text, { legacyTemplates = false } = {}) {
  let t = (text || '').replace(/<noinclude>[\s\S]*?<\/noinclude>/gi, ' ');
  t = t.replace(/<\/?includeonly>/gi, '').replace(/<\/?noinclude>/gi, '');
  for (let i = 0; i < 8; i++) {                             // nested templates, innermost-out
    const next = t.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => (legacyTemplates ? ' ' : templateText(inner)));
    if (next === t) break;
    t = next;
  }
  t = t.replace(/\{\{[^}]*?\}\}/g, ' ');                    // unbalanced leftovers
  t = t.replace(/\{\{|\}\}/g, ' ');                         // stray braces from broken markup
  t = t.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1');   // links → label
  t = t.replace(/\[\[|\]\]/g, ' ');                         // half-links left by a `|`-split template arg
  t = t.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/'''?/g, '');
  return t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** `<pagequality level="4" …/>` — 4 = validated (two proofreaders), 3 = proofread (one). */
export function pageQuality(text) {
  const m = (text || '').match(/<pagequality\s+level="(\d)"/i);
  return m ? parseInt(m[1], 10) : null;
}
