// Interactive tutorial overlay for Rithmomachia

'use client';

import { useState, useCallback } from 'react';
import { TUTORIAL_STEPS, getSectionLabel } from '@/lib/rithmomachia/tutorial';

interface TutorialOverlayProps {
  onClose: () => void;
}

const SECTION_ICONS: Record<string, string> = {
  intro: '\u265E', // chess knight
  movement: '\u2192', // arrow
  capture: '\u2694', // crossed swords
  victory: '\u2605', // star
};

export default function TutorialOverlay({ onClose }: TutorialOverlayProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const step = TUTORIAL_STEPS[currentStep];
  const total = TUTORIAL_STEPS.length;

  const goNext = useCallback(() => {
    if (currentStep < total - 1) setCurrentStep(s => s + 1);
  }, [currentStep, total]);

  const goPrev = useCallback(() => {
    if (currentStep > 0) setCurrentStep(s => s - 1);
  }, [currentStep]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      goNext();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goPrev();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [goNext, goPrev, onClose]);

  // Group steps by section for the progress indicator
  const sections = ['intro', 'movement', 'capture', 'victory'] as const;
  const sectionRanges = sections.map(sec => {
    const first = TUTORIAL_STEPS.findIndex(s => s.section === sec);
    const last = TUTORIAL_STEPS.length - 1 - [...TUTORIAL_STEPS].reverse().findIndex(s => s.section === sec);
    return { section: sec, first, last };
  });

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="dialog"
      aria-label="Rithmomachia tutorial"
    >
      <div className="bg-cream rounded-xl border border-border-light shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Section indicator */}
        <div className="flex border-b border-border-light">
          {sectionRanges.map(({ section, first, last }) => {
            const isActive = currentStep >= first && currentStep <= last;
            const isPast = currentStep > last;
            return (
              <button
                key={section}
                onClick={() => setCurrentStep(first)}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-accent-rust/10 text-accent-rust border-b-2 border-accent-rust'
                    : isPast
                    ? 'text-secondary hover:bg-warm'
                    : 'text-muted hover:bg-warm'
                }`}
              >
                <span className="mr-1">{SECTION_ICONS[section]}</span>
                {getSectionLabel(section)}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="p-6 md:p-8">
          <div className="text-xs text-muted mb-2">
            {currentStep + 1} of {total}
          </div>

          <h2 className="font-serif text-2xl text-primary mb-4">
            {step.title}
          </h2>

          <p className="text-secondary font-body leading-relaxed text-base">
            {step.text}
          </p>
        </div>

        {/* Progress bar */}
        <div className="px-6 md:px-8">
          <div className="h-1 bg-border-light rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-rust rounded-full transition-all duration-300"
              style={{ width: `${((currentStep + 1) / total) * 100}%` }}
            />
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between p-6 md:p-8 pt-4">
          <button
            onClick={goPrev}
            disabled={currentStep === 0}
            className="px-4 py-2 text-sm border border-border-light rounded-lg hover:bg-warm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Previous
          </button>

          <button
            onClick={onClose}
            className="text-sm text-muted hover:text-secondary transition-colors"
          >
            Skip tutorial
          </button>

          {currentStep < total - 1 ? (
            <button
              onClick={goNext}
              className="px-4 py-2 text-sm bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 transition-colors"
            >
              Next
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 transition-colors"
            >
              Start Playing
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
