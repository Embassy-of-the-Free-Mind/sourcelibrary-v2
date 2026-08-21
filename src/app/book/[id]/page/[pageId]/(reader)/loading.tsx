export default function PageEditorLoading() {
  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--bg-warm)' }}>
      {/* Header */}
      <header className="px-3 sm:px-6 py-2 sm:py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        {/* Row 1: Logo / Title / Navigation */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
            <div className="w-7 h-7 bg-stone-200 rounded animate-pulse flex-shrink-0" />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>/</span>
            <div className="h-5 sm:h-6 w-48 bg-stone-200 rounded animate-pulse" />
          </div>
          <div className="flex items-center gap-1 rounded-lg p-1 shrink-0" style={{ background: 'var(--bg-warm)' }}>
            <div className="w-8 h-8 bg-stone-200 rounded-md animate-pulse" />
            <div className="w-12 h-5 bg-stone-200 rounded animate-pulse mx-1" />
            <div className="w-8 h-8 bg-stone-200 rounded-md animate-pulse" />
          </div>
        </div>

        {/* Row 2: Panel toggles */}
        <div className="flex items-center justify-between mt-2 sm:mt-3">
          <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
            <div className="w-16 sm:w-20 h-7 bg-stone-200 rounded-md animate-pulse" />
            <div className="w-16 sm:w-20 h-7 bg-stone-200 rounded-md animate-pulse" />
            <div className="w-16 sm:w-20 h-7 bg-stone-200 rounded-md animate-pulse" />
          </div>
          <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
            <div className="w-16 sm:w-20 h-7 bg-stone-200 rounded-md animate-pulse" />
            <div className="w-16 sm:w-20 h-7 bg-stone-200 rounded-md animate-pulse" />
          </div>
        </div>
      </header>

      {/* Panels */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Source image panel */}
        <div className="w-full min-h-[50vh] lg:min-h-0 lg:flex-1 flex flex-col" style={{ background: 'var(--bg-cream)', borderRight: '1px solid var(--border-light)' }}>
          <div className="px-3 sm:px-4 py-2 sm:py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="h-4 w-12 bg-stone-200 rounded animate-pulse" />
            <div className="h-5 w-10 bg-violet-100 rounded animate-pulse" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="w-3/4 aspect-[3/4] max-h-[80%] bg-stone-200 rounded animate-pulse" />
          </div>
        </div>

        {/* Translation panel */}
        <div className="w-full min-h-[50vh] lg:min-h-0 lg:flex-1 flex flex-col" style={{ background: 'var(--bg-white)' }}>
          <div className="px-3 sm:px-4 py-2 sm:py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="h-4 w-20 bg-stone-200 rounded animate-pulse" />
            <div className="h-5 w-14 bg-stone-100 rounded animate-pulse" />
          </div>
          <div className="flex-1 p-4 sm:p-6 space-y-3">
            <div className="h-4 w-full bg-stone-100 rounded animate-pulse" />
            <div className="h-4 w-full bg-stone-100 rounded animate-pulse" />
            <div className="h-4 w-5/6 bg-stone-100 rounded animate-pulse" />
            <div className="h-4 w-full bg-stone-100 rounded animate-pulse" />
            <div className="h-4 w-4/6 bg-stone-100 rounded animate-pulse" />
            <div className="h-4 w-full bg-stone-100 rounded animate-pulse" />
            <div className="h-4 w-3/4 bg-stone-100 rounded animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
