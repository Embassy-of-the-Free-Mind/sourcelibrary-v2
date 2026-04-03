export const metadata = { title: 'Corner Radius Prototype — Source Library' }

// Current: rounded-lg (8px) buttons, rounded-xl (12px) cards
// Proposed: 3px everywhere — nearly angular, just enough to soften

export default function PrototypePage() {
  return (
    <div className="min-h-screen bg-[var(--bg-cream)] p-8">
      <h1 className="font-[Playfair_Display] text-3xl font-semibold text-[var(--text-primary)] mb-2">
        Corner Radius Prototype
      </h1>
      <p className="text-[var(--text-muted)] mb-12 max-w-xl">
        Current style (8–12px radius) vs. proposed sharp style (3px radius).
        The sharp variant feels more editorial and architectural.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 max-w-6xl">
        {/* CURRENT */}
        <Section label="Current (8–12px radius)">
          {/* Card */}
          <div className="bg-white border border-[var(--border-light)] rounded-xl p-6 mb-6">
            <h3 className="font-[Playfair_Display] text-lg font-semibold mb-2">De Occulta Philosophia</h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              Heinrich Cornelius Agrippa, 1533. Three books on the philosophy of magic, drawing on
              Neoplatonic, Hermetic, and Kabbalistic sources.
            </p>
            <div className="flex gap-2 flex-wrap mb-4">
              <span className="text-xs px-3 py-1 rounded-full bg-[var(--bg-warm)] text-[var(--text-muted)] border border-[var(--border-light)]">Latin</span>
              <span className="text-xs px-3 py-1 rounded-full bg-[var(--bg-warm)] text-[var(--text-muted)] border border-[var(--border-light)]">Hermetica</span>
              <span className="text-xs px-3 py-1 rounded-full bg-[var(--bg-warm)] text-[var(--text-muted)] border border-[var(--border-light)]">Kabbalah</span>
            </div>
            <div className="flex gap-3">
              <button className="text-sm font-medium text-white bg-[var(--accent-violet)] px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity">
                Read
              </button>
              <button className="text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-warm)] px-5 py-2.5 rounded-lg border border-[var(--border-light)] hover:bg-[var(--border-light)] transition-colors">
                Details
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[['5,355', 'Books'], ['2,841', 'Translated'], ['12', 'Languages']].map(([n, l]) => (
              <div key={l} className="bg-white border border-[var(--border-light)] rounded-xl p-4 text-center">
                <div className="text-2xl font-semibold text-[var(--text-primary)]">{n}</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">{l}</div>
              </div>
            ))}
          </div>

          {/* Search input */}
          <div className="relative mb-6">
            <input
              type="text"
              placeholder="Search the library..."
              className="w-full px-4 py-3 rounded-lg border border-[var(--border-light)] bg-white text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent-violet)]"
              readOnly
            />
          </div>

          {/* "See all" card like the screenshot */}
          <div className="bg-white border border-[var(--border-light)] rounded-xl p-8 flex flex-col items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-[var(--bg-warm)] flex items-center justify-center mb-3">
              <span className="text-[var(--accent-rust)] text-lg">&rarr;</span>
            </div>
            <div className="text-lg font-semibold text-[var(--text-primary)]">See all 19</div>
            <div className="text-sm text-[var(--text-muted)]">books</div>
          </div>
        </Section>

        {/* PROPOSED — SHARP */}
        <Section label="Proposed (3px radius)">
          {/* Card */}
          <div className="bg-white border border-[var(--border-light)] rounded-[3px] p-6 mb-6">
            <h3 className="font-[Playfair_Display] text-lg font-semibold mb-2">De Occulta Philosophia</h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              Heinrich Cornelius Agrippa, 1533. Three books on the philosophy of magic, drawing on
              Neoplatonic, Hermetic, and Kabbalistic sources.
            </p>
            <div className="flex gap-2 flex-wrap mb-4">
              <span className="text-xs px-3 py-1 rounded-[3px] bg-[var(--bg-warm)] text-[var(--text-muted)] border border-[var(--border-light)]">Latin</span>
              <span className="text-xs px-3 py-1 rounded-[3px] bg-[var(--bg-warm)] text-[var(--text-muted)] border border-[var(--border-light)]">Hermetica</span>
              <span className="text-xs px-3 py-1 rounded-[3px] bg-[var(--bg-warm)] text-[var(--text-muted)] border border-[var(--border-light)]">Kabbalah</span>
            </div>
            <div className="flex gap-3">
              <button className="text-sm font-medium text-white bg-[var(--accent-violet)] px-5 py-2.5 rounded-[3px] hover:opacity-90 transition-opacity">
                Read
              </button>
              <button className="text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-warm)] px-5 py-2.5 rounded-[3px] border border-[var(--border-light)] hover:bg-[var(--border-light)] transition-colors">
                Details
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[['5,355', 'Books'], ['2,841', 'Translated'], ['12', 'Languages']].map(([n, l]) => (
              <div key={l} className="bg-white border border-[var(--border-light)] rounded-[3px] p-4 text-center">
                <div className="text-2xl font-semibold text-[var(--text-primary)]">{n}</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">{l}</div>
              </div>
            ))}
          </div>

          {/* Search input */}
          <div className="relative mb-6">
            <input
              type="text"
              placeholder="Search the library..."
              className="w-full px-4 py-3 rounded-[3px] border border-[var(--border-light)] bg-white text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent-violet)]"
              readOnly
            />
          </div>

          {/* "See all" card — sharp version */}
          <div className="bg-white border border-[var(--border-light)] rounded-[3px] p-8 flex flex-col items-center justify-center">
            <div className="w-14 h-14 rounded-[3px] bg-[var(--bg-warm)] flex items-center justify-center mb-3">
              <span className="text-[var(--accent-rust)] text-lg">&rarr;</span>
            </div>
            <div className="text-lg font-semibold text-[var(--text-primary)]">See all 19</div>
            <div className="text-sm text-[var(--text-muted)]">books</div>
          </div>
        </Section>
      </div>

      {/* Additional comparison: Nav / Toolbar */}
      <h2 className="font-[Playfair_Display] text-2xl font-semibold text-[var(--text-primary)] mt-16 mb-6">
        More Elements
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 max-w-6xl">
        <Section label="Current">
          {/* Toast / notification */}
          <div className="bg-white border border-[var(--border-light)] rounded-xl p-4 flex items-center gap-3 mb-6 shadow-sm">
            <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center shrink-0">
              <span className="text-green-600 text-sm">&#10003;</span>
            </div>
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">Translation complete</div>
              <div className="text-xs text-[var(--text-muted)]">De Occulta Philosophia — 342 pages</div>
            </div>
          </div>

          {/* Toggle / tabs */}
          <div className="inline-flex bg-[var(--bg-warm)] rounded-lg p-1 mb-6">
            <button className="text-sm px-4 py-2 rounded-md bg-white text-[var(--text-primary)] font-medium shadow-sm">Original</button>
            <button className="text-sm px-4 py-2 rounded-md text-[var(--text-muted)]">Translation</button>
            <button className="text-sm px-4 py-2 rounded-md text-[var(--text-muted)]">Side by side</button>
          </div>

          {/* Dropdown / select */}
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--border-light)] bg-white text-sm text-[var(--text-secondary)]">
              Sort by: Date added
              <span className="text-[var(--text-faint)]">&#9662;</span>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center gap-1">
            <button className="w-9 h-9 rounded-lg border border-[var(--border-light)] bg-white text-sm text-[var(--text-muted)] flex items-center justify-center">&larr;</button>
            <button className="w-9 h-9 rounded-lg bg-[var(--accent-violet)] text-white text-sm flex items-center justify-center">1</button>
            <button className="w-9 h-9 rounded-lg border border-[var(--border-light)] bg-white text-sm text-[var(--text-secondary)] flex items-center justify-center">2</button>
            <button className="w-9 h-9 rounded-lg border border-[var(--border-light)] bg-white text-sm text-[var(--text-secondary)] flex items-center justify-center">3</button>
            <button className="w-9 h-9 rounded-lg border border-[var(--border-light)] bg-white text-sm text-[var(--text-muted)] flex items-center justify-center">&rarr;</button>
          </div>
        </Section>

        <Section label="Proposed">
          {/* Toast / notification */}
          <div className="bg-white border border-[var(--border-light)] rounded-[3px] p-4 flex items-center gap-3 mb-6 shadow-sm">
            <div className="w-8 h-8 rounded-[3px] bg-green-50 flex items-center justify-center shrink-0">
              <span className="text-green-600 text-sm">&#10003;</span>
            </div>
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">Translation complete</div>
              <div className="text-xs text-[var(--text-muted)]">De Occulta Philosophia — 342 pages</div>
            </div>
          </div>

          {/* Toggle / tabs */}
          <div className="inline-flex bg-[var(--bg-warm)] rounded-[3px] p-1 mb-6">
            <button className="text-sm px-4 py-2 rounded-[2px] bg-white text-[var(--text-primary)] font-medium shadow-sm">Original</button>
            <button className="text-sm px-4 py-2 rounded-[2px] text-[var(--text-muted)]">Translation</button>
            <button className="text-sm px-4 py-2 rounded-[2px] text-[var(--text-muted)]">Side by side</button>
          </div>

          {/* Dropdown / select */}
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[3px] border border-[var(--border-light)] bg-white text-sm text-[var(--text-secondary)]">
              Sort by: Date added
              <span className="text-[var(--text-faint)]">&#9662;</span>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center gap-1">
            <button className="w-9 h-9 rounded-[3px] border border-[var(--border-light)] bg-white text-sm text-[var(--text-muted)] flex items-center justify-center">&larr;</button>
            <button className="w-9 h-9 rounded-[3px] bg-[var(--accent-violet)] text-white text-sm flex items-center justify-center">1</button>
            <button className="w-9 h-9 rounded-[3px] border border-[var(--border-light)] bg-white text-sm text-[var(--text-secondary)] flex items-center justify-center">2</button>
            <button className="w-9 h-9 rounded-[3px] border border-[var(--border-light)] bg-white text-sm text-[var(--text-secondary)] flex items-center justify-center">3</button>
            <button className="w-9 h-9 rounded-[3px] border border-[var(--border-light)] bg-white text-sm text-[var(--text-muted)] flex items-center justify-center">&rarr;</button>
          </div>
        </Section>
      </div>

      <p className="text-xs text-[var(--text-faint)] mt-16 mb-8">
        Prototype only. Delete this page after review.
      </p>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-[var(--text-faint)] uppercase tracking-widest mb-4">{label}</div>
      {children}
    </div>
  )
}
