'use client';

import { Section } from '@/lib/types';
import { BookOpen, X } from 'lucide-react';

interface ReadingSidebarProps {
  sections: Section[];
  currentSectionIndex: number;
  onSectionSelect: (index: number) => void;
  isOpen: boolean;
  onClose: () => void;
}

export default function ReadingSidebar({
  sections,
  currentSectionIndex,
  onSectionSelect,
  isOpen,
  onClose,
}: ReadingSidebarProps) {
  if (sections.length === 0) {
    return null;
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar - slides from bottom on mobile, from left on desktop */}
      <aside
        className={`
          fixed z-40 bg-white
          lg:relative lg:inset-auto lg:w-72 lg:border-r lg:border-stone-200

          /* Mobile: bottom sheet */
          inset-x-0 bottom-0
          rounded-t-2xl lg:rounded-none
          max-h-[70vh] lg:max-h-none

          transform transition-transform duration-300 ease-in-out
          ${isOpen
            ? 'translate-y-0 lg:translate-x-0'
            : 'translate-y-full lg:-translate-x-full lg:hidden'
          }

          flex flex-col
          safe-area-inset-bottom
        `}
      >
        {/* Mobile drag handle */}
        <div className="lg:hidden flex justify-center py-2">
          <div className="w-12 h-1.5 bg-stone-300 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
          <div className="flex items-center gap-2 text-stone-700">
            <BookOpen className="w-5 h-5" />
            <span className="font-medium">Contents</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-stone-100 active:bg-stone-200 lg:hidden"
            aria-label="Close contents"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sections list */}
        <nav className="flex-1 overflow-y-auto py-2 overscroll-contain">
          {sections.map((section, index) => {
            const isActive = index === currentSectionIndex;
            const pageRange = section.startPage === section.endPage
              ? `Page ${section.startPage}`
              : `Pages ${section.startPage}–${section.endPage}`;

            return (
              <button
                key={section.id}
                onClick={() => {
                  onSectionSelect(index);
                  onClose();
                }}
                className={`
                  w-full text-left px-4 py-4 sm:py-3
                  border-l-4 transition-colors
                  min-h-[56px] sm:min-h-0
                  ${isActive
                    ? 'border-amber-500 bg-amber-50 text-amber-900'
                    : 'border-transparent hover:bg-stone-50 active:bg-stone-100 text-stone-700'
                  }
                `}
              >
                <div className="font-medium text-sm sm:text-sm line-clamp-2">
                  {section.title}
                </div>
                <div className="text-xs text-stone-500 mt-1 sm:mt-0.5">
                  {pageRange}
                </div>
              </button>
            );
          })}
        </nav>

        {/* Footer info */}
        <div className="px-4 py-3 border-t border-stone-200 text-xs text-stone-500">
          {sections.length} section{sections.length !== 1 ? 's' : ''}
        </div>
      </aside>
    </>
  );
}
