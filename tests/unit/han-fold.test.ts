import { describe, expect, it } from 'vitest';
import { foldSimplifiedHan } from '@/lib/search/han-fold';

describe('foldSimplifiedHan', () => {
  it.each([
    ['红楼梦', '紅樓夢'],
    ['道德经', '道德經'],
    ['金刚经', '金剛經'],
    ['史记', '史記'],
    ['黄帝内经', '黃帝內經'],
    ['周易参同契', '周易參同契'],
    ['炼丹', '煉丹'],
    ['李时珍', '李時珍'],
  ])('converts the Simplified query %s', (simplified, traditional) => {
    expect(foldSimplifiedHan(simplified)).toBe(traditional);
  });

  it.each(['紅樓夢', '道德經', '本草綱目', '皇后傳', '子曰詩云'])('leaves the traditional query %s as typed', (q) => {
    expect(foldSimplifiedHan(q)).toBe(q);
  });

  it.each(['皇后', '诗云', '干支'])('keeps the right character where a mapping is ambiguous: %s', (q) => {
    expect(foldSimplifiedHan(q)).toMatch(/^(皇后|詩云|干支)$/);
  });

  it.each(['Tao Te Ching', 'anima mundi', 'Ἑρμῆς', 'بغداد', 'བོད་', '', '  '])('leaves non-Han input alone: %s', (q) => {
    expect(foldSimplifiedHan(q)).toBe(q);
  });

  it('leaves Japanese alone', () => {
    expect(foldSimplifiedHan('のの国')).toBe('のの国');
  });

  it('keeps quotes, so an exact-phrase search stays one', () => {
    expect(foldSimplifiedHan('"红楼梦"')).toBe('"紅樓夢"');
  });

  it('converts the Han in a mixed query and keeps the Latin', () => {
    expect(foldSimplifiedHan('红楼梦 Cao Xueqin')).toBe('紅樓夢 Cao Xueqin');
  });
});
