import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import data from '@/data/page-errors.json';
import Specimen, { SpecimenLegend, pageHref, type SpecimenData } from './Specimen';

// Companion paper to /research/quality (#5613). Everything on the page is embedded at build
// from src/data/page-errors.json, which copies the 2026-09-25 by-eye taxonomy
// (.claude/docs/page-error-taxonomy.md) and adds specimens checked against the scans on
// 2026-10-02. No request-time fetch.
export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'What Goes Wrong on a Page (draft) | Source Library Research',
  description:
    'How AI transcription and translation of historical books fail, page by page: 43 classes of error seen by eye in 78 books, grouped by seven mechanisms, with real scans. A paper draft, with the data.',
  alternates: { canonical: '/research/page-errors' },
  openGraph: {
    title: 'What goes wrong on a page',
    description:
      'A by-eye taxonomy of errors in AI transcription and translation of historical books, with real pages. A paper draft from Source Library.',
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', width: 1200, height: 630, alt: 'Source Library: Digitizing and translating ancient texts' }],
  },
};

const GH = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2';
const ISSUE = (n: number) => `${GH}/issues/${n}`;

type Detect = 'yes' | 'partly' | 'no';
type LinkKey = keyof typeof data.links;
type Example = { book: string; page: number; label: string };
type Cls = {
  id: string;
  name: string;
  mech: number;
  placed?: boolean;
  known: boolean;
  links: string[];
  sees: string;
  seen: Record<string, number> | null;
  seenNote?: string;
  detect: string;
  instrument: string;
  issue: number | null;
  issues?: number[];
  examples: Example[];
  specimen?: string;
  noSpecimen?: string;
};

const CLASSES = data.classes as Cls[];
const SPECIMENS = data.specimens as SpecimenData[];
const SPECIMEN_BY_KEY = new Map(SPECIMENS.map(s => [s.key, s]));
const STRATA = data.strata;
const STRATUM_NAME = new Map(STRATA.map(s => [s.key, s.name]));
const STUDY = data.study;

const seenTotal = (c: Cls) => (c.seen ? Object.values(c.seen).reduce((a, b) => a + b, 0) : null);
const N_CLASSES = CLASSES.length;
const N_KNOWN = CLASSES.filter(c => c.known).length;

