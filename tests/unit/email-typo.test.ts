/**
 * Mail-domain typo suggestions (src/lib/email-typo.ts).
 *
 * The cases below are not invented: the "must correct" list is every genuine
 * domain typo found in the `verification_tokens` rows that never became accounts
 * in the 30 days to 2026-07-21, and the "must leave alone" list is drawn from
 * the same set — real regional domains that a naive matcher would happily
 * "correct" into the wrong country. That second list is the load-bearing one:
 * a false positive here nags a person whose address was right all along, and on
 * this audience (Argentina is the #2 country) those are common.
 */
import { describe, it, expect } from 'vitest';
import { suggestEmailFix } from '@/lib/email-typo';

describe('suggestEmailFix', () => {
  it('corrects the domain typos actually observed in failed signups', () => {
    const cases: Array<[string, string]> = [
      ['reader@gamil.com', 'reader@gmail.com'],
      ['reader@gmail.con', 'reader@gmail.com'],
      ['reader@gmailcom', 'reader@gmail.com'],
      ['reader@gmailo.com', 'reader@gmail.com'],
      ['reader@gmaill.com', 'reader@gmail.com'],
      ['reader@gmai.com', 'reader@gmail.com'],
      ['reader@gmail.co', 'reader@gmail.com'],
      ['reader@yahoo.con', 'reader@yahoo.com'],
      ['reader@yahoo.cok', 'reader@yahoo.com'],
      ['reader@hotmail.com1', 'reader@hotmail.com'],
      ['reader@gmail', 'reader@gmail.com'],
    ];
    for (const [input, expected] of cases) {
      expect(suggestEmailFix(input), input).toBe(expected);
    }
  });

  it('leaves real regional domains alone', () => {
    const real = [
      'lector@hotmail.es',
      'lector@yahoo.com.ar',
      'lector@hotmail.com.ar',
      'leitor@yahoo.com.br',
      'lector@yahoo.com.mx',
      'reader@hotmail.co.uk',
      'reader@yahoo.co.uk',
      'lecteur@orange.fr',
      'leser@web.de',
    ];
    for (const email of real) {
      expect(suggestEmailFix(email), email).toBeNull();
    }
  });

  it('leaves the big providers and unknown-but-plausible domains alone', () => {
    const fine = [
      'reader@gmail.com',
      'reader@proton.me',
      'reader@icloud.com',
      'scholar@ox.ac.uk',
      'curator@embassyofthefreemind.com',
      'someone@a-small-isp.coop',
      'me@tudelft.nl',
    ];
    for (const email of fine) {
      expect(suggestEmailFix(email), email).toBeNull();
    }
  });

  it('never throws and returns null on junk', () => {
    for (const junk of ['', '   ', 'no-at-sign', '@nolocal.com', 'trailing@', 'a@b']) {
      expect(() => suggestEmailFix(junk)).not.toThrow();
      expect(suggestEmailFix(junk)).toBeNull();
    }
  });

  it('is case- and whitespace-insensitive', () => {
    expect(suggestEmailFix('  Reader@GAMIL.com ')).toBe('reader@gmail.com');
  });
});
