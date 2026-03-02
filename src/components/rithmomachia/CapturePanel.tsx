// Capture options panel — shown when captures are available after a move

import { CaptureOption } from '@/lib/rithmomachia/types';

interface CapturePanelProps {
  options: CaptureOption[];
  onCapture: (index: number) => void;
  onSkip: () => void;
}

const METHOD_LABELS: Record<string, string> = {
  equality: 'Equality',
  addition: 'Addition',
  subtraction: 'Subtraction',
  multiplication: 'Multiplication',
  division: 'Division',
  siege: 'Siege',
};

export default function CapturePanel({ options, onCapture, onSkip }: CapturePanelProps) {
  if (options.length === 0) return null;

  return (
    <div className="bg-accent-gold/10 border border-accent-gold/30 rounded-lg p-4 mt-4">
      <div className="font-medium text-sm mb-3">Capture available</div>
      <div className="space-y-2">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => onCapture(i)}
            className="w-full text-left px-3 py-2 bg-white border border-border-light rounded-lg hover:border-accent-gold transition-colors text-sm"
          >
            <span className="font-medium text-accent-gold-dark">{METHOD_LABELS[opt.method]}</span>
            <span className="text-muted ml-2">{opt.description}</span>
          </button>
        ))}
      </div>
      <button
        onClick={onSkip}
        className="mt-2 text-sm text-muted hover:text-secondary transition-colors"
      >
        Skip capture
      </button>
    </div>
  );
}
