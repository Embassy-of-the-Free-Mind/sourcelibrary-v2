// PRIOR ART: scripts/eval/pro-translate-6545/plant.mjs (#6545's planter: number / name / clause / negation) — English
// translations only, sentence-level, through tengyur-characterize's English planters; it cannot plant into a Latin,
// German or French TRANSCRIPTION with its markup and printed lines. scripts/eval/route-judge-6740/tib-derge.py `plants`
// (prep.py plant(), Tibetan syllables) — one script's syllable rules. Searched scripts/eval/lib, scripts/eval/INDEX.md
// ("plant"): no planter for European print OCR (#7611).
/**
 * Planted-error controls for a judge of OCR transcriptions of European print (#7611: "test the test").
 *
 * plantError(text, { kind, lang, seed }) -> { text, plant } | null. Deterministic in (text, kind, lang, seed). The plant
 * is ONE error in the BODY text, never in the page's markup or furniture, kept grammatical so a judge cannot catch it by
 * form, only by reading the image:
 *   A  unchanged (the A-vs-A control: does the judge accept the same text again?)
 *   B  one number changed: a numeral (1563 -> 1568, 25 -> 35) or a number word (septimo -> nono, drey -> fünff)
 *   C  one content noun swapped for a same-language noun of the same inflection class that is NOT on the page
 *   D  one full printed line dropped from the middle (paragraph-set text: one whole sentence)
 *   E  one invented sentence, in the page's language and register, inserted at a sentence boundary
 * plant = { kind, mode: 'line'|'paragraph', line, offset, before, after, context } — `before` -> `after` is the exact
 * span changed (empty before = an insertion, empty after = a drop), at character `offset` of body line `line` (D/E:
 * offset in the original line), so the change can be checked against the text and found again in a verdict.
 *
 * BODY = lines outside markup: no line starting or ending in a tag, nothing inside a multi-line tag block (<margin>,
 * <note>, <header>, <meta>, <vocab>, <image-desc>, ...), no markdown heading / table / rule, nothing after a `---`
 * rule (the footnotes), and not the first or last body line (running heads, catchwords, signatures).
 */
import { makeRng } from './paired-stats.mjs';

export const PLANT_KINDS = ['A', 'B', 'C', 'D', 'E'];
export const ERROR_KINDS = ['B', 'C', 'D', 'E'];

