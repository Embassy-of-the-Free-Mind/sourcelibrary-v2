import { describe, it, expect } from 'vitest';
import { buildProfileUpdate } from '../../src/lib/welcome-profile-update';

const NOW = new Date('2026-08-01T00:00:00Z');

describe('buildProfileUpdate — absent means "leave alone", empty means "cleared"', () => {
  // The data-loss case. A form that renders blank must be able to save a name
  // without erasing prose it never showed the reader.
  it('does not touch a field the caller omitted', () => {
    const update = buildProfileUpdate({ name: 'Ada' }, NOW);
    expect(update).not.toHaveProperty('profile.aboutYou');
    expect(update).not.toHaveProperty('profile.helpDescription');
    expect(update).not.toHaveProperty('profile.preferredLanguage');
    expect(update).toEqual({});
  });

  it('clears a field the reader explicitly emptied', () => {
    const update = buildProfileUpdate({ about_you: '' }, NOW);
    expect(update['profile.aboutYou']).toBe('');
  });

  it('writes what the reader typed', () => {
    const update = buildProfileUpdate({
      about_you: '  Founder of Source Library  ',
      help_description: 'everything!',
      preferred_language: '  English   and  Spanish ',
    }, NOW);
    expect(update['profile.aboutYou']).toBe('Founder of Source Library');
    expect(update['profile.helpDescription']).toBe('everything!');
    expect(update['profile.preferredLanguage']).toBe('English and Spanish');
    expect(update['profile.preferredLanguageKey']).toBe('english and spanish');
  });

  it('keeps the language key in step with the language', () => {
    const update = buildProfileUpdate({ preferred_language: 'Español' }, NOW);
    expect(update['profile.preferredLanguageKey']).toBe('español');
    // Cleared language must clear its key too, or the demand tally keeps a
    // language the reader withdrew.
    const cleared = buildProfileUpdate({ preferred_language: '' }, NOW);
    expect(cleared['profile.preferredLanguage']).toBe('');
    expect(cleared['profile.preferredLanguageKey']).toBe('');
  });

  it('stamps updatedAt only when something changed', () => {
    expect(buildProfileUpdate({ name: 'Ada' }, NOW)['profile.updatedAt']).toBeUndefined();
    expect(buildProfileUpdate({ about_you: 'x' }, NOW)['profile.updatedAt']).toBe(NOW);
  });

  it('enforces the stored length caps', () => {
    const update = buildProfileUpdate({
      about_you: 'a'.repeat(5000),
      help_description: 'b'.repeat(3000),
      preferred_language: 'c'.repeat(200),
    }, NOW);
    expect((update['profile.aboutYou'] as string).length).toBe(4000);
    expect((update['profile.helpDescription'] as string).length).toBe(2000);
    expect((update['profile.preferredLanguage'] as string).length).toBe(60);
  });

  it('ignores non-string junk rather than storing it', () => {
    const update = buildProfileUpdate({ about_you: { evil: true }, help_description: 42 } as never, NOW);
    expect(update['profile.aboutYou']).toBe('');
    expect(update['profile.helpDescription']).toBe('');
  });

  it('survives a null body', () => {
    expect(buildProfileUpdate(null, NOW)).toEqual({});
  });
});
