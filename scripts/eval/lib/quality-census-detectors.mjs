// PRIOR ART: scripts/eval/quality-census-score.mjs — these detectors were written there (#5700 A1)
// and are MOVED here (one change: classifyNote's bare tag strip is now stripMarkupTags, #5564 — this
// directory is under tests/unit/bare-tag-strip-guard), so the A2/A3 cleanup (scripts/maintenance/
// translation-cleanup-a2-5700.mjs) fixes exactly the pages the census counted. The score script
// runs its census on import and pulls in the reader's TSX renderer, so nothing could import
// them from it. scripts/lib/page-terms-parse.mjs (the original-note verifier) stays where it is.
/**
 * Detectors for the 2026-10 quality census (#5700): which translation <note>s describe the scan
 * rather than the text, and which markup leaks into the served English. Pure, no I/O, no React.
 */
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';

// ── (a) note classes ─────────────────────────────────────────────────────────────────────────
const NOT_A_LETTER = '(?!\\s+(?:stage|phase|state|step|steps|part|section|word|words|sentence|condition|pattern|position|position|value|values|letters? of (?:each|the words)|sound|vowel|consonant))';
export const INITIAL_RE = new RegExp(
  '\\bdrop[- ]?caps?\\b' +
  '|\\b(?:decorat\\w*|ornate|ornament\\w*|woodcut|engraved|illuminat\\w*|historiated|inhabited|foliated|floriated|flourished|rubricated|calligraphic|red|blue|gold(?:en)?|large|capital|figured|zoomorphic|pictorial|factotum|initial)\\s+(?:[\\w\'’-]+[\\s,]+){0,3}?initials?\\b' + NOT_A_LETTER +
  '|\\binitials?\\s+(?:letter|capital)s?\\b' +
  '|\\binitial\\s+["\'‘“(]?[A-ZÀ-ÞΑ-Ω\\u0531-\\u0556\\u05D0-\\u05EA]["\'’”)]?(?=[\\s.,;:)]|$)', 'i');
