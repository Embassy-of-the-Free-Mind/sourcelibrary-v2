import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Color Mockups - Source Library',
  description: 'Before/after color system alignment mockups.',
};

/* ────────────────────────────────────────────
   Mockup components showing before → after
   for the pages most in need of color cleanup
   ──────────────────────────────────────────── */

function MockupSection({ title, description, children }: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-20">
      <h2 className="text-xl font-semibold text-stone-800 mb-1">{title}</h2>
      <p className="text-sm text-stone-500 mb-6 max-w-3xl">{description}</p>
      <div className="grid lg:grid-cols-2 gap-6">
        {children}
      </div>
    </section>
  );
}

function MockupPanel({ label, variant, children }: {
  label: string;
  variant: 'before' | 'after';
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
          variant === 'before'
            ? 'bg-red-50 text-red-600 border border-red-200'
            : 'bg-green-50 text-green-600 border border-green-200'
        }`}>
          {variant === 'before' ? 'Current' : 'Proposed'}
        </span>
        <span className="text-sm text-stone-500">{label}</span>
      </div>
      <div className="border border-stone-200 rounded-xl overflow-hidden shadow-sm">
        {children}
      </div>
    </div>
  );
}

/* ── Mockup 1: Analytics Progress Bars ── */

function AnalyticsBefore() {
  return (
    <div className="p-5 bg-[#fdfcf9] space-y-5">
      <div className="bg-white border border-stone-200 rounded-lg p-4">
        <h3 className="text-sm font-medium mb-4" style={{ color: '#1a1612' }}>Pipeline Progress</h3>

        {/* Before: mixed conventions — raw hex + CSS vars + different conventions per bar */}
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-stone-600">Archived</span>
              <span style={{ color: '#22c55e' }}>847 / 1,203</span>
            </div>
            <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: '70%', backgroundColor: '#22c55e' }} />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-stone-600">OCR</span>
              <span style={{ color: 'var(--accent-sage)' }}>612 / 1,203</span>
            </div>
            <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: '51%', backgroundColor: 'var(--accent-sage)' }} />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-stone-600">Translated</span>
              <span style={{ color: 'var(--accent-rust)' }}>389 / 1,203</span>
            </div>
            <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: '32%', backgroundColor: 'var(--accent-rust)' }} />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-stone-600">Images</span>
              <span style={{ color: '#8b5cf6' }}>156 / 1,203</span>
            </div>
            <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: '13%', backgroundColor: '#8b5cf6' }} />
            </div>
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg" style={{ background: '#fef2f2' }}>
          <p className="text-xs" style={{ color: '#991b1b' }}>3 jobs failed in the last hour</p>
        </div>
      </div>

      <p className="text-xs text-stone-400 italic px-1">
        Problem: #22c55e (raw hex), var(--accent-sage) (CSS token), var(--accent-rust) (CSS token), #8b5cf6 (raw hex) &mdash; four different conventions for four adjacent bars.
        Error states use raw hex (#fef2f2, #991b1b) instead of Tailwind or tokens.
      </p>
    </div>
  );
}

function AnalyticsAfter() {
  return (
    <div className="p-5 bg-[#fdfcf9] space-y-5">
      <div className="bg-white border border-stone-200 rounded-lg p-4">
        <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Pipeline Progress</h3>

        {/* After: all design tokens, consistent convention */}
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: 'var(--text-muted)' }}>Archived</span>
              <span style={{ color: 'var(--accent-sage)' }}>847 / 1,203</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-light)' }}>
              <div className="h-full rounded-full" style={{ width: '70%', backgroundColor: 'var(--accent-sage)' }} />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: 'var(--text-muted)' }}>OCR</span>
              <span style={{ color: 'var(--accent-gold)' }}>612 / 1,203</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-light)' }}>
              <div className="h-full rounded-full" style={{ width: '51%', backgroundColor: 'var(--accent-gold)' }} />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: 'var(--text-muted)' }}>Translated</span>
              <span style={{ color: 'var(--accent-rust)' }}>389 / 1,203</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-light)' }}>
              <div className="h-full rounded-full" style={{ width: '32%', backgroundColor: 'var(--accent-rust)' }} />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: 'var(--text-muted)' }}>Images</span>
              <span style={{ color: 'var(--accent-violet)' }}>156 / 1,203</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-light)' }}>
              <div className="h-full rounded-full" style={{ width: '13%', backgroundColor: 'var(--accent-violet)' }} />
            </div>
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-red-50">
          <p className="text-xs text-red-700">3 jobs failed in the last hour</p>
        </div>
      </div>

      <p className="text-xs text-stone-400 italic px-1">
        All bars use design tokens: sage (archived), gold (OCR), rust (translated), violet (images).
        Labels use var(--text-muted). Track uses var(--border-light). Error keeps Tailwind red (semantic, fine).
      </p>
    </div>
  );
}

/* ── Mockup 2: Book Detail Index Tags ── */

function BookIndexBefore() {
  return (
    <div className="p-5 bg-[#fdfcf9] space-y-4">
      <div className="bg-white border border-stone-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-stone-800 mb-4">Book Index</h3>

        {/* Before: raw Tailwind — blue for people, green for places, purple for concepts */}
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-stone-700">People</span>
              <span className="text-xs text-blue-600">(12)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['Hermes Trismegistus', 'Marsilio Ficino', 'Plotinus', 'Iamblichus'].map(name => (
                <span key={name} className="px-2.5 py-1 text-xs rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100">
                  {name}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-stone-700">Places</span>
              <span className="text-xs text-green-600">(8)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['Alexandria', 'Florence', 'Rome', 'Athens'].map(name => (
                <span key={name} className="px-2.5 py-1 text-xs rounded-full bg-green-50 text-green-700 hover:bg-green-100">
                  {name}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-stone-700">Concepts</span>
              <span className="text-xs text-purple-600">(15)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['Prisca theologia', 'Nous', 'Emanation', 'Theurgy'].map(name => (
                <span key={name} className="px-2.5 py-1 text-xs rounded-full bg-purple-50 text-purple-700 hover:bg-purple-100">
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-stone-400 italic px-1">
        Problem: blue/green/purple have no relationship to the design tokens.
        The same purple is used for concepts here but for AI features elsewhere (--accent-violet).
        No semantic meaning to the color choices.
      </p>
    </div>
  );
}

function BookIndexAfter() {
  return (
    <div className="p-5 bg-[#fdfcf9] space-y-4">
      <div className="bg-white border border-stone-200 rounded-lg p-4">
        <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Book Index</h3>

        {/* After: mapped to brand accents with semantic meaning */}
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>People</span>
              <span className="text-xs" style={{ color: 'var(--accent-rust)' }}>(12)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['Hermes Trismegistus', 'Marsilio Ficino', 'Plotinus', 'Iamblichus'].map(name => (
                <span key={name} className="px-2.5 py-1 text-xs rounded-full cursor-pointer transition-colors"
                  style={{ backgroundColor: 'rgba(158, 74, 58, 0.08)', color: '#9e4a3a' }}>
                  {name}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Places</span>
              <span className="text-xs" style={{ color: 'var(--accent-sage)' }}>(8)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['Alexandria', 'Florence', 'Rome', 'Athens'].map(name => (
                <span key={name} className="px-2.5 py-1 text-xs rounded-full cursor-pointer transition-colors"
                  style={{ backgroundColor: 'rgba(139, 154, 125, 0.12)', color: '#8b9a7d' }}>
                  {name}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Concepts</span>
              <span className="text-xs" style={{ color: 'var(--accent-violet)' }}>(15)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['Prisca theologia', 'Nous', 'Emanation', 'Theurgy'].map(name => (
                <span key={name} className="px-2.5 py-1 text-xs rounded-full cursor-pointer transition-colors"
                  style={{ backgroundColor: 'rgba(124, 93, 181, 0.08)', color: '#7c5db5' }}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-stone-400 italic px-1">
        Maps to brand tokens: People = rust (scholarly/literary), Places = sage (natural),
        Concepts = violet (intellectual/abstract). Warm, muted tones instead of saturated primaries.
        Consistent with the rest of the site.
      </p>
    </div>
  );
}

/* ── Mockup 3: Hero Dark Color ── */

function HeroBefore() {
  return (
    <div className="space-y-4">
      <div className="bg-black text-white p-8 rounded-t-xl">
        <div className="flex items-center gap-3 mb-4">
          <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="1" />
            <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="1" />
            <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1" />
          </svg>
          <span className="text-xl uppercase tracking-wider">
            <span className="font-semibold">Source</span><span className="font-light">Library</span>
          </span>
        </div>
        <h1 className="text-2xl font-serif mb-2">Primary Sources of the Western Esoteric Tradition</h1>
        <p className="text-white/70 text-sm">OCR, translation, and scholarly annotation of rare books.</p>
      </div>

      <p className="text-xs text-stone-400 italic px-1">
        Current: bg-black (#000000). Pure black feels flat and disconnected from
        the warm paper tones below the fold. Also inconsistent with --bg-dark (#1a1612).
      </p>
    </div>
  );
}

function HeroAfter() {
  return (
    <div className="space-y-4">
      <div className="text-white p-8 rounded-t-xl" style={{ backgroundColor: '#1a1612' }}>
        <div className="flex items-center gap-3 mb-4">
          <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="1" />
            <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="1" />
            <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1" />
          </svg>
          <span className="text-xl uppercase tracking-wider">
            <span className="font-semibold">Source</span><span className="font-light">Library</span>
          </span>
        </div>
        <h1 className="text-2xl font-serif mb-2">Primary Sources of the Western Esoteric Tradition</h1>
        <p className="text-white/70 text-sm">OCR, translation, and scholarly annotation of rare books.</p>
      </div>

      <p className="text-xs text-stone-400 italic px-1">
        Proposed: #1a1612 (--bg-dark). Warm brown-black matches the paper aesthetic.
        Subtle but the warmth is visible — it feels like aged parchment in shadow
        rather than a tech product.
      </p>
    </div>
  );
}

/* ── Mockup 4: Homepage Gray vs Stone ── */

function HomepageTextBefore() {
  return (
    <div className="space-y-4">
      <div className="p-6 bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] rounded-xl">
        <h2 className="text-xl font-serif text-gray-900 mb-3">About Source Library</h2>
        <p className="text-gray-600 text-sm mb-3">
          A digital library of primary sources from the Western esoteric tradition.
          Alchemy, Hermetica, Kabbalah, Rosicrucianism, and the intersection of
          science, magic, and philosophy from antiquity to the Enlightenment.
        </p>
        <p className="text-gray-600 text-sm">
          Every text is OCR&apos;d, translated, and annotated using AI, making these
          rare sources accessible for the first time in centuries.
        </p>
        <div className="mt-4 pt-4 border-t border-stone-300">
          <span className="text-stone-500 text-xs">In the spirit of</span>
          <p className="text-stone-800 font-medium text-sm mt-1">Marsilio Ficino</p>
          <p className="text-stone-500 text-xs">Florence, 1463</p>
        </div>
      </div>

      <p className="text-xs text-stone-400 italic px-1">
        Problem: text-gray-900 and text-gray-600 in the paragraphs, but text-stone-500
        and text-stone-800 in the footer. Gray and stone are different Tailwind palettes.
        Gray is cooler/bluer; stone is warmer — jarring side by side.
      </p>
    </div>
  );
}

function HomepageTextAfter() {
  return (
    <div className="space-y-4">
      <div className="p-6 bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] rounded-xl">
        <h2 className="text-xl font-serif text-stone-900 mb-3">About Source Library</h2>
        <p className="text-stone-600 text-sm mb-3">
          A digital library of primary sources from the Western esoteric tradition.
          Alchemy, Hermetica, Kabbalah, Rosicrucianism, and the intersection of
          science, magic, and philosophy from antiquity to the Enlightenment.
        </p>
        <p className="text-stone-600 text-sm">
          Every text is OCR&apos;d, translated, and annotated using AI, making these
          rare sources accessible for the first time in centuries.
        </p>
        <div className="mt-4 pt-4 border-t border-stone-300">
          <span className="text-stone-500 text-xs">In the spirit of</span>
          <p className="text-stone-800 font-medium text-sm mt-1">Marsilio Ficino</p>
          <p className="text-stone-500 text-xs">Florence, 1463</p>
        </div>
      </div>

      <p className="text-xs text-stone-400 italic px-1">
        Fix: text-gray-* replaced with text-stone-*. Same warmth throughout.
        Stone is the correct neutral for this site — warm undertone matches
        the cream/warm backgrounds.
      </p>
    </div>
  );
}

/* ── Mockup 5: Annotation Type Colors ── */

function AnnotationsBefore() {
  return (
    <div className="space-y-4">
      <div className="p-5 bg-white border border-stone-200 rounded-xl">
        <h3 className="text-sm font-medium text-stone-800 mb-4">Annotations</h3>
        <div className="space-y-2.5">
          {[
            { type: 'comment', color: 'bg-stone-100 text-stone-700', text: 'General observation about the passage.' },
            { type: 'context', color: 'bg-blue-100 text-blue-700', text: 'This refers to the Corpus Hermeticum, tract XII.' },
            { type: 'reference', color: 'bg-purple-100 text-purple-700', text: 'Cf. Plotinus, Enneads V.1.6.' },
            { type: 'correction', color: 'bg-red-100 text-red-700', text: 'OCR reads "mundus" but should be "mundi".' },
            { type: 'etymology', color: 'bg-green-100 text-green-700', text: 'Latin "anima" from Greek "anemos" (wind).' },
            { type: 'question', color: 'bg-yellow-100 text-yellow-700', text: 'Is this a paraphrase of Poimandres?' },
          ].map(({ type, color, text }) => (
            <div key={type} className="flex items-start gap-2">
              <span className={`px-2 py-0.5 text-[10px] rounded-full uppercase tracking-wide shrink-0 mt-0.5 ${color}`}>
                {type}
              </span>
              <p className="text-sm text-stone-600">{text}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-stone-400 italic px-1">
        Problem: 6 different Tailwind color families (stone, blue, purple, red, green, yellow) with
        no connection to design tokens. These are hardcoded in AnnotationPanel.tsx lines 59-64.
      </p>
    </div>
  );
}

function AnnotationsAfter() {
  return (
    <div className="space-y-4">
      <div className="p-5 bg-white border border-stone-200 rounded-xl">
        <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Annotations</h3>
        <div className="space-y-2.5">
          {[
            { type: 'comment', bg: 'rgba(107, 101, 96, 0.1)', fg: 'var(--text-muted)', text: 'General observation about the passage.' },
            { type: 'context', bg: 'rgba(201, 168, 108, 0.12)', fg: '#c9a86c', text: 'This refers to the Corpus Hermeticum, tract XII.' },
            { type: 'reference', bg: 'rgba(124, 93, 181, 0.08)', fg: '#7c5db5', text: 'Cf. Plotinus, Enneads V.1.6.' },
            { type: 'correction', bg: 'rgba(158, 74, 58, 0.1)', fg: '#9e4a3a', text: 'OCR reads "mundus" but should be "mundi".' },
            { type: 'etymology', bg: 'rgba(139, 154, 125, 0.12)', fg: '#8b9a7d', text: 'Latin "anima" from Greek "anemos" (wind).' },
            { type: 'question', bg: 'rgba(217, 119, 6, 0.08)', fg: '#b45309', text: 'Is this a paraphrase of Poimandres?' },
          ].map(({ type, bg, fg, text }) => (
            <div key={type} className="flex items-start gap-2">
              <span className="px-2 py-0.5 text-[10px] rounded-full uppercase tracking-wide shrink-0 mt-0.5"
                style={{ backgroundColor: bg, color: fg }}>
                {type}
              </span>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{text}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-stone-400 italic px-1">
        Mapped to design tokens: comment = muted (neutral), context = gold (decorative),
        reference = violet (intellectual), correction = rust (editorial), etymology = sage (knowledge),
        question = amber (action). The palette feels cohesive — warm, scholarly, muted.
      </p>
    </div>
  );
}

/* ── Mockup 6: NotesRenderer One-offs ── */

function NotesRendererBefore() {
  return (
    <div className="space-y-4">
      <div className="p-5 bg-[#fdfcf9] border border-stone-200 rounded-xl space-y-3">
        <h3 className="text-sm font-medium text-stone-800 mb-2">Reader Inline Elements</h3>

        <div className="p-3 rounded-lg bg-teal-100 border-l-3 border-teal-400">
          <p className="text-xs uppercase tracking-wide text-teal-800 mb-1">Marginal Note</p>
          <p className="text-sm text-teal-800">De natura rerum — a gloss on the primary text</p>
        </div>

        <div className="p-3 rounded-lg bg-indigo-100">
          <p className="text-xs uppercase tracking-wide text-indigo-700 mb-1">Chapter Marker</p>
          <p className="text-sm text-indigo-700">Caput III. De Lapide Philosophorum</p>
        </div>

        <div className="p-3 rounded-lg bg-amber-50 border border-amber-300">
          <p className="text-xs uppercase tracking-wide text-amber-700 mb-1">Blockquote</p>
          <p className="text-sm text-amber-700 italic">&ldquo;As above, so below.&rdquo;</p>
        </div>

        <div className="inline-block px-2 py-0.5 rounded bg-purple-100 text-purple-700 text-xs">
          anima mundi
        </div>
        <span className="text-xs text-stone-400 ml-2">Vocabulary term</span>
      </div>

      <p className="text-xs text-stone-400 italic px-1">
        Problem: teal, indigo, and purple are each used in exactly one place in the entire codebase.
        Three unique color families for four inline elements. None map to design tokens.
      </p>
    </div>
  );
}

function NotesRendererAfter() {
  return (
    <div className="space-y-4">
      <div className="p-5 bg-[#fdfcf9] border border-stone-200 rounded-xl space-y-3">
        <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Reader Inline Elements</h3>

        <div className="p-3 rounded-lg border-l-3" style={{ backgroundColor: 'rgba(139, 154, 125, 0.1)', borderLeftColor: '#8b9a7d' }}>
          <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#8b9a7d' }}>Marginal Note</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>De natura rerum — a gloss on the primary text</p>
        </div>

        <div className="p-3 rounded-lg" style={{ backgroundColor: 'rgba(201, 168, 108, 0.08)' }}>
          <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#c9a86c' }}>Chapter Marker</p>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>Caput III. De Lapide Philosophorum</p>
        </div>

        <div className="p-3 rounded-lg" style={{ backgroundColor: 'rgba(158, 74, 58, 0.06)', border: '1px solid rgba(158, 74, 58, 0.2)' }}>
          <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#9e4a3a' }}>Blockquote</p>
          <p className="text-sm italic" style={{ color: 'var(--text-secondary)' }}>&ldquo;As above, so below.&rdquo;</p>
        </div>

        <div className="inline-block px-2 py-0.5 rounded text-xs" style={{ backgroundColor: 'rgba(124, 93, 181, 0.08)', color: '#7c5db5' }}>
          anima mundi
        </div>
        <span className="text-xs ml-2" style={{ color: 'var(--text-faint)' }}>Vocabulary term</span>
      </div>

      <p className="text-xs text-stone-400 italic px-1">
        Mapped: marginal notes = sage (textual), chapter markers = gold (structural/decorative),
        blockquotes = rust (literary), vocabulary = violet (intellectual). Zero new colors introduced.
        All from the existing 4 accent tokens.
      </p>
    </div>
  );
}

/* ── Main Page ── */

export default function MockupsPage() {
  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-[#1a1612] text-white">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex items-center gap-3 mb-4">
            <a href="/brand" className="text-stone-400 hover:text-white text-sm transition-colors">&larr; Brand Kit</a>
          </div>
          <h1 className="text-2xl font-light tracking-wide">Color System Mockups</h1>
          <p className="text-stone-400 mt-2 max-w-2xl">
            Before/after comparisons for the pages most in need of color alignment.
            Each mockup shows the current state and a proposed fix using the existing design tokens.
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">

        {/* Summary */}
        <div className="mb-12 p-5 bg-white border border-stone-200 rounded-lg">
          <h2 className="text-sm font-semibold text-stone-800 mb-3">The Core Proposal</h2>
          <p className="text-sm text-stone-600 mb-3">
            We already have 4 good accent tokens (rust, gold, sage, violet). The problem isn&apos;t missing colors &mdash;
            it&apos;s that many components bypass the tokens and use raw Tailwind primaries (blue, green, purple, teal, indigo).
            These mockups show what it looks like when everything maps to the existing palette.
          </p>
          <div className="flex flex-wrap gap-4 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#9e4a3a' }} />
              <span className="text-stone-600">Rust &mdash; editorial, literary, people</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#c9a86c' }} />
              <span className="text-stone-600">Gold &mdash; structural, decorative, OCR</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#8b9a7d' }} />
              <span className="text-stone-600">Sage &mdash; natural, places, archival</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#7c5db5' }} />
              <span className="text-stone-600">Violet &mdash; intellectual, concepts, AI</span>
            </div>
          </div>
        </div>

        <MockupSection
          title="1. Analytics Pipeline Progress"
          description="The analytics dashboard mixes raw hex codes (#22c55e, #8b5cf6) with CSS vars (--accent-sage, --accent-rust) in adjacent progress bars. Three different conventions in one component."
        >
          <MockupPanel label="Mixed hex + CSS vars" variant="before">
            <AnalyticsBefore />
          </MockupPanel>
          <MockupPanel label="All design tokens" variant="after">
            <AnalyticsAfter />
          </MockupPanel>
        </MockupSection>

        <MockupSection
          title="2. Book Index Entity Tags"
          description="Book detail pages use blue/green/purple for People/Places/Concepts. These are Tailwind primaries with no connection to the brand palette. They clash with the warm paper tones."
        >
          <MockupPanel label="Raw Tailwind primaries" variant="before">
            <BookIndexBefore />
          </MockupPanel>
          <MockupPanel label="Brand accent tokens" variant="after">
            <BookIndexAfter />
          </MockupPanel>
        </MockupSection>

        <MockupSection
          title="3. Hero Dark Background"
          description="The hero uses bg-black (#000000). The CSS design token is --bg-dark: #1a1612 (warm brown-black). The difference is subtle but the warm tone connects to the rest of the site."
        >
          <MockupPanel label="Pure black (#000000)" variant="before">
            <HeroBefore />
          </MockupPanel>
          <MockupPanel label="Warm dark (#1a1612)" variant="after">
            <HeroAfter />
          </MockupPanel>
        </MockupSection>

        <MockupSection
          title="4. Homepage Text: Gray vs Stone"
          description="The homepage mixes text-gray-* (cool, blue undertone) with text-stone-* (warm undertone). Side by side, the temperature shift is noticeable."
        >
          <MockupPanel label="Mixed gray + stone" variant="before">
            <HomepageTextBefore />
          </MockupPanel>
          <MockupPanel label="All stone" variant="after">
            <HomepageTextAfter />
          </MockupPanel>
        </MockupSection>

        <MockupSection
          title="5. Annotation Type Colors"
          description="Annotation types use 6 different Tailwind color families hardcoded in AnnotationPanel.tsx. Each type could map to a brand accent instead."
        >
          <MockupPanel label="6 random Tailwind colors" variant="before">
            <AnnotationsBefore />
          </MockupPanel>
          <MockupPanel label="Mapped to 4 brand accents" variant="after">
            <AnnotationsAfter />
          </MockupPanel>
        </MockupSection>

        <MockupSection
          title="6. Reader Inline Elements"
          description="NotesRenderer uses teal, indigo, and purple — each appearing exactly once in the entire codebase. Three unique color families for four inline elements."
        >
          <MockupPanel label="Teal, indigo, purple one-offs" variant="before">
            <NotesRendererBefore />
          </MockupPanel>
          <MockupPanel label="All from existing accent tokens" variant="after">
            <NotesRendererAfter />
          </MockupPanel>
        </MockupSection>

        {/* Implementation Priority */}
        <section className="mt-16 p-6 bg-white border border-stone-200 rounded-lg">
          <h2 className="text-lg font-semibold text-stone-800 mb-4">Implementation Priority</h2>
          <div className="space-y-3">
            {[
              { effort: 'Low', impact: 'High', task: 'Homepage gray → stone (3 lines in page.tsx)', files: '1 file' },
              { effort: 'Low', impact: 'High', task: 'Hero bg-black → bg-[#1a1612] (1 line in HeroSection.tsx)', files: '1 file' },
              { effort: 'Low', impact: 'Medium', task: 'Remove --accent-slate from globals.css (dead code)', files: '1 file' },
              { effort: 'Medium', impact: 'High', task: 'Book index entity tags → rust/sage/violet', files: '2 files (page.tsx, BookIndexPanel.tsx)' },
              { effort: 'Medium', impact: 'High', task: 'Analytics progress bars → all design tokens', files: '1 file (analytics/page.tsx)' },
              { effort: 'Medium', impact: 'Medium', task: 'Annotation type colors → brand accents', files: '3 files (AnnotationPanel, AnnotationEditor, HighlightSelection)' },
              { effort: 'Medium', impact: 'Medium', task: 'NotesRenderer inline elements → brand accents', files: '1 file (NotesRenderer.tsx)' },
              { effort: 'High', impact: 'Low', task: 'Regenerate brand kit PNGs/SVGs with #1a1612', files: 'scripts + 170 assets' },
            ].map(({ effort, impact, task, files }, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <span className="text-stone-400 w-5 shrink-0">{i + 1}.</span>
                <div className="flex items-center gap-2 shrink-0 w-32">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    effort === 'Low' ? 'bg-green-50 text-green-700' :
                    effort === 'Medium' ? 'bg-amber-50 text-amber-700' :
                    'bg-red-50 text-red-700'
                  }`}>{effort} effort</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 w-32">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    impact === 'High' ? 'bg-green-50 text-green-700' :
                    impact === 'Medium' ? 'bg-amber-50 text-amber-700' :
                    'bg-stone-100 text-stone-600'
                  }`}>{impact} impact</span>
                </div>
                <div>
                  <p className="text-stone-700">{task}</p>
                  <p className="text-xs text-stone-400">{files}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
