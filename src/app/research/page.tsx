import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { posts } from '@/app/blog/page';

export const revalidate = false;

const OG_TITLE = 'Research at Source Library';
const OG_DESCRIPTION =
  'A working library is also an instrument. The questions we are trying to answer with it: whether machines read historical pages or recite them, what makes a scan readable, how much has never been translated, and what a first translation actually is.';

export const metadata: Metadata = {
  title: 'Research — Source Library',
  description: OG_DESCRIPTION,
  alternates: { canonical: '/research' },
  openGraph: {
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', width: 1200, height: 630, alt: 'Source Library — Digitizing and translating ancient texts' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: ['https://sourcelibrary.org/og-image.jpg'],
  },
};

const bySlug = new Map(posts.map(p => [p.slug, p]));

/** A link into the research: either a blog note (by slug, title pulled from the
 *  blog index so it can't drift) or a live instrument (by href + label).
 *  Unknown slugs are dropped rather than rendered as dead links. */
type Ref = { slug: string } | { href: string; label: string };

const QUESTIONS: { title: string; refs: Ref[] }[] = [
  {
    title: 'When a model transcribes a famous page, is it reading or reciting?',
    refs: [
      { slug: 'confident-hallucinator' },
      { slug: 'did-the-ai-read-this' },
    ],
  },
  {
    title: 'What makes a page readable in the first place?',
    refs: [{ slug: 'what-makes-a-good-scan' }],
  },
  {
    title: 'Where does machine reading break down by script?',
    refs: [
      { slug: 'tibetan-ocr' },
      { slug: 'rashi-ocr' },
      { slug: 'cuneiform-ocr' },
      { slug: 'hieroglyph-ocr' },
      { slug: 'reading-classical-chinese' },
    ],
  },
  {
    title: 'Can you catch a hallucination without ground truth?',
    refs: [
      { slug: 'ocr-consistency' },
      { slug: 'translation-collapse' },
    ],
  },
  {
    title: 'How much of the historical record has never been translated?',
    refs: [
      { slug: 'counting-the-gap' },
      { slug: 'untranslated-renaissance' },
      { slug: 'the-giants-werent-translated' },
      { slug: 'translation-rate' },
      { slug: 'how-long-to-translate' },
      { href: '/research/translation-gap', label: 'The translation gap' },
      { href: '/research/translation-registry', label: 'Translation registry' },
      { href: '/research/translation-lag', label: 'Translation lag' },
    ],
  },
  {
    title: 'What is a first translation, and how would you know?',
    refs: [
      { slug: 'first-translation-methodology' },
      { slug: 'counting-first-translations' },
      { slug: 'first-translations' },
    ],
  },
  {
    title: 'Can you trust the translation you are reading?',
    refs: [
      { slug: 'translation-collapse' },
      { slug: 'word-alignment' },
      { slug: 'does-ai-get-religion' },
      { slug: 'did-an-ai-write-the-encyclical' },
    ],
  },
  {
    title: 'What does the whole corpus look like from above?',
    refs: [
      { slug: 'ngram-viewer' },
      { slug: 'clustering' },
      { slug: 'visualizing-classification' },
      { slug: 'incunabula-knowledge-graph' },
      { slug: 'history-of-classification' },
      { href: '/ngrams', label: 'Ngram viewer' },
      { href: '/research/concept-diffusion', label: 'Concept diffusion' },
      { href: '/research/atlas', label: 'Text atlas' },
      { href: '/research/image-atlas', label: 'Image atlas' },
    ],
  },
];

function RefLinks({ refs }: { refs: Ref[] }) {
  const links = refs
    .map(r => {
      if ('href' in r) return { href: r.href, label: r.label, external: false };
      const p = bySlug.get(r.slug);
      return p ? { href: `/blog/${p.slug}`, label: p.title, external: false } : null;
    })
    .filter((l): l is NonNullable<typeof l> => Boolean(l));
  if (!links.length) return null;
  return (
    <p className="font-body text-sm leading-relaxed mt-1.5">
      {links.map((l, i) => (
        <span key={l.href}>
          {i > 0 && <span className="text-stone-300 mx-1.5">·</span>}
          <Link href={l.href} className="text-amber-800 hover:underline">
            {l.label}
          </Link>
        </span>
      ))}
    </p>
  );
}

export default function ResearchProgrammePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Research"
          subtitle="A working library is also an instrument. These are the questions we are trying to answer with it."
        />
      }
    >
      <div className="max-w-3xl mx-auto font-body text-stone-700">
        <p className="text-lg leading-relaxed py-8 border-b border-stone-200">
          Each question below started as an operational problem in keeping the library's
          promise honest, and each answer changed how the pipeline runs. We publish the
          results whether or not they flatter the system.
        </p>

        <ol className="list-none">
          {QUESTIONS.map((q, i) => (
            <li key={q.title} className="py-6 border-b border-stone-200 flex gap-5">
              <span className="font-body text-sm text-stone-400 tabular-nums pt-1.5 shrink-0">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div>
                <h2 className="font-serif text-xl md:text-2xl text-stone-900 tracking-tight">
                  {q.title}
                </h2>
                <RefLinks refs={q.refs} />
              </div>
            </li>
          ))}
        </ol>

        <div className="py-8 text-base text-stone-600 space-y-3">
          <p>
            <span className="font-body text-xs tracking-[0.16em] uppercase text-amber-700 font-semibold mr-3">Outputs</span>
            <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/.claude/docs/ocr-memorization-paper.md" className="text-amber-800 hover:underline">
              Reading or Reciting? (working paper)
            </a>
            <span className="text-stone-300 mx-1.5">·</span>
            <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/tree/main/scripts/eval/dataset" className="text-amber-800 hover:underline">
              OCR-eval dataset
            </a>
            <span className="text-stone-300 mx-1.5">·</span>
            <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/tree/main/scripts/eval" className="text-amber-800 hover:underline">
              evaluation code
            </a>
            <span className="text-stone-300 mx-1.5">·</span>
            <Link href="/blog" className="text-amber-800 hover:underline">
              all research notes
            </Link>
          </p>
          <p className="text-sm text-stone-500">
            Everything is reproducible on purpose: AGPL code, raw model outputs shipped with the
            dataset, dated snapshots, a <Link href="/developers" className="text-amber-800 hover:underline">public API</Link> and{' '}
            <Link href="/blog/mcp-server" className="text-amber-800 hover:underline">MCP server</Link>. A project of{' '}
            <a href="https://wisdomfrontiers.org" className="text-amber-800 hover:underline">Wisdom Frontiers</a>;
            collaboration and data access:{' '}
            <a href="mailto:derek@sourcelibrary.org" className="text-amber-800 hover:underline">derek@sourcelibrary.org</a>.
          </p>
        </div>
      </div>
    </ContentPageLayout>
  );
}
