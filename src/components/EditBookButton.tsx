'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import BookEditModal from './BookEditModal';
import { useRouter } from 'next/navigation';

interface EditBookButtonProps {
  book: {
    id: string;
    title?: string;
    display_title?: string;
    author?: string;
    language?: string;
    published?: string;
    place_published?: string;
    publisher?: string;
    ustc_id?: string;
  };
}

export default function EditBookButton({ book }: EditBookButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const router = useRouter();

  const handleSave = () => {
    router.refresh();
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-stone-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-sm"
        title="Edit book metadata"
      >
        <Pencil className="w-4 h-4" />
        Edit
      </button>

      {showModal && (
        <BookEditModal
          book={book}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        />
      )}
    </>
  );
}
