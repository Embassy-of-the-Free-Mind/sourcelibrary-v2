import { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import PageEditMode from '@/components/PageEditMode';
import { ENGLISH, HATCH, Figure, Step, Swatch, ImprovementChart } from '../canon-gap/diagrams';
import { IMPROVEMENTS } from '../canon-gap/improvements';
import { getDb } from '@/lib/mongodb';
import { READER_UI_STRINGS } from '@/lib/reader-strings';
import { TENGYUR_QUALITY, namedKinds } from '@/lib/tengyur-quality';
import tengyurCounts from '../../../../scripts/eval/results/tengyur-characterize-5829/counts.json';

// Built for the Eternity Foundation working session (#5513, #5864): how each core canon's text and
// English are checked, and where a scholar's time would go. No new numbers: every figure is copied
// from a merged experiment file or results file (pinned to the commit it was read at) or from the
// issue comment that reports it, and each one carries its link. Re-measure in those files, not here.
// The Tengyur section table (#6120) reads src/data/tengyur-section-quality.json, which is generated from
// those results files. The one live figure is the count of reader corrections, so the page revalidates
// hourly; a failed count throws and ISR keeps the last good page (rendering-and-seo.md).
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'How We Check Each Canon — Source Library Research',
  description:
    'For each canon in the Eternity reading programme: what checks our transcription, what checks our English, the measured figures with their sources, what is not yet measured, and what we would ask of a scholar.',
  alternates: { canonical: '/research/canon-quality' },
  robots: { index: false, follow: true },
};

const ISSUE = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/';
const BLOB = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/d86acc119ac343806e4cf3ca4bb52191977f23e8/';
const EXP = `${BLOB}scripts/eval/experiments/`;

// The write-ups every figure on this page is copied from.
const SRC = {
  tengyurStored: `${EXP}2026-10-04-tengyur-stored-draft-vs-84000-5797.md`,
  tengyurAB: `${EXP}2026-10-03-tengyur-84000-reference-ab-5497.md`,
  tengyurRandom: `${EXP}2026-10-04-tengyur-characterize-random-sample-5829.md`,
  t5: `${EXP}2026-10-03-xlref-t5-sanskrit-pali-chinese-vs-reference.md`,
  t4: `${EXP}2026-10-03-translation-vs-reference-t4-hebrew-arabic-persian-5695.md`,
  synthesis: `${EXP}2026-10-04-translation-vs-reference-synthesis-5695.md`,
  persian: `${EXP}2026-10-01-persian-ocr-vs-ganjoor-5525.md`,
  sefaria: `${EXP}2026-10-02-can-open-sefaria-text-be-fitted-to-ocr-failed-pages-5560.md`,
  kangyurOcr: `${EXP}2026-10-01-kangyur-ocr-accuracy-confirmatory-redraw-4523.md`,
  ceilingText: `${EXP}2026-10-04-human-ceiling-transcription-5762.md`,
  ceilingEnglish: `${EXP}2026-10-04-human-ceiling-translation-5762.md`,
  readiness: `${BLOB}scripts/eval/results/nalanda-readiness-2026-09-30.json`,
  status: `${BLOB}scripts/catalog-coverage/results/canon-gap-status-2026-10.json`,
  review: `${BLOB}.claude/docs/community-quality-review-design.md`,
  kangyurRun: `${ISSUE}5665#issuecomment-5975702834`,
  kangyurEye: `${ISSUE}5665#issuecomment-5975802250`,
  chineseOcr: `${ISSUE}4743`,
  scholar: `${ISSUE}5800`,
  tengyurResidue: `${BLOB}scripts/eval/results/tengyur-check-2026-10/README.md`,
  release: `${ISSUE}6120`,
};

function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-amber-800 underline decoration-amber-800/30 underline-offset-2 hover:decoration-amber-800">
      {children}
    </a>
  );
}

/** The link after a figure. */
const S = ({ href }: { href: string }) => (
  <>
    {' '}
    <a href={href} className="text-xs text-amber-800 underline underline-offset-2 whitespace-nowrap">
      source
    </a>
  </>
);

/* ---------- The canons ---------- */

type Cell = { state: 'typed' | 'sampled' | 'none'; label: string };

type Canon = {
  id: string;
  name: string;
  /** what the Figure 1 left column names */
  textRef: string;
  englishRef: string;
  /** the evidence strip (Figure 2) */
  reading: Cell;
  english: Cell;
  scholar: Cell;
  /** where an hour of scholar time does the most good */
  priority?: boolean;
  card: {
    text: ReactNode;
    english: ReactNode;
    failure: ReactNode;
    shown: ReactNode;
    notMeasured: ReactNode;
  };
};

const NO_SCHOLAR: Cell = { state: 'none', label: 'none yet' };

