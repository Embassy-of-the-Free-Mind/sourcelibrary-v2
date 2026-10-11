/**
 * /platform/admin/quality-methods — how the reading/translation quality methods fit together (2026-10-11).
 *
 * One idea runs through all of them: no single reader is trusted, human or machine. The page image (or the
 * source text) is the authority; every transcription and translation is a WITNESS; evidence is independent
 * witnesses from different model families agreeing, checked by a referee, with planted errors proving the
 * checks work. This page maps each method and each running job onto that flow, so a reader can see where a
 * piece of work sits and what decision it feeds.
 *
 * Static and hand-maintained: statuses are as of the date in the header, and every card links to its issue,
 * which is the live record. Server-rendered, no client JS, no database. Gated by the protected layout.
 */

type Status = 'live' | 'running' | 'queued' | 'proposed' | 'done';

interface Card {
  title: string;
  body: string;
  issue?: number;
  status?: Status;
}

interface Stage {
  n: number;
  name: string;
  question: string;
  cards: Card[];
}

const STATUS_STYLE: Record<Status, { color: string; background: string; label: string }> = {
  live: { color: '#3fb950', background: '#12261e', label: 'in production' },
  done: { color: '#3fb950', background: '#12261e', label: 'done' },
  running: { color: '#58a6ff', background: '#0c2d48', label: 'running' },
  queued: { color: '#d29922', background: '#2b2111', label: 'queued' },
  proposed: { color: '#a371f7', background: '#271a3d', label: 'proposed' },
};

const STAGES: Stage[] = [
  {
    n: 1,
    name: 'Authority',
    question: 'What settles a dispute?',
    cards: [
      { title: 'The page image', body: 'For transcription, the scan is the only authority. Every typed text, human or machine, is checked against it.', status: 'live' },
      { title: 'The source text', body: 'For translation, the original-language text (and its image) is the authority. A published translation is evidence, not truth.', status: 'live' },
    ],
  },
  {
    n: 2,
    name: 'Witnesses',
    question: 'Who produces a reading?',
    cards: [
      { title: 'Machine readers', body: 'Flash-Lite and 3 Flash (paid API, production); 3.6–3.8 Flash and 3.1 Pro (Gemini CLI, $0); Opus (Claude CLI, $0); PaddleOCR (GPU).', status: 'live' },
      { title: 'Machine translators', body: 'Flash-Lite / 3 Flash in production; 3.8 Flash via the CLI re-translated 23,627 Tengyur pages (better on 35 of 40 checked).', issue: 6361, status: 'done' },
      { title: 'Human typists', body: 'Typed editions we use as references: Wikisource, EEBO-TCP, DTA, CAMENA, Kanripo, CBETA, Esukhia, Sefaria. Measured error so far: Latin Wikisource 1.15%, Greek 0.07%, German 0.06%.', issue: 4523, status: 'done' },
      { title: 'Human translators', body: 'Published translations used as references: 84000, SuttaCentral, Sefaria, period translations. Their error rate has never been measured.' },
    ],
  },
  {
    n: 3,
    name: 'Combine',
    question: 'How are witnesses used together?',
    cards: [
      { title: 'One reader alone', body: "Today's pipeline: one model reads the page. The baseline every other strategy must beat.", status: 'live' },
      { title: 'Correction', body: "Reader B gets the image plus reader A's draft, from another family, and fixes it. Greif et al. 2025 report under 1% CER. Risk: copying the draft's errors (anchoring).", issue: 6544, status: 'queued' },
      { title: 'Disagreement', body: 'A and B read independently; only the disputed spans go to a referee with the image. Humphries: 4% of text flagged, 76% of errors caught, 0.23% CER. Ours: #6420 on served pages.', issue: 6420, status: 'live' },
      { title: 'Replication first', body: "Run Greif, Humphries and Unlocking the Archives on their own published data, so our numbers on our pages can be read against theirs.", issue: 6547, status: 'running' },
    ],
  },
  {
    n: 4,
    name: 'Referees',
    question: 'Who judges, and do they agree?',
    cards: [
      { title: 'Cross-family judges', body: 'Opus and Gemini 3.1 Pro both score every item, blind. A judge never has the headline on its own family\'s output (self-preference, Panickssery et al. 2024).', issue: 6545, status: 'queued' },
      { title: 'Convergence score', body: 'Krippendorff\'s alpha on scores; pairwise ranking agreement (the decision metric, Kocmi et al. 2021); error-span overlap. Each against the judge\'s own repeat agreement.', issue: 6545, status: 'queued' },
      { title: 'Tiebreak', body: 'Where the two judges split, Fable decides; pages still split are read by eye.' },
    ],
  },
  {
    n: 5,
    name: 'Controls',
    question: 'How do we know the checks work?',
    cards: [
      { title: 'Planted errors', body: 'Known mistakes slipped into drafts or translations. Catch rate for judges; survival rate = anchoring for correctors.', issue: 6544, status: 'queued' },
      { title: 'Noise floor', body: 'The same arm run twice. A difference counts only if it is larger than the run-to-run spread.', status: 'live' },
      { title: 'Failed reads: counted, not scored', body: 'Refusals, copy-filter cuts, empties and timeouts are shown as "did not read k of n" and left out of accuracy. Over 20% unread = "partly measured".', issue: 6523, status: 'queued' },
      { title: 'Structured output + tool gate', body: 'The CLI writes between <<<BEGIN>>>/<<<END>>> and may only open the image. Failed practice pages went from 22.6% to 3.3% error.', issue: 6523, status: 'running' },
    ],
  },
  {
    n: 6,
    name: 'Outputs',
    question: 'What changes because of it?',
    cards: [
      { title: 'Scores', body: 'The engine comparison page, redesigned around a summary table and verdict-only charts.', issue: 6524, status: 'running' },
      { title: 'Routing', body: 'Which reader and translator for which script. Open: manuscripts (#6544), hard-language translation (#6545).', issue: 6544, status: 'queued' },
      { title: 'Writes and holds', body: 'Tengyur: 23,627 pages live. Paddle Chinese: 4,379 flagged table pages, proposed hold + Opus re-read. Stale Siku English: 75,701 pages, decision pending.', issue: 6388, status: 'proposed' },
    ],
  },
];

