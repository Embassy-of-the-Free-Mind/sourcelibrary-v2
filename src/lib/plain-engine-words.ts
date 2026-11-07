/**
 * Model names in data-driven sentences, said as roles (#7263, Derek 2026-11-04: "I think we should hide model
 * names"). The routing table, the experiment index and the canon-gap status are read by code and tests under their
 * real names, so they keep them and the words change only where a page renders them. Nothing here changes a number.
 *
 * Kept: Kraken, the Syriac engine and scholarly credit (with Sophro Mhiro, omnisyr), and Claude as a product a
 * reader connects the library to. Letters match READER_NAME on /quality/record; a page that defines its own letters
 * by hand must not also run this over text that uses them.
 *
 * PRIOR ART: src/app/quality/pareto-alias.ts — numbers the engines of one set of chart files; it calls this for
 * the sentences left over, and src/lib/text-provenance.ts labels one page's record, not a sentence.
 */

/** A version number after a name. Never a figure: "Sonnet 94.0%" and "Opus 4.5 of 5" are findings. */
const V = String.raw`(?: [3-9](?:\.\d)?(?![\d.]|%| of | points?\b))?`;

/** Order matters: versions before bare names, compounds before words. */
const RULES: Array<[RegExp, string]> = [
  // Hand-written sentences that do not survive word for word.
  [/"current" is gemini-3\.1-flash-lite, which reads every new OCR batch since (\S+); "flash" is gemini-3-flash-preview/g,
    '"current" is the lightest model, which reads every new OCR batch since $1; the comparison is the mid-tier model'],
  [/\bGemini 3\.7 and 3\.6 Flash\b/g, 'two earlier mid-tier models'],
  [/\bOpus\/Flash\b/g, 'strongest-model/mid-tier'],
  [/\bpaddle>opus\b/gi, 'Open engine A, then the strongest model tested'],
  [/\blite>opus\b/g, 'the lightest model, then the strongest model tested'],
  [/\b[Aa] Claude arm\b/g, 'an arm from another family'],
  [/\bClaude tiers\b/g, 'Model tiers'],
  [/\bspends Claude\b/g, 'spends the stronger model'],

  // Tools that are part of the route, not a finding.
  [/\bagy -p( --model \S+)?( on the Google subscription)?/gi, 'a command-line tool on a subscription'],
  [/\bclaude -p( on the Claude subscription)?/gi, 'a command-line tool on a subscription'],
  [/\b(the )?(a )?Antigravity( command-line tool| CLI)?\b/gi, 'a command-line tool'],
  [/\b(the )?(Google|Claude|Gemini) subscription\b/gi, 'a subscription'],
  [/\bGemini allowance\b/g, 'subscription allowance'],
  [/\bClaude CLI\b/g, 'command-line tool'],
  [/\bagy (?=[\d.]*\s*[Ff]lash|gemini)/gi, ''],
  [/\bagy-(?=flash)/gi, ''],
  [/\bagy\b/gi, 'the command-line route'],
  [/\bthe Mistral API\b/g, 'a paid OCR API'],

  // A vendor's name in front of a noun that says enough alone.
  [/\b(Gemini|Claude|Google) (API|models?)\b/g, '$2'],
  [/\bGemini readers\b/g, 'the general readers'],

  // Identifiers.
  [/ \(row [\w-]+\)/g, ''],
  [/\b[\w-]+-cli-(?:gemini\d*|opus)\b/g, 'the command-line row'],
  [/\bclaude-ocr\.mjs\b/g, 'our reader script'],
  [/\bgemini-[\d.]+-flash-lite[\w.-]*\w/gi, 'the lightest model'],
  [/\bgemini-3\.8-flash[\w.-]*\w|\bgemini-3\.8-flash\b/gi, 'the current reading model'],
  [/\bgemini-3-flash[\w.-]*\w|\bgemini-3-flash\b/gi, 'the mid-tier model'],
  [/\bgemini-[\d.]+-flash[\w.-]*\w|\bgemini-[\d.]+-flash\b/gi, 'an earlier mid-tier model'],
  [/\bgemini-[\w.-]*\w/gi, 'a general model'],
  [/\bclaude-opus[\w.-]*\w/gi, 'the strongest model tested'],
  [/\bclaude-sonnet[\w.-]*\w/gi, 'a mid-size model from another family'],
  [/\bclaude-haiku[\w.-]*\w/gi, 'a small model from another family'],

  // Compounds, so a hyphen does not end up after a whole phrase.
  [/\b(?:Claude )?Opus (judges?|reviewers?)\b/g, 'AI $1'],
  [/\b(?:[Ff]lash-[Ll]ite)-(\w+)/g, 'lightest-model-$1'],
  [/\bFlash-(?!Lite|low)(\w+)/g, 'mid-tier-$1'],
  [/\bOpus-(\w+)/g, 'strongest-model-$1'],
  [/\bPaddle-(\w+)/g, 'Open-engine-A-$1'],
  [/\bGemini-(\w+)/g, 'general-model-$1'],

  // Tiers.
  [/\b(?:Gemini )?(?:[23]\.\d )?(?:Flash-Lite|flash-lite)\b/g, 'the lightest model'],
  [/\b(?:Gemini )?3\.8 Flash[- ][Ll]ow\b/g, 'the current reading model at low effort'],
  [/\b(?:Gemini )?3\.8[- ][Ff]lash\b/g, 'the current reading model'],
  [/\b[Ff]lash[- ][Ll]ow\b/g, 'the current reading model at low effort'],
  [/\b(?:Gemini )?3[- ][Ff]lash(?:-preview)?\b/g, 'the mid-tier model'],
  [/\b(?:Gemini )?[23]\.\d Flash\b/g, 'an earlier mid-tier model'],
  [/\b(?:[Gg]emini )?[Ff]lash\b/g, 'the mid-tier model'],
  [/\b(?:Gemini )?(?:[3-9](?:\.\d)? )?Argon( low)?\b/g, 'a newer model'],
  [new RegExp(String.raw`\bGemini${V} Pro\b|^Pro\b`, 'g'), 'the largest model'],
  [new RegExp(String.raw`\b(?:Claude )?Opus${V}\b`, 'g'), 'the strongest model tested'],
  [new RegExp(String.raw`\b(?:Claude )?Sonnet${V}\b`, 'g'), 'a mid-size model from another family'],
  [new RegExp(String.raw`\b(?:Claude )?Haiku${V}\b`, 'g'), 'a small model from another family'],
  [/\b[Aa] (thinking )?Gemini\b/g, 'a $1general-model'],
  [new RegExp(String.raw`\bGemini${V}\b`, 'g'), 'the general model'],
  // Claude stays only as the reader's assistant.
  [/\bClaude(?! use\b| or ChatGPT| & ChatGPT)/g, 'an AI reviewer'],
  [/(?<![-\w])lite(?![-\w])/g, 'the lightest model'],

  // Open engines, by letter.
  [/\bPaddleOCR(?:-VL(?:[ -]\d\.\d(?![\d%]))?)?|\bPaddle\b|\bpaddle\b/gi, 'Open engine A'],
  [/\bpaddleTableRisk\b/g, 'the table-risk rule'],
  [/\bLightOn(?:OCR)?(?:-\d(?![\d.%]))?/gi, 'Open engine B'],
  [/\bolmOCR(?:[ -]\d(?![\d.%]))?/gi, 'Open engine C'],
  [/\bGLM(?:-OCR)?\b/gi, 'Open engine D'],
  [/\bChandra\b/g, 'Open engine E'],
  [/\bDeepSeek(?:-OCR)?(?:-\d(?![\d.%]))?/gi, 'Open engine F'],
  [/\bMinerU(?:\d\.\d(?:-Pro)?)?( \(an open-source reader\))?/gi, 'Open engine G'],
  [/\bQwen(?:[\w.-]*\w)?/gi, 'Open engine H'],
  [/\bTesseract\b/gi, 'Open engine I'],
  [/\bdots\.ocr\b/gi, 'Open engine J'],
  [/\bNanonets(?: OCR\d?)?/gi, 'Open engine K'],
  [/\bPERO(?:-OCR)?\b|\bpero(?=[@>])/g, 'Open engine L'],
  [/\byigdzin>/g, 'the BDRC Tibetan model, then '],
  [/(?<![-\w/.])opus(?![-\w/.])/g, 'the strongest model tested'],
  [/\bCrossLing-OCR(?:-\w+)?/g, 'Open engine N'],
  [/\bMistral\b/g, 'A paid OCR service'],
  [/\bCURRENT (?:BDRC )?Yigdzin\b/g, 'CURRENT BDRC Tibetan'],
  [/\b(?:BDRC )?Yigdzin(?: 1(?![\d.%]))?(?: — BDRC tibetan-ocr VLM)?/g, 'the BDRC Tibetan model'],
  [/\bSurya(?: \d(?![\d.%]))?(?= hold| read| on\b|,)/g, 'Open engine M'],
];

