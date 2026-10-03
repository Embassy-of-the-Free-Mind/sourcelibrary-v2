/**
 * Transcript provenance — one helper behind the pane-header chip and the
 * drawer's "How this page was made" row (#5186).
 *
 * The chip exists because the provenance used to live only in the ⓘ drawer,
 * and a reader looking at an Archive-OCR page that had misread its dates had
 * no way to know which engine had read it. Two surfaces saying the same thing
 * from two code paths is how they come to disagree, so both derive from
 * `transcriptProvenance()`; these tests pin that the short and full forms
 * agree in KIND for every source, and that the two `ia_djvu` row shapes in
 * production — the ingest's `ocr.ia` block, and the 2026-09-12 provisional
 * pages that carry only the engine string in `ocr.model` — both resolve
 * without throwing.
 */
import { describe, it, expect } from 'vitest';
import {
  transcriptProvenance,
  transcriptProvenanceLabel,
  modelDisplayName,
} from '@/lib/text-provenance';
import { getReaderStrings } from '@/lib/reader-strings';
import type { Page } from '@/lib/types';

const en = getReaderStrings('en').info;
const es = getReaderStrings('es').info;

function page(ocr: Record<string, unknown> | undefined): Pick<Page, 'ocr'> {
  return { ocr: ocr as Page['ocr'] };
}

describe('transcriptProvenance', () => {
  it('Kraken lane (#4883): names the Syriac model by route, never the bare model id', () => {
    const ms = transcriptProvenance(page({ model: 'sophro-mhiro', data: 'x', engine: { name: 'kraken', model: 'sophro-mhiro', route: 'manuscript' } }));
    expect(ms).toEqual({ kind: 'kraken', route: 'manuscript' });
    expect(transcriptProvenanceLabel(ms!, en, 'full')).toContain('Sophro Mhiro');
    const pr = transcriptProvenance(page({ model: 'omnisyr', data: 'x', engine: { name: 'kraken', model: 'omnisyr', route: 'print' } }));
    expect(pr).toEqual({ kind: 'kraken', route: 'print' });
    expect(transcriptProvenanceLabel(pr!, en, 'short')).toBe('omnisyr (Kraken)');
    expect(transcriptProvenanceLabel(pr!, es, 'full')).toContain('siríaco impreso');
  });

  it('returns null when nothing says how the page was read', () => {
    expect(transcriptProvenance(page(undefined))).toBeNull();
    expect(transcriptProvenance(page({ data: 'text', language: 'Latin' }))).toBeNull();
  });

  it('ingest shape: ia_djvu with an ocr.ia block → engine, year, agreement', () => {
    const prov = transcriptProvenance(page({
      source: 'ia_djvu', model: 'ia-djvu', data: 'x', language: 'English',
      ia: { engine: 'ABBYY FineReader 11.0', ocr_date: new Date('2014-06-01T00:00:00Z') },
      agreement_ref: { median: 0.964, n: 12, min_agreement: 0.9 },
    }));
    expect(prov).toEqual({ kind: 'ia', engine: 'ABBYY FineReader 11.0', year: '2014', agreement: 0.964 });
  });

  it('provisional shape (2026-09-12): ia_djvu with only the engine in ocr.model, no ocr.ia', () => {
    const prov = transcriptProvenance(page({
      source: 'ia_djvu', model: 'ia-ocr/0.0.13', provisional: true, data: 'x', language: 'English',
    }));
    expect(prov).toEqual({ kind: 'ia', engine: 'ia-ocr/0.0.13', year: null, agreement: null });
  });

  it('ia_djvu with an unparseable ocr_date yields no year rather than "NaN"', () => {
    const prov = transcriptProvenance(page({
      source: 'ia_djvu', model: 'x', data: 'x', language: 'English',
      ia: { engine: null, ocr_date: 'not a date' },
    }));
    expect(prov).toEqual({ kind: 'ia', engine: 'x', year: null, agreement: null });
  });

  it('corpus editions win over every other signal (#4350)', () => {
    const prov = transcriptProvenance(page({ source: 'corpus', model: 'etcsl-corpus', data: 'x', language: 'Sumerian' }));
    expect(prov?.kind).toBe('corpus');
    if (prov?.kind === 'corpus') expect(prov.corpus.shortName).toBe('ETCSL');
  });

  it('manual and model sources', () => {
    expect(transcriptProvenance(page({ source: 'manual', model: 'gemini-2.5-flash', data: 'x', language: 'Latin' })))
      .toEqual({ kind: 'manual', model: 'gemini-2.5-flash' });
    expect(transcriptProvenance(page({ source: 'ai', model: 'gemini-3.1-flash-lite-preview', data: 'x', language: 'Latin' })))
      .toEqual({ kind: 'model', model: 'gemini-3.1-flash-lite-preview' });
  });
});

