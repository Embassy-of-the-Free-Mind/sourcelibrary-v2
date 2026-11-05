/**
 * The sentences behind /quality/record and /research/canon-gap, said without model names (#7263). Sweeps the real
 * files, so a new row that names a new engine fails here rather than reaching a reader.
 */
import { describe, expect, it } from 'vitest';
import byLanguage from '@/data/quality-by-language.json';
import ocrRouting from '../../scripts/lib/ocr-routing-table.json';
import gapStatus from '../../scripts/catalog-coverage/results/canon-gap-status-2026-10.json';
import { listExperiments } from '@/lib/quality-center';
import { ENGINE_CODE_KEYS, plainEngineData, plainEngineWords } from '@/lib/plain-engine-words';

const NAMES = /gemini|\bopus\b|sonnet|haiku|gpt-?\d|openai|anthropic|paddle|mineru|\bflash\b|flash-lite|qwen|deepseek|abbyy|tesseract|mistral|\bglm|lighton|antigravity|\bagy\b|yigdzin|olmocr|chandra\b|argon|dots\.ocr|nanonets|\bpero\b/i;
// Claude stays only as the assistant a reader connects the library to.
const CLAUDE = /\bClaude\b(?! use\b| or ChatGPT| & ChatGPT)/;

function shown(node: unknown, into: string[] = []): string[] {
  if (typeof node === 'string') into.push(node);
  else if (Array.isArray(node)) node.forEach(x => shown(x, into));
  else if (node && typeof node === 'object') Object.entries(node).forEach(([k, x]) => { if (!ENGINE_CODE_KEYS.has(k)) shown(x, into); });
  return into;
}

describe('plainEngineWords', () => {
  it('never takes a measurement for a version number', () => {
    expect(plainEngineWords('Gemini 3 Flash 94.7% and Claude Sonnet 94.0%')).toBe('The mid-tier model 94.7% and a mid-size model from another family 94.0%');
    expect(plainEngineWords('Opus 9.9% and Yigdzin 94% and olmOCR 2.6%')).toBe('The strongest model tested 9.9% and the BDRC Tibetan model 94% and Open engine C 2.6%');
    expect(plainEngineWords('Opus 4.5 of 5')).toBe('The strongest model tested 4.5 of 5');
  });

  it('drops the name and keeps the noun', () => {
    expect(plainEngineWords('the paid Gemini API')).toBe('the paid API');
    expect(plainEngineWords('every other Gemini model')).toBe('every other model');
  });

  it('leaves Syriac credit and the reader\'s assistant alone', () => {
    const s = 'Kraken with Sophro Mhiro and omnisyr. Do instructions make Claude use the connector? Connect to Claude or ChatGPT';
    expect(plainEngineWords(s)).toBe(s);
  });

  it('keeps the identifiers the pages look things up by', () => {
    expect(plainEngineData({ route: 'lite>agy-flash-low', reader: 'Gemini 3 Flash' })).toEqual({ route: 'lite>agy-flash-low', reader: 'The mid-tier model' });
  });
});

describe('the data a page shows', () => {
  const experiments = listExperiments().map(e => ({ question: e.question, headline: e.headline }));
  const files: Array<[string, unknown]> = [
    ['ocr-routing-table', ocrRouting],
    ['quality-by-language', byLanguage],
    ['canon-gap-status', gapStatus],
    ['experiments', experiments],
  ];
  it.each(files)('%s names no model once said plainly', (_, file) => {
    const left = shown(plainEngineData(file)).filter(s => NAMES.test(s) || CLAUDE.test(s));
    expect(left).toEqual([]);
  });
});