/** Fixes what putting a phrase where a word stood leaves behind. */
function tidy(s: string): string {
  return s
    .replace(/\b(?:the|a|an) (the|a|an) /gi, '$1 ')
    .replace(/\bmodel models\b/g, 'models')
    .replace(/\bthe command-line route CLI\b/g, 'the command-line route')
    .replace(/(^|[.!?:] )(the|a|an|two) (?=(?:lightest|mid-tier|current reading|strongest|earlier|general|newer|largest|small|mid-size|command-line|earlier|BDRC)\b)/g,
      (_, lead: string, word: string) => `${lead}${word[0].toUpperCase()}${word.slice(1)} `);
}

export function plainEngineWords(s: string): string {
  let out = s;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return tidy(out);
}

/** Identifiers, lookups and link targets in the data files, never shown as words. */
export const ENGINE_CODE_KEYS = new Set([
  'engine_id', 'route', 'file', 'files', 'source', 'sources', 'writeup', 'router_table', 'href', 'id', 'cell', 'cell_id', 'run_id', 'select', 'lane',
  'row', 'read_engine', 'production', 'reviewer', '_doc', 'ocr_engines', 'translation_models', 'book_pages', 'book_title', 'title', 'draft',
]);

/** A copy of a data file with its displayed strings said plainly. Numbers, booleans and code keys pass through. */
export function plainEngineData<T>(node: T): T {
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') return plainEngineWords(x);
    if (Array.isArray(x)) return x.map(walk);
    if (!x || typeof x !== 'object') return x;
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, ENGINE_CODE_KEYS.has(k) ? v : walk(v)]));
  };
  return walk(node) as T;
}
