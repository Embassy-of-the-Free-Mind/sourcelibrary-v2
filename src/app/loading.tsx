import { BookLoader } from '@/components/ui/BookLoader';

export default function RootLoading() {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <BookLoader size="lg" />
    </div>
  );
}
