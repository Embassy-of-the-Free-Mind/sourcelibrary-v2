import { describe, it, expect } from 'vitest';
import { mapPlaceKey, modernCountry } from '@/lib/map-place';

describe('mapPlaceKey', () => {
  it('puts spellings of one city on one pin', () => {
    // Venice as geocoded under two labels (measured 2026-10-06).
    expect(mapPlaceKey(45.4408, 12.3155)).toBe(mapPlaceKey(45.4371, 12.3326));
  });
  it('keeps neighbouring cities apart', () => {
    // Leipzig and Halle are ~30 km apart.
    expect(mapPlaceKey(51.3397, 12.3731)).not.toBe(mapPlaceKey(51.4825, 11.9697));
  });
});

describe('modernCountry', () => {
  it('maps historical state names to the country a reader expects', () => {
    expect(modernCountry("People's Republic of China")).toBe('China');
    expect(modernCountry('Nazi Germany')).toBe('Germany');
    expect(modernCountry('German Democratic Republic')).toBe('Germany');
  });
  it('drops labels that name no modern country', () => {
    expect(modernCountry('Ancient Rome')).toBeNull();
    expect(modernCountry('Qi (Huang Chao)')).toBeNull();
    expect(modernCountry(null)).toBeNull();
  });
  it('passes ordinary country names through', () => {
    expect(modernCountry('Italy')).toBe('Italy');
  });
});
