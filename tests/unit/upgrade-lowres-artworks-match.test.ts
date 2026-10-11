/**
 * #5054 — title overlap alone matched DIFFERENT works. The artist gate rejects a
 * match when both sides name an artist and share no name word; "Unknown artist"
 * and friends name nobody and neither vouch nor veto.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script, no types
import { isPlausibleMatch, renderReviewSheet } from '../../scripts/upgrade-lowres-artworks.mjs';

describe('isPlausibleMatch artist gate (#5054)', () => {
  it('rejects a named-artist mismatch even on a strong title match', () => {
    expect(isPlausibleMatch('The Holy Family under the Cherry Tree', 'Hendrick Goltzius',
      'The Holy Family under the Cherry Tree', 'Joos van Cleve')).toBe(false);
  });

  it('accepts the same artist, including accents and "after X" credits', () => {
    expect(isPlausibleMatch('Death and the Bishop', 'Heinrich Aldegrever',
      'Death and the Bishop', 'Heinrich Aldegrever')).toBe(true);
    expect(isPlausibleMatch('Melencolia I Durer engraving', 'Albrecht Dürer',
      'Melencolia I Durer engraving', 'Albrecht Durer')).toBe(true);
    expect(isPlausibleMatch('Venus and Cupid allegory', 'Jacob Matham (after Hendrick Goltzius)',
      'Venus and Cupid allegory', 'Hendrick Goltzius')).toBe(true);
  });

  it('does not let "Unknown artist" veto a museum artist', () => {
    expect(isPlausibleMatch('Canopic Chest of Khonsu', 'Unknown artist',
      'Canopic Chest of Khonsu', '')).toBe(true);
    expect(isPlausibleMatch('Canopic Chest of Khonsu', 'Anonymous (Egyptian)',
      'Canopic Chest of Khonsu', 'Some Restorer')).toBe(true);
  });

  it('still requires title overlap', () => {
    expect(isPlausibleMatch('Weighing of the Heart Tefnut', 'Unknown artist',
      'Portrait of a Man', '')).toBe(false);
  });
});

describe('renderReviewSheet', () => {
  it('escapes titles and shows both images', () => {
    const html = renderReviewSheet([{
      slug: 'bd-weighing', title: 'BD <Weighing>', author: 'Unknown artist', ourImage: 'https://a/x.jpg',
      source: 'met', objectUrl: 'https://met/1', candidateTitle: 'Anubis', candidateArtist: '',
      candidateMedium: 'Tempera', candidateImage: 'https://b/y.jpg',
    }]);
    expect(html).toContain('BD &lt;Weighing&gt;');
    expect(html).toContain('https://a/x.jpg');
    expect(html).toContain('https://b/y.jpg');
  });
});
