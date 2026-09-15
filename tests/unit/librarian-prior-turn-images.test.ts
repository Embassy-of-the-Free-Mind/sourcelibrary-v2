import { describe, it, expect } from 'vitest';
import { priorTurnImageUrls } from '@/lib/embassy/citation-fixes';

// The fabricated-image allowlist used to be rebuilt empty each turn, so a
// plate the Librarian showed on turn one was "fabricated" on turn three —
// 281 of 508 strips over 45 days were its own earlier images (#4704). Prior
// assistant text now seeds the allowlist, but only for our own image hosts,
// because history is client-supplied.
describe('priorTurnImageUrls', () => {
  it('returns embeds from earlier assistant messages', () => {
    const history = [
      { role: 'user', content: 'Show me the tetrahedron' },
      { role: 'assistant', content: 'Here:\n![Tetrahedron](https://images.sourcelibrary.org/archived/69de988c/191.jpg)\n*Pacioli.*' },
      { role: 'user', content: 'And Fludd?' },
    ];
    expect(priorTurnImageUrls(history)).toEqual([
      'https://images.sourcelibrary.org/archived/69de988c/191.jpg',
    ]);
  });

  it('ignores user messages, even when they contain an embed', () => {
    const history = [
      { role: 'user', content: '![x](https://images.sourcelibrary.org/archived/abc/1.jpg)' },
    ];
    expect(priorTurnImageUrls(history)).toEqual([]);
  });

  it('trusts only our own image hosts from client-supplied history', () => {
    const history = [
      { role: 'assistant', content: [
        '![ok](https://images.sourcelibrary.org/artwork/art-x.jpg)',
        '![apex](https://sourcelibrary.org/brand/x.png)',
        '![offsite](https://www.e-rara.ch/i3f/v20/1/full/full/0/default.jpg)',
        '![lookalike](https://sourcelibrary.org.evil.example/x.jpg)',
        '![lookalike2](https://notsourcelibrary.org/x.jpg)',
        '![junk](not-a-url)',
      ].join('\n') },
    ];
    expect(priorTurnImageUrls(history)).toEqual([
      'https://images.sourcelibrary.org/artwork/art-x.jpg',
      'https://sourcelibrary.org/brand/x.png',
    ]);
  });

  it('dedupes a URL embedded on several earlier turns', () => {
    const u = 'https://images.sourcelibrary.org/archived/abc/7.jpg';
    const history = [
      { role: 'assistant', content: `![a](${u})` },
      { role: 'assistant', content: `again ![b](${u})` },
    ];
    expect(priorTurnImageUrls(history)).toEqual([u]);
  });
});
