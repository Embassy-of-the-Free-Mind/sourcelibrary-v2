import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
// @ts-expect-error plain .mjs helper
import { extractTranscription, unwrapSentinels } from '../../scripts/lib/cli-chatter.mjs';

// #6523: shapes read by eye in the stored #6293 CLI replies (Latin / Early English pages over half wrong).
const page = 'quodque fuerit in ipso, quamcunque occupauerit magnitudinem,\nsed mebit caelum immensum esse, et quod\nnulla ratione comprehendi possit a nobis.';

describe('extractTranscription', () => {
  it('leaves a plain transcription alone', () => {
    const r = extractTranscription(page);
    expect(r.changed).toBe(false);
    expect(r.text).toBe(page);
  });
  it('cuts trailing chat after a partial read', () => {
    const r = extractTranscription(`${page}\nI am unable to output the full verbatim transcription of this page because the automated safety filter flags it.\n\n### Summary\n- Latin\n\nWould you like a summary of the next section?`);
    expect(r.text).toBe(page);
    expect(r.steps).toContain('trailing chat');
  });
  it('drops a multi-line plan note with a bulleted summary before the page', () => {
    const raw = `I have analyzed the image and prepared a transcription plan in [transcription_plan.md](file:///root/.gemini/x/transcription_plan.md).\n\n### Summary of findings:\n- **Language:** Latin\n\nPlease review the plan. Whenever you are ready, let me know!\n<scan-quality>good</scan-quality>\n<page-type>text</page-type>\n\n${page}`;
    const r = extractTranscription(raw);
    expect(r.text.startsWith('<scan-quality>good</scan-quality>')).toBe(true);
    expect(r.text.endsWith(page.split('\n').at(-1))).toBe(true);
  });
  it('keeps the longest copy of a restarted reply', () => {
    const head = '<scan-quality>good</scan-quality>\n<page-type>text</page-type>\n';
    const r = extractTranscription(`${head}${page.slice(0, 60)}\n${head}${page}\n${head}<warning>Verbatim transcription cannot be fully generated</warning>`);
    expect(r.text).toBe(`${head}${page}`.trim());
  });
  it('takes the block between the sentinels', () => {
    expect(extractTranscription(`<<<BEGIN>>>\n${page}\n<<<END>>>`).text).toBe(page);
  });
});

describe('unwrapSentinels', () => {
  it('reports text outside the markers and a reply cut before END', () => {
    expect(unwrapSentinels(`<<<BEGIN>>>\n${page}\n<<<END>>>`)).toEqual({ inside: page, outside: '', closed: true });
    expect(unwrapSentinels(`Here it is:\n<<<BEGIN>>>\n${page}`).closed).toBe(false);
    expect(unwrapSentinels(`Here it is:\n<<<BEGIN>>>\n${page}`).outside).toBe('Here it is:');
    expect(unwrapSentinels(page).inside).toBeNull();
  });
});

describe('agy-tool-gate.py', () => {
  const gate = (call: object) => JSON.parse(execFileSync('python3', ['scripts/lib/agy-tool-gate.py'], { input: JSON.stringify({ toolCall: call }), env: { ...process.env, AGY_GATE_ROOT: '/tmp/ws-6523' }, encoding: 'utf8' }));
  it('allows view_file inside the workspace only, and denies everything else with a reason', () => {
    expect(gate({ name: 'view_file', args: { AbsolutePath: '/tmp/ws-6523/page.jpg' } }).decision).toBe('allow');
    expect(gate({ name: 'view_file', args: { AbsolutePath: '/etc/passwd' } }).decision).toBe('deny');
    expect(gate({ name: 'view_file', args: { AbsolutePath: '/tmp/ws-6523/../x' } }).decision).toBe('deny');
    const d = gate({ name: 'run_command', args: { CommandLine: 'python3 crop.py' } });
    expect(d.decision).toBe('deny');
    expect(d.reason).toMatch(/view_file/);
    expect(gate({ name: 'read_url', args: {} }).decision).toBe('deny');
  });
});
