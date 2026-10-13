/**
 * The page-kind routing table (#6688) has ONE source, scripts/lib/ocr-routing-table.json. This pins
 * the three things that would otherwise drift from it:
 *   - the code: a row that says what the Gemini router does is probed against getOcrModelForBook, and a
 *     row that names a lane or reader file must name one that exists;
 *   - the doc: the generated section of scripts/eval/ocr-routing/README.md is what the builder renders;
 *   - the page: /quality imports the JSON and types no row of its own.
 * It also holds each row to its evidence: every experiment file exists, and its date is the file's.
 *
 * If the doc test is red, run `node scripts/eval/build-routing-table.mjs` and commit the README.
 * If a router probe is red, the code and a settled row disagree: that is a decision for Derek
 * (scripts/eval/ocr-routing/README.md), not something to settle by editing whichever side is easier.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  OCR_ROUTING_TABLE, ocrRouteForKind, getOcrModelForBook, OCR_MODEL_FLASH, OCR_MODEL_LITE,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/ocr-routing.mjs';
import {
  renderKindTable, currentKindSection, withKindSection, KIND_DOC, KIND_BEGIN, KIND_END,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/eval/build-routing-table.mjs';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f: string) => fs.existsSync(path.join(ROOT, f));

type Evidence = { file?: string; issue?: number; pr?: number; n: string; date: string };
type Row = {
  id: string; kind: string; reader: string; why: string; in_use: string; status: string; routed: string; production: string;
  code: null | { file: string } | { router: { language: string; visible: boolean }; expect: 'lite' | 'flash' };
  evidence: Evidence[]; audit: { select: string; reviewer: string };
};
const rows = OCR_ROUTING_TABLE.rows as Row[];
const MODEL = { lite: OCR_MODEL_LITE, flash: OCR_MODEL_FLASH };

describe('OCR routing table by page kind (scripts/lib/ocr-routing-table.json)', () => {
  it('every row is complete, with a unique id', () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) {
      for (const k of ['kind', 'reader', 'why', 'in_use', 'production'] as const) expect([r.id, k, (r[k] ?? '').length > 0]).toEqual([r.id, k, true]);
      expect([r.id, ['settled', 'provisional', 'open'].includes(r.status)]).toEqual([r.id, true]);
      expect([r.id, ['yes', 'partly', 'no'].includes(r.routed)]).toEqual([r.id, true]);
      expect([r.id, r.evidence.length > 0]).toEqual([r.id, true]);
      expect([r.id, !!r.audit?.select && !!r.audit?.reviewer]).toEqual([r.id, true]);
      expect(ocrRouteForKind(r.id)).toBe(r);
    }
    expect(() => ocrRouteForKind('no-such-kind')).toThrow(/no page kind/);
  });

  it('every evidence item is a real experiment file with the date in its name, or an issue', () => {
    for (const r of rows) for (const e of r.evidence) {
      expect([r.id, /^\d{4}-\d{2}-\d{2}$/.test(e.date), e.n.length > 0]).toEqual([r.id, true, true]);
      if (e.file) {
        expect([r.id, e.file, exists(`scripts/eval/experiments/${e.file}`)]).toEqual([r.id, e.file, true]);
        expect([e.file, e.file.startsWith(e.date)]).toEqual([e.file, true]);
        // a superseded write-up is not evidence (experiments-garden.mjs flags a public page that cites one)
        const header = read(`scripts/eval/experiments/${e.file}`).split('\n---')[0];
        expect([e.file, /^status: superseded/m.test(header)]).toEqual([e.file, false]);
      } else {
        expect([r.id, Number.isInteger(e.issue)]).toEqual([r.id, true]);
      }
    }
  });

  it('a public sentence quotes no figure without its sample and date (quality-statements.md)', () => {
    for (const r of rows.filter((x) => x.status !== 'open')) {
      expect([r.id, /\b(19|20)\d{2}\b/.test(r.why)]).toEqual([r.id, true]);
      expect([r.id, /\b\d[\d,]* (?:\w+ )*?(pages|books|folios)\b/.test(r.why)]).toEqual([r.id, true]);
    }
    // No per-source book counts (Derek's rule): the public fields never say how many books a reader has read.
    for (const r of rows) expect([r.id, /\b[\d,]+ books (were |are )?(read|written)\b/i.test(`${r.reader} ${r.in_use}`)]).toEqual([r.id, false]);
  });

  it('the public "in use" sentence agrees with `routed`', () => {
    for (const r of rows) {
      if (r.routed === 'no') expect([r.id, /^Not in use/.test(r.in_use)]).toEqual([r.id, true]);
      else expect([r.id, /^Not in use/.test(r.in_use)]).toEqual([r.id, false]);
    }
  });

  it('CODE: a row that states what the Gemini router does matches getOcrModelForBook today', () => {
    const probes = rows.filter((r) => r.code && 'router' in r.code);
    expect(probes.length).toBeGreaterThanOrEqual(3);
    for (const r of probes) {
      const c = r.code as { router: { language: string; visible: boolean }; expect: 'lite' | 'flash' };
      // The production default (OCR_LITE_ONLY on), and a book old enough that only `visible` can qualify it.
      const got = getOcrModelForBook({ ...c.router, created_at: new Date('2020-01-01') }, { liteOnly: true });
      expect([r.id, got]).toEqual([r.id, MODEL[c.expect]]);
    }
  });

  it('CODE: a row that names a lane or reader file names one that exists', () => {
    for (const r of rows) {
      if (r.code && 'file' in r.code) expect([r.id, r.code.file, exists(r.code.file)]).toEqual([r.id, r.code.file, true]);
      // every repo path the internal `production` sentence names is real too
      for (const f of r.production.match(/scripts\/[\w./-]+\.(?:mjs|sh|py)/g) ?? []) expect([r.id, f, exists(f)]).toEqual([r.id, f, true]);
    }
  });

  it('a row routed "no" or "partly" is never claimed as what the router does for every book', () => {
    // manuscripts: the evidence says Opus, the router still says lite. The row must say so, not hide it.
    const ms = ocrRouteForKind('manuscripts') as Row;
    expect(ms.routed).toBe('no');
    expect(ms.production).toMatch(/Not routed/);
  });

  it('DOC: the generated section of the README is what the builder renders from the JSON', () => {
    const doc = read(KIND_DOC);
    expect(doc.split(KIND_BEGIN).length).toBe(2);
    expect(doc.split(KIND_END).length).toBe(2);
    expect(currentKindSection(doc)).toBe(renderKindTable());
    expect(withKindSection(doc, renderKindTable())).toBe(doc);
    for (const r of rows) expect(currentKindSection(doc)).toContain(`(\`${r.id}\`)`);
  });

  it('NEGATIVE CONTROL: a row changed in the JSON makes the committed section stale', () => {
    const changed = { ...OCR_ROUTING_TABLE, rows: rows.map((r) => (r.id === 'tibetan' ? { ...r, reader: 'Gemini 3.1 Flash-Lite' } : r)) };
    expect(renderKindTable(changed)).not.toBe(currentKindSection(read(KIND_DOC)));
  });

  it('PAGE: /quality renders the rows from the JSON and types none of its own', () => {
    const page = read('src/app/quality/page.tsx');
    expect(page).toMatch(/import ocrRouting from '\.\.\/\.\.\/\.\.\/scripts\/lib\/ocr-routing-table\.json'/);
    expect(page).toContain('ocrRouting.rows.map(');
    expect(page).toContain('ocrRouting.not_adopted.map(');
    for (const k of ['row.kind', 'row.reader', 'row.why', 'row.in_use']) expect(page).toContain(`{${k}}`);
    // no row's sentence is typed into the page or its hand-written content file
    const hand = page + read('src/app/quality/content.ts');
    for (const r of rows) for (const k of ['why', 'in_use'] as const) {
      if (r[k].length > 40) expect([r.id, k, hand.includes(r[k])]).toEqual([r.id, k, false]);
    }
  });

  it('AUDIT: each reviewer is from another model family than the reader', () => {
    for (const r of rows) {
      const reader = r.reader.toLowerCase();
      const readByGemini = /^gemini/.test(reader), readByClaude = /^claude/.test(reader);
      if (readByGemini) expect([r.id, r.audit.reviewer]).toEqual([r.id, 'claude']);
      if (readByClaude) expect([r.id, r.audit.reviewer.startsWith('gemini') || r.audit.reviewer.startsWith('claude and gemini')]).toEqual([r.id, true]);
    }
  });
});
