import { BookLoader } from '@/components/ui/BookLoader';

export default function CollectionLoading() {
  return (
    <div className="min-h-screen bg-cream flex items-center justify-center">
      <BookLoader />
    </div>
  );
}
