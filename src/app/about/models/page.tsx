import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { JOBS, MODELS, engineFor, type PublicModel, type Status } from '@/data/public-models';
import { getModelUsageReport, type ModelUsageReport } from '@/lib/model-usage-report';

export const metadata: Metadata = {
  title: 'The Models We Use | Source Library',
  description:
    'Which machine read each page, which one translated it, for which books, why we chose it, and how it fails — with page counts from each page’s own record.',
  alternates: { canonical: '/about/models' },
};

// The counts come from one ops_reports document (scripts/audit/model-usage-snapshot.mjs).
// A read error throws so ISR keeps serving the last good page (rendering-and-seo.md).
export const revalidate = 21600;

const SNAPSHOT_SCRIPT = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/scripts/audit/model-usage-snapshot.mjs';
const LANE_FOR_JOB: Partial<Record<PublicModel['job'], string>> = { read: 'ocr', translate: 'translation' };

type Count = { pages: number; books: number; recent: number; languages: { language: string; books: number }[] };

function countsFor(report: ModelUsageReport | null) {
  const out = new Map<string, Count>();
  if (!report) return out;
  for (const e of report.engines ?? []) {
    if (e.lane === 'translation_es') continue;
    out.set(e.id, { pages: e.pages, books: e.books, recent: e.pages_last_30d, languages: e.languages });
  }
  return out;
}

function imageCounts(report: ModelUsageReport | null) {
  const out = new Map<string, { images: number; recent: number }>();
  for (const r of report?.images ?? []) {
    const id = engineFor('images', r.model, null) ?? 'img-older';
    const c = out.get(id) ?? { images: 0, recent: 0 };
    c.images += r.images;
    c.recent += r.images_last_30d;
    out.set(id, c);
  }
  return out;
}

const n0 = (n: number) => n.toLocaleString('en-US');
/** A planner estimate, not a count: say so, and do not print false precision. */
const about = (n: number) => (n >= 1e6 ? `about ${(n / 1e6).toFixed(1)} million` : `about ${n0(Math.round(n / 1000) * 1000)}`);
const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const STATUS_STYLE: Record<Status, string> = {
  'in use': 'text-primary border-accent-rust',
  starting: 'text-accent-rust border-accent-rust border-dashed',
  'no new pages': 'text-secondary border-light',
  fallback: 'text-secondary border-light',
  retired: 'text-muted border-dashed border-light',
};

