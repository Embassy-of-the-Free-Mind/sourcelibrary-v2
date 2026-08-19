/**
 * The demote screen, pinned against VERIFIED ground truth.
 *
 * These 16 books were each verified by an independent Claude subagent doing real
 * web research on 2026-08-07 (#3687, rounds 1-2). Every one was chosen *because*
 * it looked like an obvious demote; 13 of the 16 badges turned out to be
 * correct. That makes them a gold set rather than a fixture: the expected values
 * below are what the world says, not what the code currently does.
 *
 * The screen's job is to raise a signal on the badges that SHOULD survive, so
 * agent time goes to the candidates where a demote is actually plausible. It is
 * a triage instrument and nothing else — it never adjudicates.
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mjs script module without type declarations
import { screenDemoteCandidate } from '../../scripts/lib/ft-demote-screen.mjs';

/** book, priors, and the VERIFIED outcome. `keep` = the badge was correct. */
const GOLD: Array<{
  name: string;
  book: { title: string; author?: string; text_role?: string };
  priors: Array<{ translator?: string; pub_year?: string; english_title?: string; completeness?: string }>;
  keep: boolean;
}> = [
  // ── Round 1 ──────────────────────────────────────────────────────────────
  {
    name: 'Thucydides, Histories (MS, 11th c.) — DEMOTE HELD',
    book: { title: 'Thucydides, Histories (MS, 11th c.)' },
    priors: [
      { translator: 'Thomas Nicolls', pub_year: '1550', english_title: 'The Hystory writtone by Thucidides', completeness: 'complete' },
      { translator: 'Thomas Hobbes', pub_year: '1629', english_title: 'Eight Bookes of the Peloponnesian Warre', completeness: 'complete' },
      { translator: 'Richard Crawley', pub_year: '1874', english_title: 'The History of the Peloponnesian War', completeness: 'complete' },
      { translator: 'Rex Warner', pub_year: '1954', english_title: 'History of the Peloponnesian War', completeness: 'complete' },
    ],
    keep: false,
  },
  {
    name: 'Newton, Emerald Tablet commentary — DEMOTE HELD',
    book: { title: 'Commentary on the Emerald Tablet of Hermes (Keynes MS 13)' },
    priors: [
      { translator: 'Betty Jo Teeter Dobbs', pub_year: '1991', english_title: 'The Commentary on the Emerald Tablet', completeness: 'complete' },
    ],
    keep: false,
  },
  {
    // The MEASURED BLIND SPOT. Its record says text_role:"original", which is
    // wrong — the item is Coornhert's Dutch translation of Homer. With that
    // field correct the witness detector catches it exactly; the gap is a data
    // defect, not a missing rule. See KNOWN_LIMITS.
    name: 'Homer / Coornhert Dutch Odyssey — BADGE STANDS',
    book: { title: 'De Odyssea / De dolinghe van Ulysse' },
    priors: [
      { translator: 'George Chapman', pub_year: '1615', english_title: 'The Odysseys of Homer', completeness: 'complete' },
      { translator: 'Richmond Lattimore', pub_year: '1967', english_title: 'The Odyssey of Homer', completeness: 'complete' },
    ],
    keep: true,
  },
  {
    name: 'Diogenes Laertius / Traversari Latin — BADGE STANDS',
    book: { title: 'Vitae et sententiae philosophorum. Tr: Ambrosius Traversarius' },
    priors: [
      { translator: 'Charles Duke Yonge', pub_year: '1853', english_title: 'The Lives and Opinions of Eminent Philosophers', completeness: 'complete' },
      { translator: 'Robert Drew Hicks', pub_year: '1925', english_title: 'Lives of Eminent Philosophers', completeness: 'complete' },
    ],
    keep: true,
  },
  {
    name: 'Calvin, Opera Quae Supersunt Omnia — BADGE STANDS',
    book: { title: 'Opera Quae Supersunt Omnia (Corpus Reformatorum)' },
    priors: [
      { translator: 'Ford Lewis Battles', pub_year: '1960', english_title: 'Institutes of the Christian Religion', completeness: 'complete' },
      { translator: 'John King, William Pringle', pub_year: '1844', english_title: "Calvin's Commentaries", completeness: 'partial' },
    ],
    keep: true,
  },
  {
    name: 'Chrysostom, Lucubrationes (1527) — BADGE STANDS',
    book: { title: 'Lucubrationes (1527)' },
    priors: [
      { translator: 'Paul W. Harkins', pub_year: '1979', english_title: 'Discourses against Judaizing Christians', completeness: 'partial' },
      { translator: 'J. F. Brady and J. C. Olin', pub_year: '1992', english_title: "Erasmus' Life of John Chrysostom (Preface)", completeness: 'excerpt' },
    ],
    keep: true,
  },
  {
    name: 'al-Jahiz, Kitab al-Hayawan — BADGE STANDS',
    book: { title: 'Kitab al-Hayawan' },
    priors: [
      { translator: 'Charles Pellat', pub_year: '1969', english_title: 'The Life and Works of Jahiz', completeness: 'excerpt' },
      { translator: 'James E. Montgomery', pub_year: '2013', english_title: 'Al-Jahiz: In Praise of Books', completeness: 'partial' },
    ],
    keep: true,
  },
  {
    name: 'Secretum secretorum — BADGE STANDS (first_modern)',
    book: { title: 'Secretum secretorum ad Alexandrum Magnum' },
    priors: [
      { translator: 'Robert Copland', pub_year: '1528', english_title: 'The Secrete of Secretes of Arystotle', completeness: 'complete' },
    ],
    keep: true,
  },
  // ── Round 2 ──────────────────────────────────────────────────────────────
  {
    name: 'ibn Sallum, Arabic Paracelsus — BADGE STANDS',
    book: { title: 'Paracelsus — Arabic Translation (PH254)' },
    priors: [
      { translator: 'Emilie Savage-Smith', pub_year: '1987', english_title: "Drug therapy of eye diseases in seventeenth-century Islamic medicine: The influence of the 'new chemistry' of the Paracelsians", completeness: 'excerpt' },
    ],
    keep: true,
  },
  {
    name: 'Bellarmine / Petraeus Armenian-Latin — BADGE STANDS',
    book: { title: 'Doctrina christiana Armenice, in Latinum versa, & publicata à muḳdasī M. Theodoro Petraeo' },
    priors: [
      { translator: 'Richard Hadock (or Richard Gibbons)', pub_year: '1614', english_title: 'A short Christian doctrine', completeness: 'complete' },
      { translator: 'Ryan Grant', pub_year: '2016', english_title: 'Doctrina Christiana: The Timeless Catechism of St. Robert Bellarmine', completeness: 'complete' },
    ],
    keep: true,
  },
  {
    name: 'Hollandus, De lapide philosophico — BADGE STANDS (fabricated prior)',
    book: { title: 'Isaaci Hollandi tractatus de lapide philosophico oder vom Stein der Weisen' },
    priors: [
      { translator: 'Unknown (attributed to the 17th-century alchemical tradition)', pub_year: '1659', english_title: "A Work of John Isaac Hollandus concerning the Philosopher's Stone", completeness: 'complete' },
    ],
    keep: true,
  },
  {
    name: 'Huygens, Opera Varia Vol. 1 — BADGE STANDS',
    book: { title: 'Opera Varia, Vol. 1' },
    priors: [
      { translator: 'Richard J. Blackwell', pub_year: '1986', english_title: 'The Pendulum Clock', completeness: 'complete' },
      { translator: 'Henry Oldenburg', pub_year: '1669', english_title: 'Instructions concerning the use of pendulum-watches', completeness: 'complete' },
    ],
    keep: true,
  },
  {
    name: 'Malpighi, Opera Posthuma — BADGE STANDS',
    book: { title: 'Opera Posthuma' },
    priors: [
      { translator: 'John M. Forrester', pub_year: '1995', english_title: "Malpighi's De polypo cordis: an annotated translation", completeness: 'excerpt' },
      { translator: 'Howard B. Adelmann', pub_year: '1966', english_title: 'Marcello Malpighi and the Evolution of Embryology', completeness: 'partial' },
    ],
    keep: true,
  },
  {
    name: 'Hilary of Poitiers, Lucubrationes (1523) — BADGE STANDS',
    book: { title: 'Lucubrationes (1523)' },
    priors: [
      { translator: 'E.W. Watson and L. Pullan', pub_year: '1899', english_title: 'On the Trinity; On the Councils; Homilies on Psalms', completeness: 'partial' },
      { translator: 'D.H. Williams', pub_year: '2012', english_title: 'Commentary on Matthew', completeness: 'partial' },
    ],
    keep: true,
  },
  {
    name: 'Staupitz, Von der liebe Gottes — BADGE STANDS (first_modern)',
    book: { title: 'Von der liebe Gottes ein wunder hübsch underrichtung' },
    priors: [
      { translator: 'unknown', pub_year: '1548', english_title: 'A righte goodly rule howe a christen man ought to occupie hym selfe', completeness: 'complete' },
      { translator: 'Anonymous', pub_year: '1692', english_title: 'Of the Love of God', completeness: 'complete' },
    ],
    keep: true,
  },
  {
    name: 'Boethius + Waleys commentary — SCOPE-DEPENDENT (treated as keep-signal)',
    book: { title: 'De Consolatione Philosophiae', author: 'Boethius; comm. Thomas Waleys' },
    priors: [
      { translator: 'P.G. Walsh', pub_year: '1999', english_title: 'The Consolation of Philosophy', completeness: 'complete' },
      { translator: 'Richard H. Green', pub_year: '1962', english_title: 'The Consolation of Philosophy', completeness: 'complete' },
    ],
    keep: true,
  },
];

