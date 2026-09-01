/**
 * The triage that decides whether a broken book URL is FIXABLE, not just broken.
 *
 * Why this is worth pinning: the detector fires on `repairable` alone, and the
 * workflow keeps one open issue at a time (corpus-integrity-watch.yml). Widen
 * `repairable` by accident and the detector reports work nobody can do; narrow
 * it by accident and a genuinely broken URL ships silently. Both failures have
 * already happened once — #4389 shipped 111 bad URLs because nothing looked,
 * and #4521 left 7 fixable ones behind because the sweep asked only about the
 * title.
 *
 * The other invariant here is agreement: the repair sweep and the detector call
 * this same function, so a case that classifies `repairable` MUST be one the
 * sweep will actually write.
 */
import { describe, it, expect } from 'vitest';
import { classifySlugRepair, SLUG_REPAIR_HOLDBACK } from '@/lib/book-slug-repair';

describe('classifySlugRepair — repairable', () => {
  it('takes a Latin title', () => {
    const v = classifySlugRepair({
      id: 'a1', slug: 'untitled', title: 'گلستان سعدی', display_title: 'The Rose Garden',
      author: 'Saadi Shirazi',
    });
    expect(v.repairable).toBe(true);
    expect(v.slug).toBe('the-rose-garden-shirazi');
    expect(v.blockedBy).toBeNull();
  });

  it('takes a Latin-script AUTHOR under a non-Latin title — the #4521 seven', () => {
    // Each of these was live at a digit URL with the artist one field over.
    const cases: Array<[string, string, string]> = [
      ['-15', '葛飾北斎筆 鶏と木材鶏図', 'Katsushika Hokusai'],
      ['-9', '和漢百物語 貞信公', 'Yoshitoshi'],
      ['-14', '今様擬源氏　三十五　鳥山秋作照忠　一恵斎芳幾画', 'Utagawa Yoshiiku'],
      ['-16', '東海道名所之内 秋葉山', 'Kawanabe Kyōsai'],
      ['-22', 'Акимов Иван. Прометей делает статую', 'Ivan Akimov'],
      ['-23', '«Δύο ανδρικά κεφάλια», Ιερώνυμος Μπος', 'Hieronymus Bosch'],
    ];
    for (const [slug, title, author] of cases) {
      const v = classifySlugRepair({ id: `id-${slug}`, slug, title, author });
      expect(v.repairable, `${slug} (${author}) should be repairable`).toBe(true);
      expect(v.slug, `${slug} should get a readable segment`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('never returns a slug that is itself a placeholder', () => {
    // The sweep writes `v.slug` verbatim (after uniqueness reservation). If this
    // ever hands back a placeholder, the sweep hands the detector its own work.
    const v = classifySlugRepair({ id: 'a2', slug: '-9', title: '和漢百物語', author: 'Yoshitoshi' });
    expect(v.slug).toBe('yoshitoshi');
  });
});

describe('classifySlugRepair — blocked, and therefore NOT a finding', () => {
  it('reports a CJK record with a CJK author as needing an English title', () => {
    const v = classifySlugRepair({
      id: 'b1', slug: 'untitled-3', title: '大乘百法明門論疏', display_title: null, author: '義忠',
    });
    expect(v.repairable).toBe(false);
    expect(v.slug).toBeNull();
    expect(v.blockedBy).toBe('needs-english-title');
    expect(v.reason).toContain('#4390');
  });

  it('refuses to append a generic author to a slug that already matches its title', () => {
    // /book/216 → /book/216-anonymous: a changed public URL, no new information.
    for (const n of ['216', '217', '218']) {
      const v = classifySlugRepair({ id: `b-${n}`, slug: n, title: n, author: 'Anonymous' });
      expect(v.repairable, `/book/${n} should not be renamed`).toBe(false);
      expect(v.blockedBy).toBe('no-gain');
    }
  });

  it('honours the editorial holdback', () => {
    const [held] = [...SLUG_REPAIR_HOLDBACK];
    const v = classifySlugRepair({
      id: held, slug: '306-5741', title: '​漢宮春曉, 卷, 絹本設色, 纵30.6厘米 横574.1厘米', author: 'Qiu Ying',
    });
    expect(v.repairable).toBe(false);
    expect(v.blockedBy).toBe('held-back');
    // Without the holdback the same record WOULD be repairable — which is
    // exactly why the list has to live beside the classifier rather than in the
    // sweep, or the detector would report it as actionable work forever.
    const unheld = classifySlugRepair({
      id: 'not-held', slug: '306-5741', title: '​漢宮春曉, 卷, 絹本設色, 纵30.6厘米 横574.1厘米', author: 'Qiu Ying',
    });
    expect(unheld.repairable).toBe(true);
  });

  it('a stand-in author under a non-Latin title is not a named author', () => {
    const v = classifySlugRepair({
      id: 'b2', slug: 'untitled-18', title: '坐禪用心記', author: '未詳 (Unknown)',
    });
    expect(v.repairable).toBe(false);
    expect(v.blockedBy).toBe('needs-english-title');
  });
});

describe('classifySlugRepair — a good slug is not a blocker', () => {
  it('says nothing to do, with no blocker, for a readable slug', () => {
    const v = classifySlugRepair({
      id: 'c1', slug: 'atalanta-fugiens-maier', title: 'Atalanta Fugiens', author: 'Michael Maier',
    });
    expect(v.repairable).toBe(false);
    expect(v.blockedBy).toBeNull();
  });

  it('treats a missing slug as repairable when there is a title to use', () => {
    // /book/<objectid> is ugly rather than broken, but any readable segment
    // beats it, and there is no old URL to preserve.
    const v = classifySlugRepair({
      id: 'c2', slug: null, title: 'Atalanta Fugiens', author: 'Michael Maier',
    });
    expect(v.repairable).toBe(true);
    expect(v.slug).toBe('atalanta-fugiens-maier');
  });
});
