import { describe, it, expect } from 'vitest';
import { isHoldingStatement, usableManifestLabel } from '@/lib/manifest-label';

/**
 * Regression guard for #4572 — Gallica publishes the shelfmark as the IIIF
 * manifest `label`, and importers wrote it into `display_title`, which is the
 * name the reader sees. 977 books were named after a shelf, 216 of them live.
 *
 * The negative cases matter as much as the positive ones: these are real titles
 * from the corpus, and a guard that eats them replaces one defect with a worse
 * one (a silently missing display title).
 */
describe('isHoldingStatement', () => {
  it('rejects a Gallica label that matches the manifest call number', () => {
    // The exact pair from the reported book: label abbreviates the repository,
    // call number spells it out. Neither string equals the other.
    expect(
      isHoldingStatement(
        'BnF, département Réserve des livres rares, J-3263 (BIS,1)',
        'Bibliothèque nationale de France, département Réserve des livres rares, J-3263 (BIS,1)',
      ),
    ).toBe(true);
  });

  it('rejects a Gallica-shaped label even with no call number to compare against', () => {
    expect(isHoldingStatement('BnF, département Réserve des livres rares, YC-1765')).toBe(true);
    expect(isHoldingStatement('BnF, département Philosophie, histoire, sciences de l’homme, R-25681')).toBe(true);
    expect(isHoldingStatement('BnF, département Droit, économie, politique, F-8740')).toBe(true);
  });

  it('rejects a bare repository name', () => {
    expect(isHoldingStatement('BnF')).toBe(true);
    expect(isHoldingStatement('Bibliothèque nationale de France')).toBe(true);
  });

  it('keeps real titles that merely mention a library or a place', () => {
    expect(isHoldingStatement('De Bosphoro Thracio libri III')).toBe(false);
    expect(isHoldingStatement('Carminum libri duo, quorum unus epicorum est, alter elegiarum')).toBe(false);
    expect(isHoldingStatement('Catalogue de la bibliothèque de feu M. le duc de La Vallière')).toBe(false);
    expect(isHoldingStatement('Bibliotheca chemica curiosa')).toBe(false);
    expect(isHoldingStatement('Histoire de la Bibliothèque nationale')).toBe(false);
  });

  it('does not reject a title just because a call number exists', () => {
    // A well-behaved manifest: label is the title, call number is separate.
    expect(isHoldingStatement('Fama remissa ad fratres Roseae crucis', 'E folio 42')).toBe(false);
  });

  it('handles empty and missing input without throwing', () => {
    expect(isHoldingStatement(null)).toBe(false);
    expect(isHoldingStatement(undefined)).toBe(false);
    expect(isHoldingStatement('')).toBe(false);
    expect(isHoldingStatement('   ')).toBe(false);
  });
});

describe('usableManifestLabel', () => {
  it('passes a real title through unchanged', () => {
    expect(usableManifestLabel('De Bosphoro Thracio libri III')).toBe('De Bosphoro Thracio libri III');
  });

  it('returns null for a holding statement so the caller falls back to title', () => {
    expect(
      usableManifestLabel(
        'BnF, département Réserve des livres rares, J-3263 (BIS,1)',
        'Bibliothèque nationale de France, département Réserve des livres rares, J-3263 (BIS,1)',
      ),
    ).toBeNull();
  });

  it('returns null for absent input', () => {
    expect(usableManifestLabel(null)).toBeNull();
    expect(usableManifestLabel(undefined)).toBeNull();
  });
});
