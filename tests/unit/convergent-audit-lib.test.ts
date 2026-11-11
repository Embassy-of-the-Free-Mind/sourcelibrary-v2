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
  function run(quotaExits: number, env: Record<string, string> = {}, readersExit = 0) {
    const repo = mkdtempSync(join(tmpdir(), 'audit-sh-'));
    const base = join(repo, 'base'), bin = join(repo, 'bin'), log = join(repo, 'calls.log');
    for (const d of ['scripts/audit', 'scripts/eval/second-reader', 'scripts/eval', 'bin', 'base']) mkdirSync(join(repo, d), { recursive: true });
    cpSync('scripts/audit/convergent-audit-weekly.sh', join(repo, 'scripts/audit/convergent-audit-weekly.sh'));
    const stub = (file: string, body: string) => { writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`); chmodSync(file, 0o755); };
    stub(join(bin, 'node'), `echo "node $*" >> ${log}`);
    stub(join(bin, 'flock'), 'exit 0');
    stub(join(repo, 'scripts/eval/second-reader/run-readers.sh'), `echo "readers $2" >> ${log}; exit ${readersExit}`);
    // python3 = run-cli-arm.py: exit 3 (quota) for the first N calls, then 0.
    stub(join(bin, 'python3'), `n=$(grep -c '^cli ' ${log} 2>/dev/null); m=$(echo "$*" | sed -n 's/.*--model \\([^ ]*\\).*/\\1/p'); echo "cli $m$(echo "$*" | grep -q -- '--kind review .*--no-tool-gate' || echo ' GATED')" >> ${log}; [ "$n" -lt ${quotaExits} ] && exit 3; exit 0`);
    let out: string, status = 0;
    try {
      out = execFileSync('bash', [join(repo, 'scripts/audit/convergent-audit-weekly.sh'), '2099-01-05'], {
        encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, REPO: repo, AUDIT_BASE: base, AUDIT_LOCK: join(repo, 'lock'), AUDIT_QUOTA_WAIT: '0', ...env },
      });
    } catch (e) { const err = e as { stdout: string; status: number }; out = err.stdout; status = err.status; }
    return { out, status, calls: readFileSync(log, 'utf8').trim().split('\n') };
  }
  it('no quota trouble: one Gemini pass, then assemble and score', () => {
    const { calls } = run(0);
    // …and a review call never gets the OCR tool gate, whose denial tells the model to transcribe (#6571's default).
    expect(calls.filter((c) => c.startsWith('cli '))).toEqual(['cli gemini-3.8-flash-low']);
    expect(calls.at(-1)).toContain('convergent-audit-weekly.mjs score --run');
    expect(calls.at(-2)).toContain('cli-assemble');
  });
  // The default list is one model since 3.7 was withdrawn (2026-10-12); the fallback is exercised with two.
  const TWO = { AUDIT_GEMINI_MODELS: 'gemini-3.8-flash-low gemini-3.8-flash-medium' };
  it('quota on the first model tries the next before waiting', () => {
    const { calls } = run(1, TWO);
    expect(calls.filter((c) => c.startsWith('cli '))).toEqual(['cli gemini-3.8-flash-low', 'cli gemini-3.8-flash-medium']);
  });
  it('quota on every model waits and resumes until the reads are in', () => {
    const { out, calls } = run(4, TWO);
    expect(calls.filter((c) => c.startsWith('cli '))).toHaveLength(5);
    expect(out).toContain('every model is out of quota: wait 0s (retry 1 of 8)');
    expect(out).toContain('(retry 2 of 8)');
    expect(calls.at(-1)).toContain('score');
  });
  it('a reader that refused to run stops the round instead of printing "done" (#6420)', () => {
    const { out, status, calls } = run(0, { AUDIT_OPUS_ONLY: '1' }, 2);
    expect(status).toBe(2);
    expect(out).toContain('STOPPED: the Opus reader did not run (exit 2)');
    expect(out).not.toContain('done (Opus only');
    expect(calls.some((c) => c.includes('score'))).toBe(false);
  });
  it('gives up after the retries and still scores, so the report can say why', () => {
    const { out, calls } = run(99, { ...TWO, AUDIT_QUOTA_RETRIES: '2' });
    expect(calls.filter((c) => c.startsWith('cli '))).toHaveLength(6);   // 3 passes × 2 models
    expect(out).toContain('quota still out after 2 waits: scoring without the Gemini reader');
    expect(calls.at(-1)).toContain('score');
  });
  it('a date argument finishes that run instead of starting today', () => {
    expect(run(0).calls.at(-1)).toContain('base/2099-01-05');
  });
  it('a spare-lane round (#6781): Opus only, the given seed, scored without posting', () => {
    const { calls } = run(0, { AUDIT_OPUS_ONLY: '1', AUDIT_POST: '0', AUDIT_SEED: '424242' });
    expect(calls[0]).toContain('draw --run');
    expect(calls[0]).toContain('--seed 424242');
    expect(calls.filter((c) => c.startsWith('cli ') || c.includes('cli-requests'))).toEqual([]);
    expect(calls.at(-1)).toContain('score --run');
    expect(calls.join('\n')).not.toContain('--post');
  });
  it('the weekly run still posts', () => {
    expect(run(0).calls.at(-1)).toContain('--post');
  });
});

describe('convergent-audit-pool.mjs: one account-week of spare-lane rounds, one comment (#6781)', () => {
  // Two rounds; book A is drawn in both, so it counts once. B has a serious error; C is clean; round 2 lost C2's review.
  const ocr = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor';
  const tr = 'The quick brown fox jumps over the lazy dog and keeps running down the road';
  function round(root: string, name: string, seed: number, pages: { pk: string; book: string; review?: object }[]) {
    const R = join(root, name);
    mkdirSync(join(R, 'packets'), { recursive: true }); mkdirSync(join(R, 'readers/opus/reviews'), { recursive: true });
    writeFileSync(join(R, 'draw.json'), JSON.stringify({ seed, pages: pages.map((p) => ({ packet: p.pk, stratum: 'random', exposure: 'served', book_id: p.book, page_number: 3, language: 'Latin' })) }));
    for (const p of pages) {
      writeFileSync(join(R, 'packets', `${p.pk}.json`), JSON.stringify([{ book_id: p.book, pages: [{ page_number: 3, ocr, translation: tr }] }]));
      if (p.review) writeFileSync(join(R, 'readers/opus/reviews', `${p.pk}.json`), JSON.stringify([{ book_id: p.book, pages: [{ page_number: 3, ...p.review }] }]));
    }
    return R;
  }
  const clean = { right_page: 'yes', ocr_score: 5, tr_score: 5, ocr_errors: [], tr_errors: [] };
  const bad = { right_page: 'yes', ocr_score: 2, tr_score: 2, ocr_errors: [], tr_errors: [{ severity: 'serious', class: 'T1', problem: 'negation flipped', english: 'keeps running down the road' }] };
  it('pools by book across rounds and names every round', () => {
    const root = mkdtempSync(join(tmpdir(), 'pool-'));
    const r1 = round(root, 'spare-audit-20261016-1', 11, [{ pk: 'p000', book: 'A', review: clean }, { pk: 'p001', book: 'B', review: bad }]);
    const r2 = round(root, 'spare-audit-20261016-2', 22, [{ pk: 'p000', book: 'A', review: clean }, { pk: 'p001', book: 'C' }]);
    const out = execFileSync('node', ['scripts/audit/convergent-audit-pool.mjs', '--label', 'l7a, week to 2026-10-22', r1, r2], { encoding: 'utf8' });
    expect(out).toContain('2 round(s), Opus only');
    expect(out).toContain('3 of 4 drawn pages were read');
    expect(out).toMatch(/serious error on 1 of 2 books/);
    expect(out).toContain('`spare-audit-20261016-2` (seed 22, 1/2 read)');
    expect(out).toContain('`B` p.3');
    expect(out).toContain('nothing here is convergent');
  });
});