const CANONS: Canon[] = [
  {
    id: 'derge-tengyur',
    name: 'Derge Tengyur',
    textRef: 'Esukhia’s typed Derge e-text',
    englishRef: '84000 (8 texts)',
    reading: { state: 'typed', label: 'typed by people' },
    english: { state: 'sampled', label: '354 sides' },
    scholar: { state: 'none', label: 'planned, #5800' },
    priority: true,
    card: {
      text: (
        <>
          Not read by a model. Each page carries <A href="https://github.com/Esukhia/derge-tengyur">Esukhia&rsquo;s</A>{' '}
          public-domain typed text, aligned folio by folio to BDRC&rsquo;s scans: 128,369 of 128,639 pages, verified on
          sampled reads (status file, 3 October 2026).
          <S href={SRC.status} />
        </>
      ),
      english: (
        <>
          Against 84000&rsquo;s published translations of the same folio sides, the English stored on the pages has a
          reversed statement on 6.2 pages per 100 by either of two blind Claude Opus judges (95% CI 4.1–9.2), and 3.4
          by both (1.9–5.8); 99.2% of sides score 4 or more out of 5 (n = 354 sides, 4 October 2026). This replaces the
          first test&rsquo;s 4.4 per 100 on 113 sides; the larger sample is newer.
          <S href={SRC.tengyurStored} /> The 354 sides come from the 8 texts 84000 has published that we could align,
          none of them Madhyamaka or Pramāṇa.
          <span className="block mt-2">
            On 150 pages drawn at random from all 116,703 drafted pages, two blind Claude Opus reviewers reading the
            Tibetan rated 75% of pages as needing only light edits [69–82], and found a reversed statement or a wrong
            speaker, agent or referent on 38 pages per 100 [23–50], after adjusting for the share of their findings
            that held up when checked by eye (4 October 2026).
            <S href={SRC.tengyurRandom} />
          </span>
        </>
      ),
      failure: (
        <>
          Whose view is being stated: an opponent&rsquo;s objection given as the author&rsquo;s, a speaker or agent
          swapped. Pramāṇa (logic) is the weakest section, 40% of its pages light, and verse is worse than prose.
          The Vinaya uses Pali names for its offence classes on 11% of its pages.
          <S href={SRC.tengyurRandom} />
        </>
      ),
      shown: (
        <>All 213 volumes have been public since 7 October 2026. Every page is labelled an AI translation not yet reviewed by a scholar.</>
      ),
      notMeasured: (
        <>
          The English of any Madhyamaka or Pramāṇa text against a human translation: none exists to compare with. No
          person who reads Tibetan has reviewed our pages yet.
        </>
      ),
    },
  },
  {
    id: 'derge-kangyur',
    name: 'Derge Kangyur',
    textRef: 'Esukhia’s typed Derge e-text',
    englishRef: 'none for the texts we drafted',
    reading: { state: 'typed', label: 'typed by people' },
    english: { state: 'none', label: '6 pages, by Claude' },
    scholar: NO_SCHOLAR,
    priority: true,
    card: {
      text: (
        <>
          Not read by a model. Esukhia&rsquo;s public-domain typed text, aligned folio by folio to BDRC&rsquo;s scans
          of the Library of Congress copy: 62,375 pages carry aligned text (4 October 2026). The status file of 3
          October counts 38,188; the later count is after a repair run.
          <S href={SRC.kangyurRun} />
          <span className="block mt-2">
            A different edition, the Bhutanese manuscript Kangyur we also hold, is read by BDRC&rsquo;s Yigdzin model.
            Against the Derge e-text its reading matches a median 94.7% of syllables (n = 100 pages, 1 October 2026),
            repeating an earlier draw of 65 pages at 95.0%.
            <S href={SRC.kangyurOcr} />
          </span>
        </>
      ),
      english: (
        <>
          We drafted English only for the 40 texts 84000 lists as Not Begun (1,835 pages), so by design no published
          translation exists to judge it against. Claude read six pages beside the Tibetan and scored them 4, 4, 4, 3,
          3, 3 out of 5 (4 October 2026).
          <S href={SRC.kangyurEye} />
        </>
      ),
      failure: (
        <>
          Ritual terms read in their everyday sense, altered mantra syllables, and invented proper names. No invented
          passages, dropped lines or wrong-page text on the six pages.
          <S href={SRC.kangyurEye} />
        </>
      ),
      shown: (
        <>
          All volumes are held from public view. For the Bhutanese manuscript Kangyur, the English was taken down when
          an earlier reading model was found writing text that is not on the page.{' '}
          <A href={`${ISSUE}4523`}>#4523</A>
        </>
      ),
      notMeasured: <>Any judged rate for the Kangyur English. Six pages is a reading, not a measurement.</>,
    },
  },
  {
    id: 'chinese',
    name: 'Chinese canon (CBETA, with Chan)',
    textRef: 'CBETA’s typed Taishō text',
    englishRef: 'Legge, Giles, Gemmell and others',
    reading: { state: 'sampled', label: 'Chan books typed' },
    english: { state: 'sampled', label: '22 pages' },
    scholar: NO_SCHOLAR,
    priority: true,
    card: {
      text: (
        <>
          For the Chan records (景德傳燈錄, 祖堂集, 五燈會元 and the 語錄), CBETA&rsquo;s typed text is fitted to our
          scans: 74 of 79 books are public with it (status file, 3 October 2026).
          <S href={SRC.status} /> Elsewhere a model reads the page. Two independent typings of the Taishō (CBETA and
          SAT) differ on 2.87% of characters, almost all of it glyph convention (為/爲); with the recurring pairs folded
          they differ on 0.28%. So any Chinese error rate we quote against a reference in another convention carries
          about 2.6 points of convention (4 October 2026).
          <S href={SRC.ceilingText} />
        </>
      ),
      english: (
        <>
          On 22 Chinese pages judged against published translations (Legge, Giles, Gemmell and others), the
          English scores 3.75 out of 5 [3.43–4.07]; 64% of pages score 4 or more [43–80], and 18 pages per 100 have a
          reversed statement [7–39]. Two blind Claude Opus judges, 3–4 October 2026. The pages are printed editions of
          well-known Buddhist and Confucian works, not the CBETA-fitted Chan books.
          <S href={SRC.synthesis} />
        </>
      ),
      failure: (
        <>
          A literal crib: it keeps the terms but reads less well than the published translations. Where the reading
          fails, it is woodblock with interlinear commentary, where small-print notes spill into the text (眴 read as
          眸).
          <S href={SRC.t5} />
        </>
      ),
      shown: (
        <>
          No canon-specific warning. Since 4 October 2026 new Chinese translations use Gemini Flash in place of
          Flash-Lite, which cut reversed statements in this sample; pages already served are not yet retranslated.
          <S href={SRC.synthesis} />
        </>
      ),
      notMeasured: (
        <>
          The English of the CBETA-fitted Chan books; Chinese woodblock from 1500 to 1799, which holds 64,793 of our
          134,665 translated Chinese pages but only 9 pages of the sample; and the accuracy of our own Chinese reading
          on CBETA pages.<S href={SRC.t5} />{' '}
          <A href={SRC.chineseOcr}>#4743</A>
        </>
      ),
    },
  },
  {
    id: 'pali',
    name: 'Pali canon',
    textRef: 'GRETIL Pali (VRI text next)',
    englishRef: 'SuttaCentral (Sujato, Brahmali)',
    reading: { state: 'sampled', label: '12 pages' },
    english: { state: 'sampled', label: '15 pages' },
    scholar: NO_SCHOLAR,
    card: {
      text: (
        <>
          A model reads our scans. Against GRETIL&rsquo;s typed text of the same work, our reading matches a median 95%
          of characters (n = 12 full pages, 30 September 2026).
          <S href={SRC.readiness} /> Fitting the Vipassana Research Institute&rsquo;s typed Chaṭṭha Saṅgāyana text to
          our scans, in place of the model&rsquo;s reading, is the next step. <A href={`${ISSUE}5668`}>#5668</A>
        </>
      ),
      english: (
        <>
          On 15 pages judged against SuttaCentral&rsquo;s translations (Sujato, Brahmali; CC0), the English scores 3.67
          out of 5 [3.23–4.07]; 60% of pages score 4 or more [36–80], and 13 per 100 have a reversed statement [4–38].
          Two blind Claude Opus judges, 3–4 October 2026.
          <S href={SRC.synthesis} />
        </>
      ),
      failure: (
        <>
          Text from the neighbouring page carried into the English (30% of pages), and Sinhala-script Pali in an old
          typeface whose ligatures are misread the same way every time.
          <S href={SRC.t5} />
        </>
      ),
      shown: <>No canon-specific warning or withdrawal.</>,
      notMeasured: <>The commentaries and sub-commentaries: the sample is root texts with a SuttaCentral translation.</>,
    },
  },
  {
    id: 'sanskrit',
    name: 'Sanskrit (GRETIL)',
    textRef: 'GRETIL (for checking only)',
    englishRef: 'Thibaut, Bühler, Colebrooke and others',
    reading: { state: 'sampled', label: '38 pages' },
    english: { state: 'sampled', label: '27 pages' },
    scholar: NO_SCHOLAR,
    card: {
      text: (
        <>
          A model reads our scans; GRETIL&rsquo;s files are &ldquo;for reference purposes only&rdquo;, so we check
          against them and do not publish them. Our reading matches GRETIL on a median 89.1% of characters (n = 38 full
          pages of public books, 30 September 2026).
          <S href={SRC.readiness} />
        </>
      ),
      english: (
        <>
          On 27 pages judged against public-domain translations (Thibaut, Bühler, Colebrooke and others), the English
          scores 3.50 out of 5 [3.19–3.80]; 52% of pages score 4 or more [34–69], and 11 per 100 have a reversed
          statement [4–28]. Two blind Claude Opus judges, 3–4 October 2026. An earlier check of 18 pages scored higher
          (mean 4.06)<S href={SRC.readiness} />; this one is newer and larger.
          <S href={SRC.synthesis} />
        </>
      ),
      failure: (
        <>
          Omission. On pages with root verses and printed commentary, the English keeps the verses and condenses or
          drops the commentary: 70% of pages omit something.
          <S href={SRC.synthesis} />
        </>
      ),
      shown: <>No canon-specific warning or withdrawal.</>,
      notMeasured: <>Manuscripts, which are few in the sample; the reading failed worst on a 1492 Gītā manuscript.</>,
    },
  },
  {
    id: 'kabbalah',
    name: 'Kabbalah (Zohar, Lurianic, Cordovero)',
    textRef: 'Sefaria (43 pages fitted)',
    englishRef: 'published translations',
    reading: { state: 'none', label: 'not measured' },
    english: { state: 'sampled', label: '15 pages' },
    scholar: NO_SCHOLAR,
    card: {
      text: (
        <>
          A model reads our scans. Where it failed, Sefaria&rsquo;s typed text could be fitted to the page and verified
          on 43 of 808 pages (Zohar Chadash, Pardes Rimmonim). Sefaria marks the licence of every version of the Zohar
          itself &ldquo;unknown&rdquo;, so none of it was fitted to our Zohar manuscript (2 October 2026).
          <S href={SRC.sefaria} />
        </>
      ),
      english: (
        <>
          On 15 Hebrew pages judged against published translations, the English scores 3.80 out of 5 [3.43–4.13]; 73%
          of pages score 4 or more [48–89], and 13 per 100 have a reversed statement [4–38]. Two blind Claude Opus
          judges, 3–4 October 2026.
          <S href={SRC.synthesis} /> Across the Hebrew, Arabic and Persian sample, the 12 pages of Kabbalah and
          mysticism scored 3.04, against 4.00 for scripture, liturgy and law.
          <S href={SRC.t4} />
        </>
      ),
      failure: (
        <>
          The reading, not the translation. On low-scoring Hebrew, Arabic and Persian pages 14 of 23 failed because the
          page was misread; Rashi-type Hebrew had 45–60 wrong words per 100. One faded Zohar manuscript&rsquo;s
          transcription was largely composed by the model rather than read.
          <S href={SRC.t4} />
        </>
      ),
      shown: <>No canon-specific warning or withdrawal.</>,
      notMeasured: (
        <>
          The accuracy of our Hebrew reading on Kabbalah pages: the Sefaria fit located text on the page, it did not
          score our reading. Commentary-heavy layouts could not be matched to any translation.
        </>
      ),
    },
  },
  {
    id: 'persian-arabic',
    name: 'Persian and Arabic Sufi texts',
    textRef: 'Ganjoor (Persian poetry)',
    englishRef: 'published translations (e.g. Nicholson)',
    reading: { state: 'sampled', label: '9 pages' },
    english: { state: 'sampled', label: '32 pages' },
    scholar: NO_SCHOLAR,
    card: {
      text: (
        <>
          A model reads our scans. On Persian manuscripts of classical poetry located in Ganjoor&rsquo;s typed text, the
          reading matches a median 41% of characters in order and 74% line by line (n = 9 pages, 1 October 2026), against
          a 90% bar for translating. Printed Persian reads well.
          <S href={SRC.persian} /> No Arabic page has a reference text for measuring the reading yet.
          <S href="/research/quality#s3" />
        </>
      ),
      english: (
        <>
          Judged against published translations: Arabic 3.50 out of 5 [3.05–3.93] on 20 pages, 50% scoring 4 or more
          [30–70], 15 reversed statements per 100 [5–36]; Persian 2.96 [2.46–3.42] on 12 pages, 17% at 4 or more [5–45],
          33 reversals per 100 [14–61]. Two blind Claude Opus judges, 3–4 October 2026. The pages were drawn from Arabic
          and Persian books in general, not Sufi texts alone.
          <S href={SRC.synthesis} />
        </>
      ),
      failure: (
        <>
          The reading. Manuscripts lose words and couplet order, and four of 21 manuscript pages were degenerate output.
          A fluent sentence built on a misread word is the worst case: Hariri&rsquo;s &ldquo;my losing bargain&rdquo;
          served as &ldquo;the best of my deal&rdquo;.
          <S href={SRC.persian} />
          <S href={SRC.synthesis} />
        </>
      ),
      shown: (
        <>
          Persian manuscripts are not translated until a reading matches 90% of a typed text.
          <S href={SRC.persian} />
        </>
      ),
      notMeasured: <>Arabic reading accuracy; Persian prose; lithographs.</>,
    },
  },
];

