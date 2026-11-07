/**
 * #8110: agy sometimes prints a whole SUCCESS reply and never exits; agyCall kills it and keeps the reply
 * (`hung_after_reply`, code null, no error class, #7503). cli-ocr stored that as exit -9 and apply refused it, so a
 * complete, paid reply was thrown away. A kill with no complete reply must still be refused.
 */
import { describe, it, expect } from 'vitest';
import { cliExitCode } from '../../scripts/lib/agy-cli.mjs';

describe('cliExitCode', () => {
  it('records a reply printed whole before the hang as exit 0', () => {
    expect(cliExitCode({ code: null, cls: null, hung_after_reply: true })).toBe(0);
  });
  it('keeps -9 for a kill with no complete reply', () => {
    expect(cliExitCode({ code: null, cls: 'timeout' })).toBe(-9);
  });
  it('passes a real exit code through', () => {
    expect(cliExitCode({ code: 0, cls: null })).toBe(0);
    expect(cliExitCode({ code: 1, cls: 'exit_1' })).toBe(1);
  });
});

describe('cli-ocr apply', () => {
  it('still refuses metas written before #8110 (exit -9): those reads are unjudged, decided on #7701', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('scripts/batch/cli-ocr.mjs', 'utf8');
    expect(src).toContain("if (m.exit !== 0) { failed(m, `cli exit ${m.exit}`, 'exit'); continue; }");
    expect(src.match(/exit: cliExitCode\(r\)/g)?.length).toBe(2);
  });
});
