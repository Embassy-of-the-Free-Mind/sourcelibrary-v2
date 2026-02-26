import type { Metadata } from 'next';
import fs from 'fs';
import path from 'path';

export const metadata: Metadata = {
  title: 'Brand Kit & Color System - Source Library',
  description: 'Source Library logos, color system, design tokens, and brand guidelines.',
  alternates: { canonical: '/brand' },
};

function getAssets() {
  const brandDir = path.join(process.cwd(), 'public/brand');
  const svgDir = path.join(brandDir, 'svg');
  const pngDir = path.join(brandDir, 'png');
  const svgs = fs.existsSync(svgDir) ? fs.readdirSync(svgDir).filter(f => f.endsWith('.svg')).sort() : [];
  const pngs = fs.existsSync(pngDir) ? fs.readdirSync(pngDir).filter(f => f.endsWith('.png')).sort() : [];
  return { svgs, pngs };
}

type Config = 'logo-full' | 'logo-compact' | 'icon-only' | 'wordmark-only' | 'logo-stacked';
type Scheme = 'white-on-dark' | 'black-on-white' | 'white-on-transparent' | 'black-on-transparent';

const CONFIG_LABELS: Record<Config, string> = {
  'logo-full': 'Full Logo',
  'logo-compact': 'Compact Logo',
  'icon-only': 'Icon Only',
  'wordmark-only': 'Wordmark Only',
  'logo-stacked': 'Stacked Logo',
};

const SCHEME_LABELS: Record<Scheme, string> = {
  'white-on-dark': 'White on Dark',
  'black-on-white': 'Black on White',
  'white-on-transparent': 'White on Transparent',
  'black-on-transparent': 'Black on Transparent',
};

function parseFilename(name: string) {
  const parts = name.replace(/\.(svg|png)$/, '').split('--');
  return {
    config: parts[0] as Config,
    scheme: parts[1] as Scheme,
    height: parts[2] ? parseInt(parts[2]) : null,
  };
}

function PreviewCard({ src, label, filename, dark }: { src: string; label: string; filename: string; dark: boolean }) {
  return (
    <div className="group relative">
      <div className={`rounded-lg border overflow-hidden ${dark ? 'bg-[#1a1612] border-stone-700' : 'bg-white border-stone-200'}`}>
        <div className="flex items-center justify-center p-6 min-h-[100px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={label} className="max-h-[80px] max-w-full" />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm text-stone-500">{label}</span>
        <a
          href={src}
          download={filename}
          className="text-xs text-stone-400 hover:text-accent-rust transition-colors opacity-0 group-hover:opacity-100"
        >
          Download
        </a>
      </div>
    </div>
  );
}

function DownloadButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg transition-colors"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      {label}
    </a>
  );
}

function ColorSwatch({ color, name, hex, usage, large }: { color: string; name: string; hex: string; usage: string; large?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`${large ? 'w-14 h-14' : 'w-10 h-10'} rounded border border-stone-200 shrink-0`}
        style={{ backgroundColor: color }}
      />
      <div>
        <p className="text-sm font-medium text-stone-700">{name}</p>
        <p className="text-xs text-stone-400 font-mono">{hex}</p>
        <p className="text-xs text-stone-500 mt-0.5">{usage}</p>
      </div>
    </div>
  );
}

