/**
 * The weekly convergent audit's second reader (#6203 repair 3). On 2026-10-12 the Gemini reader posted no verdicts
 * ("—", agreement n=0) and the report gave no reason: the CLI account was out of quota, run-cli-arm.py stopped on the
 * first call with exit 3, and the wrapper carried on to score. Pins: the report can say why, the wrapper retries a
 * quota stop, and agreement per kind is only stated where it can be estimated.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error — plain .mjs module without type declarations
import { readerStatus, kindAgreement, seriousKinds, caughtControl, MIN_READ_SHARE } from '../../scripts/audit/convergent-audit-lib.mjs';

const uids = ['p000', 'p001', 'p002', 'p003'];

describe('readerStatus: why a reader has the verdicts it has', () => {
  it('the 2026-10-12 shape: quota on the first call, no rows, QUOTA.txt left behind', () => {
    const s = readerStatus({ uids, rows: [], quotaText: '2026-10-12T06:02:11.123456+00:00 audit6420-gemini37 p000\n\nIndividual quota reached\n', reviewed: [] });
    expect(s).toMatchObject({ requested: 4, read: 0, not_run: 4, quota_stopped: true, ok: false });
    expect(s.why).toBe("read 0 of 4: the CLI account's quota was exhausted (first refusal 2026-10-12 06:02 UTC), so the runner stopped with 4 pages not attempted");
    expect(s.read).toBeLessThan(MIN_READ_SHARE * s.requested);
  });
  it('a complete reader has no reason to give, and names the model that read', () => {
    const rows = uids.map((uid) => ({ uid, model: 'gemini-3.7-flash-low', text: '{"page_number":1}' }));
    expect(readerStatus({ uids, rows, reviewed: uids })).toMatchObject({ ok: true, why: null, models: ['gemini-3.7-flash-low'], read: 4 });
  });
  it('separates a reply that could not be parsed from a call that returned nothing', () => {
    const rows = [
      { uid: 'p000', model: 'm', text: '{"page_number":1}' },
      { uid: 'p001', model: 'm', text: 'I have created the plan artifact.' },               // a reply, not a review
      { uid: 'p002', model: 'm', text: '', empty: true, error: 'timeout: print timeout' },
      { uid: 'p002', model: 'm', text: '', empty: true, error: 'empty: ' },                  // the last row per uid wins
    ];
    const s = readerStatus({ uids, rows, reviewed: ['p000'] });
    expect(s).toMatchObject({ read: 1, unparsable: 1, failed: { empty: 1 }, not_run: 1, quota_stopped: false });
    expect(s.why).toBe('read 1 of 4: 1 pages were never attempted (the runner did not run or stopped early); 1 ended empty; 1 replies could not be parsed as a review');
  });
  it('a quota stop part-way says how many were left', () => {
    const rows = [{ uid: 'p000', model: 'm', text: '{}' }, { uid: 'p001', model: 'm', text: '{}' }];
    const s = readerStatus({ uids, rows, quotaText: '2026-10-19T06:40:00+00:00 arm p002\n', reviewed: ['p000', 'p001'] });
    expect(s.why).toContain('so the runner stopped with 2 pages not attempted');
  });
});

describe('agreement per kind', () => {
  const page = (errs: { class?: string; kind?: string; severity?: string }[], right = 'yes') => ({ right_page: right, ocr_errors: errs.map((e) => ({ severity: 'serious', ...e })), tr_errors: [], other: [] });
  it('takes the reader kind, else the class default; a wrong leaf is a kind too', () => {
    expect(seriousKinds(page([{ class: 'O1', kind: 'show_through' }, { class: 'O6' }, { class: 'T8', severity: 'minor' }]))).toEqual(['show_through', 'misread']);
    expect(seriousKinds(page([], 'no'))).toEqual(['wrong_leaf']);
  });
  it('kappa per kind over the pages both read; not estimable is null, never 0', () => {
    const a = new Map([['1', page([{ kind: 'misread' }])], ['2', page([{ kind: 'misread' }])], ['3', page([])], ['4', page([])], ['5', page([{ kind: 'omission' }])]]);
    const b = new Map([['1', page([{ kind: 'misread' }])], ['2', page([])], ['3', page([])], ['4', page([{ kind: 'confabulation' }])], ['9', page([])]]);
    const g = kindAgreement(a, b);
    expect(g.any_serious).toMatchObject({ n: 4, a_yes: 2, b_yes: 2, both: 1, raw: 0.5, kappa: 0 });
    expect(g.misread).toMatchObject({ a_yes: 2, b_yes: 1, both: 1 });
    expect(g.misread.kappa).toBeCloseTo(0.5, 5);
    expect(g.recitation).toMatchObject({ a_yes: 0, b_yes: 0, raw: 1, kappa: null });
    expect(g.not_on_leaf).toMatchObject({ a_yes: 0, b_yes: 1 });
  });
});

describe('planted controls', () => {
  const english = 'The king did not consent to the treaty. He sent the envoys home. The winter was hard that year.';
  it('a flipped negation is caught by a finding that quotes the planted sentence', () => {
    const control = { class: 'negation', span: [0, 39] };
    const hit = { right_page: 'yes', tr_errors: [{ severity: 'serious', kind: 'mistranslation', english: 'The king did not consent to the treaty', problem: 'the source says he consented' }] };
    expect(caughtControl(control, hit, english)).toMatchObject({ detected: true, serious: true, kind_named: true });
    const elsewhere = { right_page: 'yes', tr_errors: [{ severity: 'serious', kind: 'misread', english: 'The winter was hard that year', problem: 'x' }] };
    expect(caughtControl(control, elsewhere, english)).toMatchObject({ detected: false });
  });
  it('a dropped line is caught by an omission; a neighbouring leaf by right_page no', () => {
    expect(caughtControl({ class: 'dropped' }, { right_page: 'yes', tr_errors: [{ severity: 'moderate', kind: 'omission', problem: 'one sentence is missing' }] }, english)).toMatchObject({ detected: true, serious: false, kind_named: true });
    expect(caughtControl({ class: 'wrong_leaf' }, { right_page: 'no', tr_errors: [] }, english)).toMatchObject({ detected: true, serious: true, kind_named: true });
    expect(caughtControl({ class: 'wrong_leaf' }, { right_page: 'yes', ocr_score: 4, tr_errors: [] }, english)).toMatchObject({ detected: false });
    expect(caughtControl({ class: 'dropped' }, undefined, english)).toMatchObject({ detected: false, missing: true });
  });
});

describe('convergent-audit-weekly.sh: a quota stop is retried, not scored as an empty reader', () => {
  // A stand-in repo: the real wrapper, with every command it calls replaced by a stub that logs its call.
  function run(quotaExits: number, env: Record<string, string> = {}) {
    const repo = mkdtempSync(join(tmpdir(), 'audit-sh-'));
    const base = join(repo, 'base'), bin = join(repo, 'bin'), log = join(repo, 'calls.log');
    for (const d of ['scripts/audit', 'scripts/eval/second-reader', 'scripts/eval', 'bin', 'base']) mkdirSync(join(repo, d), { recursive: true });
    cpSync('scripts/audit/convergent-audit-weekly.sh', join(repo, 'scripts/audit/convergent-audit-weekly.sh'));
    const stub = (file: string, body: string) => { writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`); chmodSync(file, 0o755); };
    stub(join(bin, 'node'), `echo "node $*" >> ${log}`);
    stub(join(bin, 'flock'), 'exit 0');
    stub(join(repo, 'scripts/eval/second-reader/run-readers.sh'), `echo "readers $2" >> ${log}`);
    // python3 = run-cli-arm.py: exit 3 (quota) for the first N calls, then 0.
    stub(join(bin, 'python3'), `n=$(grep -c '^cli ' ${log} 2>/dev/null); m=$(echo "$*" | sed -n 's/.*--model \\([^ ]*\\).*/\\1/p'); echo "cli $m" >> ${log}; [ "$n" -lt ${quotaExits} ] && exit 3; exit 0`);
    const out = execFileSync('bash', [join(repo, 'scripts/audit/convergent-audit-weekly.sh'), '2099-01-05'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, REPO: repo, AUDIT_BASE: base, AUDIT_LOCK: join(repo, 'lock'), AUDIT_QUOTA_WAIT: '0', ...env },
    });
    return { out, calls: readFileSync(log, 'utf8').trim().split('\n') };
  }
  it('no quota trouble: one Gemini pass, then assemble and score', () => {
    const { calls } = run(0);
    expect(calls.filter((c) => c.startsWith('cli '))).toEqual(['cli gemini-3.7-flash-low']);
    expect(calls.at(-1)).toContain('convergent-audit-weekly.mjs score --run');
    expect(calls.at(-2)).toContain('cli-assemble');
  });
  it('quota on the first model tries the next before waiting', () => {
    const { calls } = run(1);
    expect(calls.filter((c) => c.startsWith('cli '))).toEqual(['cli gemini-3.7-flash-low', 'cli gemini-3.8-flash-low']);
  });
  it('quota on every model waits and resumes until the reads are in', () => {
    const { out, calls } = run(4);
    expect(calls.filter((c) => c.startsWith('cli '))).toHaveLength(5);
    expect(out).toContain('every model is out of quota: wait 0s (retry 1 of 8)');
    expect(out).toContain('(retry 2 of 8)');
    expect(calls.at(-1)).toContain('score');
  });
  it('gives up after the retries and still scores, so the report can say why', () => {
    const { out, calls } = run(99, { AUDIT_QUOTA_RETRIES: '2' });
    expect(calls.filter((c) => c.startsWith('cli '))).toHaveLength(6);   // 3 passes × 2 models
    expect(out).toContain('quota still out after 2 waits: scoring without the Gemini reader');
    expect(calls.at(-1)).toContain('score');
  });
  it('a date argument finishes that run instead of starting today', () => {
    expect(run(0).calls.at(-1)).toContain('base/2099-01-05');
  });
});
