/**
 * Ngram tokenizer + orthographic normalizer — TS twin for the app side.
 * Canonical copy: scripts/lib/ngram-normalize.mjs (the batch build writes ngram
 * keys with it). The twins MUST stay identical — the API looks keys up with
 * this file, so any drift silently breaks lookups.
 * tests/unit/ngram-normalize.test.ts pins parity on shared fixtures.
 *
 * See the .mjs original for the normalization rationale.
 */

export interface NgramCorpus {
  id: string;
  label: string;
}

export const NGRAM_CORPORA: NgramCorpus[] = [
  { id: 'en', label: 'English — all works (via translation)' },
  { id: 'la', label: 'Latin (originals)' },
  { id: 'de', label: 'German (originals)' },
  { id: 'el', label: 'Greek (originals)' },
  { id: 'fr', label: 'French (originals)' },
  { id: 'en-orig', label: 'English (original spelling)' },
  { id: 'it', label: 'Italian (originals)' },
  { id: 'nl', label: 'Dutch (originals)' },
  { id: 'ru', label: 'Russian (originals)' },
  { id: 'es', label: 'Spanish (originals)' },
  { id: 'pt', label: 'Portuguese (originals)' },
  { id: 'he', label: 'Hebrew (originals)' },
];

export const ORIGINAL_LANGUAGE_CORPUS: Record<string, string> = {
  latin: 'la',
  english: 'en-orig',
  german: 'de',
  greek: 'el',
  'ancient greek': 'el',
  french: 'fr',
  italian: 'it',
  dutch: 'nl',
  russian: 'ru',
  spanish: 'es',
  portuguese: 'pt',
  hebrew: 'he',
};

export const MAX_NGRAM_N = 3;
const MAX_TOKEN_LEN = 40;

const LIGATURES: Array<[RegExp, string]> = [
  [/ſ/g, 's'], [/æ/g, 'ae'], [/œ/g, 'oe'],
  [/ﬁ/g, 'fi'], [/ﬂ/g, 'fl'], [/ﬀ/g, 'ff'], [/ﬃ/g, 'ffi'], [/ﬄ/g, 'ffl'],
  [/ﬅ/g, 'st'], [/ﬆ/g, 'st'],
];

export function stripApparatusTags(text: string): string {
  if (!text) return '';
  return text
    .replace(/<(header|catchword|sig|page-num)>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

export function tokenize(text: string, corpus: string): string[] {
  if (!text) return [];
  let t = text
    .replace(/­/g, '') // soft hyphens
    .replace(/(\p{L})-[ \t]*\r?\n[ \t]*(?=\p{L})/gu, '$1')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[’‘ʼ`´]/g, "'");
  for (const [re, sub] of LIGATURES) t = t.replace(re, sub);
  if (corpus === 'la') {
    t = t.normalize('NFD').replace(/\p{M}+/gu, '').replace(/v/g, 'u').replace(/j/g, 'i');
  } else if (corpus === 'el') {
    t = t.normalize('NFD').replace(/\p{M}+/gu, '').replace(/ς/g, 'σ');
  }
  const matches = t.match(/\p{L}[\p{L}'-]*/gu);
  if (!matches) return [];
  const out: string[] = [];
  for (let tok of matches) {
    tok = tok.replace(/['-]+$/g, '');
    if (!tok || tok.length > MAX_TOKEN_LEN) continue;
    out.push(tok);
  }
  return out;
}

export function normalizePhrase(phrase: string, corpus: string): string {
  return tokenize(phrase, corpus).join(' ');
}
