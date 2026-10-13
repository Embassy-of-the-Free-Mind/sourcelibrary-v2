import { describe, it, expect } from 'vitest';
import { chineseShownTitle, localizedTitle, originalTitleIfDifferent } from '@/lib/localized';

describe('chineseShownTitle: the stored title of a Chinese book on /zh (#6382)', () => {
  it('writes a volume note in Chinese', () => {
    expect(chineseShownTitle('春秋大全·卷一 (vol 1)')).toBe('春秋大全·卷一（第 1 册）');
    expect(chineseShownTitle('御定佩文韻府·卷九十之四 (vol 625)')).toBe('御定佩文韻府·卷九十之四（第 625 册）');
  });

  it('drops a gloss in Roman letters and keeps a trailing volume', () => {
    expect(chineseShownTitle('五行大義 (Wuxing Dayi: Great Meaning of the Five Elements) Vol 2')).toBe('五行大義（第 2 册）');
    expect(chineseShownTitle('景祐太乙福應經 (Jingyou Taiyi Blessed Response Classic)')).toBe('景祐太乙福應經');
  });

  it('drops a gloss after a dash, before the title, or after a space, inside or outside brackets', () => {
    expect(chineseShownTitle('御定駢字類編·卷二~卷三 — Imperial Parallel Characters (vol 2)')).toBe('御定駢字類編·卷二~卷三（第 2 册）');
    expect(chineseShownTitle('Laozi Yuanyi 老子元翼 — Jiao Hong\'s commentary anthology on the Daodejing (Tao Te Ching)')).toBe('老子元翼');
    expect(chineseShownTitle('搜神記 Soushen Ji (Vols. 11-20)')).toBe('搜神記（第 11–20 册）');
    expect(chineseShownTitle('營造法式 (Yingzao Fashi) · 卷一~卷四')).toBe('營造法式 · 卷一~卷四');
    expect(chineseShownTitle('三才圖會 (Sancai Tuhui) - Illustrated Encyclopedia of the Three Realms')).toBe('三才圖會');
    expect(chineseShownTitle('道言內外秘訣全書 (六卷) — Daoyan neiwai mijue quanshu (incl. 悟真篇 Wuzhen pian)')).toBe('道言內外秘訣全書 (六卷)');
  });

  it('leaves alone what it cannot read as Chinese title + Roman gloss', () => {
    expect(chineseShownTitle('Pelliot chinois 2012 (Dunhuang Document)')).toBe('Pelliot chinois 2012 (Dunhuang Document)');
    expect(chineseShownTitle('周易 (周易注疏)')).toBe('周易 (周易注疏)');
    expect(chineseShownTitle('論語')).toBe('論語');
  });

  it('applies on /zh only, and does not print the stored string again beneath', () => {
    const book = { title: '五行大義 (Wuxing Dayi: Great Meaning of the Five Elements) Vol 2', display_title: 'The Great Meaning of the Five Elements' };
    expect(localizedTitle(book, 'zh')).toBe('五行大義（第 2 册）');
    expect(originalTitleIfDifferent(book, 'zh')).toBeNull();
    expect(localizedTitle(book, 'en')).toBe('The Great Meaning of the Five Elements');
    expect(localizedTitle(book, 'nl')).toBe(book.title);
  });
});