const NEXT: Card[] = [
  {
    title: 'Humans as witnesses: the loop that is still open',
    body: 'Every accuracy score assumes the human reference is right. Point the same machinery the other way: two families compare typed editions with their images (keying error vs deliberate editorial change vs model misreading), and judge published translations blind beside ours. Then an engine gap only counts if it exceeds the reference\'s own error.',
    status: 'proposed',
  },
];

const C = {
  card: { background: '#161b22', border: '1px solid #30363d', borderRadius: 8 } as const,
  dim: { color: '#8b949e' } as const,
};

function StatusChip({ status }: { status?: Status }) {
  if (!status) return null;
  const s = STATUS_STYLE[status];
  return (
    <span style={{ color: s.color, background: s.background, borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
}

function MethodCard({ card }: { card: Card }) {
  return (
    <div style={{ ...C.card, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{card.title}</strong>
        <StatusChip status={card.status} />
      </div>
      <p style={{ ...C.dim, fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>{card.body}</p>
      {card.issue && (
        <a
          href={`https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/${card.issue}`}
          style={{ display: 'inline-block', marginTop: 6, fontSize: 12, color: '#58a6ff', textDecoration: 'none' }}
        >
          #{card.issue}
        </a>
      )}
    </div>
  );
}

export default function QualityMethodsPage() {
  return (
    <div style={{ padding: '24px 28px 64px', maxWidth: 1240, margin: '0 auto', color: '#e6edf3' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 6px' }}>Quality methods: how the pieces fit</h1>
      <p style={{ ...C.dim, fontSize: 13.5, maxWidth: 820, margin: '0 0 6px', lineHeight: 1.55 }}>
        No single reader is trusted, human or machine. The page image (or the source text) is the authority; every
        transcription and translation is a witness. Evidence is independent witnesses from different model families
        agreeing, checked by a referee, with planted errors proving the checks work. Read left to right: each stage
        feeds the next.
      </p>
      <p style={{ ...C.dim, fontSize: 12, margin: '0 0 22px' }}>Statuses as of 11 October 2026. Each issue is the live record.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, alignItems: 'start' }}>
        {STAGES.map((stage) => (
          <section key={stage.n} aria-labelledby={`stage-${stage.n}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ borderBottom: '2px solid #30363d', paddingBottom: 6, minHeight: 70 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase', ...C.dim }}>
                {stage.n} {stage.n < STAGES.length ? '→' : ''}
              </div>
              <h2 id={`stage-${stage.n}`} style={{ fontSize: 15, fontWeight: 600, margin: '2px 0 0' }}>{stage.name}</h2>
              <div style={{ ...C.dim, fontSize: 12 }}>{stage.question}</div>
            </div>
            {stage.cards.map((card) => <MethodCard key={card.title} card={card} />)}
          </section>
        ))}
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '30px 0 8px' }}>Next</h2>
      <div style={{ maxWidth: 820 }}>
        {NEXT.map((card) => <MethodCard key={card.title} card={card} />)}
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '30px 0 8px' }}>How one page moves through it</h2>
      <ol style={{ ...C.dim, fontSize: 13, lineHeight: 1.7, maxWidth: 820, paddingLeft: 18, margin: 0 }}>
        <li>A page is read by a witness (today one model; for hard pages, two from different families).</li>
        <li>If two witnesses disagree, or a draft is corrected, a referee looks at the image and settles the span.</li>
        <li>Two judges from different families score samples blind; their agreement says whether the score can be trusted.</li>
        <li>Planted errors and repeat runs check the judges and the correctors; failed reads are counted, not scored.</li>
        <li>The result routes the next pages (which reader, which translator), and changes or holds served text, with the old text kept in the revision history.</li>
      </ol>
    </div>
  );
}
