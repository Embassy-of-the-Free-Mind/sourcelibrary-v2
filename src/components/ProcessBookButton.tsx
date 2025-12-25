'use client';

import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import ProcessBookWizard from './ProcessBookWizard';
import type { Page } from '@/lib/types';

interface ProcessBookButtonProps {
  bookId: string;
  bookTitle: string;
  pages: Page[];
}

export default function ProcessBookButton({ bookId, bookTitle, pages }: ProcessBookButtonProps) {
  const [showWizard, setShowWizard] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowWizard(true)}
        className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
      >
        <Wand2 className="w-4 h-4" />
        Process
      </button>

      {showWizard && (
        <ProcessBookWizard
          bookId={bookId}
          bookTitle={bookTitle}
          pages={pages}
          onClose={() => setShowWizard(false)}
        />
      )}
    </>
  );
}
