/**
 * #8111: a '-written' route's production yield against the write share its tests measured.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { testWriteShare, ledgerYield, checkYield, betaQuantile } from '../../scripts/lib/router-binding.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { ledgersByCrontab, yieldFindings } from '../../scripts/maintenance/router-board-push.mjs';

const RULES = JSON.parse(fs.readFileSync('scripts/eval/estimator/router-table/rules.json', 'utf8'));
const ledger = (written: number, refused: number, lang = 'la') => [
  ...Array.from({ length: written }, (_, i) => JSON.stringify({ page_id: `w${i}`, lang, outcome: 'written' })),
  ...Array.from({ length: refused }, (_, i) => JSON.stringify({ page_id: `r${i}`, lang, outcome: i % 2 ? 'put_back_unsafe' : 'other' })),
].join('\n');
const ARMC = '35 * * * * f=/root/sourcelibrary/scripts/batch/cli-ocr-lane.mjs; L=/root/jobs/euro-armc-7567; node $f armc --frame=first-read --langs=la --lane-dir=/root/jobs/euro-armc-7567 --apply';

describe('testWriteShare', () => {
  it('every -written route in rules.json carries the share of drawn pages it wrote (arm C: 18/30)', () => {
    expect(testWriteShare(RULES, 'latin-blank/print', 'pero>agy-flash-low-written')).toEqual({ written: 18, drawn: 30 });
    expect(testWriteShare(RULES, 'latin-blank/print', 'agy-flash-low@4-written')).toEqual({ written: 31, drawn: 60 });
    expect(testWriteShare(RULES, 'latin-blank/print', 'agy-flash-low@4')).toBeNull();
  });
});

describe('checkYield', () => {
  it('flags arm C: 4,708 of 28,104 tried in the lane against 18/30 in its test', () => {
    const f = checkYield({ written: 18, drawn: 30 }, ledgerYield(ledger(4708, 28104 - 4708)));
    expect(f.status).toBe('yield-low');
    expect(f.prod).toBe('4708/28104');
    expect(f.floor).toBeGreaterThan(0.35);
  });
  it('a lane that writes what its test wrote is ok; too few pages tried is unmeasured', () => {
    expect(checkYield({ written: 18, drawn: 30 }, { tried: 1000, written: 560 }).status).toBe('yield-ok');
    expect(checkYield({ written: 18, drawn: 30 }, { tried: 50, written: 0 }).status).toBe('yield-unmeasured');
    expect(checkYield(null, { tried: 1000, written: 1 }).status).toBe('no-test-share');
  });
  it('betaQuantile matches Beta(1,1) and is monotone', () => {
    expect(betaQuantile(1, 1, 0.25)).toBeCloseTo(0.25, 6);
    expect(betaQuantile(19, 13, 0.01)).toBeLessThan(betaQuantile(19, 13, 0.5));
  });
  it('ledgerYield keeps one language and leaves out pages that got OCR from elsewhere', () => {
    const t = [ledger(3, 1, 'la'), ledger(5, 5, 'it'), JSON.stringify({ page_id: 'x', lang: 'la', outcome: 'has_ocr_now' })].join('\n');
    expect(ledgerYield(t, { lang: 'la' })).toEqual({ tried: 4, written: 3 });
  });
});

describe('ledgersByCrontab / yieldFindings', () => {
  it('finds each -written line\'s ledger: arm c by --lane-dir, first-read beside --out', () => {
    const cron = [ARMC, '50 * * * * node scripts/batch/cli-ocr-lane.mjs run --cohort=visible-unread --languages=deu --per-call=4 --out=/data/fr/out --apply',
      '10 * * * * node scripts/batch/cli-ocr-lane.mjs correct --out=/x --apply'].join('\n');
    expect(ledgersByCrontab(cron)).toEqual([
      { lane: 'armc-first-read', cell: 'latin-blank/print', route: 'pero>agy-flash-low-written', ledger: '/root/jobs/euro-armc-7567/armc-ledger.jsonl', lang: 'la', mixed: false },
      { lane: 'first-read', cell: 'german-blank/print', route: 'agy-flash-low@8-written', ledger: '/data/fr/first-read-ledger.jsonl', lang: null, mixed: false },
    ]);
  });
  it('the arm C line is flagged from its ledger; a missing ledger says so', () => {
    const [f] = yieldFindings(ARMC, RULES, () => ledger(4708, 28104 - 4708));
    expect([f.status, f.test, f.prod]).toEqual(['yield-low', '18/30', '4708/28104']);
    expect(yieldFindings(ARMC, RULES, () => null)[0].status).toBe('no-ledger');
  });
});
