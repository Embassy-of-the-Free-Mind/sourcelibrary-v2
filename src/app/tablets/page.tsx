import type { Metadata } from 'next';
import corpus from '../../../scripts/output/cuneiform-corpus.json';
import {
  tokenizeAtfLine,
  type AtfToken,
} from '@/lib/cuneiform-signs';
import CroppedSurfaceImage from './CroppedSurfaceImage';

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
  imageAspect: number; // width / height of the original photo
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
  translation?: string;
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

    if (trimmed.startsWith('&') || trimmed === '@tablet' || trimmed === '')
      continue;

    // Translation lines: attach to the most recent line
    if (trimmed.startsWith('#tr.en:')) {
      if (current && current.lines.length > 0) {
        const last = current.lines[current.lines.length - 1];
        last.translation = trimmed.replace(/^#tr\.en:\s*/, '');
      }
      continue;
    }

    // Skip other comment/metadata lines
    if (trimmed.startsWith('#')) continue;

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

              {/* Detection map: full photo with blue/red bounding boxes */}
              {tablet.photoBounds && tablet.photoBounds.surfaces.length > 0 && (
                <div
                  className="p-4 border-b"
                  style={{ backgroundColor: '#f0ece3', borderColor: 'var(--border-light)' }}
                >
                  <div className="flex justify-center">
                    <a
                      href={tablet.cdliUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative inline-block"
                      style={{ maxWidth: '280px' }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={tablet.photoUrl}
                        alt={`${tablet.designation} with detected surfaces`}
                        loading="lazy"
                        className="block w-full rounded shadow-sm"
                      />
                      {tablet.photoBounds.surfaces.map((surface, si) => (
                        <div
                          key={si}
                          className="absolute border-2 pointer-events-none"
                          style={{
                            left: `${surface.bbox.x * 100}%`,
                            top: `${surface.bbox.y * 100}%`,
                            width: `${surface.bbox.w * 100}%`,
                            height: `${surface.bbox.h * 100}%`,
                            borderColor: surface.label === 'obverse' ? '#3b82f6' : '#ef4444',
                            backgroundColor: surface.label === 'obverse' ? 'rgba(59, 130, 246, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                          }}
                        >
                          <span
                            className="absolute top-1 left-1 text-[10px] font-mono px-1.5 py-0.5 rounded leading-none"
                            style={{
                              backgroundColor: surface.label === 'obverse' ? '#3b82f6' : '#ef4444',
                              color: 'white',
                            }}
                          >
                            @{surface.label}
                          </span>
                        </div>
                      ))}
                    </a>
                  </div>
                  <p className="text-center mt-2 text-[10px] font-mono italic" style={{ color: 'var(--text-faint)' }}>
                    Surface detection by Gemini Vision (AI-generated bounding boxes)
                  </p>
                </div>
              )}

              {/* Surface transliterations with cropped photos */}
              {sections.length > 0 ? (
                <div className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
                  {sections.map((section, si) => {
                    const bounds = tablet.photoBounds?.surfaces.find(
                      (s) => s.label.toLowerCase() === section.surface.toLowerCase()
                    );
                    const aspect = tablet.photoBounds?.imageAspect;
                    return (
                      <div key={si}>
                        {/* Surface header */}
                        <div
                          className="px-5 pt-3 pb-1 flex items-center gap-3"
                        >
                          <span
                            className="text-xs font-semibold uppercase tracking-wider"
                            style={{ color: 'var(--accent-gold-dark)' }}
                          >
                            @{section.surface}
                          </span>
                        </div>
                        {/* Columns: Photo | Signs (generated) | ATF (CDLI) | Translation */}
                        <div className="flex gap-0 px-5 pb-3">
                          {bounds && aspect ? (
                            <div className="shrink-0">
                              <CroppedSurfaceImage
                                photoUrl={tablet.photoUrl}
                                bbox={bounds.bbox}
                                imageAspect={aspect}
                                containerWidth={360}
                                alt={`${tablet.designation} ${section.surface}`}
                              />
                            </div>
                          ) : null}
                          {/* Cuneiform signs column — generated */}
                          <div className="min-w-0 flex-1 px-4">
                            <div className="flex items-center gap-1.5 mb-1.5 pb-1 border-b" style={{ borderColor: 'var(--border-light)' }}>
                              <span className="text-[9px] font-mono px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--accent-violet)/12', color: 'var(--accent-violet)' }}>
                                Generated
                              </span>
                              <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                                Cuneiform Signs
                              </span>
                            </div>
                            <SignsColumn section={section} />
                          </div>
                          {/* ATF column — CDLI source data */}
                          <div className="min-w-0 flex-1 px-4 border-l" style={{ borderColor: 'var(--border-light)' }}>
                            <div className="flex items-center gap-1.5 mb-1.5 pb-1 border-b" style={{ borderColor: 'var(--border-light)' }}>
                              <span className="text-[9px] font-mono px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--accent-sage)/12', color: 'var(--accent-sage-dark)' }}>
                                CDLI
                              </span>
                              <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                                ATF Transliteration
                              </span>
                            </div>
                            <AtfColumn section={section} />
                          </div>
                          {/* Translation column — from CDLI ATF when available */}
                          {section.lines.some(l => l.translation) && (
                            <div className="min-w-0 flex-1 px-4 border-l" style={{ borderColor: 'var(--border-light)' }}>
                              <div className="flex items-center gap-1.5 mb-1.5 pb-1 border-b" style={{ borderColor: 'var(--border-light)' }}>
                                <span className="text-[9px] font-mono px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--accent-sage)/12', color: 'var(--accent-sage-dark)' }}>
                                  CDLI
                                </span>
                                <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                                  English Translation
                                </span>
                              </div>
                              <TranslationColumn section={section} />
                            </div>
                          )}
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

              {/* Metadata footer with source attribution */}
              <div
                className="px-5 py-3 border-t"
                style={{ borderColor: 'var(--border-light)' }}
              >
                <div className="flex gap-6 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {/* CDLI source data */}
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span
                        className="font-mono text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{ backgroundColor: 'var(--accent-sage)/12', color: 'var(--accent-sage-dark)' }}
                      >
                        CDLI
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                        Source data
                      </span>
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                      <span style={{ color: 'var(--text-faint)' }}>Period</span>
                      <span>{tablet.period}</span>
                      <span style={{ color: 'var(--text-faint)' }}>Language</span>
                      <span>{tablet.language}</span>
                      <span style={{ color: 'var(--text-faint)' }}>Genre</span>
                      <span>{tablet.genre}</span>
                      <span style={{ color: 'var(--text-faint)' }}>Museum</span>
                      <span>{tablet.museum} ({tablet.museumNo})</span>
                      <span style={{ color: 'var(--text-faint)' }}>Lines</span>
                      <span>{tablet.lineCount}</span>
                      <span style={{ color: 'var(--text-faint)' }}>Surfaces</span>
                      <span>{tablet.surfaces.join(', ')}</span>
                      {tablet.hasTranslation && (
                        <>
                          <span style={{ color: 'var(--text-faint)' }}>Translation</span>
                          <span>Available on CDLI</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Generated data */}
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span
                        className="font-mono text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{ backgroundColor: 'var(--accent-violet)/12', color: 'var(--accent-violet)' }}
                      >
                        Generated
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                        Source Library
                      </span>
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                      <span style={{ color: 'var(--text-faint)' }}>Difficulty</span>
                      <span>{tablet.difficulty}</span>
                      {tablet.photoBounds && (
                        <>
                          <span style={{ color: 'var(--text-faint)' }}>Detection</span>
                          <span>
                            {tablet.photoBounds.surfaces.length} surface{tablet.photoBounds.surfaces.length !== 1 ? 's' : ''} ({tablet.photoBounds.layout})
                          </span>
                        </>
                      )}
                      <span style={{ color: 'var(--text-faint)' }}>Cuneiform</span>
                      <span>Unicode sign mapping (experimental)</span>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </main>
    </div>
  );
}

/** ATF column: raw scholarly transliteration from CDLI */
function AtfColumn({ section }: { section: ParsedSection }) {
  return (
    <div className="space-y-0.5">
      {section.lines.map((line, li) => (
        <div key={li} className="flex gap-2">
          <span
            className="text-xs font-mono w-5 shrink-0 text-right"
            style={{ color: 'var(--text-faint)' }}
          >
            {line.lineNum}
          </span>
          <span
            className="text-xs font-mono"
            style={{ color: 'var(--text-secondary)' }}
          >
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Signs column: generated Unicode cuneiform rendering */
function SignsColumn({ section }: { section: ParsedSection }) {
  return (
    <div className="space-y-0.5">
      {section.lines.map((line, li) => (
        <div key={li} className="flex gap-2">
          <span
            className="text-xs font-mono w-5 shrink-0 pt-1 text-right"
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
            ) : (
              <span
                className="text-[10px] font-mono italic"
                style={{ color: 'var(--text-faint)' }}
              >
                {line.text.startsWith('$') ? line.text : '—'}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Translation column: English translations from CDLI ATF (#tr.en: lines) */
function TranslationColumn({ section }: { section: ParsedSection }) {
  return (
    <div className="space-y-0.5">
      {section.lines.map((line, li) => (
        <div key={li} className="flex gap-2">
          <span
            className="text-xs font-mono w-5 shrink-0 text-right"
            style={{ color: 'var(--text-faint)' }}
          >
            {line.lineNum}
          </span>
          <span
            className="text-xs font-body"
            style={{ color: line.translation ? 'var(--text-secondary)' : 'var(--text-faint)' }}
          >
            {line.translation || '—'}
          </span>
        </div>
      ))}
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
