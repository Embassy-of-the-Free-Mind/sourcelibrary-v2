import { describe, it, expect } from 'vitest';
import {
  licenceAllowed, flattenVersion, cleanSegment, normHe, buildStream, buildIndex, locate, anchorAt, fitEnd,
  spanText, gramBag, containment, krakenLetters, fitClass, FIT_RULES,
} from '../../scripts/lib/sefaria-fit.mjs';

const VERSION = {
  title: 'Test', versionTitle: 'Test PD', license: 'Public Domain',
  schema: { nodes: [{ enTitle: 'Bereshit' }, { enTitle: 'Noach' }] },
  text: {
    Bereshit: ['וַיֹּאמֶר אֱלֹהִים יְהִי אוֹר, אָמַר רִבִּי יִצְחָק', 'רַבִּי שִׁמְעוֹן פָּתַח <b>מִי יְמַלֵּל</b> גְּבוּרוֹת ה\''],
    Noach: [['אֵלֶּה תּוֹלְדֹת נֹחַ נֹחַ אִישׁ צַדִּיק'], ['תָּמִים הָיָה בְּדֹרֹתָיו']],
  },
};

describe('sefaria-fit licence gate', () => {
  it('admits PD / CC0 / CC-BY only', () => {
    expect(licenceAllowed('Public Domain')).toBe(true);
    expect(licenceAllowed('CC-BY')).toBe(true);
    expect(licenceAllowed('CC0')).toBe(true);
    expect(licenceAllowed('CC-BY-NC')).toBe(false);
    expect(licenceAllowed('CC-BY-SA')).toBe(false);
    expect(licenceAllowed('unknown')).toBe(false);
    expect(licenceAllowed('')).toBe(false);
  });
});

describe('sefaria-fit flatten / normalise', () => {
  it('walks schema order and jagged arrays, with Sefaria-style refs', () => {
    const s = flattenVersion(VERSION);
    expect(s.map((x: { ref: string }) => x.ref)).toEqual(['Bereshit 1', 'Bereshit 2', 'Noach 1:1', 'Noach 2:1']);
  });
  it('strips markup for storage and pointing, finals and abbreviation marks for matching', () => {
    expect(cleanSegment('<b>מִי</b> יְמַלֵּל<br>x')).toBe('מִי יְמַלֵּל\nx');
    expect(normHe('וַיֹּאמֶר אֱלֹהִים')).toBe('ויאמר אלהימ');
    expect(normHe('ר"ש')).toBe(normHe('רש'));
    expect(normHe('בְּרֵאשִׁית־בָּרָא')).toBe('בראשית ברא');
  });
  it('an all-Latin input normalises to EMPTY (the caller must treat that as unjudgeable)', () => {
    expect(normHe('Zohar Hadash, Amsterdam 1701')).toBe('');
    expect(fitClass({ read_letters: 0, f1: 0, control: 0, best_shift: 0, by_shift: { 0: 0 } })).toBe('uninformative');
  });
});

describe('sefaria-fit stream, location and spans', () => {
  const st = buildStream(flattenVersion(VERSION));
  const ix = buildIndex(st.letters, 5);
  it('maps letters back to exact cleaned-segment text, extended to word boundaries', () => {
    const a = st.letters.indexOf('שמעונ');
    const b = st.letters.indexOf('גבורות') + 3; // mid-word
    expect(spanText(st, a + 1, b)).toBe('שִׁמְעוֹן פָּתַח מִי יְמַלֵּל גְּבוּרוֹת');
  });
  it('locates a query by k-gram voting (to within its slack bucket) and refuses a query with no grams in the text', () => {
    const q = normHe('רבי שמעון פתח מי ימלל').replace(/ /g, '');
    expect(Math.abs(locate(q, ix, { slack: 8 }).pos - st.letters.indexOf(q))).toBeLessThanOrEqual(8);
    expect(locate('ששששששששש', ix).pos).toBe(null);
  });
  it('semi-global fitEnd finds where a noisy tail ends', () => {
    const t = 'אבגדהוזחטיכלמנסעפצקרשת'.repeat(3);
    const q = 'כלמנסעפצ';
    const f = fitEnd(q, t);
    expect(f.end).toBe(t.indexOf(q) + q.length);
    expect(f.identity).toBe(1);
  });
  it('anchorAt refuses a too-short page instead of guessing', () => {
    expect(anchorAt('אבג', ix, st, { side: 'end' }).pos).toBe(null);
  });
});

describe('sefaria-fit verification', () => {
  it('containment is order-free (Kraken column order is not the edition\'s)', () => {
    const A = gramBag(krakenLetters('אבגדהוז\nחטיכלמנ'));
    const B = gramBag(krakenLetters('חטיכלמנ\nאבגדהוז'));
    expect(containment(A, B)).toBeGreaterThan(0.6);
    expect(containment(new Map(), B)).toBe(0);
  });
  it('writes only when shift 0 is best and clearly beats the wrong-page control', () => {
    const base = { read_letters: 4000, best_shift: 0 };
    expect(fitClass({ ...base, f1: 0.22, control: 0.09, by_shift: { 0: 0.22 } })).toBe('verified');
    expect(fitClass({ ...base, f1: 0.15, control: 0.10, by_shift: { 0: 0.15 } })).toBe('weak');
    expect(fitClass({ ...base, best_shift: 2, f1: 0.12, control: 0.2, by_shift: { 0: 0.12, 2: 0.2 } })).toBe('misaligned');
    expect(fitClass({ ...base, f1: 0.05, control: 0.04, by_shift: { 0: 0.05 } })).toBe('uninformative');
    expect(fitClass({ ...base, read_letters: FIT_RULES.minReadLetters - 1, f1: 0.5, control: 0, by_shift: { 0: 0.5 } })).toBe('uninformative');
  });
});