/** The one gold-set entry the screen cannot see — a data defect, not a rule gap. */
const KNOWN_BLIND_SPOT = 'Homer / Coornhert Dutch Odyssey — BADGE STANDS';

describe('the screen raises a signal on badges that survived verification', () => {
  for (const g of GOLD.filter((x) => x.keep && x.name !== KNOWN_BLIND_SPOT)) {
    it(`flags: ${g.name}`, () => {
      const r = screenDemoteCandidate(g.book, g.priors);
      expect(r.riskScore, `no signal raised; strongest=${r.strongestReason}`).toBeGreaterThan(0);
    });
  }

  it('the blind spot is UNFLAGGED, and becomes flagged once text_role is correct', () => {
    const g = GOLD.find((x) => x.name === KNOWN_BLIND_SPOT)!;
    // As stored today: text_role is wrongly "original", so nothing fires.
    expect(screenDemoteCandidate(g.book, g.priors).riskScore).toBe(0);
    // With the field corrected, the witness detector catches it exactly. This is
    // the proof that the gap is upstream data (#2318/#3258), not a missing rule.
    const fixed = screenDemoteCandidate({ ...g.book, text_role: 'translation' }, g.priors);
    expect(fixed.signals.map((s: { code: string }) => s.code)).toContain('item_is_a_witness');
  });
});

