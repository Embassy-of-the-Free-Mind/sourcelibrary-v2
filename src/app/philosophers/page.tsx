import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';

// The Philosophers' Hall (#230). The game is a self-contained static page in
// public/philosophers/hall.html, built from JDerekLomas/philosophers-hall
// (`node build.mjs --preview sim/<run>/state.json`). It replays sessions written
// offline on the subscription; nothing here calls a model. To ship a new run,
// rebuild that file and replace it.

export const metadata: Metadata = {
  title: "The Philosophers' Hall - Source Library",
  description:
    'Fifteen philosophers argue, lecture and write in a pixel-art library, each from the pages they left in Source Library. Every line links to the page it rests on.',
  alternates: { canonical: '/philosophers' },
};

export default function PhilosophersPage() {
  return (
    <main className="min-h-screen bg-cream">
      <SiteHeader variant="light" breadcrumbs={[{ label: "The Philosophers' Hall", href: '/philosophers' }]} />
      <div className="max-w-[1100px] mx-auto px-4 pt-6 pb-2">
        <p className="text-sm text-muted max-w-[70ch]">
          Fifteen philosophers argue, lecture and write from the pages they left in this library. Claude writes
          every line they speak, so none of it is quotation. Each line names the page it rests on, and that page
          opens in a new tab.
        </p>
      </div>
      <iframe
        src="/philosophers/hall.html"
        title="The Philosophers' Hall"
        className="block w-full border-0"
        style={{ height: 'calc(100vh - 120px)', minHeight: 760 }}
      />
    </main>
  );
}
