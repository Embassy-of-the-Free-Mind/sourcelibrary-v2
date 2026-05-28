import { BookLoader } from '@/components/ui/BookLoader';

export default function ArtistLoading() {
  return (
    <div className="min-h-screen bg-stone-900 flex items-center justify-center">
      <BookLoader size="lg" variant="dark" />
    </div>
  );
}