function DecisionCard({ title, status, problem, proposal, evidence }: {
  title: string;
  status: 'proposal' | 'decided' | 'open';
  problem: string;
  proposal: string;
  evidence: string;
}) {
  const statusColors = {
    proposal: 'bg-accent-gold/8 text-accent-gold-dark border-accent-gold/20',
    decided: 'bg-green-50 text-green-700 border-green-200',
    open: 'bg-blue-50 text-blue-700 border-blue-200',
  };
  const statusLabels = {
    proposal: 'Proposal',
    decided: 'Decided',
    open: 'Needs Decision',
  };

  return (
    <div className="border border-stone-200 rounded-lg p-5 bg-white">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h4 className="font-medium text-stone-800">{title}</h4>
        <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${statusColors[status]}`}>
          {statusLabels[status]}
        </span>
      </div>
      <div className="space-y-2 text-sm">
        <div>
          <p className="text-stone-500 font-medium text-xs uppercase tracking-wide">Problem</p>
          <p className="text-stone-600">{problem}</p>
        </div>
        <div>
          <p className="text-stone-500 font-medium text-xs uppercase tracking-wide">Proposal</p>
          <p className="text-stone-700">{proposal}</p>
        </div>
        <div>
          <p className="text-stone-500 font-medium text-xs uppercase tracking-wide">Evidence</p>
          <p className="text-stone-500 text-xs">{evidence}</p>
        </div>
      </div>
    </div>
  );
}

function GradientSwatch({ from, to, label }: { from: string; to: string; label: string }) {
  return (
    <div>
      <div
        className="h-16 rounded-lg border border-stone-200"
        style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      />
      <p className="text-xs text-stone-500 mt-1.5 font-mono">{from} &rarr; {to}</p>
      <p className="text-xs text-stone-400">{label}</p>
    </div>
  );
}

export default function BrandPage() {
  const { svgs, pngs } = getAssets();

  const svgByConfig = new Map<Config, typeof svgs>();
  for (const file of svgs) {
    const { config } = parseFilename(file);
    if (!svgByConfig.has(config)) svgByConfig.set(config, []);
    svgByConfig.get(config)!.push(file);
  }

  const pngPreviewByConfig = new Map<Config, Map<Scheme, string>>();
  for (const file of pngs) {
    const { config, scheme, height } = parseFilename(file);
    if (height !== 256) continue;
    if (!pngPreviewByConfig.has(config)) pngPreviewByConfig.set(config, new Map());
    pngPreviewByConfig.get(config)!.set(scheme, file);
  }

  const pngByConfigScheme = new Map<string, string[]>();
  for (const file of pngs) {
    const { config, scheme } = parseFilename(file);
    const key = `${config}--${scheme}`;
    if (!pngByConfigScheme.has(key)) pngByConfigScheme.set(key, []);
    pngByConfigScheme.get(key)!.push(file);
  }

  const configs = Object.keys(CONFIG_LABELS) as Config[];

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-[#1a1612] text-white">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <div className="flex items-center gap-4 mb-6">
            <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1" />
            </svg>
            <h1 className="text-3xl font-light tracking-wide">Brand Kit & Color System</h1>
          </div>
          <p className="text-stone-400 max-w-2xl text-lg">
            Logos, color system, typography, and design decisions for Source Library.
            This page documents the current state, open questions, and proposed alignment.
          </p>
          <nav className="flex flex-wrap gap-4 mt-8 text-sm">
            <a href="#logos" className="text-stone-400 hover:text-white transition-colors">Logos</a>
            <a href="#color-system" className="text-stone-400 hover:text-white transition-colors">Color System</a>
            <a href="#decisions" className="text-stone-400 hover:text-white transition-colors">Decisions</a>
            <a href="#typography" className="text-stone-400 hover:text-white transition-colors">Typography</a>
            <a href="#usage" className="text-stone-400 hover:text-white transition-colors">Usage</a>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12 space-y-20">

        {/* ─── LOGOS ─── */}
        <section id="logos">
          <h2 className="text-2xl font-semibold text-stone-800 mb-8">Logo Configurations</h2>
          <div className="space-y-16">
            {configs.map(config => {
              const configSvgs = svgByConfig.get(config) || [];
              const configPngs = pngPreviewByConfig.get(config) || new Map();
              const allSchemes = [...new Set<Scheme>([
                ...configSvgs.map(f => parseFilename(f).scheme),
                ...configPngs.keys(),
              ])].sort();

              return (
                <div key={config} id={config}>
                  <h3 className="text-lg font-semibold text-stone-800 mb-1">
                    {CONFIG_LABELS[config]}
                  </h3>
                  <p className="text-stone-500 mb-4 text-sm">
                    {config === 'logo-full' && 'The primary logo. Use this wherever space allows.'}
                    {config === 'logo-compact' && 'Smaller variant for tight spaces, navigation bars, and mobile.'}
                    {config === 'icon-only' && 'The concentric circles mark. Use for favicons, app icons, and avatars.'}
                    {config === 'wordmark-only' && 'Text-only mark. Use when the icon is already present or for inline references.'}
                    {config === 'logo-stacked' && 'Vertical layout. Use for square formats, social media profiles, and print.'}
                  </p>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    {allSchemes.map(scheme => {
                      const isDark = scheme.includes('dark') || scheme === 'white-on-transparent';
                      const svgFile = configSvgs.find(f => f.includes(scheme));
                      const pngFile = configPngs.get(scheme);
                      const src = svgFile ? `/brand/svg/${svgFile}` : pngFile ? `/brand/png/${pngFile}` : null;
                      if (!src) return null;

                      return (
                        <PreviewCard
                          key={scheme}
                          src={src}
                          label={SCHEME_LABELS[scheme]}
                          filename={svgFile || pngFile || ''}
                          dark={isDark}
                        />
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {configSvgs.map(file => {
                      const { scheme } = parseFilename(file);
                      return (
                        <DownloadButton
                          key={file}
                          href={`/brand/svg/${file}`}
                          label={`SVG ${SCHEME_LABELS[scheme]}`}
                        />
                      );
                    })}
                  </div>

                  <details className="mt-4">
                    <summary className="text-sm text-stone-500 cursor-pointer hover:text-stone-700">
                      PNG sizes (32px to 512px)
                    </summary>
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                      {[...pngByConfigScheme.entries()]
                        .filter(([key]) => key.startsWith(config))
                        .map(([key, files]) => {
                          const scheme = key.replace(`${config}--`, '') as Scheme;
                          return (
                            <div key={key} className="text-sm">
                              <p className="font-medium text-stone-600 mb-1">{SCHEME_LABELS[scheme]}</p>
                              <div className="flex flex-wrap gap-1">
                                {files.sort((a, b) => {
                                  const ha = parseFilename(a).height || 0;
                                  const hb = parseFilename(b).height || 0;
                                  return ha - hb;
                                }).map(file => {
                                  const { height } = parseFilename(file);
                                  return (
                                    <a
                                      key={file}
                                      href={`/brand/png/${file}`}
                                      download
                                      className="px-2 py-0.5 text-xs bg-stone-100 hover:bg-accent-gold/15 text-stone-500 hover:text-accent-rust rounded transition-colors"
                                    >
                                      {height}px
                                    </a>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        </section>

        {/* ─── COLOR SYSTEM ─── */}
        <section id="color-system" className="border-t border-stone-200 pt-12">
          <h2 className="text-2xl font-semibold text-stone-800 mb-2">Color System</h2>
          <p className="text-stone-500 mb-10 max-w-3xl">
            Two color systems coexist: CSS design tokens (used in ~35 files) and raw Tailwind utilities
            (used in ~117 files). This section documents both, proposes alignment, and flags decisions needed.
          </p>

          {/* Brand Accent Colors */}
          <div className="mb-12">
            <h3 className="text-lg font-semibold text-stone-800 mb-1">Brand Accents</h3>
            <p className="text-sm text-stone-500 mb-4">
              Five named accent colors defined as CSS custom properties in globals.css.
              These are the intentional, curated palette. Defined in <code className="text-xs bg-stone-100 px-1.5 py-0.5 rounded">@theme inline</code> so
              they work as both <code className="text-xs bg-stone-100 px-1.5 py-0.5 rounded">var(--accent-rust)</code> and Tailwind <code className="text-xs bg-stone-100 px-1.5 py-0.5 rounded">text-accent-rust</code>.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              <ColorSwatch color="#9e4a3a" name="Rust" hex="--accent-rust: #9e4a3a" usage="Links, annotations, prose accents. Used in 12 files." large />
              <ColorSwatch color="#c9a86c" name="Gold" hex="--accent-gold: #c9a86c" usage="Decorative, search highlights, logo flame. Used in 5 files." large />
              <ColorSwatch color="#8b9a7d" name="Sage" hex="--accent-sage: #8b9a7d" usage="OCR/AI features, processing states. Used in 6 files." large />
              <ColorSwatch color="#546b8a" name="Slate" hex="--accent-slate: #546b8a" usage="Defined but never used in any component. Remove?" large />
              <ColorSwatch color="#7c5db5" name="Violet" hex="--accent-violet: #7c5db5" usage="AI assistant, explain features, annotations. Used in 7 files." large />
            </div>
          </div>

          {/* Action Color: Amber */}
          <div className="mb-12">
            <h3 className="text-lg font-semibold text-stone-800 mb-1">Action Color: Amber</h3>
            <p className="text-sm text-stone-500 mb-4">
              The dominant interactive color. Used via raw Tailwind classes across 93 files (479 occurrences of amber-600 alone).
              Buttons, CTAs, hover states, focus rings, loading spinners, badges.
              Not defined as a design token &mdash; used directly as Tailwind <code className="text-xs bg-stone-100 px-1.5 py-0.5 rounded">amber-*</code>.
            </p>
            <div className="flex flex-wrap gap-3 mb-4">
              {[
                { shade: '50', hex: '#fffbeb' },
                { shade: '100', hex: '#fef3c7' },
                { shade: '200', hex: '#fde68a' },
                { shade: '300', hex: '#fcd34d' },
                { shade: '400', hex: '#fbbf24' },
                { shade: '500', hex: '#f59e0b' },
                { shade: '600', hex: '#d97706' },
                { shade: '700', hex: '#b45309' },
                { shade: '800', hex: '#92400e' },
              ].map(({ shade, hex }) => (
                <div key={shade} className="text-center">
                  <div className="w-12 h-12 rounded border border-stone-200" style={{ backgroundColor: hex }} />
                  <p className="text-[10px] text-stone-400 mt-1">{shade}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-stone-400">
              Primary action shade: amber-600 (#d97706). Hover: amber-700 (#b45309). Subtle backgrounds: amber-50, amber-100.
            </p>
          </div>

          {/* Amber vs Gold comparison */}
          <div className="mb-12 bg-accent-gold/5 border border-accent-gold/15 rounded-lg p-5">
            <h4 className="font-medium text-accent-gold-dark mb-2">Amber vs Gold &mdash; are these the same color?</h4>
            <div className="flex items-center gap-6 mb-3">
              <div className="text-center">
                <div className="w-16 h-16 rounded-lg border-2 border-accent-gold/20" style={{ backgroundColor: '#d97706' }} />
                <p className="text-xs text-stone-600 mt-1 font-medium">Amber-600</p>
                <p className="text-[10px] text-stone-400 font-mono">#d97706</p>
              </div>
              <div className="text-stone-300 text-2xl">&ne;</div>
              <div className="text-center">
                <div className="w-16 h-16 rounded-lg border-2 border-accent-gold/20" style={{ backgroundColor: '#c9a86c' }} />
                <p className="text-xs text-stone-600 mt-1 font-medium">Gold token</p>
                <p className="text-[10px] text-stone-400 font-mono">#c9a86c</p>
              </div>
            </div>
            <p className="text-sm text-stone-600">
              These serve different roles. Amber is saturated and high-energy &mdash; used for clickable actions.
              Gold is muted and warm &mdash; used for decorative/ornamental purposes (search highlight backgrounds, flame accents).
              See decision below.
            </p>
          </div>

          {/* Backgrounds & Surfaces */}
          <div className="mb-12">
            <h3 className="text-lg font-semibold text-stone-800 mb-1">Backgrounds & Surfaces</h3>
            <p className="text-sm text-stone-500 mb-4">
              The warm paper aesthetic is a signature look. Cream backgrounds with subtle warm shifts.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
              <ColorSwatch color="#fdfcf9" name="Cream" hex="--bg-cream: #fdfcf9" usage="Primary page background" />
              <ColorSwatch color="#f5f0e8" name="Warm" hex="--bg-warm: #f5f0e8" usage="Cards, panels, elevated surfaces" />
              <ColorSwatch color="#ffffff" name="White" hex="--bg-white: #fff" usage="Input fields, modal backgrounds" />
              <ColorSwatch color="#1a1612" name="Dark" hex="--bg-dark: #1a1612" usage="Header, hero, dark sections" />
            </div>

            <h4 className="text-sm font-medium text-stone-700 mb-3">Signature Gradients</h4>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <GradientSwatch from="#fdfcf9" to="#f5f0e8" label="Page fade (cream to warm)" />
              <GradientSwatch from="#f6f3ee" to="#f3ede6" label="Section backgrounds" />
              <GradientSwatch from="#1a1612" to="#2a2520" label="Dark header gradient" />
            </div>
          </div>

          {/* Dark color inconsistency */}
          <div className="mb-12 bg-stone-100 border border-stone-200 rounded-lg p-5">
            <h4 className="font-medium text-stone-800 mb-2">Dark color inconsistency</h4>
            <div className="flex items-center gap-6 mb-3">
              <div className="text-center">
                <div className="w-16 h-16 rounded-lg border-2 border-stone-300" style={{ backgroundColor: '#1a1612' }} />
                <p className="text-xs text-stone-600 mt-1 font-medium">CSS token</p>
                <p className="text-[10px] text-stone-400 font-mono">#1a1612 (warm)</p>
              </div>
              <div className="text-stone-300 text-2xl">vs</div>
              <div className="text-center">
                <div className="w-16 h-16 rounded-lg border-2 border-stone-300" style={{ backgroundColor: '#1a1a1a' }} />
                <p className="text-xs text-stone-600 mt-1 font-medium">Brand assets</p>
                <p className="text-[10px] text-stone-400 font-mono">#1a1a1a (neutral)</p>
              </div>
              <div className="text-stone-300 text-2xl">vs</div>
              <div className="text-center">
                <div className="w-16 h-16 rounded-lg border-2 border-stone-300" style={{ backgroundColor: '#000000' }} />
                <p className="text-xs text-stone-600 mt-1 font-medium">Hero overlay</p>
                <p className="text-[10px] text-stone-400 font-mono">#000000 (pure)</p>
              </div>
            </div>
            <p className="text-sm text-stone-600">
              Three different &ldquo;dark&rdquo; values used across the site. See decision below.
            </p>
          </div>

          {/* Text Hierarchy */}
          <div className="mb-12">
            <h3 className="text-lg font-semibold text-stone-800 mb-1">Text Hierarchy</h3>
            <p className="text-sm text-stone-500 mb-4">
              All text colors meet WCAG AA 4.5:1 contrast on cream/white backgrounds.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <ColorSwatch color="#1a1612" name="Primary" hex="--text-primary: #1a1612" usage="Headings, body text" />
              <ColorSwatch color="#444444" name="Secondary" hex="--text-secondary: #444" usage="Subheadings, supporting text" />
              <ColorSwatch color="#6b6560" name="Muted" hex="--text-muted: #6b6560" usage="Captions, metadata (5.2:1)" />
              <ColorSwatch color="#8a8480" name="Faint" hex="--text-faint: #8a8480" usage="Timestamps, hints (4.5:1)" />
            </div>
          </div>

          {/* Borders */}
          <div className="mb-12">
            <h3 className="text-lg font-semibold text-stone-800 mb-1">Borders</h3>
            <div className="grid sm:grid-cols-2 gap-5">
              <ColorSwatch color="#e8e4dc" name="Light" hex="--border-light: #e8e4dc" usage="Card borders, dividers. Used in ~32 files." />
              <ColorSwatch color="#d4cfc4" name="Medium" hex="--border-medium: #d4cfc4" usage="Stronger separators, input borders. Used in ~10 files." />
            </div>
          </div>

          {/* Neutral Palette: Stone */}
          <div className="mb-12">
            <h3 className="text-lg font-semibold text-stone-800 mb-1">Neutral Palette: Stone</h3>
            <p className="text-sm text-stone-500 mb-4">
              The structural/neutral system. Used via raw Tailwind classes across 117 files.
              Backgrounds, borders, text, cards &mdash; the foundational gray scale.
            </p>
            <div className="flex flex-wrap gap-3">
              {[
                { shade: '50', hex: '#fafaf9' },
                { shade: '100', hex: '#f5f5f4' },
                { shade: '200', hex: '#e7e5e4' },
                { shade: '300', hex: '#d6d3d1' },
                { shade: '400', hex: '#a8a29e' },
                { shade: '500', hex: '#78716c' },
                { shade: '600', hex: '#57534e' },
                { shade: '700', hex: '#44403c' },
                { shade: '800', hex: '#292524' },
                { shade: '900', hex: '#1c1917' },
              ].map(({ shade, hex }) => (
                <div key={shade} className="text-center">
                  <div className="w-12 h-12 rounded border border-stone-200" style={{ backgroundColor: hex }} />
                  <p className="text-[10px] text-stone-400 mt-1">{shade}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Semantic / State Colors */}
          <div className="mb-12">
            <h3 className="text-lg font-semibold text-stone-800 mb-1">Semantic Colors</h3>
            <p className="text-sm text-stone-500 mb-4">
              Standard UI states. Used via raw Tailwind classes. Not design tokens &mdash; this is fine.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded bg-status-success" />
                  <p className="text-sm font-medium text-stone-700">Green (Success)</p>
                </div>
                <p className="text-xs text-stone-500">52 files. OCR/translation complete, pipeline done, success.</p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded bg-status-error" />
                  <p className="text-sm font-medium text-stone-700">Red (Error)</p>
                </div>
                <p className="text-xs text-stone-500">46 files. Failed jobs, errors, delete confirmations.</p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded bg-blue-600" />
                  <p className="text-sm font-medium text-stone-700">Blue (In Progress)</p>
                </div>
                <p className="text-xs text-stone-500">41 files. Running jobs, processing, informational.</p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded bg-yellow-500" />
                  <p className="text-sm font-medium text-stone-700">Yellow (Warning)</p>
                </div>
                <p className="text-xs text-stone-500">8 files. Pending, warnings, highlights.</p>
              </div>
            </div>
          </div>

          {/* Scattered colors */}
          <div>
            <h3 className="text-lg font-semibold text-stone-800 mb-1">Other Colors in Codebase</h3>
            <p className="text-sm text-stone-500 mb-4">
              Tailwind colors used in scattered spots. These are not part of the design system
              but appear in specific components.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm text-stone-600">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-purple-500" />
                <span>purple-* &mdash; annotations, experiment variant B</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-rose-500" />
                <span>rose-* &mdash; annotation type colors</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-teal-500" />
                <span>teal-* &mdash; scattered, minor usage</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-emerald-500" />
                <span>emerald-* &mdash; alternative success states</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-sky-500" />
                <span>sky-* &mdash; scattered, minor usage</span>
              </div>
            </div>
          </div>
        </section>

        {/* ─── DECISIONS ─── */}
        <section id="decisions" className="border-t border-stone-200 pt-12">
          <h2 className="text-2xl font-semibold text-stone-800 mb-2">Decisions & Proposals</h2>
          <p className="text-stone-500 mb-8 max-w-3xl">
            The color system works but has inconsistencies. Below are the open questions
            with proposed resolutions based on actual codebase usage data.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <DecisionCard
              title="1. Amber vs Gold: keep both?"
              status="proposal"
              problem="Amber-600 (#d97706) is used for all interactive elements (93 files, 479 occurrences). Gold (#c9a86c) is a separate muted warm used decoratively (5 files). They look different but both occupy the 'warm accent' space."
              proposal="Keep both. They serve distinct roles: Amber = action (buttons, links, CTAs), Gold = ornament (decorative highlights, logo flame). Trying to consolidate would mean either dull buttons or garish decorations. Document the distinction."
              evidence="Amber has 93 files of usage vs Gold's 5. Replacing either would touch hundreds of lines for no UX improvement."
            />

            <DecisionCard
              title="2. Dark background: which black?"
              status="proposal"
              problem="Three 'dark' values: #1a1612 (warm brown-black, CSS token), #1a1a1a (neutral, brand assets), #000000 (pure black, hero overlay). These are visually similar but inconsistent."
              proposal="Standardize on #1a1612 (the warm brown-black). It matches the warm paper aesthetic of the entire site. Regenerate brand assets with this value. Pure black can stay for overlay gradients where it fades to transparent."
              evidence="--bg-dark: #1a1612 is the intentional design token. #1a1a1a was a shorthand that crept into the brand kit. The warm tone is consistent with cream/warm backgrounds."
            />

            <DecisionCard
              title="3. Remove --accent-slate?"
              status="proposal"
              problem="--accent-slate (#546b8a) is defined in globals.css but never used in any component, page, or stylesheet."
              proposal="Remove it. Zero usage means it's dead code. If a blue-slate accent is ever needed, it can be re-added with actual usage."
              evidence="Grep of entire codebase: 0 files reference --accent-slate or text-accent-slate outside globals.css definitions."
            />

            <DecisionCard
              title="4. Warm gradients in brand guidelines?"
              status="proposal"
              problem="The warm cream gradients (#fdfcf9 to #f5f0e8, #f6f3ee to #f3ede6) are a distinctive visual signature but aren't documented anywhere."
              proposal="Yes, include them. They're as much the brand as the logo. Document the 3 signature gradients: page fade (cream to warm), section backgrounds, and dark header."
              evidence="The paper-like warmth is what distinguishes Source Library from generic websites. Every reader page, search result, and book card uses these tones."
            />

            <DecisionCard
              title="5. Scope of this page"
              status="proposal"
              problem="Should the brand page be a minimal logo kit, or a fuller design system reference?"
              proposal="This page: logos + full color palette + typography + key visual patterns. Not a component library. Enough that a designer or second developer can build consistent UI without reverse-engineering globals.css."
              evidence="The codebase already has a collaborative dev (per CLAUDE.md). This reference prevents color drift and documents the intent behind each token."
            />

            <DecisionCard
              title="6. Two color systems: consolidate?"
              status="open"
              problem="CSS vars (--accent-rust, etc.) are used in ~35 files. Raw Tailwind (amber-*, stone-*) in ~117 files. They overlap — stone-900 and --text-primary are nearly the same color."
              proposal="Don't consolidate now — the cost is too high (touching 117+ files) for minimal benefit. The @theme inline bridge already makes CSS vars available as Tailwind classes. Instead, prefer design tokens for new code and let raw Tailwind usage naturally decrease over time."
              evidence="109 files use only raw Tailwind with zero CSS vars. Migrating them all would be a huge refactor with risk of visual regressions and no user-facing improvement."
            />
          </div>
        </section>

        {/* ─── TYPOGRAPHY ─── */}
        <section id="typography" className="border-t border-stone-200 pt-12">
          <h2 className="text-2xl font-semibold text-stone-800 mb-6">Typography</h2>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Logo typography */}
            <div>
              <h3 className="font-medium text-stone-700 mb-3">Logo Wordmark</h3>
              <div className="space-y-2 text-sm text-stone-600">
                <p><strong>Font:</strong> Inter (Google Fonts)</p>
                <p><strong>&ldquo;SOURCE&rdquo;:</strong> Semibold (600)</p>
                <p><strong>&ldquo;LIBRARY&rdquo;:</strong> Light (300)</p>
                <p><strong>Case:</strong> Uppercase</p>
                <p><strong>Tracking:</strong> 0.05em</p>
              </div>
              <div className="mt-4 bg-[#1a1612] text-white p-6 rounded-lg inline-block">
                <span className="font-sans text-2xl uppercase tracking-wider">
                  <span className="font-semibold">Source</span><span className="font-light">Library</span>
                </span>
              </div>
            </div>

            {/* Site typography */}
            <div>
              <h3 className="font-medium text-stone-700 mb-3">Site Typography</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Display / Headings</p>
                  <p className="font-serif text-2xl text-stone-800 font-display">Playfair Display</p>
                </div>
                <div>
                  <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Body / Reading</p>
                  <p className="text-lg text-stone-800 font-body">Newsreader &mdash; optimized for extended reading</p>
                </div>
                <div>
                  <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Scholarly / OCR text</p>
                  <p className="text-lg text-stone-800 font-serif">Cormorant Garamond &mdash; historical text display</p>
                </div>
                <div>
                  <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">UI / Navigation</p>
                  <p className="font-sans text-lg text-stone-800">Inter &mdash; clean, functional interface text</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── USAGE GUIDELINES ─── */}
        <section id="usage" className="border-t border-stone-200 pt-12">
          <h2 className="text-2xl font-semibold text-stone-800 mb-6">Usage Guidelines</h2>

          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <h3 className="font-medium text-stone-700 mb-3">Logo Usage</h3>
              <div className="space-y-2 text-sm text-stone-600">
                <p>Use the <strong>full logo</strong> as the primary mark.</p>
                <p>Use the <strong>icon only</strong> at small sizes or as an avatar.</p>
                <p>Use <strong>white on dark</strong> on dark or image backgrounds.</p>
                <p>Use <strong>black on white</strong> on light backgrounds.</p>
                <p>Maintain clear space equal to the icon height around the logo.</p>
              </div>
            </div>

            <div>
              <h3 className="font-medium text-stone-700 mb-3">Color Intent</h3>
              <div className="space-y-2 text-sm text-stone-600">
                <p><strong>Rust</strong> for literary/scholarly emphasis (links in prose, annotations).</p>
                <p><strong>Gold</strong> for decorative warmth (highlights, ornamental accents).</p>
                <p><strong>Sage</strong> for AI/technology features (OCR, processing).</p>
                <p><strong>Violet</strong> for AI assistant features (explain, summarize).</p>
                <p><strong>Amber</strong> for all interactive actions (buttons, CTAs, focus).</p>
              </div>
            </div>

            <div>
              <h3 className="font-medium text-stone-700 mb-3">Visual Identity</h3>
              <div className="space-y-2 text-sm text-stone-600">
                <p>The <strong>warm paper tones</strong> (cream, warm) are the signature look.</p>
                <p>Prefer <strong>stone</strong> neutrals over pure gray.</p>
                <p>Use <strong>subtle gradients</strong> for section backgrounds.</p>
                <p>The overall feeling: <strong>a well-lit reading room</strong>, not a tech dashboard.</p>
                <p>Design tokens are preferred for new code. Raw Tailwind for rapid prototyping.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ─── TECHNICAL REFERENCE ─── */}
        <section className="border-t border-stone-200 pt-12 pb-8">
          <h2 className="text-2xl font-semibold text-stone-800 mb-6">Technical Reference</h2>

          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h3 className="font-medium text-stone-700 mb-3">CSS Custom Properties</h3>
              <div className="bg-stone-100 rounded-lg p-4 text-xs font-mono text-stone-600 space-y-1">
                <p className="text-stone-400">/* globals.css :root */</p>
                <p>--bg-cream: #fdfcf9;</p>
                <p>--bg-warm: #f5f0e8;</p>
                <p>--bg-dark: #1a1612;</p>
                <p>--text-primary: #1a1612;</p>
                <p>--text-secondary: #444;</p>
                <p>--text-muted: #6b6560;</p>
                <p>--text-faint: #8a8480;</p>
                <p>--accent-rust: #9e4a3a;</p>
                <p>--accent-gold: #c9a86c;</p>
                <p>--accent-sage: #8b9a7d;</p>
                <p className="line-through text-stone-400">--accent-slate: #546b8a; <span className="not-italic">/* unused, remove */</span></p>
                <p>--accent-violet: #7c5db5;</p>
                <p>--border-light: #e8e4dc;</p>
                <p>--border-medium: #d4cfc4;</p>
              </div>
            </div>

            <div>
              <h3 className="font-medium text-stone-700 mb-3">Tailwind Theme Bridge</h3>
              <div className="bg-stone-100 rounded-lg p-4 text-xs font-mono text-stone-600 space-y-1">
                <p className="text-stone-400">/* @theme inline makes these Tailwind utilities */</p>
                <p>bg-cream, text-cream</p>
                <p>bg-warm, text-warm</p>
                <p>bg-dark, text-dark</p>
                <p>text-primary, text-secondary, text-muted</p>
                <p>text-accent-rust, bg-accent-rust</p>
                <p>text-accent-gold, bg-accent-gold</p>
                <p>text-accent-sage, bg-accent-sage</p>
                <p>text-accent-violet, bg-accent-violet</p>
                <p>border-border-light, border-border-medium</p>
                <p className="text-stone-400 mt-2">/* Plus all standard Tailwind colors */</p>
                <p>amber-*, stone-*, green-*, red-*, blue-*, yellow-*</p>
              </div>
            </div>
          </div>

          <div className="mt-8 text-sm text-stone-500">
            <p>
              Brand kit generated by <code className="text-xs bg-stone-100 px-1.5 py-0.5 rounded">scripts/generate-brand-kit.mjs</code>.
              Re-run to regenerate all assets.
              SVGs are potrace-traced outlines with no font dependencies.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
