import type { Metadata } from 'next';
import corpus from '../../../scripts/output/cuneiform-corpus.json';
import {
  tokenizeAtfLine,
  type AtfToken,
} from '@/lib/cuneiform-signs';

export const metadata: Metadata = {
  title: 'Cuneiform Tablet Corpus — Source Library',
  description:
    '107 cuneiform tablets from CDLI with photos, metadata, and scholarly ATF transliterations.',
};

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PhotoBounds {
  layout: string;
  surfaces: { label: string; bbox: BBox }[];
}

interface Tablet {
  pId: string;
  designation: string;
  period: string;
  periodShort: string;
  language: string;
  genre: string;
  museum: string;
  museumNo: string;
  photoUrl: string;
  cdliUrl: string;
  atf: string;
  lineCount: number;
  surfaces: string[];
  hasDamage: boolean;
  hasTranslation: boolean;
  difficulty: string;
  photoBounds?: PhotoBounds;
}

interface ParsedLine {
  lineNum: string;
  text: string;
  tokens: AtfToken[];
}

interface ParsedSection {
  surface: string;
  lines: ParsedLine[];
}

function parseAtf(raw: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (
      trimmed.startsWith('&') ||
      trimmed.startsWith('#') ||
      trimmed === '@tablet' ||
      trimmed === ''
    )
      continue;

    const surfaceMatch = trimmed.match(
      /^@(obverse|reverse|left|right|top|bottom|seal\s*\d*|column\s*\d*)/i
    );
    if (surfaceMatch) {
      current = { surface: surfaceMatch[1], lines: [] };
      sections.push(current);
      continue;
    }

    if (current && /^\d+[\.\']/.test(trimmed)) {
      const numMatch = trimmed.match(/^(\d+)[\.']\s*(.*)/);
      if (numMatch) {
        const [, lineNum, text] = numMatch;
        current.lines.push({
          lineNum,
          text,
          tokens: tokenizeAtfLine(text),
        });
      }
    } else if (current && trimmed.startsWith('$')) {
      current.lines.push({
        lineNum: '',
        text: trimmed,
        tokens: [],
      });
    }
  }

  return sections;
}

const difficultyColor: Record<string, string> = {
  easy: 'bg-status-success/15 text-status-success',
  medium: 'bg-status-warning/15 text-status-warning',
  hard: 'bg-status-error/15 text-status-error',
};

const tablets = corpus as Tablet[];

const periods = [...new Set(tablets.map((t) => t.periodShort))];
const languages = [...new Set(tablets.map((t) => t.language))];
const genres = [...new Set(tablets.map((t) => t.genre))];

export default function TabletsPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-cream)' }}>
      <header
        className="border-b py-10 px-6"
        style={{ borderColor: 'var(--border-light)' }}
      >
        <div className="max-w-7xl mx-auto">
          <h1
            className="font-serif text-3xl font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Cuneiform Tablet Corpus
          </h1>
          <p className="text-base mb-4" style={{ color: 'var(--text-muted)' }}>
            {tablets.length} tablets from CDLI with photos, cuneiform signs, and
            scholarly ATF transliterations.
          </p>
          <div
            className="flex flex-wrap gap-4 text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span>
              <strong>{periods.length}</strong> periods
            </span>
            <span>
              <strong>{languages.length}</strong> language
              {languages.length > 1 ? 's' : ''}
            </span>
            <span>
              <strong>{genres.length}</strong> genre
              {genres.length > 1 ? 's' : ''}
            </span>
            <span>
              <strong>{tablets.filter((t) => t.hasDamage).length}</strong> with
              damage
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {tablets.map((tablet) => {
          const sections = parseAtf(tablet.atf);
          return (
            <article
              key={tablet.pId}
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
                  <a
                    href={tablet.cdliUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-serif text-lg font-semibold hover:underline"
                    style={{ color: 'var(--accent-rust)' }}
                  >
                    {tablet.designation}
                  </a>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-mono"
                    style={{
                      backgroundColor: 'var(--bg-cream)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {tablet.pId}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${difficultyColor[tablet.difficulty] || ''}`}
                  >
                    {tablet.difficulty}
                  </span>
                  {tablet.hasDamage && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-status-warning/15 text-status-warning font-medium">
                      damaged
                    </span>
                  )}
                </div>
                <div
                  className="text-xs space-x-3"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <span>{tablet.periodShort}</span>
                  <span>{tablet.language}</span>
                  <span>{tablet.genre}</span>
                </div>
              </div>

              {/* Each surface gets its own cropped photo section */}
              {sections.length > 0 ? (
                <div className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
                  {sections.map((section, si) => {
                    // Find matching bounding box from Gemini detection
                    const bounds = tablet.photoBounds?.surfaces?.find(
                      (s) => s.label === section.surface
                    );
                    return (
                    <div
                      key={si}
                      className="grid grid-cols-1 md:grid-cols-[280px_1fr]"
                    >
                      {/* Cropped photo for this surface — uses bbox to show only this part */}
                      <div
                        className="p-3 flex items-center justify-center border-b md:border-b-0 md:border-r"
                        style={{
                          backgroundColor: '#f0ece3',
                          borderColor: 'var(--border-light)',
                        }}
                      >
                        {bounds ? (
                          <a
                            href={tablet.cdliUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`${section.surface} of ${tablet.designation}`}
                            className="block overflow-hidden rounded shadow-sm"
                            style={{
                              width: '100%',
                              aspectRatio: `${bounds.bbox.w} / ${bounds.bbox.h}`,
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={tablet.photoUrl}
                              alt={`${section.surface} of ${tablet.designation}`}
                              loading="lazy"
                              style={{
                                display: 'block',
                                width: `${(1 / bounds.bbox.w) * 100}%`,
                                height: `${(1 / bounds.bbox.h) * 100}%`,
                                maxWidth: 'none',
                                objectFit: 'cover',
                                marginLeft: `${-(bounds.bbox.x / bounds.bbox.w) * 100}%`,
                                marginTop: `${-(bounds.bbox.y / bounds.bbox.h) * 100}%`,
                              }}
                            />
                          </a>
                        ) : (
                          <a
                            href={tablet.cdliUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`View ${tablet.designation} on CDLI`}
                            className="block w-full overflow-hidden rounded"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={tablet.photoUrl}
                              alt={`${section.surface} of ${tablet.designation}`}
                              className="w-full shadow-sm"
                              loading="lazy"
                            />
                          </a>
                        )}
                      </div>

                      {/* Cuneiform signs for this surface */}
                      <div className="p-4 overflow-x-auto">
                        <div
                          className="text-xs font-semibold uppercase tracking-wider mb-1.5 pb-1 border-b"
                          style={{
                            color: 'var(--accent-gold-dark)',
                            borderColor: 'var(--border-light)',
                          }}
                        >
                          @{section.surface}
                        </div>
                        <div className="space-y-1">
                          {section.lines.map((line, li) => (
                            <div key={li} className="flex gap-2">
                              <span
                                className="text-xs font-mono w-5 shrink-0 pt-1.5 text-right"
                                style={{ color: 'var(--text-faint)' }}
                              >
                                {line.lineNum}
                              </span>
                              <div className="min-w-0">
                                {line.tokens.length > 0 ? (
                                  <div className="flex flex-wrap gap-x-0.5 items-baseline leading-tight">
                                    {line.tokens.map((token, ti) => (
                                      <CuneiformToken key={ti} token={token} />
                                    ))}
                                  </div>
                                ) : null}
                                <div
                                  className="text-[10px] font-mono leading-tight"
                                  style={{ color: 'var(--text-faint)' }}
                                >
                                  {line.text}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4">
                  <p
                    className="text-sm italic"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    No transliteration data available.
                  </p>
                </div>
              )}

              {/* Compact metadata footer */}
              <div
                className="px-5 py-3 border-t text-xs flex flex-wrap gap-x-4 gap-y-1"
                style={{
                  borderColor: 'var(--border-light)',
                  color: 'var(--text-muted)',
                }}
              >
                <span>{tablet.museum}</span>
                <span>{tablet.museumNo}</span>
                <span>{tablet.lineCount} lines</span>
                <span>{tablet.surfaces.join(', ')}</span>
              </div>
            </article>
          );
        })}
      </main>
    </div>
  );
}

function CuneiformToken({ token }: { token: AtfToken }) {
  if (token.isDeterminative) {
    // Determinatives render small and superscript
    return (
      <span
        className="text-xs align-super"
        style={{ color: 'var(--accent-sage-dark)' }}
        title={`Determinative: ${token.reading}`}
      >
        {token.sign || token.reading}
      </span>
    );
  }

  if (token.isNumber) {
    // Numbers: show the numeral with cuneiform sign
    return (
      <span
        className="text-xl"
        title={token.reading}
        style={{ color: 'var(--text-primary)' }}
      >
        {token.sign ? (
          <>
            <span className="text-xs align-super font-mono" style={{ color: 'var(--text-muted)' }}>
              {token.numValue}
            </span>
            {token.sign}
          </>
        ) : (
          <span
            className="text-sm font-mono"
            style={{ color: 'var(--text-muted)' }}
          >
            {token.reading}
          </span>
        )}
      </span>
    );
  }

  if (token.sign) {
    // Mapped sign: show large cuneiform character
    return (
      <span
        className="text-2xl leading-none"
        title={token.reading}
        style={{ color: 'var(--text-primary)' }}
      >
        {token.sign}
      </span>
    );
  }

  // Unmapped: show ATF reading in distinct style
  return (
    <span
      className="text-sm font-mono px-0.5 rounded"
      title={`Unmapped: ${token.reading}`}
      style={{
        color: 'var(--accent-rust)',
        backgroundColor: 'var(--bg-warm)',
      }}
    >
      {token.reading}
    </span>
  );
}
