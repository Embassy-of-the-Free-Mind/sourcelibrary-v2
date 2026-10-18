import { describe, it, expect } from 'vitest';
import {
  COURSE,
  MAX_EXERCISES,
  MIN_EXERCISES,
  allLessons,
  buildLesson,
  buildReview,
  completeLesson,
  emptyProgress,
  explain,
  grade,
  isGraded,
  isUnlocked,
  itemOf,
  modernForm,
  parseProgress,
  recordItem,
  reviewQueue,
  rightAnswer,
  sentenceById,
  streak,
  validateAttempt,
  validateProposal,
  wordById,
  type Exercise,
} from '@/lib/learn-yucatec';

/**
 * /learn/yucatec (#6921). These run on the real course file, as built and
 * checked against the page text by scripts/learn/build-yucatec-course.mjs,
 * so a rebuild that breaks a lesson fails here.
 */

describe('the course file', () => {
  it('every sentence and word carries a page link and an image check', () => {
    for (const s of COURSE.sentences) {
      expect(s.url).toMatch(/^\/book\/[a-f0-9]{24}\?page=\d+$/);
      expect(s.checked).toBeTruthy();
    }
    for (const w of COURSE.words) {
      expect(w.attest.url).toMatch(/\?page=\d+$/);
      expect(w.attest.checked).toBeTruthy();
      expect(w.dict.url).toMatch(/\?page=\d+$/);
      expect(w.dict.es.length).toBeGreaterThan(3);
      expect(w.dict.en.length).toBeGreaterThan(3);
    }
  });

  it('no modern form is set at build: the field exists and is empty until a speaker confirms one', () => {
    for (const w of COURSE.words) expect(w.modern).toBeNull();
  });

  it('units 1–3, 4–6 lessons each, every grammar note quoting a page', () => {
    expect(COURSE.units.map((u) => u.n)).toEqual([1, 2, 3]);
    for (const u of COURSE.units) {
      expect(u.lessons.length).toBeGreaterThanOrEqual(4);
      expect(u.lessons.length).toBeLessThanOrEqual(6);
      const note = COURSE.notes.find((n) => n.id === u.note)!;
      expect(note.quotes.length).toBeGreaterThan(0);
      for (const q of note.quotes) expect(q.url).toMatch(/\?page=\d+$/);
    }
  });
});

describe('buildLesson', () => {
  it('every lesson has 8–12 graded exercises and is the same each time', () => {
    for (const l of allLessons()) {
      const ex = buildLesson(l.id);
      const n = ex.filter(isGraded).length;
      expect(n, l.id).toBeGreaterThanOrEqual(MIN_EXERCISES);
      expect(n, l.id).toBeLessThanOrEqual(MAX_EXERCISES);
      expect(buildLesson(l.id)).toEqual(ex);
    }
  });

  it('teaches each new word on a card before asking it', () => {
    for (const l of allLessons()) {
      const ex = buildLesson(l.id);
      for (const w of l.new) {
        const teach = ex.findIndex((e) => e.kind === 'teach' && e.word === w);
        const ask = ex.findIndex((e) => (e.kind === 'pick' || e.kind === 'pick-form') && e.word === w);
        expect(teach, `${l.id} ${w}`).toBeGreaterThanOrEqual(0);
        if (ask >= 0) expect(teach).toBeLessThan(ask);
      }
    }
  });

  it('choices are four distinct options including the answer, none sharing its gloss', () => {
    for (const l of allLessons()) {
      for (const e of buildLesson(l.id)) {
        if (e.kind === 'pick' || e.kind === 'pick-form') {
          expect(new Set(e.options).size, e.id).toBe(e.options.length);
          expect(e.options).toContain(e.word);
          const glosses = e.options.map((o) => wordById(o)!.short);
          expect(new Set(glosses).size, e.id).toBe(glosses.length);
        }
        if (e.kind === 'read') {
          expect(e.options).toContain(e.sentence);
          expect(e.options.length).toBe(4);
        }
      }
    }
  });

  it('a build exercise never starts in the right order, and its tiles are the sentence\'s own words', () => {
    for (const l of allLessons()) {
      for (const e of buildLesson(l.id)) {
        if (e.kind !== 'build') continue;
        const s = sentenceById(e.sentence)!;
        expect(e.tiles.join(' ')).not.toBe(s.tiles!.join(' '));
        expect([...e.tiles].sort()).toEqual([...s.tiles!].sort());
        expect(s.show).toContain(s.tiles!.join(' '));
      }
    }
  });

  it('a pronoun blank offers the other two pronouns', () => {
    const e = buildLesson('yl-1-5').find((x) => x.kind === 'fill' && x.sentence === 'ys-talez') as Extract<Exercise, { kind: 'fill' }>;
    expect(e.options.map((o) => o.text).sort()).toEqual(['a', 'in', 'u']);
    expect(e.blank).toBe('in');
  });
});

describe('fill blanks', () => {
  it('never offer a suffix where a whole word goes', () => {
    for (const l of allLessons()) {
      for (const e of buildLesson(l.id)) {
        if (e.kind === 'fill' && !sentenceById(e.sentence)!.fill_text) for (const o of e.options) expect(o.text.startsWith('-'), e.id).toBe(false);
      }
    }
  });
});