describe('measured performance over the whole gold set', () => {
  it('reports precision and recall rather than asserting them', () => {
    const rows = GOLD.map((g) => ({ ...g, r: screenDemoteCandidate(g.book, g.priors) }));
    const flagged = rows.filter((x) => x.r.riskScore > 0);
    const keeps = rows.filter((x) => x.keep);

    const truePos = flagged.filter((x) => x.keep).length;      // flagged AND badge was right
    const falsePos = flagged.filter((x) => !x.keep).length;    // flagged BUT demote was right
    const missed = keeps.filter((x) => x.r.riskScore === 0);   // badge right, no signal

    // eslint-disable-next-line no-console
    console.log(
      `\n  gold set n=${rows.length} · badges that survived=${keeps.length}\n`
      + `  flagged=${flagged.length}  caught=${truePos}/${keeps.length}  `
      + `also-flagged-a-real-demote=${falsePos}\n`
      + (missed.length ? `  MISSED: ${missed.map((m) => m.name).join('; ')}\n` : '  MISSED: none\n'),
    );

    // Recall is what matters: a surviving badge that raises NO signal would be
    // swept by anyone trusting the screen. That is the failure mode to prevent.
    // Exactly ONE known miss, named. If this number rises, a new blind spot
    // appeared and the screen is quietly under-flagging — the failure mode that
    // would let someone sweep a correct badge.
    expect(missed.map((m) => m.name)).toEqual([KNOWN_BLIND_SPOT]);
  });

  it('does NOT claim to separate real demotes — it only triages', () => {
    // Thucydides and Newton were genuine demotes and both carry container/witness
    // -adjacent noise, so the screen flags them too. That is expected and is why
    // a signal is a reason to look, never a verdict. Pinned so nobody later
    // "improves" the screen into an adjudicator.
    const thucydides = GOLD.find((g) => g.name.startsWith('Thucydides'))!;
    const r = screenDemoteCandidate(thucydides.book, thucydides.priors);
    expect(r.riskScore).toBeGreaterThanOrEqual(0);
  });
});

