import { describe, it, expect } from 'vitest';
import {
  addDays,
  describeNumeral,
  emptyCourse,
  nextDayWrong,
  nextLesson,
  numeralWrong,
  parseCourse,
  placeMistake,
  placeValue,
  readSpelling,
  recordAnswer,
  reviewDue,
  reviewIntro,
  startSitting,
  toPlaces,
  finishLesson,
} from '@/lib/learn-maya-course';
import { COURSE_ITEMS, DAY_FIG, ENTRIES, LESSONS, OPEN_LESSONS, SYLLABLES, isItem } from '@/app/learn/maya/course';

/** /learn/maya v2 (#6921): the course's wrong-answer explanations and its "last time you missed" review. */

describe('numbers', () => {
  it('describes a number the way it is drawn', () => {
    expect(describeNumeral(0)).toBe('the shell');
    expect(describeNumeral(1)).toBe('one dot');
    expect(describeNumeral(7)).toBe('one bar and two dots');
    expect(describeNumeral(15)).toBe('three bars');
  });

  it('a wrong count names both drawings', () => {
    expect(numeralWrong(7, 1)).toBe('You said 7: one bar and two dots. This is one dot.');
  });

  it('reads stacked numbers in plain and calendar places', () => {
    expect(placeValue([2, 5], [20, 1])).toBe(45);
    expect(placeValue([1, 7, 2], [360, 20, 1])).toBe(502);
    expect(toPlaces(502, [360, 20, 1])).toEqual([1, 7, 2]);
    expect(toPlaces(400, [20, 1])).toBeNull();
    // 18 twenties do not exist under a 360 place: that is the next place up.
    expect(toPlaces(360, [360, 20, 1])).toEqual([1, 0, 0]);
  });

  it('names the misreading behind a wrong place-value answer', () => {
    expect(placeMistake(10, [1, 7, 2], [360, 20, 1])).toBe('sum');
    expect(placeMistake(542, [1, 7, 2], [360, 20, 1])).toBe('plain-count');
    expect(placeMistake(142, [1, 7, 2], [360, 20, 1])).toBe('skipped-top');
    expect(placeMistake(102, [2, 5], [20, 1])).toBe('upside-down');
    expect(placeMistake(25, [2, 5], [20, 1])).toBeNull();
  });
});

describe('days', () => {
  it('number and sign both step on; the number wraps at 13, the sign at 20', () => {
    expect(addDays([3, 'Akbal'], 1)).toEqual([4, 'Kan']);
    expect(addDays([13, 'Manik'], 1)).toEqual([1, 'Lamat']);
    expect(addDays([1, 'Imix'], 260)).toEqual([1, 'Imix']);
    expect(addDays([1, 'Ahau'], 1)).toEqual([2, 'Imix']);
  });

  it('says which half of a next-day answer is wrong', () => {
    expect(nextDayWrong([3, 'Akbal'], [4, 'Ik'])).toContain('after Akbal comes Kan');
    expect(nextDayWrong([3, 'Akbal'], [3, 'Kan'])).toContain('3 becomes 4');
    expect(nextDayWrong([13, 'Manik'], [14, 'Lamat'])).toContain('Numbers stop at 13');
  });
});

describe('syllables', () => {
  it('the last vowel is silent', () => {
    expect(readSpelling(['ba', 'la', 'ma'])).toBe('balam');
    expect(readSpelling(['ka', 'na'])).toBe('kan');
    expect(readSpelling(['o', 'ko'])).toBe('ok');
    expect(readSpelling(['o'])).toBe('o');
  });
});

