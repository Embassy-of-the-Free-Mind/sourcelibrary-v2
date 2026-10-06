/**
 * The per-language table in .claude/docs/ocr-engine-routing.md is GENERATED (#5828) from the live
 * routing constants, the evidence JSON, the routing-eval results and DECISIONS.md. This fails when
 * the committed section is not what the generator writes today.
 *
 * Why a test and not a note: the hand-written table said Persian's hidden backlog "stays lite" on the
 * day #5812 moved it to flash. If this is red, run `node scripts/eval/build-routing-table.mjs` and
 * commit the doc; do not edit between the markers.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  renderRoutingTable, currentSection, withSection, DOC, BEGIN, END,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/eval/build-routing-table.mjs';
import {
  getOcrModelForBook, FLASH_OCR_FROM, FLASH_OCR_INCLUDES_HIDDEN, OCR_MODEL_FLASH,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/ocr-routing.mjs';

const doc = fs.readFileSync(path.resolve(__dirname, '../..', DOC), 'utf8');
const row = (section: string, family: string) => section.split('\n').find((l) => l.includes(`(\`${family}\`)`)) ?? '';

describe('generated routing table (.claude/docs/ocr-engine-routing.md)', () => {
  it('is current: the committed section is what build-routing-table.mjs renders', () => {
    expect(currentSection(doc)).toBe(renderRoutingTable());
  });

  it('has exactly one marker pair, and writing the section back changes nothing', () => {
    expect(doc.split(BEGIN).length).toBe(2);
    expect(doc.split(END).length).toBe(2);
    expect(withSection(doc, renderRoutingTable())).toBe(doc);
    expect(() => withSection('no markers here', 'x')).toThrow(/expected exactly one/);
  });

  it('keeps the hand-written sections around it', () => {
    for (const h of ['## What production does today', '## Reading notes per language', '## Deciding a new script', '## Recommendations the evidence already supports', '## Experiments still owed']) expect(doc).toContain(h);
  });

  it('NEGATIVE CONTROL: a section that disagrees with the routing constants is detected as stale', () => {
    const section = renderRoutingTable();
    const stale = section.replace(row(section, 'fas'), row(section, 'fas').replace(/\| flash \([^|]*\) \|/, '| lite |'));
    expect(stale).not.toBe(section);
    expect(currentSection(withSection(doc, stale))).not.toBe(renderRoutingTable());
  });

  it('reads production from the live constants, not from prose', () => {
    const section = renderRoutingTable();
    for (const family of Object.keys(FLASH_OCR_FROM)) {
      expect([family, row(section, family)]).toEqual([family, expect.stringContaining('| flash (')]);
      // the hidden backlog is on flash in the table exactly when the constant says so
      const cell = row(section, family).split(' | ')[2];
      expect([family, /^flash \([^)]*hidden backlog/.test(cell)]).toEqual([family, FLASH_OCR_INCLUDES_HIDDEN.has(family)]);
    }
    expect(row(section, 'lat').split(' | ')[2]).toBe('lite');
    expect(getOcrModelForBook({ language: 'Persian', visible: false, created_at: new Date('2020-01-01') }, { liteOnly: true })).toBe(OCR_MODEL_FLASH);
  });

  it('carries the #5795 routing-eval verdicts under both rules', () => {
    expect(row(renderRoutingTable(), 'fas')).toContain('#5795: stay on lite (hidden-flash-5795-registered); route to flash (margin-v1)');
  });
});