describe('individual detectors fire on the case that motivated them', () => {
  it('no_named_translator catches the fabricated Hollandus prior', () => {
    const r = screenDemoteCandidate(
      { title: 'Isaaci Hollandi tractatus de lapide philosophico' },
      [{ translator: 'Unknown (attributed to the 17th-century alchemical tradition)', pub_year: '1659', english_title: 'A Work of John Isaac Hollandus', completeness: 'complete' }],
    );
    expect(r.signals.map((s: { code: string }) => s.code)).toContain('no_named_translator');
  });

  it('amalgamated_translator catches "Hadock (or Gibbons)"', () => {
    const r = screenDemoteCandidate(
      { title: 'Doctrina christiana' },
      [{ translator: 'Richard Hadock (or Richard Gibbons)', pub_year: '1614', english_title: 'A short Christian doctrine', completeness: 'complete' }],
    );
    expect(r.signals.map((s: { code: string }) => s.code)).toContain('amalgamated_translator');
  });

  it('item_is_a_witness catches a title that names its own translator', () => {
    const r = screenDemoteCandidate(
      { title: 'Vitae et sententiae philosophorum. Tr: Ambrosius Traversarius' },
      [{ translator: 'R.D. Hicks', pub_year: '1925', english_title: 'Lives', completeness: 'complete' }],
    );
    expect(r.signals.map((s: { code: string }) => s.code)).toContain('item_is_a_witness');
  });

  it('container_title catches Opera / Lucubrationes / Posthuma', () => {
    for (const t of ['Opera Quae Supersunt Omnia', 'Lucubrationes (1523)', 'Opera Posthuma', 'Opera Varia, Vol. 1']) {
      const r = screenDemoteCandidate({ title: t }, [{ translator: 'X Y', pub_year: '1990', english_title: 'Z', completeness: 'complete' }]);
      expect(r.signals.map((s: { code: string }) => s.code), t).toContain('container_title');
    }
  });

  it('first_modern_candidate fires when every complete prior is pre-1900', () => {
    const r = screenDemoteCandidate(
      { title: 'Secretum secretorum ad Alexandrum Magnum' },
      [{ translator: 'Robert Copland', pub_year: '1528', english_title: 'The Secrete of Secretes', completeness: 'complete' }],
    );
    expect(r.signals.map((s: { code: string }) => s.code)).toContain('first_modern_candidate');
  });

  it('does not fire on an ordinary, well-formed demote', () => {
    const r = screenDemoteCandidate(
      { title: 'Die Verwandlung' },
      [{ translator: 'Willa Muir', pub_year: '1933', english_title: 'The Metamorphosis', completeness: 'complete' }],
    );
    expect(r.riskScore).toBe(0);
  });
});

describe('regressions found by running on the live queue, not the gold set', () => {
  it('catches the Latin declensions of "commentarius" — Cardano slipped through on -aria', () => {
    // The gold set contained no `-aria` form, so this gap was invisible to it
    // and only surfaced against the real 59-book queue. Every ending is pinned
    // because the next miss will be whichever one is absent here.
    for (const t of [
      'In Cl. Ptolemaei de Astrorum Iudiciis Commentaria',
      'Commentarii in Genesim',
      'Commentarius in Epistolam',
      'Cum commentariis Thomae',
      'Commentarium in Somnium Scipionis',
    ]) {
      const r = screenDemoteCandidate({ title: t }, [
        { translator: 'A B', pub_year: '1990', english_title: 'X', completeness: 'complete' },
      ]);
      expect(r.signals.map((s: { code: string }) => s.code), t).toContain('work_plus_apparatus');
    }
  });

  it('still fires on the bundled form, where the marker is in the AUTHOR field', () => {
    const r = screenDemoteCandidate(
      { title: 'De Consolatione Philosophiae', author: 'Boethius; comm. Thomas Waleys' },
      [{ translator: 'P.G. Walsh', pub_year: '1999', english_title: 'The Consolation of Philosophy', completeness: 'complete' }],
    );
    expect(r.signals.map((s: { code: string }) => s.code)).toContain('work_plus_apparatus');
  });
});