/* ---------- Figure 1: the two layers ---------- */

const Down = () => (
  <div aria-hidden className="text-stone-400 text-center leading-none my-1">
    ↓
  </div>
);

function TwoLayers({ n }: { n: number }) {
  return (
    <Figure
      n={n}
      title="Two layers of human expertise"
      caption={
        <>
          Left: what checks our work today. Every check compares our output with work done by people: a text they
          typed, or a translation they published. Right: what is not yet in place, a scholar reading our own pages.
          Starred: Tibetan and Chinese, which have no human-checked anchor page at all in the scorecard that
          calibrates our machine checks, so a scholar&rsquo;s hour there turns an absence into a number.
          <S href={SRC.review} />
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6">
        <div>
          <div className="font-body text-xs uppercase tracking-wider text-teal-800 font-semibold mb-2">
            Layer 1 · in use: people&rsquo;s texts and translations
          </div>
          <div className="hidden sm:grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 font-body text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-300 pb-1.5">
            <div>Canon</div>
            <div>Typed text checks our reading</div>
            <div>Translation checks our English</div>
          </div>
          <ul className="divide-y divide-stone-100">
            {CANONS.map((c) => (
              <li key={c.id} className="py-2 sm:grid sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-3 font-body text-sm leading-snug">
                <a href={`#${c.id}`} className="font-semibold text-stone-900 hover:text-amber-800 hover:underline underline-offset-2">
                  {c.name}
                  {c.priority && <span className="text-amber-700" title="no human anchor pages yet"> ★</span>}
                </a>
                <div className="text-stone-700">
                  <span className="sm:hidden text-stone-400">text: </span>
                  {c.textRef}
                </div>
                <div className="text-stone-700">
                  <span className="sm:hidden text-stone-400">English: </span>
                  {c.englishRef}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="font-body text-xs uppercase tracking-wider text-amber-700 font-semibold mb-2">
            Layer 2 · not yet in place: a scholar reads our pages
          </div>
          <Step tone="planned" label="A scholar reads about 30 of our pages" sub="image, source text and English side by side" />
          <Down />
          <Step tone="planned" label="Their verdicts calibrate the machine checks" sub="how far to trust an AI reviewer that can read every page" />
          <Down />
          <Step tone="planned" label="Their corrections become reference data" sub="each one a revision on the page, the next check's yardstick" />
          <Down />
          <Step tone="planned" label="“Reviewed by” in the reader" sub="named on the pages and the round they read" />
          <div className="mt-4 rounded-sm bg-amber-50 border border-amber-300 px-3 py-2 font-body text-xs text-stone-700 leading-snug">
            <span className="font-semibold text-stone-900">★ Where an hour does most good:</span> Tibetan and Chinese,
            which have no human anchor pages; within the Tengyur, Pramāṇa, verse and the Vinaya, where the AI review
            found most problems.
          </div>
        </div>
      </div>
    </Figure>
  );
}

/* ---------- Figure 2: the evidence strip ---------- */

const CELL_STYLE: Record<Cell['state'], CSSProperties> = {
  typed: { backgroundColor: ENGLISH, color: 'white' },
  sampled: { backgroundColor: `${ENGLISH}26`, boxShadow: `inset 0 0 0 1px ${ENGLISH}80` },
  none: HATCH,
};

function EvidenceStrip({ n }: { n: number }) {
  const cols = 'grid grid-cols-3 md:grid-cols-[13rem_repeat(3,minmax(0,1fr))] gap-x-2 md:gap-x-3';
  return (
    <Figure
      n={n}
      title="What has been checked, canon by canon"
      caption="One row per canon, the same three checks in each. A full cell means the text was typed by people, so no model reads it; a light cell means a sample was checked against people's work (its size is shown), or only part of the canon is typed; a hatched cell means no check yet. The figures behind every cell are in the cards below."
    >
      <div className="font-body text-xs text-stone-600 mb-4 flex flex-wrap gap-y-1">
        <Swatch style={CELL_STYLE.typed} label="typed by people" />
        <Swatch style={CELL_STYLE.sampled} label="partly: a checked sample, or part typed" />
        <Swatch style={CELL_STYLE.none} label="not checked" />
      </div>
      <div className={`${cols} font-body text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-300 pb-1.5`}>
        <div className="hidden md:block" />
        <div>Reading</div>
        <div>English</div>
        <div>Scholar review</div>
      </div>
      <div className="divide-y divide-stone-100">
        {CANONS.map((c) => (
          <div key={c.id} className={`${cols} items-center py-2`}>
            <a href={`#${c.id}`} className="col-span-3 md:col-span-1 mb-1 md:mb-0 font-body text-sm text-stone-800 leading-tight hover:text-amber-800 hover:underline underline-offset-2">
              {c.name}
            </a>
            {[c.reading, c.english, c.scholar].map((cell, i) => (
              <div
                key={i}
                className="rounded-sm px-2 py-1.5 font-body text-xs leading-tight tabular-nums min-h-[2rem] flex items-center"
                style={CELL_STYLE[cell.state]}
              >
                <span className={cell.state === 'none' ? 'bg-white/85 px-1 rounded-[2px] text-stone-600' : ''}>{cell.label}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Figure>
  );
}

/* ---------- Figure 3: what a scholar's 30 pages buy ---------- */

type Band = { label: string; sub: ReactNode; lo?: number; hi?: number; at?: number; measured?: boolean };

function WhatPagesBuy({ n }: { n: number }) {
  const bands: Band[] = [
    {
      label: 'No pages read by a person',
      sub: 'every canon on this page today: no estimate can be made',
    },
    {
      label: 'About 35 pages',
      sub: '±10 points, if about 90% of pages are sound',
      lo: 80,
      hi: 100,
      at: 90,
    },
    {
      label: 'About 140 pages',
      sub: '±5 points, same assumption',
      lo: 85,
      hi: 95,
      at: 90,
    },
    {
      label: '150 pages, AI reviewers, Tengyur',
      sub: 'measured: 75% need only light edits [69–82]',
      lo: 69,
      hi: 82,
      at: 75,
      measured: true,
    },
  ];
  return (
    <Figure
      n={n}
      title="What a few dozen pages buy"
      caption={
        <>
          How precisely a share of sound pages can be stated for one canon, by how many pages were read. The first three
          rows are the sample-size arithmetic in our review design, not results; the 90% is an assumption. The last row
          is a measured result, for comparison: 150 random Tengyur pages read by AI reviewers. A scholar&rsquo;s 30
          pages do two things: they give a direct estimate at about the second row&rsquo;s precision, and they tell us
          how far to trust the AI reviewers, who can read every page. Sources: <A href={SRC.review}>review design</A>,{' '}
          <A href={SRC.tengyurRandom}>Tengyur sample</A>.
        </>
      }
    >
      <div className="space-y-4">
        {bands.map((b) => (
          <div key={b.label} className="md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:gap-6 items-center">
            <div className="font-body text-sm mb-1.5 md:mb-0">
              <div className="text-stone-900 font-semibold leading-tight">{b.label}</div>
              <div className="text-xs text-stone-500 leading-snug">{b.sub}</div>
            </div>
            <div
              className="relative h-6 rounded-sm bg-stone-50 border border-stone-200"
              role="img"
              aria-label={b.lo == null ? `${b.label}: no estimate` : `${b.label}: ${b.lo}% to ${b.hi}%`}
            >
              {b.lo == null ? (
                <div className="absolute inset-0 rounded-sm" style={HATCH} />
              ) : (
                <>
                  <div
                    className="absolute top-1 bottom-1 rounded-[2px]"
                    style={{ left: `${b.lo}%`, width: `${(b.hi as number) - b.lo}%`, backgroundColor: b.measured ? ENGLISH : `${ENGLISH}59` }}
                  />
                  <div className="absolute top-0 bottom-0 w-[2px] bg-stone-900" style={{ left: `${b.at}%` }} />
                </>
              )}
            </div>
          </div>
        ))}
        <div className="md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:gap-6">
          <div />
          <div className="flex justify-between font-body text-[11px] text-stone-400">
            <span>0%</span>
            <span>50%</span>
            <span>100% of pages</span>
          </div>
        </div>
      </div>
    </Figure>
  );
}

/* ---------- Page ---------- */

const CONTENTS = [
  ['layers', 'Two layers of human expertise'],
  ['strip', 'What has been checked'],
  ['canons', 'Canon by canon'],
  ['tengyur-sections', 'The Tengyur, section by section'],
  ['ask', 'What we would ask of a scholar'],
  ['changes', 'What each measured change did'],
  ['method', 'How to read these numbers'],
] as const;

function Section({ id, title, children }: { id: (typeof CONTENTS)[number][0]; title: string; children: ReactNode }) {
  const i = CONTENTS.findIndex(([k]) => k === id) + 1;
  return (
    <section id={id} className="scroll-mt-24 py-14 border-t border-stone-200">
      <div className="font-body text-xs tracking-[0.16em] uppercase text-amber-700 font-semibold mb-3 tabular-nums">
        {String(i).padStart(2, '0')}
      </div>
      <h2 className="font-serif text-2xl md:text-3xl text-stone-900 mb-5 tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="md:grid md:grid-cols-[9rem_minmax(0,1fr)] md:gap-4 py-2.5 border-t border-stone-100 first:border-t-0">
      <dt className="font-body text-[11px] uppercase tracking-wider text-stone-500 md:pt-1 mb-1 md:mb-0">{label}</dt>
      <dd className="font-body text-base text-stone-700 leading-relaxed">{children}</dd>
    </div>
  );
}

function CanonCard({ c }: { c: Canon }) {
  return (
    <article id={c.id} className="scroll-mt-24 rounded-sm border border-stone-200 bg-white px-4 py-5 md:px-6 md:py-6 mb-6">
      <h3 className="font-serif text-xl text-stone-900 mb-3">
        {c.name}
        {c.priority && <span className="text-amber-700 text-base" title="no human anchor pages yet"> ★</span>}
      </h3>
      <dl>
        <Row label="Text">{c.card.text}</Row>
        <Row label="English">{c.card.english}</Row>
        <Row label="Main failure">{c.card.failure}</Row>
        <Row label="Shown to readers">{c.card.shown}</Row>
        <Row label="Not yet measured">{c.card.notMeasured}</Row>
      </dl>
    </article>
  );
}

/* ---------- The Tengyur by section (#6120) ---------- */

const TQ = TENGYUR_QUALITY;
const KIND_WORDS = READER_UI_STRINGS.en.tengyurNote.kinds;
const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const n0 = (x: number) => x.toLocaleString('en-US');
const ci = (c?: number[]) => (c ? ` [${Math.round(c[0])}–${Math.round(c[1])}]` : '');

/**
 * Readers' "the English is wrong here" reports on Tengyur pages (#6120), and how many a person has
 * dealt with (`addressed`, the feedback lifecycle). Applied corrections show in each page's revision
 * history; the feedback row does not record whether the change was made, so this does not claim it.
 */
async function tengyurCorrections(): Promise<{ received: number; reviewed: number }> {
  const ids = tengyurCounts.by_volume.map((v) => v.book_id);
  const q = { 'page_report.kind': 'translation_error', 'page_report.book_id': { $in: ids } };
  const feedback = (await getDb()).collection('feedback');
  const [received, reviewed] = await Promise.all([
    feedback.countDocuments(q),
    feedback.countDocuments({ ...q, addressed: true }),
  ]);
  return { received, reviewed };
}

function TengyurSectionTable() {
  const rows = Object.entries(TQ.sections)
    .filter(([, q]) => q.n > 0)
    .sort((a, b) => b[1].n - a[1].n);
  const unsampled = Object.entries(TQ.sections).filter(([, q]) => q.n === 0).map(([name]) => name);
  const th = 'text-left font-body text-[11px] uppercase tracking-wider text-stone-500 font-normal py-2 pr-4 align-bottom';
  const td = 'py-2.5 pr-4 align-top border-t border-stone-100';
  const rate = (q: (typeof rows)[number][1]) =>
    q.rated
      ? `${Math.round(q.light!)}% / ${Math.round(q.work!)}% / ${Math.round(q.specialist!)}% · ${Math.round(q.rev_agent_per100!)} per 100${ci(q.rev_agent_ci)}`
      : 'Too few pages measured to give a rate.';
  return (
    <>
    {/* Phones: one block per section; five columns do not fit in 390px. */}
    <dl className="md:hidden text-base text-stone-700 tabular-nums">
      {rows.map(([name, q]) => (
        <div key={name} className="py-2.5 border-t border-stone-100">
          <dt className="text-stone-900">
            {name} <span className="text-xs text-stone-500">· {q.n} pages read of {n0(q.corpus_pages)}</span>
          </dt>
          <dd className={q.rated ? '' : 'text-stone-500'}>{rate(q)}</dd>
          {q.rated && <dd className="text-sm text-stone-500">{namedKinds(q).map((k) => KIND_WORDS[k]).join(', ')}</dd>}
        </div>
      ))}
      <div className="py-2.5 border-t border-stone-100">
        <dt className="font-semibold text-stone-900">All sections <span className="text-xs text-stone-500 font-normal">· {TQ.sample.n} pages read</span></dt>
        <dd>
          {Math.round(TQ.sample.light)}% / {Math.round(TQ.sample.work)}% / {Math.round(TQ.sample.specialist)}% ·{' '}
          {Math.round(TQ.sample.rev_agent_per100_adjusted)} per 100{ci(TQ.sample.rev_agent_ci_adjusted)}, adjusted for
          findings that did not hold up
        </dd>
      </div>
      <p className="text-sm text-stone-500 pt-2">
        Read as: light / work / specialist · reversed statements or wrong speakers per 100 pages [95% interval].
      </p>
    </dl>
    <div className="hidden md:block">
      <table className="w-full text-base text-stone-700 tabular-nums">
        <thead>
          <tr>
            <th className={th}>Section</th>
            <th className={th}>Pages read</th>
            <th className={th}>Light / work / specialist</th>
            <th className={th}>Reversed or wrong speaker, per 100 pages</th>
            <th className={th}>Commonest other errors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, q]) => (
            <tr key={name}>
              <td className={td}>
                <span className="text-stone-900">{name}</span>
                <span className="block text-xs text-stone-500">{n0(q.corpus_pages)} pages in the draft</span>
              </td>
              <td className={td}>{q.n}</td>
              {q.rated ? (
                <>
                  <td className={td}>
                    {Math.round(q.light!)}% / {Math.round(q.work!)}% / {Math.round(q.specialist!)}%
                  </td>
                  <td className={td}>
                    {Math.round(q.rev_agent_per100!)}
                    <span className="text-stone-500">{ci(q.rev_agent_ci)}</span>
                  </td>
                  <td className={td}>{namedKinds(q).map((k) => KIND_WORDS[k]).join(', ')}</td>
                </>
              ) : (
                <td className={`${td} text-stone-500`} colSpan={3}>
                  Too few pages measured to give a rate.
                </td>
              )}
            </tr>
          ))}
          <tr>
            <td className={`${td} font-semibold text-stone-900`}>All sections</td>
            <td className={td}>{TQ.sample.n}</td>
            <td className={td}>
              {Math.round(TQ.sample.light)}% / {Math.round(TQ.sample.work)}% / {Math.round(TQ.sample.specialist)}%
            </td>
            <td className={td}>
              {Math.round(TQ.sample.rev_agent_per100_adjusted)}
              <span className="text-stone-500">{ci(TQ.sample.rev_agent_ci_adjusted)}</span>
              <span className="block text-xs text-stone-500">adjusted for findings that did not hold up</span>
            </td>
            <td className={td} />
          </tr>
        </tbody>
      </table>
    </div>
      {unsampled.length > 0 && (
        <p className="text-sm text-stone-500 mt-2">No sample page fell in: {unsampled.join(', ')}.</p>
      )}
    </>
  );
}

function TengyurSections({ corrections }: { corrections: { received: number; reviewed: number } }) {
  const d = TQ.defects;
  return (
    <>
      <p>
        Every translated page of the Derge Tengyur says, under its draft label, how its section measured here. The
        figures are from {TQ.sample.n} pages drawn at random from all {n0(TQ.sample.population)} drafted pages and read
        against the Tibetan on {fmtDate(TQ.measured)}.
        <S href={SRC.tengyurRandom} />
      </p>
      <p className="mt-4 text-base border-l-2 border-amber-700/40 pl-3">
        <strong>The reviewers are AI, not scholars.</strong> Two Claude Opus reviewers, each blind to the other, read
        every page. When their findings were checked by eye, {TQ.reviewers.precision_pct}% held up
        {ci(TQ.reviewers.precision_ci)}; they found {TQ.reviewers.planted_recall_pct}% of errors we planted; their page
        verdicts agreed with a κ of {TQ.reviewers.kappa.toFixed(2)}. No person who reads Tibetan has reviewed these
        pages yet (<A href={SRC.scholar}>#5800</A>). A section with fewer than {TQ.min_pages} pages read gets no rate of
        its own.
      </p>
      <div className="mt-6">
        <TengyurSectionTable />
      </div>
      <p className="text-sm text-stone-500 mt-3">
        Light, work and specialist are each reviewer&rsquo;s verdict on whether a Tibetologist could fix the page with
        light edits, would need real work, or would need a specialist. Reversed or wrong speaker counts what either
        reviewer flagged, per 100 pages, with a 95% interval; the section rates are not adjusted, the total is.
        Pages in the draft: {fmtDate(TQ.measured)}.
      </p>

      <h3 className="font-serif text-xl text-stone-900 mt-10 mb-3">Known defects</h3>
      <ul className="list-disc pl-5 space-y-2 text-base">
        <li>
          <strong>Pramāṇa:</strong> an opponent&rsquo;s objection is sometimes given as the author&rsquo;s own view,
          and named reason-types are mistranslated. It is the weakest section by both measures above.
          <S href={SRC.tengyurRandom} />
        </li>
        <li>
          <strong>Vinaya:</strong> {n0(d.vinaya_pali_pages)} pages ({d.vinaya_pali_pct}% of the section) use Pali
          names for the offence classes of a Mūlasarvāstivāda text, such as <em>saṅghādisesa</em> for{' '}
          <em>saṅghāvaśeṣa</em>. Measured {fmtDate(TQ.measured)}.
          <S href={SRC.tengyurRandom} />
        </li>
        <li>
          <strong>{n0(d.unclear_guess_tags)}</strong> words at the end of a page are marked unclear, and the English
          inside the mark is a guess at a word broken across the page.
          <S href={SRC.tengyurResidue} />
        </li>
        <li>
          <strong>{n0(d.colophon_missing_ending)}</strong> colophons are missing their ending in the English.
          <S href={SRC.tengyurResidue} />
        </li>
        <li>
          <strong>{n0(d.body_text_in_note)}</strong> pages have body text inside a translator&rsquo;s note, and{' '}
          {n0(d.tibetan_outside_notes)} have Tibetan left in the English. Listed {fmtDate(d.measured)}, not yet
          repaired.
          <S href={SRC.tengyurResidue} />
        </li>
        <li>
          <strong>Verse</strong> is worse than prose: {Math.round(TQ.verse.mostly_verse.rev_agent_per100)} reversed
          statements or wrong speakers per 100 pages on pages that are half verse or more (n ={' '}
          {TQ.verse.mostly_verse.n}), against {Math.round(TQ.verse.prose.rev_agent_per100)} on prose (n ={' '}
          {TQ.verse.prose.n}).
          <S href={SRC.tengyurRandom} />
        </li>
      </ul>

      <h3 className="font-serif text-xl text-stone-900 mt-10 mb-3">Corrections from readers</h3>
      <p className="text-base">
        Any page can be reported with &ldquo;The English is wrong here&rdquo;, giving the passage, the correction and,
        if you like, the Tibetan. A person reads every report against the Tibetan before anything changes; nothing is
        applied automatically, and a correction we make is kept as a recorded revision of the page. Received so far on
        Tengyur pages: <strong>{n0(corrections.received)}</strong>; reviewed: <strong>{n0(corrections.reviewed)}</strong>.
        <S href={SRC.release} />
      </p>
    </>
  );
}

export default async function CanonQualityPage() {
  const corrections = await tengyurCorrections();
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="How We Check Each Canon"
          subtitle="For each canon in the Eternity programme: what checks our transcription, what checks our English, how good each is by the measurements so far, and where a scholar would help most."
        />
      }
    >
      <div className="max-w-5xl mx-auto font-body text-stone-700 text-lg leading-relaxed">
        <p className="text-sm text-stone-500 mt-8">
          Prepared for the Eternity Foundation working session, October 2026. Every figure is copied from a published
          write-up of a measurement made between 30 September and 4 October 2026, and links to it. A companion to{' '}
          <a href="/research/canon-gap" className="text-amber-800 underline underline-offset-2">The Open Canons</a>. What is still open across
          all languages is listed on <a href="/research/quality/open" className="text-amber-800 underline underline-offset-2">open quality work</a>.
        </p>

        <p className="mt-6">
          Human expertise is already the backbone of how we check our work. Every measurement on this page compares our
          output with something people made. Texts typed by people, such as Esukhia&rsquo;s Derge e-text, GRETIL, CBETA,
          Sefaria and Ganjoor, check our transcriptions. Translations published by people, such as 84000&rsquo;s and
          SuttaCentral&rsquo;s, check our English. What is missing is the second layer: a scholar reading our own pages.
          No person who reads the source language has yet checked our pages in any of these canons.
        </p>

        <nav aria-label="Contents" className="mt-10 mb-4">
          <div className="font-body text-xs tracking-[0.16em] uppercase text-stone-400 mb-3">Contents</div>
          <ol className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-base">
            {CONTENTS.map(([id, title], i) => (
              <li key={id} className="flex gap-3">
                <span className="text-amber-700 tabular-nums text-sm pt-0.5">{String(i + 1).padStart(2, '0')}</span>
                <a href={`#${id}`} className="text-stone-800 hover:text-amber-800 hover:underline underline-offset-2">
                  {title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <Section id="layers" title="Two layers of human expertise">
          <p>
            In the first layer, people&rsquo;s work is the yardstick. Where a canon has been typed by people, we fit
            the typed text to our scans and no model reads the page. Where it has not, a model reads the page, and we
            score that reading against a typed text of the same work. To check the English, two AI judges, who do not
            know which version is ours, score it against a published translation of the same passage. The second layer
            is a scholar reading our pages directly, and it is the one we do not yet have.
          </p>
          <TwoLayers n={1} />
        </Section>

        <Section id="strip" title="What has been checked">
          <p>
            The same three questions for each canon: is the reading checked, is the English checked, and has a scholar
            reviewed it? The last column is empty everywhere.
          </p>
          <EvidenceStrip n={2} />
        </Section>

        <Section id="canons" title="Canon by canon">
          <p className="mb-6 text-base text-stone-600">
            Scores out of 5 are the mean of two blind Claude Opus judges, each scoring how faithful our English is to the
            source, with a published translation beside it as a guide; 4 means minor slips only. Brackets are 95%
            confidence intervals. A rate judged against a reference covers only the texts that have one, which are
            usually the better-known works, so for the rest of a canon it is likely an upper bound.
          </p>
          {CANONS.map((c) => (
            <CanonCard key={c.id} c={c} />
          ))}
        </Section>

        <Section id="tengyur-sections" title="The Tengyur, section by section">
          <TengyurSections corrections={corrections} />
        </Section>

        <Section id="ask" title="What we would ask of a scholar">
          <p className="mb-4">
            About 30 pages, which we expect to take about two hours. The first round is the Derge Tengyur.{' '}
            <A href={SRC.scholar}>#5800</A>
          </p>
          <ul className="list-disc pl-5 space-y-3 text-base">
            <li>
              <strong>Which pages.</strong> Five each from Madhyamaka, Pramāṇa, sūtra commentary, Prajñāpāramitā, tantra
              commentary, and Vinaya or Jātaka, picked to avoid the opening pages of texts. Weighted toward Pramāṇa, verse
              and the Vinaya, where the AI review found most problems. For 10 of them, where 84000 has published the same
              passage, 84000&rsquo;s English is also sent, unlabelled.
            </li>
            <li>
              <strong>What you see.</strong> Batches of five pages by email: the woodblock image, the Tibetan, and our
              English. For each page: what would you correct (quote the line)? Is there a reversed statement, an
              omission or an addition? Would you start from this draft: yes, with work, or no?
            </li>
            <li>
              <strong>What happens to your answers.</strong> They are coded page by page by hand. We apply each
              correction as a recorded revision of the page, never as a silent overwrite, so the earlier English and the
              reason for the change stay on record. Your verdicts are set beside the AI reviewers&rsquo; on the same
              pages, which tells us how far to trust the AI review of the whole draft. The draft label on the Tengyur
              then says what review it has had. Contributors are named for each round they complete, and passing on a
              page outside your field counts as taking part.
              <S href={SRC.review} />
            </li>
            <li>
              <strong>What we will not do.</strong> Quote your answers as a measured rate without your permission and an
              ethics check; until then they are reported as expert feedback.
            </li>
          </ul>
          <WhatPagesBuy n={3} />
          <p className="text-base">
            The AI reviewers your pages would be compared with found 97.5% of errors planted in test pages [87–100], and
            70% of their findings held up when checked by eye [52–83]; two reviewers agreed on the page verdict with a κ
            of 0.61. A scholar&rsquo;s reading is the check that remains.
            <S href={SRC.tengyurRandom} />
          </p>
        </Section>

        <Section id="changes" title="What each measured change did">
          <p className="text-base">
            Every change to how we read or translate is tested on the same pages as the method it would replace, against
            the same reference. These are the results so far, across all languages.
          </p>
          <ImprovementChart n={4} rows={IMPROVEMENTS} />
        </Section>

        <Section id="method" title="How to read these numbers">
          <ul className="list-disc pl-5 space-y-3 text-base">
            <li>
              <strong>A judged score is not accuracy.</strong> The judges compare our English with the transcription and
              the reference, not with the page image. Where the transcription is wrong, the score overstates how
              faithful the English is to the page.
              <S href={SRC.synthesis} />
            </li>
            <li>
              <strong>The reference is one reading.</strong> Where ours and the published translation differ in meaning,
              the judge sided with the reference on 29 Sanskrit, Pali and Chinese pages and with ours on 16. A second
              published translator, judged the same way on 66 Greek and Latin pages, scores about 4.2 of 5, not 5, and
              reverses the sense on 3% of pages against 11–17% for the models.
              <S href={SRC.t5} />
              <S href={SRC.ceilingEnglish} />
            </li>
            <li>
              <strong>Typed texts disagree too.</strong> Two careful typings of the same printed page differ on about one
              letter in 700 in English and on 0.28% of characters in the Taishō, once glyph conventions are folded. An
              error rate below that is at the floor and should not be ranked.
              <S href={SRC.ceilingText} />
            </li>
            <li>
              <strong>The judges are models of one family.</strong> All judges and reviewers here are Claude Opus. Planted
              controls (a wrong page, a planted reversal, a duplicate) were mixed into every judged run on this page and were
              caught, which shows the judges are not blind to those faults; it does not measure what they miss.
            </li>
            <li>
              <strong>Small samples.</strong> Most canons have 10–40 judged pages, so intervals are wide. A difference in
              reversals smaller than about 8 per 100 pages cannot be read at these sizes.
              <S href={SRC.synthesis} />
            </li>
          </ul>
          <p className="mt-8 text-base">
            The full evaluation, for every language, is on{' '}
            <a href="/research/quality" className="text-amber-800 underline underline-offset-2">our translation quality page</a>,
            including the preregistered reader panel that this round would feed (
            <a href="/research/quality#s6" className="text-amber-800 underline underline-offset-2">§6</a>). Holdings,
            licences and the cost of a draft for each canon are on{' '}
            <a href="/research/canon-gap" className="text-amber-800 underline underline-offset-2">The Open Canons</a>.
          </p>
        </Section>
      </div>
      <PageEditMode />
    </ContentPageLayout>
  );
}
