import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs maintenance script, no type declarations
import { classifyPaths, classifyPR, groupedBumps, scannableAddedLines } from '../../scripts/maintenance/pr-tier.mjs';

const DELETION = 'data deletion or migration in the diff';
const reasons = (paths: string[], lines: string[]) =>
  (classifyPaths(paths, lines).reasons as { reason: string }[]).map((r) => r.reason);

const diffOf = (file: string, added: string[]) =>
  [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, '@@ -1,1 +1,9 @@', ...added.map((l) => `+${l}`)].join('\n');

describe('pr-tier: the deletion rule fires on code that can run, not on prose about it', () => {
  it('real deletion code in a script still holds', () => {
    const diff = diffOf('scripts/maintenance/x.mjs', ["await books.updateOne({ id }, { $unset: { stale: '' } });", 'await col.deleteMany({});']);
    expect(reasons(['scripts/maintenance/x.mjs'], scannableAddedLines(diff))).toContain(DELETION);
  });

  it('a comment that mentions a deletion does not hold', () => {
    const diff = diffOf('scripts/maintenance/x.mjs', [' * 3. $unset the stale Gemini-era fields', '// Not `$unset: translation`: the stamp keeps it out', '# deleteMany( is refused here']);
    expect(scannableAddedLines(diff)).toEqual([]);
    expect(reasons(['scripts/maintenance/x.mjs'], scannableAddedLines(diff))).not.toContain(DELETION);
  });

  it('code after a comment on the same line is still code', () => {
    const diff = diffOf('scripts/maintenance/x.mjs', ['await col.deleteOne({ id }); // remove the stale row']);
    expect(reasons(['scripts/maintenance/x.mjs'], scannableAddedLines(diff))).toContain(DELETION);
  });

  it('a write-up, a test or a results file that quotes deletion code does not hold', () => {
    for (const file of ['scripts/eval/experiments/2026-10-08-x.md', 'tests/unit/x.test.ts', 'scripts/eval/results/x/audit.json', '.claude/docs/x.md']) {
      const diff = diffOf(file, ['the script ran `col.deleteMany({})` on 2026-10-01', 'DROP TABLE page_translations']);
      expect(scannableAddedLines(diff), file).toEqual([]);
    }
  });

  it('a migration file holds on its path, whatever its lines say', () => {
    const diff = diffOf('scripts/migrations/2026-10-08-x.mjs', ['// nothing but a comment']);
    expect(reasons(['scripts/migrations/2026-10-08-x.mjs'], scannableAddedLines(diff))).toContain(DELETION);
  });

  it('lines from an ignored file do not hide lines from a scanned one in the same diff', () => {
    const diff = [diffOf('docs/x.md', ['col.deleteMany({})']), diffOf('src/lib/x.ts', ['await col.deleteMany({});'])].join('\n');
    expect(scannableAddedLines(diff)).toEqual(['await col.deleteMany({});']);
  });
});

describe('pr-tier: a grouped dependabot bump is read from the diff', () => {
  const pkg = (lines: string[]) => ['--- a/package.json', '+++ b/package.json', '@@ -10,6 +10,6 @@', ...lines].join('\n');

  it('minor and patch bumps only: nothing breaking', () => {
    const r = groupedBumps(pkg(['-    "sharp": "^0.34.1",', '+    "sharp": "^0.34.5",', '-    "zod": "^4.1.0",', '+    "zod": "^4.3.2",']));
    expect(r.pairs).toBe(2);
    expect(r.breaking).toEqual([]);
  });

  it('a major jump inside a group is named', () => {
    const r = groupedBumps(pkg(['-    "nodemailer": "^9.0.3",', '+    "nodemailer": "^10.0.1",', '-    "zod": "^4.1.0",', '+    "zod": "^4.3.2",']));
    expect(r.breaking.map((b: { name: string }) => b.name)).toEqual(['nodemailer']);
  });

  it('a minor change on a 0.x package counts as breaking', () => {
    expect(groupedBumps(pkg(['-    "sharp": "^0.33.5",', '+    "sharp": "^0.34.0",'])).breaking).toHaveLength(1);
  });

  it('a lockfile is not read: its repeated "version" keys would pair unrelated packages', () => {
    const lock = ['--- a/package-lock.json', '+++ b/package-lock.json', '@@ -1,4 +1,4 @@', '-      "version": "1.2.3",', '+      "version": "7.0.0",'].join('\n');
    expect(groupedBumps(lock).pairs).toBe(0);
    const both = [pkg(['-    "zod": "^4.1.0",', '+    "zod": "^4.3.2",']), lock].join('\n');
    expect(groupedBumps(both)).toEqual({ pairs: 1, breaking: [] });
  });

  it('a newly added dependency is not a pair; a diff with no pairs reads as zero so the caller keeps the hold', () => {
    expect(groupedBumps(pkg(['+    "left-pad": "^1.3.0",'])).pairs).toBe(0);
    expect(groupedBumps('').pairs).toBe(0);
  });
});

describe('pr-tier: a PR whose diff GitHub will not serve holds instead of crashing (#6324)', () => {
  const view = JSON.stringify({ number: 5991, title: 'eval: big results drop', author: { login: 'JDerekLomas' }, labels: [], files: [{ path: 'scripts/eval/results/x.json' }], comments: [] });
  const fakeGh = (diff: () => string) => (cmd: string) => (cmd.startsWith('gh pr view') ? view : diff());

  it('a readable diff of harmless paths is AUTO', () => {
    expect(classifyPR(5991, fakeGh(() => '')).result.tier).toBe('AUTO');
  });

  it('an HTTP 406 too_large diff is HOLD with the reason, not a throw', () => {
    const tooLarge = () => {
      throw Object.assign(new Error('Command failed: gh pr diff 5991'), {
        stderr: 'could not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of files (300).\nPullRequest.diff too_large\n',
      });
    };
    const { result } = classifyPR(5991, fakeGh(tooLarge));
    expect(result.tier).toBe('HOLD');
    expect(result.reasons.map((r: { reason: string }) => r.reason).join('\n')).toMatch(/diff could not be read.*HTTP 406/);
  });
});
