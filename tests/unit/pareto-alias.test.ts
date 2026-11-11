/**
 * The quality charts name no engine (#7263). Everything the builders wrote passes through one alias layer at render,
 * so a new model or a new verdict sentence in the generated JSON fails here rather than reaching a reader.
 */
import { describe, it, expect } from 'vitest';
import pareto from '@/data/ocr-pareto.json';
import xlate from '@/data/translation-pareto.json';
import roster from '@/data/model-roster.json';
import { aliasEngines, buildEngineAliases } from '@/app/quality/pareto-alias';

const NAME = /gemini|claude|\bopus\b|sonnet|haiku|\bgpt|openai|anthropic|paddle|mineru|\bflash\b|flash-lite|qwen|deepseek|abbyy|tesseract|mistral|glm-ocr|lighton|antigravity|\bagy\b|yigdzin|olmocr|dots\.|chandra|surya|argon/i;
const CODE = new Set(['engine', 'production_engine', 'source', 'files', 'writeup', 'kind', 'track', 'rule', 'id', 'group', 'agy_models']);

function strings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach(x => strings(x, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) if (!CODE.has(k)) strings(v, out);
  }
  return out;
}

describe('pareto aliases', () => {
  const { words, aliasOf } = buildEngineAliases(pareto, xlate, roster);

  it('leaves no model name in any displayed string of the three data files', () => {
    for (const file of [pareto, xlate, roster]) {
      const hits = strings(aliasEngines(file, words)).filter(s => NAME.test(s));
      expect(hits).toEqual([]);
    }
  });

  it('keeps every number: aliasing changes words, not figures', () => {
    const numbers = (x: unknown): unknown[] => {
      if (typeof x === 'number') return [x];
      if (Array.isArray(x)) return x.flatMap(numbers);
      if (x && typeof x === 'object') return Object.values(x).flatMap(numbers);
      return [];
    };
    for (const file of [pareto, xlate, roster]) expect(numbers(aliasEngines(file, words))).toEqual(numbers(file));
  });

  it('gives one number to one label, in sentences as on the dots', () => {
    const three = aliasOf.get('Gemini 3 Flash')!;
    expect(three).toMatch(/^Engine \d+$/);
    expect(words('Gemini 3.8 Flash scores better than Gemini 3 Flash, the engine we use')).toContain(`${three}, the engine we use`);
    expect(aliasOf.get('Gemini 3 Flash (thinking)')).not.toBe(three);
    expect(words('Gemini 3 Flash (thinking)')).toBe(aliasOf.get('Gemini 3 Flash (thinking)'));
  });

  it('keeps the Syriac credit', () => {
    expect(aliasOf.has('Kraken (OmniSyr)')).toBe(false);
    expect(words('Kraken (Sophro Mhiro)')).toBe('Kraken (Sophro Mhiro)');
    expect(words('Kraken (OmniSyr), no column split')).toBe('Kraken (OmniSyr), no column split');
  });
});