describe('modelDisplayName', () => {
  it('names Gemini tiers as a reader would say them', () => {
    expect(modelDisplayName('gemini-3.1-flash-lite-preview')).toBe('Gemini 3.1 Flash-Lite');
    expect(modelDisplayName('gemini-3-flash-preview')).toBe('Gemini 3 Flash');
    expect(modelDisplayName('gemini-2.5-pro')).toBe('Gemini 2.5 Pro');
  });
  it('passes unknown ids through untouched — the exact id, never a guess', () => {
    expect(modelDisplayName('ia-ocr/0.0.13')).toBe('ia-ocr/0.0.13');
    expect(modelDisplayName('bdrc-yigdzin-v1')).toBe('bdrc-yigdzin-v1');
  });
});

describe('transcriptProvenanceLabel — header chip and drawer never disagree', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['ia (ingest)', { source: 'ia_djvu', model: 'ia-djvu', data: 'x', language: 'English', ia: { engine: 'ABBYY FineReader 11.0', ocr_date: new Date('2014-06-01') } }],
    ['ia (provisional)', { source: 'ia_djvu', model: 'ia-ocr/0.0.13', data: 'x', language: 'English' }],
    ['corpus', { source: 'corpus', model: 'oraec-corpus', data: 'x', language: 'Egyptian' }],
    ['manual', { source: 'manual', model: 'gemini-2.5-flash', data: 'x', language: 'Latin' }],
    ['model', { source: 'ai', model: 'gemini-3.1-flash-lite-preview', data: 'x', language: 'Latin' }],
  ];

  for (const [name, ocr] of cases) {
    it(`${name}: short and full forms are non-empty in both locales`, () => {
      const prov = transcriptProvenance(page(ocr));
      expect(prov).not.toBeNull();
      for (const t of [en, es]) {
        expect(transcriptProvenanceLabel(prov!, t, 'short').trim().length).toBeGreaterThan(0);
        expect(transcriptProvenanceLabel(prov!, t, 'full').trim().length).toBeGreaterThan(0);
      }
    });
  }

  it('Archive OCR short form names the engine; full form is the drawer sentence', () => {
    const prov = transcriptProvenance(page({ source: 'ia_djvu', model: 'ia-ocr/0.0.13', data: 'x', language: 'English' }))!;
    expect(transcriptProvenanceLabel(prov, en, 'short')).toBe('Internet Archive OCR · ia-ocr/0.0.13');
    expect(transcriptProvenanceLabel(prov, en, 'full')).toBe("Read from the scan by the Internet Archive's OCR (ia-ocr/0.0.13)");
  });

  it('the Archive chip tooltip names the numbers failure mode and shows agreement only when measured', () => {
    expect(en.transcriptChipIaTitle(null)).toBe('Archive OCR — numbers may be misread (see #5186)');
    expect(en.transcriptChipIaTitle(0.964)).toContain('96%');
  });

  it('model short form is the display name; full form keeps the exact id', () => {
    const prov = transcriptProvenance(page({ source: 'ai', model: 'gemini-3.1-flash-lite-preview', data: 'x', language: 'Latin' }))!;
    expect(transcriptProvenanceLabel(prov, en, 'short')).toBe('Gemini 3.1 Flash-Lite');
    expect(transcriptProvenanceLabel(prov, en, 'full')).toBe('Read from the scan by gemini-3.1-flash-lite-preview');
  });

  it('corpus short form', () => {
    const prov = transcriptProvenance(page({ source: 'corpus', model: 'etcsl-corpus', data: 'x', language: 'Sumerian' }))!;
    expect(transcriptProvenanceLabel(prov, en, 'short')).toBe('Corpus: ETCSL');
  });
});
