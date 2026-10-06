/**
 * The diagrams on /how-it-works (#5861), written for a library or a partner project
 * deciding whether to work with Source Library: how the whole line runs (and the checks
 * that loop over published pages), the two ways a page gets its text, what is recorded
 * with every page, and where people come in.
 *
 * Server components, HTML + CSS only: they read at phone width, need no client JS,
 * and every value shown is passed in from a record or a results file by the page.
 */
import type { ReactNode } from 'react';

const fmt = (n: number) => n.toLocaleString('en-US');

export function Figure({ n, title, caption, children }: { n: number; title: string; caption?: ReactNode; children: ReactNode }) {
  return (
    <figure className="my-12">
      <figcaption className="mb-5">
        <span className="font-sans text-xs font-semibold uppercase tracking-[0.12em] text-accent-rust">Figure {n}</span>
        <span className="block font-serif text-2xl md:text-3xl text-primary leading-tight mt-1">{title}</span>
      </figcaption>
      {children}
      {caption && <p className="font-sans text-sm text-muted leading-relaxed mt-4">{caption}</p>}
    </figure>
  );
}

/* ── Figure 1: the line, then the loop ─────────────────────────────────────── */

type Stage = { name: string; does: string; out: string; theirs?: string; pending?: boolean };

const LINE: Stage[] = [
  {
    name: 'Find',
    does: 'We take each page image from the library that holds the book, through IIIF or the archive’s own download, and keep a copy on our storage.',
    out: 'Page images, credited to the holding library',
    theirs: 'Pre-processing',
  },
  {
    name: 'Read',
    does: 'Where people have already typed the text, we fit their typing to our scans. Where not, a model reads each page image.',
    out: 'A transcription beside every page',
    theirs: 'Semantic Alignment',
  },
  {
    name: 'Translate',
    does: 'A model translates each page into English from its transcription, in batches.',
    out: 'English beside every page, marked as not yet reviewed',
    theirs: 'Draft Translation',
  },
  {
    name: 'Connect',
    does: 'Each page is indexed by meaning; the people, places and ideas on it go into the book’s index; other editions of the same work are linked.',
    out: 'A page that can be found by what it says',
  },
  {
    name: 'Publish',
    does: 'Scan, text and English side by side; full-text search; a stable link to every page; DOIs for editions; an AI-assistant connector.',
    out: 'A page anyone can read, quote and cite',
    theirs: 'Publication',
  },
];

const CHECK: Stage = {
  name: 'Check and correct',
  does: 'Checks run over the published pages, again and again. Our text is scored against typed editions and our English against published translations; detectors sweep for known faults. Pages that fail are repaired, run again or taken down, and each correction is kept as a revision.',
  out: 'Measured error rates, per canon and language',
  theirs: 'Automated Critique',
};

const SCHOLARS: Stage = {
  name: 'Scholars',
  does: 'A person who reads the source language reads our pages. Each correction is saved as a revision of the page.',
  out: 'Not yet: no scholar has reviewed pages in the Eternity canons',
  theirs: 'Human Review',
  pending: true,
};

function StageBox({ s, n }: { s: Stage; n?: number }) {
  return (
    <div
      className={`h-full rounded-sm border px-4 py-4 md:px-3 ${
        s.pending ? 'border-dashed border-border-medium bg-transparent' : 'border-border-light bg-white'
      }`}
    >
      {n !== undefined && <div className="font-sans text-xs text-accent-rust tabular-nums">{n}</div>}
      <div className="font-serif text-xl text-primary leading-tight mb-2">{s.name}</div>
      <p className="font-sans text-[13px] text-secondary leading-snug mb-3">{s.does}</p>
      <p className={`font-sans text-[13px] leading-snug font-medium ${s.pending ? 'text-accent-rust' : 'text-primary'}`}>{s.out}</p>
      {s.theirs && <p className="font-sans text-[11px] uppercase tracking-[0.08em] text-muted mt-3">{s.theirs}</p>}
    </div>
  );
}

