import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import PrintButton from './PrintButton';

export const metadata: Metadata = {
  title: 'Certificate of Adoption — Source Library',
  robots: { index: false, follow: false },
};

interface AdoptionRecord {
  bookTitle?: string;
  bookSlug?: string | null;
  bookId?: string;
  sponsor?: string | null;
  payer_name?: string | null;
  created_at?: Date | string;
}

function formatDate(d: Date | string | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default async function CertificatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const db = await getDb();
  const adoption = (await db
    .collection('book_adoptions')
    .findOne({ stripe_session_id: token })) as AdoptionRecord | null;

  if (!adoption) notFound();

  const name = adoption.payer_name || adoption.sponsor || 'A patron of Source Library';
  const bookTitle = adoption.bookTitle || 'a book from the Bibliotheca Philosophica Hermetica';
  const date = formatDate(adoption.created_at);
  const bookPath = adoption.bookSlug || adoption.bookId ? `/book/${adoption.bookSlug || adoption.bookId}` : null;

  return (
    <main className="min-h-screen bg-stone-100 flex flex-col items-center justify-center py-12 px-4 print:bg-white print:py-0">
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 1.5cm; } body { background: #fff; } }`}</style>

      <div
        className="w-full max-w-2xl bg-[#fbf7ee] text-[#1e1a16] px-10 py-14 text-center"
        style={{ boxShadow: '0 0 0 1px #d8c9a8, 0 0 0 10px #fbf7ee, 0 0 0 11px #c9a24a' }}
      >
        <p style={{ letterSpacing: '0.25em' }} className="text-xs uppercase text-[#9c6b2e] mb-6">
          Embassy of the Free Mind · Amsterdam
        </p>

        <h1 className="font-serif text-3xl md:text-4xl mb-2" style={{ fontFamily: 'Georgia, serif' }}>
          Certificate of Adoption
        </h1>
        <div className="mx-auto my-5 h-px w-24 bg-[#c9a24a]" />

        <p className="text-base text-[#4a4138] mb-3">This certifies that</p>
        <p className="font-serif text-2xl md:text-3xl text-[#7a1f1f] mb-5" style={{ fontFamily: 'Georgia, serif' }}>
          {name}
        </p>

        <p className="text-base leading-relaxed text-[#1e1a16] max-w-xl mx-auto">
          has given <em>{bookTitle}</em> to the world — digitized, translated, and made freely
          readable by anyone, anywhere, for as long as the internet endures.
        </p>

        {date && <p className="mt-8 text-sm text-[#8a8480]">{date}</p>}

        <p className="mt-2 text-sm text-[#8a8480]">
          Source Library · Bibliotheca Philosophica Hermetica
        </p>
      </div>

      <div className="no-print mt-6 text-center">
        {bookPath && (
          <a href={bookPath} className="text-sm text-[#9e4a3a] hover:underline">
            View the book →
          </a>
        )}
        <div>
          <PrintButton />
        </div>
      </div>
    </main>
  );
}
