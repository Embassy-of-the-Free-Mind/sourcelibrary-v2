import { describe, it, expect } from 'vitest';
import { firstMessageKey } from '@/lib/embassy/replay-cache';

// "The same question" for the replay cache: case, spacing, and trailing
// punctuation do not make a new question; a different word does.
describe('firstMessageKey', () => {
  it('folds case, whitespace and trailing punctuation', () => {
    expect(firstMessageKey('What is the Emerald Tablet?')).toBe('what is the emerald tablet');
    expect(firstMessageKey('  what IS   the emerald tablet!! ')).toBe('what is the emerald tablet');
    expect(firstMessageKey('¿Qué es la Tabla Esmeralda?')).toBe('¿qué es la tabla esmeralda');
  });

  it('keeps distinct questions distinct', () => {
    expect(firstMessageKey('What is the Emerald Tablet?')).not.toBe(firstMessageKey('Who wrote the Emerald Tablet?'));
  });
});