export function LineFigure({ books, readable, languages }: { books: number; readable: number; languages: number }) {
  return (
    <Figure
      n={1}
      title="The line every book goes through, and the loop after it"
      caption={
        <>
          A book is published as soon as it is through the line; the checks run on published pages. Before that, each
          translation is checked once as it is written: one that is far too short or too long, that copies the original, or
          that slips into a third script is refused and kept aside. A partner can hold its books until they are checked, as
          the Derge Tengyur is held now. The grey label under each step is the name the Eternity Foundation’s Nālandā
          Restored programme uses for the same step. Today the library holds {fmt(books)} books in {fmt(languages)}{' '}
          languages; {fmt(readable)} of them can be read in English.
        </>
      }
    >
      <ol className="grid gap-3 md:grid-cols-5 md:gap-2">
        {LINE.map((s, i) => (
          <li key={s.name} className="relative">
            <StageBox s={s} n={i + 1} />
            {i < LINE.length - 1 && (
              <span aria-hidden className="hidden md:block absolute -right-[7px] top-8 z-10 text-muted text-sm">›</span>
            )}
          </li>
        ))}
      </ol>
      <div className="relative mt-3 md:mt-2 grid gap-3 md:grid-cols-5 md:gap-2">
        <div className="md:col-span-4 relative">
          <span aria-hidden className="block text-center md:text-right md:pr-[9%] font-sans text-sm text-muted leading-none mb-1">
            ↻ <span className="text-[11px] uppercase tracking-[0.08em]">over every published page</span>
          </span>
          <StageBox s={CHECK} n={LINE.length + 1} />
        </div>
        <div className="md:pt-5">
          <StageBox s={SCHOLARS} />
        </div>
      </div>
    </Figure>
  );
}

/* ── Figure 2: two ways to the text ─────────────────────────────────────────── */

function Route({ when, steps, example }: { when: string; steps: string[]; example: ReactNode }) {
  return (
    <div className="rounded-sm border border-border-light bg-white px-5 py-5">
      <div className="font-sans text-xs font-semibold uppercase tracking-[0.1em] text-accent-rust mb-3">{when}</div>
      <ol className="space-y-2 mb-4">
        {steps.map((st, i) => (
          <li key={i} className="flex gap-3 font-sans text-sm text-secondary leading-snug">
            <span className="text-muted tabular-nums">{i + 1}</span>
            <span>{st}</span>
          </li>
        ))}
      </ol>
      <div className="border-t border-border-light pt-3 font-sans text-[13px] text-muted leading-snug">{example}</div>
    </div>
  );
}

export function TextRoutesFigure({
  tengyurPages,
  examplePage,
}: {
  tengyurPages: number;
  examplePage: { model: string; label: string };
}) {
  return (
    <Figure
      n={2}
      title="Two ways a page gets its text"
      caption="A typed edition is the better source wherever one exists, because people made it and no model has read the page. The model’s reading is used where no one has typed the book, which is most of the library."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Route
          when="Someone has typed the text"
          steps={[
            'Take the typed edition, with its licence and the exact version used.',
            'Pair each typed folio with its page image, and check the pairing by reading a sample of pages.',
            'The page shows the typed text. No model reads the image.',
          ]}
          example={
            <>
              Example: the Derge Tengyur, typed by Esukhia. {fmt(tengyurPages)} pages are paired with BDRC’s woodblock
              scans.
            </>
          }
        />
        <Route
          when="No one has typed it"
          steps={[
            'A model reads the page image and writes out the text, in the original script.',
            'Where a typed text of the same work exists anywhere, we score the model’s reading against it.',
            'Pages it cannot read are marked as such, not filled in.',
          ]}
          example={<>Example: {examplePage.label}, read by {examplePage.model}.</>}
        />
      </div>
    </Figure>
  );
}

/* ── Figure 3: the record behind one page ───────────────────────────────────── */

export type PageRecord = {
  pageLabel: string;
  readerUrl: string;
  image: { from: string; sourceUrl?: string; archivedAt?: string; width?: number; height?: number };
  text?: { model: string; prompt?: string; at?: string };
  english?: { model: string; modelVersion?: string; prompt?: string; api?: string; batch?: string; hash?: string; at?: string };
  alignment?: { pairs: number; model?: string };
  revisions: number;
};

function RecordRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 md:grid-cols-[9rem_1fr] md:gap-4 py-3 border-b border-border-light last:border-0">
      <dt className="font-sans text-xs font-semibold uppercase tracking-[0.1em] text-muted pt-0.5">{label}</dt>
      <dd className="font-sans text-sm text-secondary leading-relaxed">{children}</dd>
    </div>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="text-[13px] text-primary bg-cream px-1 rounded-sm">{children}</code>
);