const L = '\\p{L}\\p{M}';
const LANGS = { Latin: 'la', German: 'de', French: 'fr', la: 'la', de: 'de', fr: 'fr' };
export const langCode = (lang) => LANGS[lang] ?? LANGS[String(lang || '').split(/[\s(]/)[0]] ?? null;

// ── body lines ──
/** The indices of the body lines of a transcription (see BODY above). */
export function bodyLines(text) {
  const lines = String(text).split('\n');
  const body = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (/^-{3,}$|^\*{3,}$|^_{3,}$/.test(s)) { if (body.length) break; continue; }   // a rule after the text: footnotes follow
    if (open) { if (new RegExp(`</${open}>`).test(s)) open = null; continue; }
    const m = s.match(/^<([a-z][\w-]*)\b[^>]*>/i);
    if (m && !new RegExp(`</${m[1]}>`).test(s) && !/\/>$/.test(s)) { open = m[1]; continue; }   // a multi-line block opens
    if (!s || /^[<#|>]/.test(s) || /[>]$/.test(s) || /[<>]/.test(s)) continue;   // markup, headings, tables, inline tags
    if (s.length < 12 || !new RegExp(`[${L}]{3}`, 'u').test(s)) continue;     // page numbers, signatures, stray marks
    body.push(i);
  }
  // Printed lines: the first and last are where running heads, catchwords and signatures slip through untagged.
  return rawLayout(lines, body) === 'line' ? body.slice(1, -1) : body;
}
const rawLayout = (lines, body) => { const lens = body.map((i) => lines[i].length).sort((a, b) => a - b); return lens.length && lens[Math.floor(lens.length / 2)] > 110 ? 'paragraph' : 'line'; };

/** 'line' when the text keeps the printed lines (short lines), 'paragraph' when a line is a whole paragraph. */
export const layoutMode = (text, body = bodyLines(text)) => rawLayout(String(text).split('\n'), body);

// The long s: a page printed (and transcribed) with ſ gets ſ in what is planted, so the plant does not stand out by form.
const usesLongS = (text) => (String(text).match(/ſ/g) || []).length >= 3;
const longS = (w, on) => (on ? w.replace(/s(?=[\p{L}])/gu, 'ſ') : w);
const norm = (w) => w.normalize('NFC').toLowerCase().replace(/ſ/g, 's').replace(/\p{M}/gu, '');
const matchCase = (src, w) => (src === src.toUpperCase() && src.length > 1 ? w.toUpperCase() : /^\p{Lu}/u.test(src) ? w[0].toUpperCase() + w.slice(1) : w);

// ── B: numbers ──
const NUMWORDS = {
  la: { duo: 'tres', tres: 'quinque', quatuor: 'sex', quattuor: 'sex', quinque: 'septem', sex: 'octo', septem: 'novem', octo: 'decem', novem: 'septem', nouem: 'septem',
    decem: 'duodecim', viginti: 'triginta', triginta: 'quadraginta', centum: 'mille', mille: 'centum', duobus: 'tribus', duabus: 'tribus',
    primo: 'tertio', secundo: 'quarto', tertio: 'quinto', quarto: 'sexto', quinto: 'septimo', septimo: 'nono', octavo: 'decimo', octauo: 'decimo',
    primus: 'tertius', secundus: 'quartus', tertius: 'quintus', prima: 'tertia', secunda: 'quarta', tertia: 'quinta', septima: 'nona' },
  de: { zwey: 'drey', zwei: 'drei', drey: 'fünff', drei: 'fünf', vier: 'sechs', 'fünff': 'sieben', 'fünf': 'sieben', sechs: 'acht', sieben: 'neun',
    zwanzig: 'dreissig', dreissig: 'vierzig', vierzig: 'sechzig', neun: 'sieben', zehen: 'zwölff', zehn: 'zwölf', 'zwölff': 'zehen', 'zwölf': 'zehn', hundert: 'tausend', tausend: 'hundert',
    erste: 'dritte', ersten: 'dritten', dritte: 'fünffte', dritten: 'fünfften', vierdte: 'sechste', vierte: 'sechste' },
  fr: { deux: 'trois', trois: 'cinq', quatre: 'six', cinq: 'sept', six: 'huit', sept: 'neuf', huit: 'dix', dix: 'douze', douze: 'dix',
    vingt: 'trente', trente: 'quarante', quarante: 'soixante', cent: 'mille', mille: 'cent', second: 'troisième', seconde: 'troisième', 'troisième': 'cinquième', troisiesme: 'cinquiesme' },
};
/** The changed numeral: a year-like 4-digit number moves its last digit by 5, a smaller one by 3 (1-9) or 10. */
export const bumpNumber = (s) => (s.length === 4 ? s.slice(0, 3) + String((Number(s[3]) + 5) % 10) : String(Number(s) + (Number(s) > 9 ? 10 : 3)));

/** Roman numerals as early modern print sets them in running text: `vj.`, `xiiij.`, `XII.` (2+ letters, a full stop). */
const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, j: 1 };
export function romanValue(s) {
  const t = s.toLowerCase(); if (!/^[ivxlcj]+$/.test(t) || /j[^j]/.test(t)) return null;
  let v = 0; for (let i = 0; i < t.length; i++) { const a = ROMAN[t[i]], b = ROMAN[t[i + 1]] ?? 0; v += a < b ? -a : a; }
  return v > 0 && v <= 100 ? v : null;
}
export function romanOf(n, like) {
  const T = [[100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = ''; for (const [v, r] of T) while (n >= v) { s += r; n -= v; }
  if (/j$/i.test(like) && /i$/.test(s)) s = s.slice(0, -1) + 'j';   // the printer's final j (vij, xiiij)
  if (/iiii/i.test(like)) s = s.replace(/iv$/, 'iiii').replace(/iv(?=j$)/, 'iii');
  return like === like.toUpperCase() ? s.toUpperCase() : s;
}

function numberSites(lines, body, lc) {
  const out = [];
  const words = NUMWORDS[lc] ?? {};
  for (const li of body) {
    const s = lines[li];
    for (const m of s.matchAll(/(?<![\d\p{L}.,/()[\]-])(\d{1,4})(?![\d\p{L}/)\]-]|[.,]\d)/gu)) {
      if (/^0/.test(m[1]) || !s.slice(0, m.index).trim()) continue;   // a section number opening the line is furniture
      out.push({ line: li, offset: m.index, before: m[1], after: bumpNumber(m[1]) });
    }
    for (const m of s.matchAll(/(?<![\p{L}.])([ivxlcj]{2,6}|[IVXLC]{2,6})\.(?=\s)/gu)) {
      const v = romanValue(m[1]); if (!v || !s.slice(0, m.index).trim()) continue;
      out.push({ line: li, offset: m.index, before: m[1], after: romanOf(v + 2, m[1]) });
    }
    for (const m of s.matchAll(new RegExp(`(?<![${L}-])([${L}]+)(?![${L}-])`, 'gu'))) {
      const rep = words[norm(m[1])];
      if (rep) out.push({ line: li, offset: m.index, before: m[1], after: matchCase(m[1], longS(rep, /ſ/.test(m[1]))) });
    }
  }
  return out;
}

// ── C: a content noun of the same inflection class, not on the page ──
// Classes are suffixes that fix the word's case/number (Latin) or gender (German, French), so the swap stays grammatical.
const NOUNS = {
  la: {
    ionem: ['rationem', 'generationem', 'operationem', 'compositionem', 'putrefactionem', 'dispositionem', 'distillationem', 'separationem', 'mutationem', 'demonstrationem'],
    ione: ['ratione', 'generatione', 'operatione', 'compositione', 'putrefactione', 'dispositione', 'distillatione', 'separatione', 'mutatione', 'demonstratione'],
    ionis: ['rationis', 'generationis', 'operationis', 'compositionis', 'putrefactionis', 'dispositionis', 'distillationis', 'separationis', 'mutationis', 'demonstrationis'],
    iones: ['rationes', 'generationes', 'operationes', 'compositiones', 'dispositiones', 'distillationes', 'separationes', 'mutationes', 'demonstrationes'],
    tatem: ['veritatem', 'qualitatem', 'quantitatem', 'civitatem', 'humiditatem', 'proprietatem', 'facultatem', 'dignitatem', 'necessitatem', 'utilitatem'],
    tate: ['veritate', 'qualitate', 'quantitate', 'civitate', 'humiditate', 'proprietate', 'facultate', 'dignitate', 'necessitate', 'utilitate'],
    tatis: ['veritatis', 'qualitatis', 'quantitatis', 'civitatis', 'humiditatis', 'proprietatis', 'facultatis', 'dignitatis', 'necessitatis', 'utilitatis'],
    mentum: ['fundamentum', 'elementum', 'argumentum', 'experimentum', 'instrumentum', 'medicamentum', 'nutrimentum', 'documentum'],
    menti: ['fundamenti', 'elementi', 'argumenti', 'experimenti', 'instrumenti', 'medicamenti', 'nutrimenti', 'documenti'],
    mento: ['fundamento', 'elemento', 'argumento', 'experimento', 'instrumento', 'medicamento', 'nutrimento', 'documento'],
    menta: ['fundamenta', 'elementa', 'argumenta', 'experimenta', 'instrumenta', 'medicamenta', 'nutrimenta', 'documenta'],
    entiam: ['sapientiam', 'scientiam', 'essentiam', 'substantiam', 'prudentiam', 'experientiam', 'potentiam', 'sententiam'],
    entia: ['sapientia', 'scientia', 'essentia', 'substantia', 'prudentia', 'experientia', 'potentia', 'sententia'],
    entiae: ['sapientiae', 'scientiae', 'essentiae', 'substantiae', 'prudentiae', 'experientiae', 'potentiae', 'sententiae'],
  },
  de: {
    ung: ['Ordnung', 'Meinung', 'Bewegung', 'Erfahrung', 'Wirckung', 'Bereitung', 'Reinigung', 'Hoffnung', 'Rechnung', 'Handlung', 'Verwandlung', 'Auflösung'],
    ungen: ['Ordnungen', 'Meinungen', 'Bewegungen', 'Erfahrungen', 'Wirckungen', 'Bereitungen', 'Reinigungen', 'Rechnungen', 'Handlungen', 'Verwandlungen'],
    heit: ['Gesundheit', 'Wahrheit', 'Kranckheit', 'Weißheit', 'Gelegenheit', 'Schönheit', 'Gewißheit', 'Klarheit'],
    keit: ['Feuchtigkeit', 'Ewigkeit', 'Gerechtigkeit', 'Seligkeit', 'Fruchtbarkeit', 'Bitterkeit', 'Süßigkeit', 'Flüchtigkeit'],
    schafft: ['Wissenschafft', 'Eigenschafft', 'Gemeinschafft', 'Freundschafft', 'Gesellschafft', 'Herrschafft'],
    schaft: ['Wissenschaft', 'Eigenschaft', 'Gemeinschaft', 'Freundschaft', 'Gesellschaft', 'Herrschaft'],
  },
  fr: {
    tion: ['opération', 'génération', 'composition', 'proportion', 'distillation', 'putréfaction', 'digestion', 'dissolution', 'purification', 'observation', 'préparation'],
    tions: ['opérations', 'générations', 'compositions', 'proportions', 'distillations', 'digestions', 'dissolutions', 'purifications', 'observations', 'préparations'],
    'ité': ['vérité', 'qualité', 'quantité', 'humidité', 'subtilité', 'propriété', 'dignité', 'nécessité', 'utilité', 'facilité'],
    'ités': ['vérités', 'qualités', 'quantités', 'humidités', 'subtilités', 'propriétés', 'dignités', 'nécessités', 'utilités'],
    ance: ['substance', 'puissance', 'connoissance', 'abondance', 'ressemblance', 'constance', 'importance'],
    ence: ['essence', 'science', 'prudence', 'présence', 'influence', 'quintessence', 'expérience', 'sentence'],
  },
};
// Latin and French accents vary by edition; a page written without them gets the plant without them.
const stripAcc = (w) => w.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
const STOP = new Set(['entia', 'mento', 'menta', 'ione', 'tate', 'question', 'questions']);

function nounSites(text, lines, body, lc) {
  const bank = NOUNS[lc]; if (!bank) return [];
  const onPage = new Set([...String(text).matchAll(new RegExp(`[${L}]+`, 'gu'))].map((m) => norm(m[0])));
  const accents = lc !== 'fr' || /[éè]/.test(text);
  const ls = usesLongS(text);
  const classes = Object.keys(bank).sort((a, b) => b.length - a.length);
  const out = [];
  for (const li of body) {
    const s = lines[li];
    for (const m of s.matchAll(new RegExp(`(?<![${L}-])([${L}]{6,})(?![${L}-])`, 'gu'))) {
      const w = m[1], n = stripAcc(norm(w));
      if (STOP.has(n)) continue;
      if (lc === 'de' && !/^\p{Lu}/u.test(w)) continue;             // German nouns are capitalised
      const cl = classes.find((c) => n.endsWith(stripAcc(c)) && n.length > c.length + 2);
      if (!cl) continue;
      if (lc === 'fr' && /^it/.test(cl) && !/ités?$/i.test(w)) continue;   // -ite without the accent: petite, conduite
      const pool = bank[cl].map((x) => (accents ? x : stripAcc(x))).filter((x) => !onPage.has(stripAcc(norm(x))) && stripAcc(norm(x)) !== n);
      if (!pool.length) continue;
      out.push({ line: li, offset: m.index, before: w, pool: pool.map((x) => matchCase(w, longS(x, ls && /ſ/.test(w + s)))) });
    }
  }
  return out;
}

// ── E: one invented sentence, in register ──
const SENTENCES = {
  la: ['Quod etiam veteres philosophi diligenter observaverunt.', 'Hoc autem quotidiana experientia satis comprobatur.', 'Id quod multis exemplis facile posset ostendi.',
    'Quae res a plerisque hactenus neglecta fuit.', 'Nec aliter de reliquis iudicandum esse existimo.', 'Cuius rei causam paulo post explicabimus.'],
  de_old: ['Welches auch die Alten fleissig in acht genommen haben.', 'Solches lehret die tägliche Erfahrung genugsam.', 'Davon wil ich hernach weitläufftiger handeln.',
    'Welches viel gelehrte Leute bezeuget haben.', 'Darumb sol man hierin gute acht haben.', 'Solches ist auch bey den Alten wol bekandt gewesen.'],
  de: ['Dies haben schon die Alten sorgfältig beobachtet.', 'Das bestätigt die tägliche Erfahrung zur Genüge.', 'Davon soll später ausführlicher die Rede sein.',
    'Dies haben viele gelehrte Männer bezeugt.', 'Darauf ist hier besonders zu achten.', 'Auch den Alten war dies wohl bekannt.'],
  fr_old: ['Ce que les anciens ont aussi diligemment obserué.', 'L\'experience iournaliere le confirme assez.', 'Dont nous parlerons plus amplement cy apres.',
    'Ce que plusieurs doctes personnages ont tesmoigné.', 'A quoy il faut prendre garde soigneusement.', 'Chose qui n\'estoit pas incognue aux anciens.'],
  fr: ['C\'est ce que les anciens avaient déjà soigneusement observé.', 'L\'expérience de chaque jour le confirme assez.', 'Nous en parlerons plus amplement dans la suite.',
    'Plusieurs savants l\'ont attesté avant nous.', 'Il faut y prendre garde avec soin.', 'Cela n\'était pas inconnu des anciens.'],
};
const oldDe = (t) => /\b(vnd|vnnd|seyn|auff|vnser|darumb|solches)\b/i.test(t) || usesLongS(t);
const oldFr = (t) => /\b(estoit|auoit|avoit|étoit|faict|aussy|cy|iusques|tousiours|estre|iour|mesme|ceste|veue|faisoit|disoit|pouvoit|falloit|devoit|avoient|étoient|servoient|connoissons)\b/iu.test(t) || usesLongS(t);
export function sentenceBank(lc, text) {
  if (lc === 'de') return SENTENCES[oldDe(text) ? 'de_old' : 'de'];
  if (lc === 'fr') return SENTENCES[oldFr(text) ? 'fr_old' : 'fr'];
  return SENTENCES[lc] ?? null;
}

// A sentence ends after a word of 3+ letters (not an abbreviation such as `S.`, `Br.`, `c.`, nor a numeral) and . ? !
const BOUNDARY = /(?<=[\p{L}\p{M}]{3})[.?!][)»"]?\s+(?=[\p{Lu}])/gu;
/** Sentence-start offsets inside a body line (after a full stop and a capital), never at the line's start or end. */
function boundaries(s) { return [...s.matchAll(BOUNDARY)].map((m) => m.index + m[0].length).filter((o) => o > 0 && o < s.length - 8); }

// ── D: a line (or, paragraph-set, a sentence) dropped ──
function dropSites(lines, body, mode) {
  const first = body[0], last = body[body.length - 1];
  const out = [];
  if (mode === 'line') {
    const lo = Math.floor(body.length * 0.2), hi = Math.ceil(body.length * 0.8);
    for (let j = Math.max(1, lo); j < Math.min(body.length - 1, hi); j++) {
      const li = body[j], s = lines[li], prev = lines[li - 1] ?? '';
      if (s.trim().length < 25 || /[-¬⸗=]$/.test(s.trim()) || /[-¬⸗=]$/.test(prev.trim())) continue;   // no word split across the gap
      if (body[j - 1] !== li - 1 || body[j + 1] !== li + 1) continue;                                // inside a run of body lines
      out.push({ line: li, offset: 0, before: s, after: '', whole_line: true });
    }
  } else {
    for (const li of body) {
      const s = lines[li], b = [0, ...boundaries(s), s.length];
      // never the page's first sentence (it may begin on the leaf before) nor its last (it may run on to the next)
      for (let k = li === first ? 1 : 0; k < b.length - (li === last ? 2 : 1); k++) {
        if (b.length === 2) break;                                   // a one-sentence paragraph: dropping it is a paragraph
        const span = s.slice(b[k], b[k + 1]), words = span.trim().split(/\s+/).length;
        if (words >= 6 && words <= 50 && /[.?!][)»"]?\s*$/.test(span)) out.push({ line: li, offset: b[k], before: span, after: '' });
      }
    }
  }
  return out;
}

function insertSites(lines, body, mode) {
  const out = [];
  for (const li of body) for (const o of boundaries(lines[li])) out.push({ line: li, offset: o });
  if (!out.length && mode === 'line') {           // printed lines: a new line after a body line that ends a sentence
    for (const li of body.slice(0, -1)) if (/[\p{L}\p{M}]{3}[.?!]$/u.test(lines[li].trim())) out.push({ line: li, offset: lines[li].length, newline: true });
  }
  return out;
}

const ctx = (s, o, len) => s.slice(Math.max(0, o - 30), o + len + 30);

/**
 * Plant one error of `kind` into `text`. Returns { text, plant } or null when the page has no site for that kind (the
 * caller picks another page or kind). Deterministic in (text, kind, lang, seed).
 */
export function plantError(text, { kind, lang, seed }) {
  if (!PLANT_KINDS.includes(kind)) throw new Error(`plantError: kind ${kind}`);
  if (!Number.isFinite(seed)) throw new Error('plantError: a numeric seed is required');
  const lc = langCode(lang); if (!lc) throw new Error(`plantError: language ${lang} has no planter`);
  const lines = String(text).split('\n'), body = bodyLines(text), mode = layoutMode(text, body);
  if (kind === 'A') return { text, plant: { kind, mode, line: null, offset: null, before: '', after: '', context: '' } };
  if (!body.length || (mode === 'line' && body.length < 3)) return null;
  const R = makeRng(seed);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const put = (site, after) => {
    const s = lines[site.line];
    const t = s.slice(0, site.offset) + after + s.slice(site.offset + site.before.length);
    const out = [...lines]; out[site.line] = t;
    return out.join('\n');
  };
  if (kind === 'B') {
    const sites = numberSites(lines, body, lc); if (!sites.length) return null;
    const s = pick(sites);
    return { text: put(s, s.after), plant: { kind, mode, line: s.line, offset: s.offset, before: s.before, after: s.after, context: ctx(lines[s.line], s.offset, s.before.length) } };
  }
  if (kind === 'C') {
    const sites = nounSites(text, lines, body, lc); if (!sites.length) return null;
    const s = pick(sites), after = pick(s.pool);
    return { text: put(s, after), plant: { kind, mode, line: s.line, offset: s.offset, before: s.before, after, context: ctx(lines[s.line], s.offset, s.before.length) } };
  }
  if (kind === 'D') {
    const sites = dropSites(lines, body, mode); if (!sites.length) return null;
    const s = pick(sites);
    const out = s.whole_line ? lines.filter((_, i) => i !== s.line).join('\n') : put(s, '');
    return { text: out, plant: { kind, mode, line: s.line, offset: s.offset, before: s.before, after: '', context: s.whole_line ? [lines[s.line - 1], lines[s.line + 1]].join(' / ') : ctx(lines[s.line], s.offset, s.before.length) } };
  }
  const bank = sentenceBank(lc, text), sites = insertSites(lines, body, mode);
  if (!bank || !sites.length) return null;
  const s = pick(sites), sent = longS(pick(bank), usesLongS(text));
  if (s.newline) {
    const out = [...lines]; out.splice(s.line + 1, 0, sent);
    return { text: out.join('\n'), plant: { kind, mode, line: s.line + 1, offset: 0, before: '', after: sent, context: lines[s.line], newline: true } };
  }
  return { text: put({ ...s, before: '' }, `${sent} `), plant: { kind, mode, line: s.line, offset: s.offset, before: '', after: sent, context: ctx(lines[s.line], s.offset, 0) } };
}

/** Undo check: the planted text with the plant reversed is the original (a plant changes exactly the recorded span). */
export function unplant(planted, plant) {
  if (plant.kind === 'A') return planted;
  const lines = planted.split('\n');
  if (plant.kind === 'D' && plant.offset === 0 && plant.mode === 'line') { lines.splice(plant.line, 0, plant.before); return lines.join('\n'); }
  if (plant.newline) { lines.splice(plant.line, 1); return lines.join('\n'); }
  const s = lines[plant.line], add = plant.kind === 'E' ? `${plant.after} ` : plant.after;
  if (s.slice(plant.offset, plant.offset + add.length) !== add) throw new Error('unplant: the plant is not where it was recorded');
  lines[plant.line] = s.slice(0, plant.offset) + plant.before + s.slice(plant.offset + add.length);
  return lines.join('\n');
}

// ── scoring ──
const fold = (s) => norm(String(s || '')).replace(/[^\p{L}\d]+/gu, ' ').trim();
/**
 * Did the verdict NAME the plant? B / C: a defect quotes the planted word (or number). E: a defect quote shares a run
 * of 3+ words with the invented sentence. D: a defect of class O5 (silent omission), or one whose quote or note says
 * something is missing, quoting or naming text next to the gap or in the dropped line.
 */
export function namedPlant(verdict, plant) {
  const ds = verdict?.defects || [];
  if (!plant || plant.kind === 'A') return false;
  if (plant.kind === 'B' || plant.kind === 'C') {
    const a = fold(plant.after);
    return ds.some((d) => (` ${fold(d.quote)} `).includes(` ${a} `));
  }
  if (plant.kind === 'E') {
    const w = fold(plant.after).split(' ');
    const grams = new Set(w.slice(0, -2).map((_, i) => w.slice(i, i + 3).join(' ')));
    return ds.some((d) => { const q = fold(d.quote).split(' '); return q.some((_, i) => grams.has(q.slice(i, i + 3).join(' '))); });
  }
  const missing = /omi|omis|drop|miss|skip|lack|absent|left out|lost|gap/i;
  return ds.some((d) => /^O5/i.test(String(d.class || '')) || missing.test(`${d.what || ''} ${d.class || ''}`));
}

/** caught = the judge did not accept the planted text, or named the plant (#7611's definition). */
export function scorePlant(verdict, plant) {
  const named = namedPlant(verdict, plant);
  return { accepted: !!verdict?.accept, named, caught: !verdict?.accept || named };
}