describe('grading and explanations', () => {
  const lesson = buildLesson('yl-1-1');
  const pick = lesson.find((e) => e.kind === 'pick' && e.word === 'yw-bix') as Extract<Exercise, { kind: 'pick' }>;

  it('a wrong pick explains what was chosen, with its dictionary entry, next to the right one', () => {
    const wrong = pick.options.find((o) => o !== 'yw-bix')!;
    expect(grade(pick, wrong)).toBe(false);
    const x = explain(pick, wrong)!;
    expect(x.chosen!.label).toBe(wordById(wrong)!.form);
    expect(x.chosen!.quote!.url).toMatch(/\?page=\d+$/);
    expect(x.right.means).toBe('how');
    expect(x.right.quote!.es).toContain('BIX: como');
  });

  it('a wrong tile order explains itself with the rule and its page', () => {
    const b = lesson.find((e) => e.kind === 'build') as Extract<Exercise, { kind: 'build' }>;
    expect(grade(b, rightAnswer(b))).toBe(true);
    expect(grade(b, 'a bix bel')).toBe(false);
    const x = explain(b, 'a bix bel')!;
    expect(x.right.label).toBe('bix a bel');
    expect(x.rule!.quoteRef!.url).toMatch(/\?page=\d+$/);
  });

  it('a wrong reading shows which line the chosen translation belongs to', () => {
    const r = buildLesson('yl-1-2').find((e) => e.kind === 'read') as Extract<Exercise, { kind: 'read' }>;
    const wrong = r.options.find((o) => o !== r.sentence)!;
    const x = explain(r, wrong)!;
    expect(x.chosen!.sentence!.id).toBe(wrong);
    expect(x.chosen!.sentence!.url).toMatch(/\?page=\d+$/);
  });

  it('the -tul blank explains the counting rule from Tozzer', () => {
    const f = buildLesson('yl-2-4').find((e) => e.kind === 'fill' && e.sentence === 'ys-oxtul') as Extract<Exercise, { kind: 'fill' }>;
    expect(f).toBeTruthy();
    const x = explain(f, 'oxpel')!;
    expect(x.chosen!.means).toContain('things');
    expect(x.rule!.quoteRef!.cite).toContain('Tozzer');
  });

  it('attempts count against the word asked or the sentence', () => {
    expect(itemOf(pick)).toBe('yw-bix');
    const f = buildLesson('yl-1-2').find((e) => e.kind === 'fill')!;
    expect(itemOf(f)).toBe('yw-in');
  });
});

describe('progress', () => {
  it('a missed word joins the review queue and comes back inside a real sentence', () => {
    let p = recordItem(emptyProgress(), 'yw-in', false);
    expect(reviewQueue(p)).toEqual(['yw-in']);
    const r = buildReview(p);
    expect(r[0].kind).toBe('fill');
    p = recordItem(recordItem(recordItem(p, 'yw-in', true), 'yw-in', true), 'yw-in', true);
    expect(reviewQueue(p)).toEqual([]);
  });

  it('streak counts days in a row, ending today or yesterday', () => {
    expect(streak(['2026-10-16', '2026-10-17', '2026-10-18'], '2026-10-18')).toBe(3);
    expect(streak(['2026-10-16', '2026-10-17'], '2026-10-18')).toBe(2);
    expect(streak(['2026-10-15', '2026-10-17'], '2026-10-18')).toBe(1);
    expect(streak(['2026-10-15'], '2026-10-18')).toBe(0);
    expect(streak(['2026-02-28', '2026-03-01'], '2026-03-01')).toBe(2);
  });

  it('lessons open in order', () => {
    let p = emptyProgress();
    expect(isUnlocked(p, 'yl-1-1')).toBe(true);
    expect(isUnlocked(p, 'yl-1-2')).toBe(false);
    p = completeLesson(p, 'yl-1-1', '2026-10-18');
    expect(isUnlocked(p, 'yl-1-2')).toBe(true);
    expect(p.days).toEqual(['2026-10-18']);
  });

  it('bad stored progress starts fresh', () => {
    expect(parseProgress('{"v":2}')).toEqual(emptyProgress());
    expect(parseProgress('not json')).toEqual(emptyProgress());
  });
});

describe('modern forms and validation', () => {
  it('a modern form shows only once confirmed', () => {
    const w = { ...wordById('yw-bix')!, modern: { form: 'bix', confirmed_by: null, date: null } };
    expect(modernForm(w)).toBeNull();
    expect(modernForm({ ...w, modern: { form: 'bix', confirmed_by: 'speaker-1', date: '2026-10-18' } })).toBe('bix');
  });

  it('attempts must name a course item', () => {
    expect(validateAttempt({ item_id: 'yw-bix', answer: 'how', correct: true, exercise: 'pick' })).toBeNull();
    expect(validateAttempt({ item_id: 'yw-nope', answer: 'x', correct: true })).toBe('bad item_id');
    expect(validateAttempt({ kind: 'lesson', lesson_id: 'yl-1-1' })).toBeNull();
    expect(validateAttempt({ kind: 'lesson', lesson_id: 'yl-9-9' })).toBe('bad lesson_id');
  });

  it('proposals need a known word and a short form', () => {
    expect(validateProposal({ word_id: 'yw-bix', form: 'bix' })).toBeNull();
    expect(validateProposal({ word_id: 'yw-bix', form: '' })).toMatch(/form/);
    expect(validateProposal({ word_id: 'zz', form: 'x' })).toBe('bad word_id');
  });
});
