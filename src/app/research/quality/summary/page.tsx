import { Metadata } from 'next';
import Link from 'next/link';
import byLanguage from '@/data/quality-by-language.json';
import { KEY_FINDINGS } from '../findings';

// A one-page summary of /research/quality for handing to partners and funders: it prints on one
// sheet (browser Print → Save as PDF). Every figure comes from the same files as the paper.
export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Page Quality — One-Page Summary — Source Library Research',
  description: 'How good are Source Library’s transcriptions and translations, language by language, and how sure are we? A one-page summary of the working paper.',
  alternates: { canonical: '/research/quality/summary' },
};

const PAPER = '/research/quality';
const pct = (x: number) => `${Math.round(x * 100)}%`;
const cer = (x: number | null) => (x == null ? '—' : x < 0.01 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 1000) / 10}%`);

function Bar({ p, lo, hi }: { p: number; lo: number; hi: number }) {
  const W = 90, x = (v: number) => 3 + v * (W - 6);
  return (
    <svg viewBox={`0 0 ${W} 10`} className="w-[5.6rem] h-auto shrink-0" role="img" aria-label={`${pct(p)}, 95% CI ${pct(lo)}–${pct(hi)}`}>
      <line x1={x(0)} x2={x(1)} y1={5} y2={5} stroke="var(--border-light)" strokeWidth="1" />
      <line x1={x(lo)} x2={x(hi)} y1={5} y2={5} stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
      <circle cx={x(p)} cy={5} r="3" fill="var(--accent-rust)" />
    </svg>
  );
}

const CHAIN = [
  { n: 1, name: 'Leaf', q: 'The image shown is the leaf transcribed', fail: 'wrong leaf' },
  { n: 2, name: 'Transcription', q: 'The text matches the image', fail: 'misread, garble, recitation' },
  { n: 3, name: 'Translation', q: 'The English matches the transcription', fail: 'omission, invention, inversion' },
];

export default function QualitySummaryPage() {
  return (
    <main className="bg-cream min-h-screen print:bg-white">
      <article className="max-w-5xl mx-auto px-4 py-10 print:py-0 print:px-0 text-[13px] leading-snug">
        <header className="border-b border-light pb-4 mb-5">
          <div className="text-xs uppercase tracking-[0.16em] text-muted font-semibold mb-2">
            Source Library · Page quality · summary of the working paper · data as of {byLanguage.generated}
          </div>
          <h1 className="text-2xl md:text-3xl text-primary font-serif leading-tight text-balance">Does this English say what is printed on this leaf?</h1>
          <p className="text-secondary mt-2 max-w-3xl text-sm leading-relaxed">
            Source Library serves AI transcriptions and English translations of historical books in more than fifteen languages. A page is right for a reader only when three links hold. This sheet shows how well each is measured, language by language, and what is not yet known.
          </p>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5" aria-label="The three links">
          {CHAIN.map(c => (
            <div key={c.n} className="border-t-2 border-accent-rust pt-2">
              <div className="text-primary font-semibold">{c.n}. {c.name}</div>
              <div className="text-secondary">{c.q}</div>
              <div className="text-muted text-xs">Fails as: {c.fail}</div>
            </div>
          ))}
        </section>

        <section aria-label="Key findings" className="mb-5">
          <ol className="grid gap-2 grid-cols-1 sm:grid-cols-5 list-none p-0 m-0">
            {KEY_FINDINGS.map(f => (
              <li key={f.figure} className="border border-light rounded bg-white/60 p-2.5 min-w-0 print:break-inside-avoid">
                <div className="text-xl text-primary font-serif tabular-nums">{f.figure}</div>
                <div className="text-xs text-secondary leading-snug">{f.text}</div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mb-5" aria-labelledby="by-language">
          <h2 id="by-language" className="text-lg text-primary font-serif mb-2">Quality by language</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="text-left text-muted border-b border-light">
                  <th className="py-1 pr-2 font-medium">Language</th>
                  <th className="py-1 pr-2 font-medium text-right">Share of pages</th>
                  <th className="py-1 pr-2 font-medium">Character error (Flash-Lite) · books</th>
                  <th className="py-1 pr-2 font-medium">Rated faithful by the judge · books</th>
                  <th className="py-1 font-medium">What is missing</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {byLanguage.rows.map(r => {
                  const o = r.ocr.current, t = r.translation;
                  return (
                    <tr key={r.language} className="border-b border-light align-top">
                      <td className="py-1 pr-2 text-primary font-medium">{r.language}</td>
                      <td className="py-1 pr-2 text-right text-secondary">{r.share_of_translated_pages}%</td>
                      <td className="py-1 pr-2 text-secondary">{o.median_cer == null ? <span className="text-muted">no reference</span> : <>{cer(o.median_cer)} <span className="text-muted">· {o.books_referenced}</span></>}</td>
                      <td className="py-1 pr-2">
                        <span className="flex items-center gap-1.5"><Bar p={t.share} lo={t.ci[0]} hi={t.ci[1]} /><span className="text-secondary">{pct(t.share)}</span><span className="text-muted">· {t.books}</span></span>
                      </td>
                      <td className="py-1 text-muted leading-snug">{r.caveat?.text ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted mt-1.5 leading-snug">
            Character error: median against a published e-text, one page per book; Flash-Lite has read every new page since 11 September 2026. Faithful: share of one-page-per-book samples Claude Opus rated 4 or 5 of 5, with the 95% interval ({byLanguage.translation_books} books, pooled monthly audits); a model&rsquo;s judgement, not accuracy. Under 30 books a figure is exploratory.
          </p>
        </section>

        <section className="grid gap-5 sm:grid-cols-2 mb-5">
          <div>
            <h2 className="text-lg text-primary font-serif mb-1.5">What we cannot say yet</h2>
            <ul className="list-disc pl-4 space-y-1 text-secondary">
              <li><strong className="text-primary">The judge&rsquo;s own error rate.</strong> Every check is a model, or a model reading an image.</li>
              <li><strong className="text-primary">How often the leaf is wrong.</strong> Two in twenty audited pages showed the wrong leaf; the true rate could be 3% or 30%.</li>
              <li><strong className="text-primary">Accuracy in most scripts.</strong> Without a published text, two reads measure agreement, and two models can share a mistake.</li>
              <li><strong className="text-primary">Memorised texts.</strong> A model that knows a famous work can reproduce it without reading the page.</li>
            </ul>
          </div>
          <div>
            <h2 className="text-lg text-primary font-serif mb-1.5">Next: readers of the original</h2>
            <ul className="list-disc pl-4 space-y-1 text-secondary">
              <li>Volunteers who read a language get one page at a time and answer one question: <em>does the English say what this page says?</em></li>
              <li>Pages alternate between those the judge called sound and defective, so both groups fill.</li>
              <li>One answered page in five goes to a second reader, to measure how often two readers agree: the ceiling for any judge.</li>
              <li>Preregistered; awaiting ethics approval. No page has been sent.</li>
            </ul>
          </div>
        </section>

        <footer className="border-t border-light pt-3 text-xs text-muted flex flex-wrap gap-x-5 gap-y-1">
          <span>Full working paper, methods and sources: <Link href={PAPER} className="text-accent-rust hover:underline">sourcelibrary.org/research/quality</Link></span>
          <span>Data and code: scripts/eval in the public repository (AGPL)</span>
          <span>team@sourcelibrary.org</span>
        </footer>
      </article>
    </main>
  );
}
