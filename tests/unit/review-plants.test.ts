import { describe, expect, it } from 'vitest';
import { PLANT_RATE, plantError, shouldPlant } from '@/lib/review-plants';

const filler = (n: number) => 'The text continues in the same plain manner here. '.repeat(n);
const page = (middle: string) => `${filler(4)}${middle} ${filler(14)}`;

describe('shouldPlant', () => {
  it('is deterministic per volunteer and page', () => {
    expect(shouldPlant('vol-a', 'page-1')).toBe(shouldPlant('vol-a', 'page-1'));
  });

  it('plants about PLANT_RATE of pages', () => {
    let hits = 0;
    for (let i = 0; i < 5000; i++) if (shouldPlant('vol-a', `page-${i}`)) hits++;
    expect(hits / 5000).toBeGreaterThan(PLANT_RATE * 0.8);
    expect(hits / 5000).toBeLessThan(PLANT_RATE * 1.2);
  });
});

describe('plantError', () => {
  it('swaps an antonym, keeping case, and changes nothing else', () => {
    const text = page('Then the Sun rose over the hill.');
    const p = plantError(text, 'v', 'p');
    expect(p).not.toBeNull();
    expect(p!.kind).toBe('antonym');
    expect(p!.original).toBe('Sun');
    expect(p!.planted).toBe('Moon');
    expect(p!.planted_text).toBe(text.replace('Sun', 'Moon'));
  });

  it('never plants a word that already occurs on the page', () => {
    const text = page('The sun and the moon rose together.');
    const p = plantError(text, 'v', 'p');
    expect(p?.planted.toLowerCase()).not.toBe('moon');
    expect(p?.planted.toLowerCase()).not.toBe('sun');
  });

  it('changes a number when no antonym is available', () => {
    const text = page('He paid 40 crowns for the horse.');
    const p = plantError(text, 'v', 'p');
    expect(p?.kind).toBe('number');
    expect(p?.original).toBe('40');
    expect(p?.planted).not.toBe('40');
    expect(p!.planted_text).toContain(`paid ${p!.planted} crowns`);
  });

  it('does not touch markup, the opening lines, or the tail the next page carries', () => {
    const text = `Page 12 sun. ${filler(4)}<note>the sun 40</note> ${filler(14)} At the end the sun set.`;
    expect(plantError(text, 'v', 'p')).toBeNull();
  });

  it('returns null for a short page', () => {
    expect(plantError('The sun rose.', 'v', 'p')).toBeNull();
  });
});
