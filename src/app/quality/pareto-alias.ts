/**
 * The engines on the quality charts, by number and not by name (#7263, Derek 2026-11-04: "I think we should hide
 * model names"). Findings and grades stay; the recipe does not. A chart still has to say which dot beat which, so
 * each label gets a stable "Engine N", and every sentence the builders wrote gets the same words.
 *
 * Done here at render because src/data/{ocr-pareto,translation-pareto,model-roster}.json are generated, and the
 * builders, scripts/eval and the tests read their real names. Nothing here changes a number.
 *
 * Kept: the Syriac models, which are scholarly credit (Sophro Mhiro, Beth Mardutho; omnisyr; Qoruyo).
 */

import { plainEngineWords } from '@/lib/plain-engine-words';

/** Identifiers and paths, never shown as words. A link's target stays a link's target. */
const CODE_KEYS = new Set(['engine', 'production_engine', 'source', 'files', 'writeup', 'kind', 'track', 'rule', 'id', 'group', 'agy_models']);

const SCHOLARLY_CREDIT = /^Kraken \((OmniSyr|Sophro|Qoruyo)/;

type Json = unknown;

function labelsIn(node: Json, into: Set<string>): void {
  if (Array.isArray(node)) { node.forEach(x => labelsIn(x, into)); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if ((k === 'label' || k === 'production_label') && typeof v === 'string') into.add(v);
    else labelsIn(v, into);
  }
}

/** What the builders' sentences call things when they are not quoting a label. Order matters: longest first. */
const PROSE: Array<[RegExp, string]> = [
  [/\bagy -p --model \S+( on the Google subscription)?/gi, 'a command-line tool on a subscription'],
  [/\bclaude -p( on the Claude subscription)?/gi, 'a command-line tool on a subscription'],
  [/\bClaude on the subscription\b/g, 'On a subscription'],
  [/\bthrough the Antigravity CLI\b/gi, 'through a command-line tool'],
  [/\b(the )?(a )?Antigravity( command-line tool| CLI)?\b/gi, 'a command-line tool'],
  [/\bagy -p( on [^,;.]*)?/gi, 'a command-line tool on a subscription'],
  [/\bagy models\b/g, 'its model list'],
  [/\bthe Mistral API\b/g, 'a paid OCR API'],
  [/\bClaude CLI\b/g, 'command-line tool'],
  [/\b(the )?(Google|Claude|Gemini) subscription\b/gi, 'a subscription'],
  [/\b(blind )?(Claude )?Opus judges?\b/g, 'blind AI judges'],
  [/\bJudged blind by Claude Opus\b/g, 'Judged blind by an AI reviewer'],
  [/\ba Gemini [\d.]+ judge\b/gi, 'a second AI judge'],
  [/\b(Gemini|Claude) through\b/g, 'Models through'],
  [/ via OpenRouter \(Anthropic\)/g, ' via a billed API'],
  [/\bMistral \/v1\/ocr\b/g, 'A paid OCR API'],
];

/** Anything still naming a model after the labels: no number to give it, so it says what it is. */
const RESIDUE: Array<[RegExp, string]> = [
  [/\bKraken\b/g, 'an open engine'],
  [/\bGoogle\b/g, 'the vendor'],
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface EngineAliases { aliasOf: Map<string, string>; words: (s: string) => string }

/** One numbering across all three files: "Engine 7" is the same engine on every chart and in the roster. */
export function buildEngineAliases(...files: Json[]): EngineAliases {
  const labels = new Set<string>();
  files.forEach(f => labelsIn(f, labels));
  const aliasOf = new Map<string, string>();
  let n = 0;
  for (const label of [...labels].sort()) {
    if (SCHOLARLY_CREDIT.test(label) || /^Production\b/.test(label)) continue;
    aliasOf.set(label, `Engine ${++n}`);
  }
  // Longest first, or "Gemini 3 Flash" would eat the front of "Gemini 3 Flash (thinking)".
  const byLength = [...aliasOf.keys()].sort((a, b) => b.length - a.length);
  const pattern = byLength.length ? new RegExp(byLength.map(escapeRe).join('|'), 'g') : null;
  const credit = /Kraken \((?:OmniSyr|Sophro|Qoruyo)[^)]*\)(?:, no column split)?|the span fitted to the page with Kraken/g;
  const words = (s: string): string => {
    // Syriac credit and the Kraken fit are set aside so the residue pass cannot touch them.
    const held: string[] = [];
    let out = s.replace(credit, m => { held.push(m); return `\u0000${held.length - 1}\u0000`; });
    if (pattern) out = out.replace(pattern, m => aliasOf.get(m) ?? m);
    // The census sentences drop this engine's version number.
    out = out.replace(/\bPaddleOCR-VL\b/g, aliasOf.get('PaddleOCR-VL 1.6') ?? 'an open engine');
    for (const [re, to] of PROSE) out = out.replace(re, to);
    out = plainEngineWords(out);
    for (const [re, to] of RESIDUE) out = out.replace(re, to);
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
  };
  return { aliasOf, words };
}

/** A copy of a data file with its displayed strings aliased. Numbers, booleans and code keys pass through. */
export function aliasEngines<T>(node: T, words: (s: string) => string): T {
  const walk = (x: Json): Json => {
    if (typeof x === 'string') return words(x);
    if (Array.isArray(x)) return x.map(walk);
    if (!x || typeof x !== 'object') return x;
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, CODE_KEYS.has(k) ? v : walk(v)]));
  };
  return walk(node) as T;
}