export const SCAN_RE = new RegExp([
  '\\bfox(?:ing|ed)\\b', '\\bspeckl\\w*', '\\b(?:water|ink|damp|mou?ld|brown|tide)[- ]?stain\\w*',
  '\\bstain(?:ed|ing|s)?\\b', '\\bbleed[- ]?through\\b', '\\bshow[- ]?through\\b', '\\bink (?:has )?(?:bled|bleeding)\\b',
  '\\b(?:reversed|mirror(?:ed)?|ghost(?:ed)?) (?:impression|image|text)s?\\b', '\\boffset(?:ting)? (?:of|from) (?:the )?(?:facing|opposite)\\b',
  '\\bfad(?:ed|ing)\\b', '\\bblurr(?:ed|y|ing)\\b', '\\bout of focus\\b', '\\bsmudg\\w*', '\\bworm[- ]?(?:holes?|eaten|damage)\\b',
  '\\b(?:paper|page|leaf|scan|image|margin|corner|edge|text) (?:is |are |has been )?(?:damaged|torn|creased|crumpled|trimmed|cropped|cut off)\\b',
  '\\b(?:damaged|torn|creased|crumpled|trimmed|cropped) (?:paper|page|leaf|scan|image|margin|corner|edge|area|portion|section)\\b',
  '\\bcut off (?:at|by|along) the (?:edge|margin|binding|gutter|scan|image|page|bottom|top|right|left)\\b',
  '\\b(?:gutter|binding|fold) (?:obscures|hides|swallows|obscuring)\\b', '\\bobscured by (?:the )?(?:binding|gutter|fold|stain|damage|tape)\\b',
  '\\brotated\\b', '\\bsideways\\b', '\\bupside[- ]down\\b', '\\b(?:printed|written|oriented|running) (?:vertically|at (?:a|an) (?:90|right)[- ]degree)',
  '\\b(?:image|scan|photograph|reproduction|microfilm) (?:quality|resolution)\\b', '\\blow[- ]resolution\\b', '\\bpoor(?:ly)? (?:scanned|quality|legib\\w*|reproduc\\w*)\\b',
  '\\bdiscolou?r\\w*', '\\b(?:yellow|brown)(?:ed|ing) (?:paper|page)\\b', '\\bbrowning\\b', '\\b(?:paper|tape) repair\\b',
].join('|'), 'i');
export const ORNAMENT_RE = /\b(?:head-?pieces?|tail-?pieces?|fleurons?|printer'?s (?:ornaments?|devices?|flowers?|marks?)|typographic(?:al)? ornaments?|cul-de-lampe|vignettes?|(?:ornamental|decorative) (?:borders?|bands?|rules?|frames?|bars?|dividers?|lines?|elements?|ornaments?|flourish\w*|motifs?|pieces?|devices?))\b/i;

// A scan warning talks about THIS page's text or leaf. A condition word inside a description of
// an illustration, a cover, a stamp or a watermark is an image description (its own class, not
// counted here): by eye, 32 of the first 50 SCAN_RE hits were that.
const SCAN_SUBJECT = /\b(?:page|text|leaf|leaves|folio|paper|columns?|lines?|portion|section|corner|reverse|verso|recto|margins?|scan|legib\w*|illegib\w*|obscur\w*|characters|words?|writing|script|ink)\b/i;
const IMAGE_DESC_OPENER = /^(?:editorial note:\s*)?(?:a|an|the)\s+(?:[\w,'-]+\s+){0,5}?(?:woodcut|engraving|etching|illustration|photograph|drawing|image shows|cover|binding|spine|fore-edge|watermark|diagram|miniature|stamp|label|portrait|plate|map|figure|emblem|frontispiece|seal)\b/i;
const NOT_CONDITION = /\b(?:front cover|back cover|spine|fore-edge|binding|watermark|bookplate|mirror[- ]script|ex libris)\b/i;
export function isScanWarning(t) {
  return SCAN_RE.test(t) && SCAN_SUBJECT.test(t) && !IMAGE_DESC_OPENER.test(t) && !NOT_CONDITION.test(t);
}

export function classifyNote(body) {
  const t = stripMarkupTags(body).replace(/\s+/g, ' ').trim();
  if (/^\s*(?:original|orig\.|lit\.|literally|alt\.|alternative|or\b|cf\.|i\.e\.|continu\w+ from)/i.test(t)) return null;
  if (INITIAL_RE.test(t)) return 'initial';
  if (isScanWarning(t)) return 'scan';
  if (ORNAMENT_RE.test(t)) return 'ornament';
  return null;
}
export function notes(tr) {
  return [...String(tr || '').matchAll(/<note(?:\s[^>]*)?>([\s\S]*?)<\/note>/gi)].map(m => m[1]);
}


// ── (c) leaked markup ────────────────────────────────────────────────────────────────────────
export const BRACKET_META = /^\s*(?:blank(?: page)?\b|(?:no )?translat(?:ion|able|ed)\b|translation of\b|(?:the )?(?:note|text|page|passage|list|table|line|entry) (?:continues|is|ends|breaks|cut)|name|title|author|date|number|illegible|unclear|several (?:lines|words)|(?:text|lines?|words?) (?:missing|illegible|cut off|obscured|damaged)|continued|continu(?:es|ing) (?:from|on)|from (?:the )?previous page|see (?:previous|next)|image|figure|illustration|diagram|page (?:\d+|break|ends)|end of (?:page|text)|(?:greek|latin|hebrew|arabic|chinese|syriac|german|french) (?:text|word|phrase|passage)|transcri)/i;
const PAIRED = ['note', 'margin', 'gloss', 'term', 'insert', 'unclear', 'header', 'page-num', 'image-desc', 'interp', 'meta', 'summary', 'keywords', 'sig', 'warning', 'vocab'];
export function rawLeaks(tr, ocr) {
  const t = String(tr || '');
  const out = {};
  const empty = /<(margin|note|gloss|term|insert|unclear|header|page-num|sig|interp|image-desc|meta|summary|keywords)(?:\s[^>]*)?>\s*<\/\1>/i.exec(t);
  if (empty) out.empty_tag = empty[0];
  for (const tag of PAIRED) {
    const opens = (t.match(new RegExp(`<${tag}(?:\\s[^>]*)?(?<!/)>`, 'gi')) || []).length;
    const closes = (t.match(new RegExp(`</${tag}\\s*>`, 'gi')) || []).length;
    if (opens > closes) (out.unclosed ||= []).push(tag);
    if (closes > opens) (out.orphan_close ||= []).push(tag);
  }
  // Square brackets the translation prompt forbids ("Bare [square brackets] for interpolations").
  // Exclude the legacy [[tag: …]] syntax and markdown links. A page whose OCR carries brackets
  // too may be the source's own; reported apart.
  const plain = t.replace(/\[\[[\s\S]*?\]\]/g, ' ').replace(/\[[^\]\n]*\]\([^)]*\)/g, ' ');
  const br = plain.match(/\[[^\[\]\n]{1,120}\]/g) || [];
  if (br.length) {
    const ocrHas = /\[[^\[\]\n]{1,120}\]/.test(String(ocr || ''));
    out[ocrHas ? 'brackets_source_has' : 'brackets_translator'] = br.slice(0, 3);
    // The harmful subclass: not an interpolated word but the model talking — a placeholder
    // ("[Name]", "[Title]") or a description of the page ("[Blank page — no translatable content]",
    // "[The note continues…]"). The reader styles every bracket as "Translator's addition", so
    // these read as content.
    const meta = br.filter(b => BRACKET_META.test(b.slice(1, -1)));
    if (meta.length) out.brackets_meta = meta.slice(0, 3);
  }
  if (/<(?:header|page-num)(?:\s[^>]*)?>/i.test(t)) out.meta_tag_in_english = true;
  // The dominant empty-tag shape: `<margin></margin>` + the margin's text + a stray `</margin>` —
  // the opener was closed too early. The reader drops both, so the margin prints as body text.
  if (/<(margin|insert|gloss|unclear|note|term)>\s*<\/\1>[^<]{1,600}<\/\1>/i.test(t)) out.premature_close = true;
  return out;
}
export function visibleLeaks(text) {
  const out = {};
  const ctx = (re) => { const m = re.exec(text); return m ? text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ').trim() : null; };
  const h = ctx(/#/); if (h) out.vis_hash = h;
  const tg = ctx(/<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/); if (tg) out.vis_tag = tg;
  const mw = ctx(/\bpage-num\b|\bpage-type\b|\bscan-quality\b|<\/?header\b|\bheader>/i); if (mw) out.vis_meta_word = mw;
  const ar = ctx(/->|<-(?!-)/); if (ar) out.vis_centre_arrow = ar;
  return out;
}
