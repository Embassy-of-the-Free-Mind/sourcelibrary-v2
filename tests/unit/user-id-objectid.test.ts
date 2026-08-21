import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';
import { ObjectId } from 'mongodb';
import { toUserId } from '../../src/lib/user-id';

// The NextAuth MongoDBAdapter stores `users._id` as an ObjectId but hands the
// application the STRING form via `session.user.id` / `token.id`. Querying the
// users collection with that raw string matches nothing — and Mongo returns
// null rather than raising, so the failure is completely silent.
//
// Measured on production 2026-07-29: all 3,854 user documents have an ObjectId
// _id, and `findOne({ _id: "<the string form>" })` returned null for every one
// of them. That single line in src/lib/auth.ts's jwt callback made
// `needsWelcome` permanently false, so the /welcome interstitial never fired
// for 3,850 users, and `token.membership` permanently null, which would have
// denied the first paying member their member-only downloads.
//
// Two guards below: the helper's actual behaviour, and the absence of any
// remaining raw-string user lookup (re-introduction is the failure mode here,
// which is what makes a source-shape assertion the right tool — see the
// "a test that greps source is not a guard" note in CLAUDE.md).
const repoRoot = path.resolve(__dirname, '..', '..');

describe('toUserId', () => {
  it('converts an adapter id string to the ObjectId the document is keyed by', () => {
    const oid = new ObjectId('699508ede7f094a3786bed8e');
    const converted = toUserId(oid.toString());

    expect(converted).toBeInstanceOf(ObjectId);
    // .equals is the check that matters: a same-typed but different-valued
    // ObjectId would still satisfy an instanceof assertion.
    expect((converted as ObjectId).equals(oid)).toBe(true);
  });

  it('round-trips every id shape the adapter can produce', () => {
    for (const hex of ['000000000000000000000000', 'ffffffffffffffffffffffff', '69f8691d858d22fcff27ce34']) {
      expect(toUserId(hex).toString()).toBe(hex);
    }
  });

  it('passes through ids that are not valid ObjectIds instead of throwing', () => {
    // A non-adapter user document (or a future auth backend) may key on a
    // plain string. Converting must never be the thing that breaks sign-in.
    for (const id of ['not-an-object-id', '', 'user_12345']) {
      expect(toUserId(id)).toBe(id);
    }
  });

  it('does not treat a 12-character string as an ObjectId', () => {
    // ObjectId.isValid('123456789012') returns TRUE (Mongo's legacy 12-byte
    // form), but the modern driver throws on that constructor input. Using
    // isValid here would turn a harmless unknown id into a 500 at sign-in.
    expect(() => toUserId('123456789012')).not.toThrow();
    expect(toUserId('123456789012')).toBe('123456789012');
  });
});

describe('no raw-string user _id lookups remain', () => {
  it('every users-collection query keyed on a session id goes through toUserId', () => {
    // git grep stays inside tracked files, so it never descends into the
    // worktree checkouts under .claude/worktrees/ (CLAUDE.md).
    let output = '';
    try {
      output = execFileSync(
        'git',
        ['grep', '-n', '-E', '_id: (session\\.user\\.id|token\\.id|userId) as any', '--', 'src', 'scripts'],
        { cwd: repoRoot, encoding: 'utf8' }
      );
    } catch (err: any) {
      // git grep exits 1 with no output when there are no matches — that is a pass.
      if (err.status === 1 && !err.stdout) return;
      throw err;
    }

    const offenders = output.split('\n').filter(Boolean);
    expect(
      offenders,
      `These query users._id with the raw session string, which silently matches nothing. ` +
        `Wrap the id in toUserId() from src/lib/user-id.ts:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
