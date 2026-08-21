import Logo from '@/components/layout/Logo';
import {
  ChevronLeft, ChevronRight, List, Search, BookOpen, MessageCircle, Info,
  Quote, Share2, Download, GalleryHorizontal, Columns3, MoreHorizontal,
} from 'lucide-react';

/**
 * Reader loading fallback — shown the instant navigation starts (every page
 * turn, and a slow first load), swapped for Reader2C once its data arrives.
 *
 * Deliberately NOT a skeleton. An earlier version mocked up the whole page
 * (gray pulsing blocks standing in for the title, the toolbar, seven lines of
 * fake body text) — readers reported it as "a wireframe preview thing" they
 * didn't want to see. The chrome below is REAL: the same dark top bar, the
 * same tool rail with the same icons, the same pane frames and background
 * colors Reader2C renders once it mounts. Only the parts that depend on the
 * fetch (title, page text, page count) are left blank rather than faked, so
 * there is nothing here to jar or flash when the real content replaces it.
 * Structure and colors are copied from Reader2C.tsx's markup — mirror any
 * chrome change made there (rail icon set, bar heights, pane colors) here too.
 */

const INK = 'var(--bg-dark)';
function onInk(opacity: number): string {
  return `rgba(253, 252, 249, ${opacity})`;
}
// Same as ReaderV2Bits.SURFACE — duplicated rather than imported so this
// fallback has no dependency on the file the other session is actively
// editing.
const SURFACE_SCAN_BED = 'color-mix(in srgb, var(--bg-warm) 96%, var(--bg-dark))';
const SURFACE_TEXT = 'color-mix(in srgb, var(--bg-cream) 45%, var(--bg-warm))';

const RAIL_ICONS = [List, Search, BookOpen, MessageCircle, Info, Quote, Share2, Download];

function RailIcon({ Icon }: { Icon: typeof List }) {
  return (
    <div className="w-12 h-[46px] flex items-center justify-center" style={{ color: onInk(0.45) }}>
      <Icon size={17} />
    </div>
  );
}

function PaneFrame({ background, borderRight }: { background: string; borderRight: boolean }) {
  return (
    <section
      className={`flex-1 min-w-0 flex flex-col ${borderRight ? 'border-r' : ''}`}
      style={{ background, borderColor: 'var(--border-medium)' }}
    >
      <div className="h-[46px] shrink-0" style={{ borderBottom: '1px solid var(--border-medium)' }} />
    </section>
  );
}

export default function ReaderLoading() {
  return (
    <div>
      {/* ── Desktop (lg+): same fixed frame as Reader2C ──────────────────── */}
      <div
        className="hidden lg:grid h-[100dvh]"
        style={{ gridTemplateColumns: '66px 1fr', gridTemplateRows: '58px 1fr auto' }}
      >
        <header
          className="col-span-2 flex items-center gap-3 px-4"
          style={{ background: INK, color: '#fdfcf9', borderBottom: `1px solid ${onInk(0.12)}` }}
        >
          <Logo white compact />
          <div className="flex-1" />
          <div className="flex items-stretch border" style={{ borderColor: onInk(0.14), background: onInk(0.06) }}>
            <div className="w-8 h-[34px] flex items-center justify-center" style={{ color: onInk(0.4) }}>
              <ChevronLeft size={15} />
            </div>
            <div className="w-14 h-[34px]" />
            <div className="w-8 h-[34px] flex items-center justify-center" style={{ color: onInk(0.4) }}>
              <ChevronRight size={15} />
            </div>
          </div>
        </header>

        <nav
          className="row-span-2 flex flex-col items-center pt-3 gap-1"
          style={{ background: INK, borderRight: `1px solid ${onInk(0.12)}` }}
          aria-label="Reader tools"
        >
          {RAIL_ICONS.map((Icon, i) => <RailIcon key={i} Icon={Icon} />)}
          <div className="flex-1" />
          <div className="flex items-start justify-center" style={{ height: 92, paddingTop: 8 }}>
            <div className="w-12 h-[54px] flex flex-col items-center justify-center gap-1" style={{ color: onInk(0.45) }}>
              <GalleryHorizontal size={17} />
            </div>
          </div>
        </nav>

        <div className="relative flex min-h-0">
          <PaneFrame background={SURFACE_SCAN_BED} borderRight />
          <PaneFrame background={SURFACE_TEXT} borderRight={false} />
        </div>
      </div>

      {/* ── Mobile (below lg): same header/toolbar/panes as Reader2C ─────── */}
      <div className="lg:hidden flex flex-col h-[100dvh]">
        <header className="shrink-0" style={{ background: INK, height: 52 }}>
          <div className="flex items-center gap-2.5 h-[52px] px-3">
            <Logo white mini />
          </div>
        </header>

        <main className="flex-1 min-h-0 flex flex-col">
          <section className="flex-1" style={{ background: SURFACE_SCAN_BED }}>
            <div className="h-[34px] border-b" style={{ borderColor: 'var(--border-medium)' }} />
          </section>
          <section className="flex-1 border-t" style={{ background: SURFACE_TEXT, borderColor: 'var(--border-medium)' }}>
            <div className="h-[34px] border-b" style={{ borderColor: 'var(--border-medium)' }} />
          </section>
        </main>

        <div
          className="flex items-center w-full shrink-0"
          style={{ background: INK, borderTop: `1px solid ${onInk(0.12)}`, height: 52 }}
        >
          {[GalleryHorizontal, Columns3, Search, MoreHorizontal].map((Icon, i) => (
            <div key={i} className="flex-1 min-w-0 h-[52px] flex items-center justify-center" style={{ color: onInk(0.45) }}>
              <Icon size={19} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
