import type { Metadata } from 'next';
import evalData from '../../../scripts/output/hieroglyph-eval.json';

export const metadata: Metadata = {
  title: 'Hieroglyph OCR Eval — Source Library',
  description:
    'Side-by-side evaluation of Gemini AI hieroglyphic OCR against Budge\'s Egyptian Reading Book (1896).',
};

interface EvalEntry {
  page: number;
  label: string;
  imageUrl: string;
  ocrText: string;
}

const entries = evalData as EvalEntry[];

function OcrOutput({ text }: { text: string }) {
  // Split into sections based on === headers ===
  const sections = text.split(/^(===.*===)$/m).filter(Boolean);

  return (
    <div className="space-y-3">
      {sections.map((section, i) => {
        if (section.startsWith('===')) {
          return (
            <h4
              key={i}
              className="text-[10px] font-mono uppercase tracking-wider pt-2 first:pt-0"
              style={{ color: 'var(--accent-gold-dark)' }}
            >
              {section.replace(/=/g, '').trim()}
            </h4>
          );
        }
        // Check if this section contains hieroglyphs (Unicode range 13000-1342F)
        const hasHieroglyphs = /[\u{13000}-\u{1342F}]/u.test(section);
        return (
          <pre
            key={i}
            className={`whitespace-pre-wrap text-sm leading-relaxed ${
              hasHieroglyphs ? 'text-2xl leading-loose tracking-wide' : ''
            }`}
            style={{
              color: 'var(--text-primary)',
              fontFamily: hasHieroglyphs
                ? '"Noto Sans Egyptian Hieroglyphs", "Segoe UI Historic", serif'
                : 'inherit',
            }}
          >
            {section.trim()}
          </pre>
        );
      })}
    </div>
  );
}

export default function HieroglyphEvalPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-cream)' }}>
      {/* Google font for hieroglyphs */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Noto+Sans+Egyptian+Hieroglyphs&display=swap"
        rel="stylesheet"
      />

      <header
        className="border-b py-10 px-6"
        style={{ borderColor: 'var(--border-light)' }}
      >
        <div className="max-w-7xl mx-auto">
          <h1
            className="font-serif text-3xl font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Hieroglyph OCR Evaluation
          </h1>
          <p className="text-base mb-2" style={{ color: 'var(--text-muted)' }}>
            {entries.length} pages from Budge&apos;s <em>Egyptian Reading Book for Beginners</em> (1896).
            Gemini 2.0 Flash OCR output with Unicode hieroglyphs, compared against the original page.
          </p>
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
            Left: original scan from Internet Archive. Right: Gemini OCR output.
            The transliteration at the bottom of each page serves as ground truth for evaluation.
          </p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {entries.map((entry) => (
          <article
            key={entry.page}
            className="rounded-lg border overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-white)',
              borderColor: 'var(--border-light)',
            }}
          >
            {/* Title bar */}
            <div
              className="px-5 py-3 flex items-center justify-between border-b"
              style={{
                backgroundColor: 'var(--bg-warm)',
                borderColor: 'var(--border-light)',
              }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="font-serif text-lg font-semibold"
                  style={{ color: 'var(--accent-rust)' }}
                >
                  {entry.label}
                </span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-mono"
                  style={{
                    backgroundColor: 'var(--bg-cream)',
                    color: 'var(--text-muted)',
                  }}
                >
                  scan #{entry.page}
                </span>
              </div>
              <a
                href={`https://archive.org/details/egyptianreadingb00budguoft/page/n${entry.page}/mode/1up`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs hover:underline"
                style={{ color: 'var(--accent-rust)' }}
              >
                View on Internet Archive
              </a>
            </div>

            {/* Side-by-side: Image | OCR */}
            <div className="flex flex-col lg:flex-row gap-0">
              {/* Left: Original page image */}
              <div
                className="lg:w-1/2 p-4 flex justify-center border-b lg:border-b-0 lg:border-r"
                style={{
                  backgroundColor: '#f0ece3',
                  borderColor: 'var(--border-light)',
                }}
              >
                <div className="relative" style={{ maxWidth: '500px' }}>
                  <a
                    href={`https://archive.org/details/egyptianreadingb00budguoft/page/n${entry.page}/mode/1up`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={entry.imageUrl}
                      alt={`Page scan: ${entry.label}`}
                      loading="lazy"
                      className="w-full rounded shadow-sm"
                    />
                  </a>
                  <p
                    className="text-center mt-2 text-[10px] font-mono italic"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    Original scan — Internet Archive
                  </p>
                </div>
              </div>

              {/* Right: Gemini OCR output */}
              <div className="lg:w-1/2 p-5">
                <div className="flex items-center gap-1.5 mb-3 pb-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                  <span
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded font-medium"
                    style={{ backgroundColor: 'var(--accent-violet)/12', color: 'var(--accent-violet)' }}
                  >
                    Gemini 2.0 Flash
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                    OCR Output — Unicode Hieroglyphs
                  </span>
                </div>
                <OcrOutput text={entry.ocrText} />
              </div>
            </div>
          </article>
        ))}
      </main>
    </div>
  );
}
