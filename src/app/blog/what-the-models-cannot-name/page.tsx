import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

// Source of every figure here: issue #6038 — the run-1 headline comment (2026-10-06) and the
// "Run 2 result" comment (2026-10-07) — and the experiment files they cite:
// scripts/eval/experiments/2026-10-06-ai-exposure-refresh-6038.md (PR #6041) and
// scripts/eval/experiments/2026-10-07-ai-exposure-run2-6038.md (PR #6089, preregistration
// 41f1da023). The language and genre intervals are Wilson intervals on the counts in the run-2
// file. Nothing below was measured for this note; if a number is not in those, it does not belong here.

const HERO = 'https://images.sourcelibrary.org/artwork/art-raphael-raphael-after-heraclitus.jpg';
const HERO_ALT =
  'After Raphael, Heraclitus: a bearded philosopher leans on a stone block, his hand resting on a sheet of writing.';

const TITLE = 'What the Models Cannot Name';
const DESCRIPTION =
  'For about half of the distinct works we hold, none of Gemini 3.1 Pro, Claude Opus 5.5 or GPT-5.6 can name the author from the title; by volumes it is about a third. This measures what models can recall, not what they were trained on. The method, its controls, and where it sits among published methods.';

export const metadata: Metadata = {
  title: `${TITLE} - Research Notes - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description: 'For about half of the distinct works we hold, no frontier model can name the author from the title. A preregistered re-run of our May survey.',
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/blog/what-the-models-cannot-name' },
};

const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mt-14 mb-6';
const A = 'text-accent-rust hover:underline';
const CAP = 'text-center text-sm text-muted mt-3 italic';
const TH = 'text-left font-medium text-primary py-2 pr-4 border-b border-border-light';
const TD = 'py-2 pr-4 align-top border-b border-border-light text-secondary';

// Diagram colours (blog posts draw with literal stone-palette values, as the other notes do).
const INK = '#44403c';
const MUTED = '#a8a29e';
const RULE = '#d6d3d1';
const PAPER = '#fafaf9';
const LAPIS = '#1e40af';
const OCHRE = '#b45309';
const STOP = '#991b1b';

type Row = { label: string; v: number; lo?: number; hi?: number; color: string; strong?: boolean; note?: string };

/** Horizontal bars, with 95% intervals where the source gives one, all marks on one linear scale. */
function IntervalChart({ rows, max, ticks, label }: { rows: Row[]; max: number; ticks: number[]; label: string }) {
  const L = 200;
  const R = 640;
  const top = 18;
  const step = 34;
  const x = (v: number) => L + ((R - L) * v) / max;
  const bottom = top + rows.length * step;
  return (
    <svg viewBox={`0 0 720 ${bottom + 30}`} className="w-full h-auto" role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top - 8} y2={bottom} stroke={RULE} strokeWidth={1} />
          <text x={x(t)} y={bottom + 18} fontSize={11} fill={MUTED} textAnchor="middle">{t}%</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = top + i * step + step / 2;
        const end = Math.max(r.hi !== undefined ? x(r.hi) : 0, x(r.v));
        return (
          <g key={r.label}>
            <text x={L - 12} y={y + 4} fontSize={12.5} fill={INK} textAnchor="end" fontWeight={r.strong ? 700 : 400}>{r.label}</text>
            <rect x={L} y={y - 7} width={Math.max(1.5, x(r.v) - L)} height={14} rx={2} fill={r.color} opacity={0.85} />
            {r.lo !== undefined && r.hi !== undefined && (
              <g stroke={INK} strokeWidth={1.4}>
                <line x1={x(r.lo)} x2={x(r.hi)} y1={y} y2={y} />
                <line x1={x(r.lo)} x2={x(r.lo)} y1={y - 5} y2={y + 5} />
                <line x1={x(r.hi)} x2={x(r.hi)} y1={y - 5} y2={y + 5} />
              </g>
            )}
            <text x={end + 8} y={y + 4} fontSize={12} fill={INK} stroke={PAPER} strokeWidth={4} paintOrder="stroke">
              {r.v.toFixed(1)}%{r.note ? <tspan fill={MUTED}>{`  ${r.note}`}</tspan> : null}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const UNITS: Row[] = [
  { label: 'works', v: 52.2, lo: 47.4, hi: 56.9, color: OCHRE, strong: true, note: '217 of 416' },
  { label: 'volumes', v: 38.6, lo: 30.2, hi: 48.2, color: OCHRE },
  { label: 'pages', v: 35.3, lo: 27.4, hi: 43.9, color: OCHRE },
];
const MODELS: Row[] = [
  { label: 'Claude Opus 5.5', v: 56.7, color: MUTED },
  { label: 'Gemini 3.1 Pro', v: 62.5, color: MUTED },
  { label: 'GPT-5.6 Sol', v: 63.9, color: MUTED },
  { label: 'none of the three', v: 52.2, lo: 47.4, hi: 56.9, color: OCHRE, strong: true },
];
const SLICES: Row[] = [
  { label: 'disputations, orations', v: 75.9, lo: 65.5, hi: 84.0, color: OCHRE, note: 'n = 79' },
  { label: 'Latin', v: 62.6, lo: 56.7, hi: 68.1, color: OCHRE, note: 'n = 270' },
  { label: 'German', v: 56.4, lo: 41.0, hi: 70.7, color: OCHRE, note: 'n = 39' },
  { label: 'scripture, commentary', v: 48.5, lo: 32.5, hi: 64.8, color: OCHRE, note: 'n = 33' },
  { label: 'English', v: 11.8, lo: 4.7, hi: 26.6, color: OCHRE, note: 'n = 34' },
  { label: 'Chinese', v: 0, lo: 0, hi: 20.4, color: OCHRE, note: '0 of 15' },
];

function Arrowheads() {
  return (
    <defs>
      <marker id="rx-ink" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill={INK} /></marker>
      <marker id="rx-lapis" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill={LAPIS} /></marker>
      <marker id="rx-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill={MUTED} /></marker>
      <marker id="rx-stop" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill={STOP} /></marker>
    </defs>
  );
}

const CHANNELS = ['modern translation', 'critical edition', 'catalogue, Wikipedia', 'scholarly citations'];

function TwoQuestionsDiagram() {
  const box = { fill: PAPER, stroke: INK, strokeWidth: 1 };
  return (
    <svg viewBox="0 0 860 350" className="w-full h-auto min-w-[640px]" role="img" aria-label="A work reaches a model through translations, editions, catalogues and citations. Asking the model and checking its answer shows whether it knows the work. Whether it trained on our own scan cannot be tested from outside.">
      <Arrowheads />
      <rect x={10} y={120} width={160} height={70} rx={3} {...box} />
      <text x={90} y={148} fontSize={14} fontWeight={700} fill={INK} textAnchor="middle">The work</text>
      <text x={90} y={168} fontSize={11.5} fill={MUTED} textAnchor="middle">e.g. a Latin</text>
      <text x={90} y={182} fontSize={11.5} fill={MUTED} textAnchor="middle">disputation</text>
      {CHANNELS.map((c, i) => {
        const y = 20 + i * 56;
        return (
          <g key={c}>
            <rect x={250} y={y} width={180} height={40} rx={3} {...box} />
            <text x={340} y={y + 25} fontSize={12} fill={INK} textAnchor="middle">{c}</text>
            <path d={`M170,${140 + i * 8} C210,${140 + i * 8} 210,${y + 20} 248,${y + 20}`} stroke={INK} strokeWidth={1.2} fill="none" markerEnd="url(#rx-ink)" />
            <path d={`M430,${y + 20} C470,${y + 20} 470,${130 + i * 10} 508,${130 + i * 10}`} stroke={INK} strokeWidth={1.2} fill="none" markerEnd="url(#rx-ink)" />
          </g>
        );
      })}
      <text x={470} y={16} fontSize={11} fill={MUTED} textAnchor="middle">trained on</text>
      <rect x={250} y={276} width={180} height={50} rx={3} fill={PAPER} stroke={OCHRE} strokeWidth={1.6} />
      <text x={340} y={297} fontSize={12} fill={INK} textAnchor="middle">our scan + transcription</text>
      <text x={340} y={314} fontSize={11} fill={MUTED} textAnchor="middle">the file we hold</text>
      <path d="M170,176 C210,176 210,301 248,301" stroke={INK} strokeWidth={1.2} fill="none" markerEnd="url(#rx-ink)" />
      <path d="M430,301 C480,301 470,184 508,182" stroke={MUTED} strokeWidth={1.2} strokeDasharray="5 4" fill="none" markerEnd="url(#rx-muted)" />
      <text x={440} y={336} fontSize={11} fill={MUTED}>trained on?</text>
      <rect x={510} y={104} width={130} height={90} rx={3} {...box} />
      <text x={575} y={145} fontSize={14} fontWeight={700} fill={INK} textAnchor="middle">Frontier</text>
      <text x={575} y={163} fontSize={14} fontWeight={700} fill={INK} textAnchor="middle">model</text>
      <rect x={690} y={58} width={160} height={84} rx={3} fill={PAPER} stroke={LAPIS} strokeWidth={1.6} />
      <text x={770} y={84} fontSize={14} fontWeight={700} fill={LAPIS} textAnchor="middle">Recall</text>
      <text x={770} y={104} fontSize={12} fill={INK} textAnchor="middle">knows the work</text>
      <text x={770} y={122} fontSize={12} fill={INK} textAnchor="middle">this note measures it</text>
      <rect x={690} y={228} width={160} height={84} rx={3} fill={PAPER} stroke={STOP} strokeWidth={1.2} strokeDasharray="4 3" />
      <text x={770} y={254} fontSize={14} fontWeight={700} fill={INK} textAnchor="middle">Exposure</text>
      <text x={770} y={274} fontSize={12} fill={INK} textAnchor="middle">trained on our text</text>
      <text x={770} y={292} fontSize={12} fill={INK} textAnchor="middle">not testable from outside</text>
      <path d="M640,130 C665,130 665,100 688,100" stroke={LAPIS} strokeWidth={1.6} fill="none" markerEnd="url(#rx-lapis)" />
      <text x={575} y={94} fontSize={11} fill={LAPIS} textAnchor="middle">ask + check</text>
      <path d="M640,172 C665,172 665,270 688,270" stroke={MUTED} strokeWidth={1.2} strokeDasharray="5 4" fill="none" markerEnd="url(#rx-muted)" />
    </svg>
  );
}

const STEPS: { n: string; lines: string[]; color: string }[] = [
  { n: '1 · preregister', lines: ['estimand, scoring,', 'pass and retract', 'thresholds, fixed', 'before any call'], color: LAPIS },
  { n: '2 · draw', lines: ['seeded random 500', 'works, one edition', 'each; 416 with a', 'readable title + author'], color: INK },
  { n: '3 · controls', lines: ['famous works, an', 'obscure-but-known', 'tier, 40 invented', 'titles: gates'], color: LAPIS },
  { n: '4 · ask', lines: ['title only, author', 'masked: who wrote', 'it? Pro, Opus and', 'GPT-5.6'], color: INK },
  { n: '5 · score', lines: ['named author vs', 'our catalogue;', 'mismatches read', 'by eye'], color: LAPIS },
];

function PipelineDiagram() {
  const W = 156;
  const gap = 20;
  return (
    <svg viewBox="0 0 880 270" className="w-full h-auto min-w-[640px]" role="img" aria-label="Five steps: preregister; draw a seeded random 500 works; run controls that must pass; ask three frontier models to name the author from the title alone; score the named author against our catalogue.">
      <Arrowheads />
      {STEPS.map((s, i) => {
        const x = 6 + i * (W + gap + 2);
        return (
          <g key={s.n}>
            <rect x={x} y={30} width={W} height={112} rx={3} fill={PAPER} stroke={s.color} strokeWidth={s.color === INK ? 1 : 1.6} />
            <text x={x + 12} y={52} fontSize={11} fill={MUTED}>{s.n}</text>
            {s.lines.map((l, j) => (
              <text key={l} x={x + 12} y={76 + j * 18} fontSize={12} fill={INK}>{l}</text>
            ))}
            {i < STEPS.length - 1 && <path d={`M${x + W},86 L${x + W + gap},86`} stroke={INK} strokeWidth={1.2} markerEnd="url(#rx-ink)" />}
          </g>
        );
      })}
      <path d="M440,142 L440,198" stroke={STOP} strokeWidth={1.2} markerEnd="url(#rx-stop)" />
      <text x={450} y={176} fontSize={11} fill={STOP}>a gate fails</text>
      <rect x={335} y={202} width={210} height={52} rx={3} fill={PAPER} stroke={STOP} strokeWidth={1.2} strokeDasharray="4 3" />
      <text x={440} y={224} fontSize={12} fill={INK} textAnchor="middle">that model is reported,</text>
      <text x={440} y={242} fontSize={12} fill={INK} textAnchor="middle">not counted (Haiku)</text>
      <text x={794} y={172} fontSize={11} fill={MUTED} textAnchor="middle">unknown =</text>
      <text x={794} y={190} fontSize={11} fill={MUTED} textAnchor="middle">no model names</text>
      <text x={794} y={208} fontSize={11} fill={MUTED} textAnchor="middle">the author</text>
    </svg>
  );
}

const METHODS: { name: string; cite: string; x: number; y: number; color: string; ours?: boolean }[] = [
  { name: 'Min-K% Prob', cite: 'Shi et al., ICLR 2024', x: 190, y: 62, color: MUTED },
  { name: 'Dataset inference', cite: 'Maini et al. 2024 · whole collections', x: 190, y: 122, color: MUTED },
  { name: 'Name cloze', cite: 'Chang, Bamman et al. 2023', x: 540, y: 52, color: MUTED },
  { name: 'DE-COP', cite: 'Duarte et al., ICML 2024', x: 540, y: 100, color: MUTED },
  { name: 'Our May continuation test', cite: 'no signal (1.17×)', x: 540, y: 148, color: OCHRE },
  { name: 'Head-to-Tail', cite: 'Sun et al. 2023 · famous vs obscure', x: 540, y: 222, color: MUTED },
  { name: 'This note', cite: 'author recall + decoys + preregistration', x: 540, y: 282, color: LAPIS, ours: true },
];

function MethodsMap() {
  const cell = { fill: PAPER, stroke: RULE };
  return (
    <svg viewBox="0 0 860 380" className="w-full h-auto min-w-[640px]" role="img" aria-label="Published methods placed by what they ask about, a text or a work, and what access they need, token probabilities or plain questions. Only plain-question methods work on closed frontier models. This note is the work-level, plain-question method.">
      <rect x={150} y={20} width={350} height={160} {...cell} />
      <rect x={500} y={20} width={350} height={160} {...cell} />
      <rect x={150} y={180} width={350} height={160} {...cell} />
      <rect x={500} y={180} width={350} height={160} {...cell} />
      <text x={325} y={364} fontSize={11.5} fill={MUTED} textAnchor="middle">needs token probabilities (open models only)</text>
      <text x={675} y={364} fontSize={11.5} fill={MUTED} textAnchor="middle">plain questions (works on closed models)</text>
      <text x={140} y={96} fontSize={11.5} fill={MUTED} textAnchor="end">asks about</text>
      <text x={140} y={112} fontSize={11.5} fill={MUTED} textAnchor="end">the TEXT</text>
      <text x={140} y={256} fontSize={11.5} fill={MUTED} textAnchor="end">asks about</text>
      <text x={140} y={272} fontSize={11.5} fill={MUTED} textAnchor="end">the WORK</text>
      <text x={325} y={264} fontSize={11.5} fill={MUTED} textAnchor="middle">(rarely studied)</text>
      {METHODS.map((m) => (
        <g key={m.name}>
          <circle cx={m.x} cy={m.y} r={m.ours ? 7 : 5} fill={m.color} />
          <text x={m.x + 14} y={m.y + 4} fontSize={13.5} fontWeight={700} fill={m.ours ? LAPIS : INK}>{m.name}</text>
          <text x={m.x + 14} y={m.y + 22} fontSize={11.5} fill={MUTED}>{m.cite}</text>
        </g>
      ))}
    </svg>
  );
}

export default function WhatTheModelsCannotNamePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title={TITLE}
          subtitle="A preregistered re-run of our May survey. For about half of the distinct works we hold, no frontier model can name the author from the title. That says what the models can recall, not what they were trained on."
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">7 October 2026 &middot; 10 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link href="/blog" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          In May we estimated that about 43% of our transcribed books were &ldquo;confidently new to AI
          training&rdquo; (<Link href="/blog/did-the-ai-read-this" className={A}>Did the AI Read This?</Link>).
          We have now measured the question twice more on today&apos;s library, with current models,
          controls, and the method and its stopping rules written down before any model was asked. The
          result: for <strong>about half of the distinct works we hold (52%, 95% interval 47&ndash;57%)</strong>,
          none of Gemini 3.1 Pro, Claude Opus 5.5 or GPT-5.6 can name the author from the title. Counted by
          volumes it is about a third, because the works the models know tend to be the ones with many
          editions.
        </p>
        <p className={P}>
          That is a narrower claim than May&apos;s. A model that cannot name a work&apos;s author has not met the
          work in any form it can retrieve. It is not proof that the text was never in its training data, and
          no test run from outside a closed model can give that proof. This note explains why, shows how the
          measurement runs, and places it among the published methods.
        </p>

        <h2 className={H2}>Two questions that sound like one</h2>
        <p className={P}>
          &ldquo;Is this book in the training data?&rdquo; hides two questions. The first is whether the model
          knows the <em>work</em>: whether a translation, an edition, a catalogue entry or a scholarly citation
          has reached it. The second is whether it trained on <em>our file</em>, the scan and transcription we
          hold. A model can know the Iliad well without ever having seen our 1535 printing of it.
        </p>
        <figure className="my-10">
          <div className="overflow-x-auto"><TwoQuestionsDiagram /></div>
          <figcaption className={CAP}>
            A work reaches a model through many channels. Asking the model, and checking its answer, tests
            what it can recall. Whether it trained on our own text cannot be tested from outside.
          </figcaption>
        </figure>
        <p className={P}>
          The second question is the one the research literature calls <em>membership inference</em>, and the
          literature is discouraging. Duan and colleagues ran the standard tests on models whose training data
          is public and found they{' '}
          <a href="https://arxiv.org/abs/2402.07841v2" className={A}>barely beat random guessing</a>. Das and
          colleagues showed that many published successes came from comparing two different kinds of text, and
          that a test which never looks at the model{' '}
          <a href="https://arxiv.org/pdf/2406.16201" className={A}>can do better</a>. Our own May test agreed:
          given the first 80 characters of our transcription, a model continued books it &ldquo;knew&rdquo;
          only 1.17 times better than books it did not. So this note answers the first question and does not
          claim the second.
        </p>

        <h2 className={H2}>From &ldquo;do you know it?&rdquo; to &ldquo;who wrote it?&rdquo;</h2>
        <p className={P}>
          Our first re-run, on 6 October, simply asked the models whether they knew each work. Gemini 3.1 Pro
          said no to 45% of a random sample. A review of that run found the question too soft. Shown a
          work&apos;s title and author, Pro says it knows 59% of works; asked to name the author from the
          title alone, it manages 38%. Saying &ldquo;yes, I know it&rdquo; is much easier than recalling
          anything. The review also found that many of the &ldquo;unknown&rdquo; Tibetan records were volume
          labels and shelfmarks that nobody could recognise. So the second re-run asks for a fact that can be
          checked.
        </p>
        <figure className="my-10">
          <div className="overflow-x-auto"><PipelineDiagram /></div>
          <figcaption className={CAP}>
            Each step was fixed in a preregistration before the first model call, including the result that
            would make us retract the earlier figure.
          </figcaption>
        </figure>
        <p className={P}>
          We drew 500 works at random from every book with transcribed text, visible or not, one edition per
          work. 416 of them have a title a person could identify and an author in our catalogue to check
          against. Each model sees only the title, year and language; where the author&apos;s name is printed
          in the title, it is masked. It is asked who wrote the work, roughly when, and what it is about, and
          may guess if it marks the guess. The named author is matched against our catalogue mechanically, with
          names folded across scripts and spellings. A work counts as <em>known</em> if any of the three models
          names its author.
        </p>

        <h2 className={H2}>The controls</h2>
        <p className={P}>
          A model is counted only if it passes the controls. Claude Haiku did not, and is reported but
          excluded.
        </p>
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm border-collapse font-body">
            <thead>
              <tr>
                <th className={TH}>control</th>
                <th className={TH}>Gemini 3.1 Pro</th>
                <th className={TH}>Claude Opus 5.5</th>
                <th className={TH}>GPT-5.6 Sol</th>
                <th className={TH}>Claude Haiku</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <tr><td className={TD}>famous works, author named (21)</td><td className={TD}>85.7%</td><td className={TD}>90.5%</td><td className={TD}>85.7%</td><td className={TD}>66.7%, fails</td></tr>
              <tr><td className={TD}>obscure but known works (25)</td><td className={TD}>88%</td><td className={TD}>84%</td><td className={TD}>80%</td><td className={TD}>28%</td></tr>
              <tr><td className={TD}>invented titles called known (40)</td><td className={TD}>2.5%</td><td className={TD}>0%</td><td className={TD}>2.5%</td><td className={TD}>5%</td></tr>
            </tbody>
          </table>
        </div>
        <p className={P}>
          The famous works the models &ldquo;miss&rdquo; are catalogue quirks: our record for the Diamond
          Sūtra names its translator, the Qur&apos;an is catalogued under Muhammad. The one invented title two
          models accepted turned out to be a near twin of a real 1619 treatise on comets, a fault in the decoy
          rather than a bluff. A second run of Pro agreed with the first on 98% of works.
        </p>

        <h2 className={H2}>The result</h2>
        <figure className="my-10">
          <IntervalChart rows={UNITS} max={80} ticks={[0, 20, 40, 60, 80]} label="Share of the random sample whose author no frontier model can name: 52.2% of works, 38.6% of volumes, 35.3% of pages." />
          <figcaption className={CAP}>
            Share of the random sample whose author none of the three models can name, counted three ways,
            with 95% intervals.
          </figcaption>
        </figure>
        <p className={P}>
          The three counts answer different questions. By works it is about half. By volumes and pages it is
          about a third, because the famous works fill many volumes. Reading every mismatch by eye, some
          &ldquo;wrong&rdquo; answers name the right person under another spelling (Suso for Seuse, Sylvius for
          Dubois) or correct an error in our catalogue. Counting those as known gives 47.7% [43.1&ndash;52.6]
          of works.
        </p>
        <figure className="my-10">
          <IntervalChart rows={MODELS} max={80} ticks={[0, 20, 40, 60, 80]} label="Share of works whose author each model cannot name: Opus 56.7%, Pro 62.5%, GPT-5.6 63.9%; none of the three 52.2%." />
          <figcaption className={CAP}>
            Share of works whose author each model cannot name. The models know different works, so together
            they leave fewer unknown than any one alone.
          </figcaption>
        </figure>
        <figure className="my-10">
          <IntervalChart rows={SLICES} max={100} ticks={[0, 25, 50, 75, 100]} label="Share of works no model can name, by genre and language: disputations 75.9%, Latin 62.6%, German 56.4%, scripture and commentary 48.5%, English 11.8%, Chinese 0 of 15." />
          <figcaption className={CAP}>
            The same measure by genre and by language, with 95% intervals. Small groups have wide intervals.
          </figcaption>
        </figure>
        <p className={P}>
          The unknown works are concentrated where one would expect: university disputations, orations and
          dissertations (three in four unknown), and Latin and German books generally. English books are
          mostly known, and all 15 Chinese works in the sample are known.
        </p>
        <p className={P}>
          One correction to our first re-run matters for anyone reading about our Tibetan and Sanskrit
          holdings. That run reported 63% of that shelf as unrecognised. The figure came from volume labels
          and monastery records, not from the great works. All 17 works by the Nālandā masters that we hold,
          among them the Abhidharmakośa, the Madhyamakakārikā and the Bodhicaryāvatāra, are known to every
          model. Of seven Tibetan commentaries on them, five are not, but seven is too few to generalise from.
        </p>

        <h2 className={H2}>Where this sits among published methods</h2>
        <figure className="my-10">
          <div className="overflow-x-auto"><MethodsMap /></div>
          <figcaption className={CAP}>
            Methods placed by what they ask about and what access they need. Closed frontier models allow only
            the right-hand column.
          </figcaption>
        </figure>
        <p className={P}>
          Most published methods ask about the text. <a href="https://arxiv.org/pdf/2310.16789" className={A}>Min-K% Prob</a>{' '}
          and <a href="https://arxiv.org/abs/2406.06443v1" className={A}>dataset inference</a> need the
          model&apos;s token probabilities, which closed models do not expose. The{' '}
          <a href="https://www.ischool.berkeley.edu/news/2023/new-research-prof-david-bamman-reveals-chatgpt-seems-be-trained-copyrighted-books" className={A}>name-cloze test</a>{' '}
          asks a model to fill in a masked character name in a novel, and{' '}
          <a href="https://proceedings.mlr.press/v235/duarte24a.html" className={A}>DE-COP</a> asks it to pick a
          verbatim passage out of paraphrases. Both work on famous English books a model can partly reproduce.
          Against seventeenth-century Latin or a Tibetan manuscript they have nothing to detect. The closest
          relative of this note is work on long-tail knowledge such as{' '}
          <a href="https://arxiv.org/pdf/2308.10168" className={A}>Head-to-Tail</a>, which found that model
          accuracy falls from famous to obscure subjects. What this note adds is the guard rails: invented
          titles, an obscure-but-known control tier, a fact that is scored rather than a feeling that is
          reported, and a preregistered rule for when to retract.
        </p>

        <h2 className={H2}>What it does not show</h2>
        <ul className="list-disc pl-6 mb-6 space-y-3 text-secondary leading-relaxed font-body">
          <li>Whether any model trained on our transcriptions. Naming an author is recall of a work, which is stricter than recognising it and says nothing about which texts were in a training set.</li>
          <li>Whether the models know what the works <em>say</em>. A model can name the author of a treatise and know nothing of its argument.</li>
          <li>Our catalogue is the answer key. Where it is wrong, a model can be marked wrong for being right; we read every mismatch by eye, which is how the 47.7% figure arose.</li>
        </ul>
        <p className={P}>
          The next run tests the first two points from outside the models: whether passages of our
          transcriptions appear in the public web crawls that models are trained on, whether a model can answer
          questions about what a text says, and whether a machine-readable text of the work already exists
          elsewhere. The data, prompts, preregistrations and scripts are in{' '}
          <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6038" className={A}>issue #6038</a>.
        </p>
      </article>
    </ContentPageLayout>
  );
}