describe('spaced review', () => {
  it('a miss comes back in the NEXT sitting, not the one it was missed in', () => {
    let s = startSitting(emptyCourse());
    s = recordAnswer(s, 'syllables', 'c3-ma', false, 'ba', 'ma');
    expect(reviewDue(s)).toEqual([]);
    s = startSitting(s);
    expect(reviewDue(s)).toEqual(['c3-ma']);
    expect(reviewIntro(s, reviewDue(s))).toBe('Last time you mixed up ba and ma. One quick one.');
    s = recordAnswer(s, 'syllables', 'c3-ma', true, 'ma', 'ma');
    expect(reviewDue(s)).toEqual([]);
  });

  it('opens with at most three, oldest first, and lists each pair once', () => {
    let s = startSitting(emptyCourse());
    s = recordAnswer(s, 'counting', 'c1-seven', false, '8', '7');
    s = startSitting(s);
    for (const id of ['c2-ik', 'c2-kan', 'c2-oc']) s = recordAnswer(s, 'days', id, false, 'Kan', 'Ik');
    s = startSitting(s);
    const due = reviewDue(s);
    expect(due).toHaveLength(3);
    expect(due[0]).toBe('c1-seven');
    expect(reviewIntro(s, due)).toBe('Last time you mixed up 8 and 7, and Kan and Ik. Three quick ones.');
  });

  it('survives a bad or old localStorage value', () => {
    expect(parseCourse('{"v":1,"seq":3}')).toEqual(emptyCourse());
    expect(parseCourse('not json')).toEqual(emptyCourse());
  });

  it('the next lesson is the first one not finished', () => {
    let s = emptyCourse();
    expect(nextLesson(s, OPEN_LESSONS)).toBe('counting');
    s = finishLesson(s, 'counting');
    expect(nextLesson(s, OPEN_LESSONS)).toBe('days');
  });
});

describe('the course content', () => {
  const open = LESSONS.filter((l) => OPEN_LESSONS.includes(l.id));

  it('opens lessons 1-3 and shows 4-6 as coming', () => {
    expect(open.map((l) => l.n)).toEqual([1, 2, 3]);
    expect(LESSONS.filter((l) => !l.open).map((l) => l.n)).toEqual([4, 5, 6]);
  });

  it('each lesson starts with a worked example, has 6-10 items and ends in the wild', () => {
    for (const l of open) {
      expect(isItem(l.steps[0])).toBe(false);
      const items = l.steps.filter(isItem);
      expect(items.length).toBeGreaterThanOrEqual(6);
      expect(items.length).toBeLessThanOrEqual(10);
      const last = l.steps[l.steps.length - 1];
      expect(isItem(last) && last.wild?.href).toMatch(/^\/book\//);
      expect(l.recap.length).toBeGreaterThan(0);
    }
  });

  it('every item has exactly one right option, and every option can be explained when wrong', () => {
    for (const { item } of COURSE_ITEMS.values()) {
      expect(item.why.length).toBeGreaterThan(0);
      if (item.kind === 'place') expect(item.options.filter((o) => o === placeValue(item.digits, item.places))).toHaveLength(1);
      if (item.kind === 'next') expect(item.options.filter((o) => addDays(item.from, 1).join() === o.join())).toHaveLength(1);
      if (item.kind === 'day') {
        for (const o of item.options) expect(DAY_FIG[typeof o === 'string' ? o : o[1]]).toBeDefined();
        expect(item.options.filter((o) => JSON.stringify(o) === JSON.stringify(item.answer))).toHaveLength(1);
      }
      if (item.kind === 'sign') expect(item.options).toContain(item.answer);
      if (item.kind === 'word') for (const o of item.options) expect(ENTRIES[o]).toBeDefined();
      if (item.kind === 'read') {
        const right = readSpelling(item.signs.map((k) => SYLLABLES[k].value));
        expect(item.options.filter((o) => o.text === right)).toHaveLength(1);
        for (const o of item.options) if (o.text !== right) expect(!!o.misread || !!o.rule).toBe(true);
        for (const o of item.options) if (o.misread) expect(readSpelling(item.signs.map((k, i) => SYLLABLES[i === o.misread!.index ? o.misread!.as : k].value))).toBe(o.text);
      }
      if (item.kind === 'tap') expect(item.zones[item.answer]).toBeDefined();
    }
  });
});
