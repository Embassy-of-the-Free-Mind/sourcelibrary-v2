import { describe, expect, it } from 'vitest';
import { hasLocalizedCollectionName, localizedTitle } from '@/lib/localized';

describe('hasLocalizedCollectionName', () => {
  it('lists a shelf on /zh only when it has a Chinese name', () => {
    expect(hasLocalizedCollectionName({ name: 'East Asia', localized: { zh: { name: '东亚' } } }, 'zh')).toBe(true);
    expect(hasLocalizedCollectionName({ name: 'Slime Moulds' }, 'zh')).toBe(false);
    expect(hasLocalizedCollectionName({ name: 'Alchemy', localized: { es: { name: 'Alquimia' } } }, 'zh')).toBe(false);
    expect(hasLocalizedCollectionName({ name: 'Blank', localized: { zh: { name: '' } } }, 'zh')).toBe(false);
  });

  it('never treats English as a localized name', () => {
    expect(hasLocalizedCollectionName({ name: 'Alchemy' }, 'en')).toBe(false);
  });
});

describe('a result card title on /zh', () => {
  it('shows the book in Chinese, not the English gloss', () => {
    const book = { title: '紅樓夢 (Dream of the Red Chamber), Vol. 39', display_title: 'Dream of the Red Chamber, Vol. 39' };
    expect(localizedTitle(book, 'zh')).toBe('紅樓夢（第 39 册）');
    expect(localizedTitle(book, 'en')).toBe('Dream of the Red Chamber, Vol. 39');
  });

  it('keeps a stored title that has no Chinese', () => {
    expect(localizedTitle({ title: 'Pelliot chinois 2012' }, 'zh')).toBe('Pelliot chinois 2012');
  });
});