export function RecordFigure({ r }: { r: PageRecord }) {
  return (
    <Figure
      n={3}
      title="What we keep with every page"
      caption={
        <>
          This is the stored record of {r.pageLabel}, the page in the film, as it is in our database today. Every page carries
          the same fields, so any line of English can be traced to the image, the model and the run that produced it.{' '}
          <a href={r.readerUrl} className="text-accent-rust hover:underline">Open the page</a>.
        </>
      }
    >
      <dl className="rounded-sm border border-border-light bg-white px-5 py-2">
        <RecordRow label="Image">
          Scan from {r.image.from}
          {r.image.sourceUrl && (
            <>
              {' '}(<a href={r.image.sourceUrl} className="text-accent-rust hover:underline">original</a>)
            </>
          )}
          {r.image.width && r.image.height && <>, {r.image.width} × {r.image.height} pixels</>}.
          {r.image.archivedAt && <> Our copy made {r.image.archivedAt}; the original address is kept.</>}
        </RecordRow>
        {r.text && (
          <RecordRow label="Transcription">
            Read by <Code>{r.text.model}</Code>
            {r.text.prompt && <>, with our prompt {r.text.prompt}</>}
            {r.text.at && <>, on {r.text.at}</>}.
          </RecordRow>
        )}
        {r.english && (
          <RecordRow label="English">
            Drafted by <Code>{r.english.model}</Code>
            {r.english.modelVersion && <> (version <Code>{r.english.modelVersion}</Code>)</>}
            {r.english.prompt && <>, prompt {r.english.prompt}</>}
            {r.english.api && <>, through the {r.english.api}</>}
            {r.english.at && <>, on {r.english.at}</>}.
            {r.english.batch && <> Run <Code>{r.english.batch}</Code>.</>}
            {r.english.hash && <> Fingerprint of the text: <Code>{r.english.hash}</Code>.</>}
          </RecordRow>
        )}
        {r.alignment && (
          <RecordRow label="Alignment">
            {r.alignment.pairs} phrase pairs link the original to the English, so a reader can select a word on one side and
            see it on the other. Each pairing stores fingerprints of both texts, so it is known to be stale if either changes.
          </RecordRow>
        )}
        <RecordRow label="Revisions">
          {r.revisions === 0
            ? 'None yet. When the text or English is corrected, the earlier version and the reason are kept as a revision, never overwritten.'
            : `${r.revisions} earlier version${r.revisions === 1 ? '' : 's'} kept. A correction is saved as a revision with its reason; nothing is overwritten.`}
        </RecordRow>
      </dl>
    </Figure>
  );
}

/* ── Figure 4: where people come in ─────────────────────────────────────────── */

export function PeopleFigure({ draftLabel }: { draftLabel: string }) {
  const box = 'rounded-sm border px-4 py-4';
  return (
    <Figure
      n={4}
      title="Where people come in"
      caption={
        <>
          The first layer is in place for every canon with a typed text or a published translation. The second has not
          started. Measurements, canon by canon, are on{' '}
          <a href="/research/canon-quality" className="text-accent-rust hover:underline">How we check each canon</a>.
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <div className={`${box} border-border-light bg-white`}>
          <div className="font-sans text-xs font-semibold uppercase tracking-[0.1em] text-accent-rust mb-2">Now · people’s work as the yardstick</div>
          <p className="font-sans text-sm text-secondary leading-relaxed">
            Texts typed by people (Esukhia’s Derge, GRETIL, CBETA, Sefaria, Ganjoor) check our transcriptions. Translations
            published by people (84000, SuttaCentral) check our English, scored by two AI judges that do not know which
            version is ours.
          </p>
        </div>
        <div className={`${box} border-dashed border-border-medium`}>
          <div className="font-sans text-xs font-semibold uppercase tracking-[0.1em] text-accent-rust mb-2">Next · a scholar reads our pages</div>
          <p className="font-sans text-sm text-secondary leading-relaxed">
            Batches of pages, each with the image, the original and our English. The scholar marks what is wrong and whether
            they would start from this draft. Corrections become revisions; verdicts are set beside the AI judges’ on the
            same pages, which tells us how far to trust the AI judges on the rest.
          </p>
        </div>
        <div className={`${box} border-border-light bg-white`}>
          <div className="font-sans text-xs font-semibold uppercase tracking-[0.1em] text-accent-rust mb-2">Always · what the reader is told</div>
          <p className="font-sans text-sm text-secondary leading-relaxed">
            Until a page has been reviewed, its English carries the label:
          </p>
          <p className="mt-2 text-base italic text-primary">“{draftLabel}”</p>
          <p className="font-sans text-sm text-secondary leading-relaxed mt-2">Any reader can report a problem on any page.</p>
        </div>
      </div>
    </Figure>
  );
}