export default async function ModelsPage() {
  const report = await getModelUsageReport();
  const counts = countsFor(report);
  const images = imageCounts(report);
  const asOf = report ? fmtDate(report.generated_at) : null;
  const spanish = report?.engines?.filter(e => e.lane === 'translation_es').reduce((s, e) => s + e.pages, 0) ?? 0;
  const searchPages = report?.search.find(s => s.table === 'page_translations')?.rows_estimated ?? null;
  const clipImages = report?.search.find(s => s.table === 'clip_embeddings')?.rows_estimated ?? null;

  function countLine(m: PublicModel) {
    if (!report) return null;
    if (m.job === 'images') {
      const c = images.get(m.id);
      return c ? `${n0(c.images)} pictures in the gallery` : null;
    }
    if (m.id === 'search-gemini-embedding' && searchPages) return `${about(searchPages)} pages searchable by meaning`;
    if (m.id === 'search-clip' && clipImages) return `${about(clipImages)} pictures compared`;
    if (!LANE_FOR_JOB[m.job]) return null;
    const c = counts.get(m.id);
    if (!c || c.pages === 0) return m.status === 'starting' ? 'starting now; no pages yet' : null;
    const recent = c.recent > 0 ? `; ${n0(c.recent)} in the last 30 days` : '';
    // A page belongs to one book, so more books than pages means the snapshot counted books
    // through pages without text (snapshots before the bookIfText fix): show pages only.
    const books = c.books <= c.pages ? ` in ${n0(c.books)} books` : '';
    return `${n0(c.pages)} pages${books}${recent}`;
  }

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Models We Use"
          subtitle="Which machine read each page, which one translated it, for which books, why we chose it, and how it fails."
        />
      }
      bg="bg-cream"
    >
      <div className="max-w-3xl">
        <p className="text-lg text-secondary leading-relaxed mb-4">
          Every transcription and translation in the library was written by a machine, and every page keeps a record
          of which one. This page lists those machines by the job they do. For each, it says which books it works on,
          why we chose it, and the mistakes it is known to make, with a link to the test behind each claim.
        </p>
        <p className="text-secondary leading-relaxed mb-8">
          {asOf ? (
            <>
              Page counts were taken from each page’s own record on {asOf}{' '}
              (<a href={SNAPSHOT_SCRIPT} className="text-accent-rust hover:underline">how they are counted</a>).
              A page counts once, under the model whose text it shows today.
            </>
          ) : (
            <>Page counts have not been taken yet; they will appear here after the first count.</>
          )}
        </p>

        <nav aria-label="Jobs" className="border-y border-light py-4 mb-10">
          <ul className="list-none p-0 m-0 space-y-2">
            {JOBS.map(j => (
              <li key={j.job} className="text-sm leading-snug">
                <a href={`#${j.job}`} className="text-primary font-semibold hover:text-accent-rust">{j.title}.</a>{' '}
                <span className="text-secondary">{j.sentence}</span>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {JOBS.map(j => {
        const models = MODELS.filter(m => m.job === j.job).filter(m => {
          // Rows with nothing to show (a retired lane with no pages left) stay off the page.
          if (m.status !== 'retired' || !report) return true;
          if (m.job === 'images') return (images.get(m.id)?.images ?? 0) > 0;
          return (counts.get(m.id)?.pages ?? 0) > 0;
        });
        return (
          <section key={j.job} id={j.job} className="mt-12 scroll-mt-24">
            <h2 className="text-2xl md:text-3xl text-primary mb-2">{j.title}</h2>
            <p className="text-secondary leading-relaxed mb-5 max-w-3xl">{j.sentence}</p>
            <div className="grid gap-4 md:grid-cols-2">
              {models.map(m => (
                <ModelCard
                  key={m.id}
                  m={m}
                  count={countLine(m)}
                  languages={LANE_FOR_JOB[m.job] ? counts.get(m.id)?.languages : undefined}
                  extra={m.id === 'tr-flash-lite' && spanish > 0 ? `${n0(spanish)} pages also translated into Spanish` : null}
                />
              ))}
            </div>
          </section>
        );
      })}

      <section className="mt-14 max-w-3xl">
        <h2 className="text-2xl md:text-3xl text-primary mb-3">How to read the counts</h2>
        <ul className="list-disc pl-5 space-y-2 text-secondary leading-relaxed">
          <li>
            A count is how many pages carry that model’s text today, not how many it ever read. When a specialist model
            re-reads a page, the page moves to the specialist.
          </li>
          <li>
            Blank pages and pages not yet read are not counted. Spanish translations are counted separately from English.
          </li>
          <li>
            A count says how much a model wrote, not how good it is. For quality, follow the test linked on each card, or
            read <Link href="/research/quality" className="text-accent-rust hover:underline">how we measure page quality</Link>.
          </li>
          <li>
            The steps every book goes through are described in{' '}
            <Link href="/about/processing" className="text-accent-rust hover:underline">how we process books</Link>.
          </li>
        </ul>
      </section>
    </ContentPageLayout>
  );
}

function ModelCard({ m, count, languages, extra }: {
  m: PublicModel;
  count: string | null;
  languages?: { language: string; books: number }[];
  extra: string | null;
}) {
  const langs = (languages ?? []).slice(0, 3).map(l => l.language);
  return (
    <article className="border border-light rounded bg-white/60 p-4 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-1">
        <h3 className="text-lg text-primary font-semibold">{m.name}</h3>
        <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${STATUS_STYLE[m.status]}`}>{m.status}</span>
      </div>
      {m.maker !== '—' && <div className="text-xs text-muted mb-2">{m.maker} · {m.access}</div>}
      {count && (
        <p className="text-sm text-primary mb-2">
          <span className="font-semibold tabular-nums">{count}</span>
          {langs.length > 0 && <span className="text-muted"> · mostly {langs.join(', ')}</span>}
          {extra && <span className="block text-muted">{extra}</span>}
        </p>
      )}
      <dl className="text-sm leading-snug space-y-1.5">
        <div><dt className="inline text-muted">For: </dt><dd className="inline text-secondary">{m.books}</dd></div>
        {m.why !== '—' && <div><dt className="inline text-muted">Why: </dt><dd className="inline text-secondary">{m.why}</dd></div>}
        <div><dt className="inline text-muted">Known weakness: </dt><dd className="inline text-secondary">{m.weakness}</dd></div>
      </dl>
      {m.version !== '—' && (
        <div className="text-xs text-muted mt-2 break-words">{m.access === 'existing text, no model' ? 'Source' : 'Model'}: <span className="font-mono">{m.version}</span></div>
      )}
      {m.evidence.length > 0 && (
        <div className="text-xs mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <span className="text-muted">Evidence:</span>
          {m.evidence.map(e => (
            <a key={e.href} href={e.href} className="text-accent-rust hover:underline">{e.label}</a>
          ))}
        </div>
      )}
    </article>
  );
}