/* ── page furniture, as on /research/quality ── */
function Section({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-14 scroll-mt-24">
      <h2 className="text-2xl md:text-3xl text-primary mb-6">
        <span className="text-muted tabular-nums mr-3">{n}.</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-secondary leading-relaxed mb-6">{children}</p>;
}

function Figure({ n, caption, children }: { n: number; caption: ReactNode; children: ReactNode }) {
  return (
    <figure id={`fig${n}`} className="my-10">
      {children}
      <figcaption className="text-sm text-muted mt-3 leading-relaxed">
        <span className="font-semibold text-secondary">Figure {n}.</span> {caption}
      </figcaption>
    </figure>
  );
}

const DETECT_LABEL: Record<Detect, string> = { yes: 'Detected', partly: 'Partly detected', no: 'Not detected' };
const DETECT_CLASS: Record<Detect, string> = {
  yes: 'border-light text-primary',
  partly: 'border-light text-secondary',
  no: 'border-accent-rust/50 text-accent-rust',
};
// Presence 1–6 of six books, as a tint of the accent (full class names, so Tailwind keeps them).
const PRESENCE_BG = ['', 'bg-accent-rust/10', 'bg-accent-rust/20', 'bg-accent-rust/30', 'bg-accent-rust/40', 'bg-accent-rust/50', 'bg-accent-rust/60'];

function DetectChip({ d }: { d: Detect }) {
  return <span className={`inline-block border rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${DETECT_CLASS[d]}`}>{DETECT_LABEL[d]}</span>;
}

/* ── Figure 1: the sample ── */
function StrataTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left border-collapse">
        <thead>
          <tr className="border-b border-light text-muted">
            <th className="py-1.5 pr-4 font-medium">Stratum</th>
            <th className="py-1.5 pr-4 font-medium">How the six books were drawn</th>
            <th className="py-1.5 font-medium">What the draw actually returned</th>
          </tr>
        </thead>
        <tbody>
          {STRATA.map(s => (
            <tr key={s.key} className="border-b border-light align-top">
              <td className="py-1.5 pr-4 text-primary whitespace-nowrap">{s.name}</td>
              <td className="py-1.5 pr-4 text-secondary">{s.drawn}</td>
              <td className="py-1.5 text-secondary">{s.found}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── one class ── */
function SeenLine({ c }: { c: Cls }) {
  const total = seenTotal(c);
  if (total === null) return <span>{c.seenNote}</span>;
  const parts = Object.entries(c.seen!).map(([k, v]) => `${STRATUM_NAME.get(k) ?? k} ${v}`);
  return (
    <span>
      <span className="text-primary font-semibold tabular-nums">{total} of {STUDY.books} books</span>{' '}
      <span className="text-muted">(presence, not a rate; of six per stratum: {parts.join(' · ')})</span>
      {c.seenNote && <> {c.seenNote}</>}
    </span>
  );
}

function ClassEntry({ c }: { c: Cls }) {
  const specimen = c.specimen ? SPECIMEN_BY_KEY.get(c.specimen) : undefined;
  return (
    <article id={c.id} className="border-t border-light pt-5 mt-5 scroll-mt-24">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <span className="text-lg text-primary font-semibold tabular-nums">{c.id}</span>
        <h4 className="text-lg text-primary">{c.name}</h4>
        <span className="text-xs text-muted">{c.known ? 'known before the study' : 'new in the study'}</span>
      </header>
      <dl className="grid gap-x-4 gap-y-2 text-sm leading-relaxed sm:grid-cols-[9rem_1fr]">
        <dt className="text-muted">What the reader sees</dt>
        <dd className="text-secondary">{c.sees}</dd>
        <dt className="text-muted">Seen in</dt>
        <dd className="text-secondary"><SeenLine c={c} /></dd>
        <dt className="text-muted">Link it breaks</dt>
        <dd className="text-secondary">{c.links.map(l => data.links[l as LinkKey] ?? l).join('; ')}</dd>
        <dt className="text-muted">Instruments</dt>
        <dd className="text-secondary"><DetectChip d={c.detect as Detect} /> {c.instrument}</dd>
        {(c.examples.length > 0 || c.issue) && (
          <>
            <dt className="text-muted">Pages and issue</dt>
            <dd className="text-secondary">
              {c.examples.map((e, i) => (
                <span key={`${e.book}-${e.page}`}>
                  {i > 0 && '; '}
                  {e.label}, <a href={pageHref(e.book, e.page)} className="text-accent-rust hover:underline">p. {e.page}</a>
                </span>
              ))}
              {c.issue && (
                <>
                  {c.examples.length > 0 && '. '}
                  <a href={ISSUE(c.issue)} className="text-accent-rust hover:underline">#{c.issue}</a>
                  {c.issues?.map(n => (
                    <span key={n}>, <a href={ISSUE(n)} className="text-accent-rust hover:underline">#{n}</a></span>
                  ))}
                </>
              )}
            </dd>
          </>
        )}
      </dl>
      {c.noSpecimen && <p className="text-xs text-muted mt-2">{c.noSpecimen}</p>}
      {specimen && <Specimen s={specimen} />}
    </article>
  );
}

/* ── Figure 2: what the instruments see, by link ── */
function InstrumentTable() {
  const keys = Object.keys(data.links) as LinkKey[];
  const rows = keys.map(k => {
    const cs = CLASSES.filter(c => c.links[0] === k);
    const count = (d: Detect) => cs.filter(c => c.detect === d);
    return { k, total: cs.length, yes: count('yes'), partly: count('partly'), no: count('no') };
  });
  const ids = (cs: Cls[]) => cs.map(c => c.id).join(', ') || '–';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left border-collapse">
        <thead>
          <tr className="border-b border-light text-muted">
            <th className="py-1.5 pr-4 font-medium">First link broken</th>
            <th className="py-1.5 pr-4 font-medium">Detected</th>
            <th className="py-1.5 pr-4 font-medium">Partly</th>
            <th className="py-1.5 font-medium">Not detected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.k} className="border-b border-light align-top">
              <td className="py-1.5 pr-4 text-primary">{data.links[r.k]} <span className="text-muted">({r.total})</span></td>
              <td className="py-1.5 pr-4 text-secondary"><span className="tabular-nums font-semibold">{r.yes.length}</span> <span className="text-muted text-xs">{ids(r.yes)}</span></td>
              <td className="py-1.5 pr-4 text-secondary"><span className="tabular-nums font-semibold">{r.partly.length}</span> <span className="text-muted text-xs">{ids(r.partly)}</span></td>
              <td className="py-1.5 text-secondary"><span className="tabular-nums font-semibold">{r.no.length}</span> <span className="text-muted text-xs">{ids(r.no)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Figure 3: strata × class presence grid ── */
function PresenceGrid() {
  return (
    <div className="overflow-x-auto">
      <table className="text-xs text-left border-collapse">
        <thead>
          <tr className="border-b border-light text-muted align-bottom">
            <th className="py-1 pr-3 font-medium">Class</th>
            {STRATA.map(s => (
              <th key={s.key} className="py-1 px-1 font-medium text-center w-8" title={s.name}>{s.key}</th>
            ))}
            <th className="py-1 pl-2 font-medium text-right">Books</th>
          </tr>
        </thead>
        <tbody>
          {CLASSES.filter(c => c.seen).map(c => (
            <tr key={c.id} className="border-b border-light">
              <td className="py-1 pr-3 whitespace-nowrap"><a href={`#${c.id}`} className="text-primary hover:text-accent-rust">{c.id}</a> <span className="text-muted">{c.name.length > 34 ? `${c.name.slice(0, 32)}…` : c.name}</span></td>
              {STRATA.map(s => {
                const v = c.seen![s.key];
                return (
                  <td key={s.key} className={`py-1 px-1 text-center tabular-nums ${v ? `text-primary ${PRESENCE_BG[v]}` : 'text-muted'}`}>
                    {v ?? '·'}
                  </td>
                );
              })}
              <td className="py-1 pl-2 text-right tabular-nums text-primary">{seenTotal(c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CONTENTS: [string, string][] = [
  ['#method', '1. Method'],
  ['#mechanisms', '2. Seven mechanisms'],
  ['#classes', '3. The classes, by mechanism'],
  ['#instruments', '4. What our instruments see'],
  ['#untested', '5. What the sample could not test'],
  ['#data', '6. Data, sources and citation'],
];

export default function PageErrorsPaper() {
  const specimenCount = SPECIMENS.length;
  const notDetected = CLASSES.filter(c => c.detect === 'no').length;
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="What goes wrong on a page"
          subtitle="How AI transcription and translation of historical books fail, class by class, with real pages"
        >
          <p className="text-stone-400 text-sm mt-4">Working draft &middot; 2 October 2026 &middot; companion to <Link href="/research/quality" className="underline hover:text-stone-200">How page quality is measured</Link> &middot; <Link href="/research/quality/open" className="underline hover:text-stone-200">Open quality work</Link></p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link href="/research" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Research
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <section className="border-l-2 border-accent-rust pl-5 md:pl-6 mb-10">
          <h2 className="text-xs uppercase tracking-[0.16em] text-muted font-semibold mb-4">Abstract</h2>
          <p className="text-secondary leading-relaxed mb-4">
            Source Library publishes AI transcriptions and English translations of historical books. Our{' '}
            <Link href="/research/quality" className="text-accent-rust hover:underline">quality paper</Link> asks how often a page is right. This paper asks what a wrong page looks like. Eight readers, each a Claude model, opened the scans of {STUDY.leaves} leaves, a consecutive pair from each of {STUDY.books} books in {STUDY.strata} strata, and compared each scan with the stored transcription and each transcription with the English.
          </p>
          <p className="text-secondary leading-relaxed mb-4">
            They found {N_CLASSES} classes of error. {N_KNOWN} were known to us before; {N_CLASSES - N_KNOWN} were new. Almost all are one of seven mechanisms, and the largest is the simplest to state: the model reads what it expects, not what is there. It writes a fluent page in the right language where the leaf is illegible, recites the standard text of a famous work in place of the manuscript, and normalises what an editor would keep. The translation then makes weak or invented source into fluent English, with notes that explain the misreads. None of this is visible from the English alone.
          </p>
          <p className="text-secondary leading-relaxed mb-4">
            Every class below is shown with what the reader sees, the books it was seen in, the link between scan and English that it breaks, and whether any of our instruments detects it today. {specimenCount} classes are shown on a real page: the scan, what we served, and what it should be. {notDetected} of the {N_CLASSES} classes are detected by nothing we run.
          </p>
          <p className="text-secondary leading-relaxed">
            The counts are presence, not rates: the number of books, of six drawn per stratum, in which a class was seen at least once. A sample of six cannot give a rate, and we do not offer one.
          </p>
        </section>

        <nav aria-label="Contents" className="text-sm border-y border-light py-5 mb-4">
          <div className="text-xs uppercase tracking-[0.16em] text-muted font-semibold mb-2">Contents</div>
          <ul className="list-none p-0 m-0 grid gap-1 sm:grid-cols-2">
            {CONTENTS.map(([href, label]) => (
              <li key={href}><a href={href} className="text-secondary hover:text-accent-rust">{label}</a></li>
            ))}
          </ul>
        </nav>

        <Section id="method" n={1} title="Method">
          <h3 className="text-lg text-primary font-semibold mb-3">Sample</h3>
          <P>
            On 25 September 2026 we drew {STUDY.books} books from the library in {STUDY.strata} strata of {STUDY.perStratum} books each, chosen to cover the kinds of page we expected to be hard: dense early modern prose, columns, manuscripts, plates, music, tables, Greek, right-to-left scripts, Chinese, Korean and Tibetan, incunabula, and seventeenth- and nineteenth-century print. From each book we took one consecutive pair of pages, so that both the pages and the break between them could be read. That gives {STUDY.leaves} leaves and {STUDY.books} page breaks.
          </P>
          <P>
            The strata were drawn from our own fields: the OCR&rsquo;s tags for script and columns, the stored page type and length, the catalogue language and date. Figure 1 shows that many of those fields were wrong. The &ldquo;two-column&rdquo; stratum was mostly unsplit spreads; the &ldquo;short&rdquo; stratum was mostly not short; two of the six Greek &ldquo;prints&rdquo; are manuscripts. That is itself a finding (class E2), and it is why every count here was made by eye.
          </P>
          <Figure n={1} caption={<>The thirteen strata: how each was drawn and what it held. The draw script and the list of books and pages are in the study folder (§6).</>}>
            <StrataTable />
          </Figure>

          <h3 className="text-lg text-primary font-semibold mb-3">Reading by eye</h3>
          <P>
            Eight readers, each a Claude model run by the session that built the taxonomy and given one or two strata, opened every image, read the stored transcription and the stored translation, and wrote notes for each book. The order of reading was fixed: the image first, then the transcription against the image, then the translation against the transcription. An earlier judge that read only the English had missed every fidelity error, and this order is the correction. Every claim in the notes carries a label for what was compared: the image alone, transcription against image, translation against transcription, or translation against image. A class is listed only where a reader saw it on the leaf.
          </P>
          <P>
            For this paper we opened again every scan shown below, read the crop, and checked the served text against the production database on 2 October 2026. Where the text had changed since the study, we say so and show what was served before. One of the study&rsquo;s examples did not survive this check: the transcription it described as missing thirteen lines now has them, and we show a different page for that class.
          </P>

          <h3 className="text-lg text-primary font-semibold mb-3">What &ldquo;seen in&rdquo; means</h3>
          <P>
            &ldquo;Seen in 7 of 78 books&rdquo; means that in seven books a reader saw the class at least once on one of the two pages. It is presence. It is not a rate, because six books per stratum cannot estimate one, and a page pair is one observation of a book, not two. Presence tells a reader which faults exist and where they turned up. It does not say how common they are in the library. Where a corpus detector has run, its rate is in the class&rsquo;s issue, not here.
          </P>

          <h3 className="text-lg text-primary font-semibold mb-3">Limits</h3>
          <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-2">
            <li>The readers were models, not specialists in each script. Where a hand was hard, they wrote what they could read and marked doubt. The class descriptions summarise their notes; in the specimens we state only what we could confirm on the scan ourselves.</li>
            <li>The strata were drawn from tags that turned out to be wrong, so some kinds of page are thin or absent (§5).</li>
            <li>Classes overlap. One page can show a misread (O6), the invented note that explains it (T10), and the raw tag around it (D1). We count each class once per book.</li>
            <li>The taxonomy document counts 44 classes. It lists the word-level repetition loop as a known class apart from the new block-level one; here both are O4, which gives {N_CLASSES}.</li>
            <li>Severity is judged for a reader reading straight through, not for a cataloguer or a corpus linguist.</li>
            <li>The study reads pages as stored. Where the renderer changes what the reader sees, we say so; most readers checked the stored text, not the screen.</li>
          </ul>
        </Section>

        <Section id="mechanisms" n={2} title="Seven mechanisms">
          <P>
            Grouped by what goes wrong underneath rather than by the stage where it shows, almost all the classes are one of seven things. The taxonomy assigned most classes to a mechanism; for the rest we made the assignment, marked &ldquo;placed here&rdquo; in §3. Five classes fit none of the seven and are listed together at the end.
          </P>
          <ol className="list-none p-0 m-0 space-y-5 mb-6">
            {data.mechanisms.filter(m => m.n > 0).map(m => {
              const ids = CLASSES.filter(c => c.mech === m.n);
              return (
                <li key={m.n} className="grid grid-cols-[2rem_1fr] gap-2">
                  <span className="text-2xl text-muted tabular-nums leading-none">{m.n}</span>
                  <div>
                    <a href={`#mech-${m.n}`} className="text-primary font-semibold hover:text-accent-rust">{m.title}</a>
                    <p className="text-secondary leading-relaxed mt-1">{m.text}</p>
                    <p className="text-sm text-muted mt-1">
                      {ids.map((c, i) => (
                        <span key={c.id}>{i > 0 && ' · '}<a href={`#${c.id}`} className="hover:text-accent-rust">{c.id}</a></span>
                      ))}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          <P>
            The first mechanism matters most because it defeats the usual checks. A transcription that is fluent and in the right language passes every test that reads text alone. A translation that is faithful to an invented transcription passes a judge that compares the two. Only a reading against the image finds it.
          </P>
        </Section>

        <Section id="classes" n={3} title="The classes, by mechanism">
          <P>
            Each entry gives what a reader of the page sees, the number of books in which the class was seen (presence, of six per stratum, never a rate), the link between scan and English that it breaks, whether any instrument we run detects it, example pages, and the issue where the work on it is tracked. A specimen follows where we could show the page.
          </P>
          <div className="mb-6"><SpecimenLegend /></div>
          {data.mechanisms.map(m => {
            const cs = CLASSES.filter(c => c.mech === m.n);
            return (
              <section key={m.n} id={`mech-${m.n}`} className="mt-12 scroll-mt-24">
                <h3 className="text-xl md:text-2xl text-primary mb-2">{m.n > 0 ? `${m.n}. ` : ''}{m.title}</h3>
                <p className="text-sm text-muted leading-relaxed mb-2 max-w-3xl">
                  {cs.length} classes.{cs.some(c => c.placed) && <> Placed here by this paper: {cs.filter(c => c.placed).map(c => c.id).join(', ')}.</>}
                </p>
                {cs.map(c => <ClassEntry key={c.id} c={c} />)}
              </section>
            );
          })}
        </Section>

        <Section id="instruments" n={4} title="What our instruments see">
          <P>
            The quality paper splits the reader&rsquo;s question into links: the image shown is the leaf transcribed, the transcription matches the leaf, the English matches the transcription. Here we add two more, that the reader is shown what was stored and that the catalogue describes the book. Figure 2 sorts the classes by the first link each breaks and counts what our instruments catch, as of 2 October 2026. Several checks were added in the week after the study; they are counted as detecting where they now run.
          </P>
          <Figure n={2} caption={<>Classes by the first link they break, and whether an instrument we run detects them. &ldquo;Partly&rdquo; means a check exists but sees only some forms of the class, or runs only on new pages. Counts are of classes, not of pages.</>}>
            <InstrumentTable />
          </Figure>
          <P>
            The pattern is plain. Faults that leave a trace in the text, such as a page cut short, a repeated block, a stray tag or a wrong page number, are now caught by checks that need no model. Faults in which fluent text stands in for the leaf are not: a confabulated page, a misread carried into good English, a silent omission, an invented note. These are caught only by a reader, or a model, that looks at the image. The quality paper measures how often they occur on a random page; this paper shows what they are.
          </P>
        </Section>

        <Section id="untested" n={5} title="What the sample could not test">
          <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-2">
            <li>Staff notation with underlaid text, lute tablature, lyrics in singing order: 2 of 12 &ldquo;music&rdquo; leaves carried notation, and none carried lyrics.</li>
            <li>Rashi script, rabbinic Bible layouts, printed Arabic and Persian: the right-to-left draw returned manuscripts and one Syriac edition.</li>
            <li>The known Tibetan fault in which the first line of a lower leaf is dropped: both Tibetan pairs failed earlier, so the test was moot.</li>
            <li>Right-to-left line order. On every page whose transcription was really of the page, line order and word order were correct. The fault in Hebrew, Syriac and Persian was the cursive hand, not the direction.</li>
            <li>Vertical column order in Chinese was correct on every page. The damage there was to single characters (O6).</li>
            <li>Nineteenth-century print was read very well, including Greek in footnotes and most Yoruba tone marks. Nearly all the harm a reader would see in those books was in the translation (T12, T13, T16).</li>
          </ul>
        </Section>

        <Section id="data" n={6} title="Data, sources and citation">
          <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-2">
            <li>The taxonomy, with every class, example and fix: <a href={`${GH}/blob/main/.claude/docs/page-error-taxonomy.md`} className="text-accent-rust hover:underline">page-error-taxonomy.md</a>.</li>
            <li>The sample, the draw script and the readers&rsquo; notes for each book: <a href={`${GH}/tree/main/scripts/eval/results/page-error-taxonomy-2026-09-25`} className="text-accent-rust hover:underline">scripts/eval/results/page-error-taxonomy-2026-09-25</a>.</li>
            <li>The data behind this page, including every specimen&rsquo;s crop box in the image&rsquo;s own pixels: <a href={`${GH}/blob/main/src/data/page-errors.json`} className="text-accent-rust hover:underline">src/data/page-errors.json</a>.</li>
            <li>One issue per new class: <a href={`${GH}/issues?q=%22Page+error+class%22+in%3Atitle`} className="text-accent-rust hover:underline">{STUDY.issueRange}</a>.</li>
            <li>The companion paper, with rates, confidence intervals and the reader panel: <Link href="/research/quality" className="text-accent-rust hover:underline">How page quality is measured</Link>.</li>
          </ul>
          <Figure n={3} caption={<>Presence of each class by stratum: the number of books, of six, in which the class was seen at least once. A dot means the readers looked and did not see it, not that it cannot occur there. Not a rate.</>}>
            <PresenceGrid />
          </Figure>
          <h3 className="text-lg text-primary font-semibold mb-3">Scans and rights</h3>
          <P>
            Each specimen credits the institution that holds the original and states the terms under which we show it. We checked the rights recorded for every scan, and the source where the record was unclear. We left out scans whose terms forbid further copying (the British Library&rsquo;s Tibetan collections) and two microfilm scans whose holder is not named. Page links open the page in the reader, where the full scan, transcription and translation can be compared.
          </P>
          <h3 className="text-lg text-primary font-semibold mb-3">How to cite</h3>
          <p className="text-sm text-secondary leading-relaxed mb-8 border-l-2 border-light pl-4">
            Source Library (2026). <em>What goes wrong on a page: a by-eye taxonomy of errors in AI transcription and translation of historical books.</em> Working draft, 2 October 2026. https://sourcelibrary.org/research/page-errors
          </p>
          <p className="text-sm text-muted leading-relaxed mb-12">
            A working draft, not peer-reviewed. Corrections and questions:{' '}
            <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:underline">team@sourcelibrary.org</a>.
          </p>
        </Section>
      </article>
    </ContentPageLayout>
  );
}
