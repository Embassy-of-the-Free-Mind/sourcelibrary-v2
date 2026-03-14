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
  pass1Text: string;
  pass2Text: string;
}

const entries = evalData as EvalEntry[];

/** Extract hieroglyph lines from OCR text */
function extractHieroLines(text: string): string[] {
  // Match either === HIEROGLYPHS === or === CORRECTED HIEROGLYPHS ===
  const match = text.match(/(?:HIEROGLYPHS|CORRECTED HIEROGLYPHS)\s*===?\s*\n([\s\S]*?)(?:\n\s*(?:===|###|\n\n))/);
  if (!match) return [];
  return match[1].trim().split('\n').filter(l => l.trim() && /^\d+\./.test(l.trim()));
}

/** Extract transliteration from OCR text */
function extractTransliteration(text: string): string | null {
  const match = text.match(/TRANSLITERATION\s*===?\s*\n([\s\S]*?)(?:\n\s*(?:===|###)|$)/);
  return match ? match[1].trim() : null;
}

/** Extract corrections from pass 2 */
function extractCorrections(text: string): string | null {
  const match = text.match(/CORRECTIONS\s*===?\s*\n([\s\S]*?)$/);
  return match ? match[1].trim() : null;
}

function HieroLines({ lines }: { lines: string[] }) {
  return (
    <div className="space-y-1">
      {lines.map((line, i) => (
        <p
          key={i}
          className="text-lg leading-loose tracking-wide"
          style={{
            color: 'var(--text-primary)',
            fontFamily: '"Noto Sans Egyptian Hieroglyphs", "Segoe UI Historic", serif',
          }}
        >
          {line}
        </p>
      ))}
    </div>
  );
}

export default function HieroglyphEvalPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-cream)' }}>
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
            Two-pass pipeline: Gemini 3 Flash Preview direct Unicode OCR, then self-correction pass.
          </p>
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
            Left: original scan. Middle: pass 1 (direct Unicode). Right: pass 2 (corrected).
            Transliteration at bottom serves as ground truth.
          </p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {entries.map((entry) => {
          const pass1Lines = extractHieroLines(entry.pass1Text);
          const pass2Lines = extractHieroLines(entry.pass2Text);
          const translit = extractTransliteration(entry.pass2Text) || extractTransliteration(entry.pass1Text);
          const corrections = extractCorrections(entry.pass2Text);

          return (
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

              {/* Three-column: Scan | Pass 1 | Pass 2 */}
              <div className="flex flex-col lg:flex-row gap-0">
                {/* Left: Original scan */}
                <div
                  className="lg:w-1/3 p-4 flex justify-center border-b lg:border-b-0 lg:border-r"
                  style={{
                    backgroundColor: '#f0ece3',
                    borderColor: 'var(--border-light)',
                  }}
                >
                  <div className="relative w-full">
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

                {/* Middle: Pass 1 */}
                <div className="lg:w-1/3 p-4 border-b lg:border-b-0 lg:border-r" style={{ borderColor: 'var(--border-light)' }}>
                  <div className="flex items-center gap-1.5 mb-3 pb-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: '#e3f2fd', color: '#1565c0' }}
                    >
                      Pass 1
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                      Direct Unicode OCR
                    </span>
                  </div>
                  <HieroLines lines={pass1Lines} />
                </div>

                {/* Right: Pass 2 */}
                <div className="lg:w-1/3 p-4">
                  <div className="flex items-center gap-1.5 mb-3 pb-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: '#e8f5e9', color: '#2e7d32' }}
                    >
                      Pass 2
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                      Self-corrected
                    </span>
                  </div>
                  <HieroLines lines={pass2Lines} />
                </div>
              </div>

              {/* Transliteration + Corrections */}
              <div
                className="px-5 py-3 border-t"
                style={{
                  backgroundColor: 'var(--bg-warm)',
                  borderColor: 'var(--border-light)',
                }}
              >
                {translit && (
                  <div className="mb-3">
                    <h4
                      className="text-[10px] font-mono uppercase tracking-wider mb-2"
                      style={{ color: 'var(--accent-gold-dark)' }}
                    >
                      Transliteration (Ground Truth)
                    </h4>
                    <pre
                      className="whitespace-pre-wrap text-sm leading-relaxed"
                      style={{ color: 'var(--text-primary)', fontFamily: 'inherit' }}
                    >
                      {translit}
                    </pre>
                  </div>
                )}
                {corrections && (
                  <details className="mt-2">
                    <summary
                      className="text-[10px] font-mono uppercase tracking-wider cursor-pointer"
                      style={{ color: 'var(--text-faint)' }}
                    >
                      Pass 2 Corrections Log
                    </summary>
                    <pre
                      className="whitespace-pre-wrap text-xs leading-relaxed mt-2"
                      style={{ color: 'var(--text-muted)', fontFamily: 'inherit' }}
                    >
                      {corrections}
                    </pre>
                  </details>
                )}
              </div>
            </article>
          );
        })}
      </main>
    </div>
  );
}
