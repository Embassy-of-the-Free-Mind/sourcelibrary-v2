'use client';

import Link from 'next/link';

const scanModes = [
  {
    href: '/scan/bulk',
    title: 'Bulk Upload',
    description: 'Take photos with your camera app, then upload them all at once. Best for scanning many pages quickly.',
    badge: 'Recommended',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
    ),
  },
  {
    href: '/scan/auto',
    title: 'Auto-Capture',
    description: 'Live camera with automatic edge detection. Detects the page and captures when steady.',
    badge: 'Experimental',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
      </svg>
    ),
  },
  {
    href: '/scan/opencv',
    title: 'Auto-Capture (OpenCV)',
    description: 'Same as Auto-Capture but uses OpenCV.js for more accurate edge detection. Downloads ~8 MB.',
    badge: 'Experimental',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
      </svg>
    ),
  },
];

export default function ScanMenu() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <div className="max-w-lg mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ color: 'var(--accent-rust)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.331 0 4.467.89 6.064 2.346m0-14.304a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.346m0-14.304v14.304" />
            </svg>
          </Link>
          <h1 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
            Scan a Book
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Choose a scanning mode
          </p>
        </div>

        {/* Mode cards */}
        <div className="space-y-3">
          {scanModes.map((mode) => (
            <Link
              key={mode.href}
              href={mode.href}
              className="flex items-start gap-4 p-4 rounded-xl border transition-all hover:shadow-md active:scale-[0.99]"
              style={{
                background: 'white',
                borderColor: 'var(--border-light)',
              }}
            >
              <div
                className="shrink-0 w-12 h-12 rounded-lg flex items-center justify-center mt-0.5"
                style={{
                  background: mode.badge === 'Recommended' ? 'var(--accent-rust)' : 'var(--bg-warm)',
                  color: mode.badge === 'Recommended' ? 'white' : 'var(--text-secondary)',
                }}
              >
                {mode.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {mode.title}
                  </span>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full"
                    style={{
                      background: mode.badge === 'Recommended' ? 'var(--accent-rust)' : 'var(--bg-warm)',
                      color: mode.badge === 'Recommended' ? 'white' : 'var(--text-muted)',
                    }}
                  >
                    {mode.badge}
                  </span>
                </div>
                <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                  {mode.description}
                </p>
              </div>
              <svg className="w-5 h-5 shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--text-faint)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
          ))}
        </div>

        {/* Recent scans link */}
        <div className="mt-8 text-center">
          <Link
            href="/scan/bulk"
            className="text-sm underline underline-offset-2"
            style={{ color: 'var(--text-muted)' }}
          >
            View recent scans
          </Link>
        </div>
      </div>
    </div>
  );
}
