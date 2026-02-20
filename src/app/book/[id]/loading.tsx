import { BookLoader } from '@/components/ui/BookLoader';

export default function BookDetailLoading() {
  return (
    <div className="min-h-screen bg-cream flex items-center justify-center">
      <BookLoader size="lg" />
    </div>
  );
}
