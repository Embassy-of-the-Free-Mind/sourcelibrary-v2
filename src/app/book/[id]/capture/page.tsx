'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import CameraCapture from '@/components/camera/CameraCapture';
import { books } from '@/lib/api-client';

interface Book {
  id: string;
  title: string;
  display_title?: string;
}

export default function CapturePage() {
  const params = useParams();
  const router = useRouter();
  const bookId = params.id as string;

  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch book to verify it exists and get title
  useEffect(() => {
    async function fetchBook() {
      try {
        const data = await books.get(bookId);
        setBook(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load book');
      } finally {
        setLoading(false);
      }
    }
    fetchBook();
  }, [bookId]);

  const handleComplete = () => {
    router.push(`/book/${bookId}`);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center p-8 text-center">
        <p className="text-red-400 mb-4">{error || 'Book not found'}</p>
        <Link
          href="/"
          className="flex items-center gap-2 text-stone-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Library
        </Link>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black flex flex-col"
      style={{ touchAction: 'none' }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 bg-black/80 text-white z-10"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <Link href={`/book/${bookId}`} className="p-2 -ml-2">
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <h1 className="text-sm font-medium truncate max-w-[60%]">
          {book.display_title || book.title}
        </h1>
        <div className="w-10" /> {/* Spacer for centering */}
      </header>

      {/* Camera */}
      <CameraCapture bookId={bookId} onComplete={handleComplete} />
    </div>
  );
}
