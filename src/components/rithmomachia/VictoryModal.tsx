// Victory announcement modal

import { VictoryCondition, GameMode, Difficulty } from '@/lib/rithmomachia/types';

interface VictoryModalProps {
  victory: VictoryCondition;
  onNewGame: (mode: GameMode, difficulty: Difficulty) => void;
  onClose: () => void;
  mode: GameMode;
  difficulty: Difficulty;
}

export default function VictoryModal({ victory, onNewGame, onClose, mode, difficulty }: VictoryModalProps) {
  const isPhilosophical = ['arithmetic', 'geometric', 'harmonic'].includes(victory.type);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-cream rounded-xl border border-border-light shadow-2xl max-w-md w-full p-8 text-center">
        <div className="font-serif text-3xl text-primary mb-2">
          {isPhilosophical ? 'Philosophical Victory!' : 'Victory!'}
        </div>

        <div className="text-secondary mb-6 font-body leading-relaxed">
          {victory.description}
        </div>

        {isPhilosophical && (
          <div className="bg-accent-violet/10 rounded-lg p-4 mb-6 text-sm text-secondary italic font-body">
            &ldquo;In those numbers all the harmonies are contained.&rdquo;
            <div className="text-xs text-muted mt-1 not-italic">
              &mdash;{' '}
              <a
                href="https://sourcelibrary.org/book/the-game-of-chess-gustavus-selenus?page=536"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-rust hover:underline"
              >
                Selenus, 1616, p. 536
              </a>
            </div>
          </div>
        )}

        <div className="flex gap-3 justify-center">
          <button
            onClick={() => onNewGame(mode, difficulty)}
            className="px-5 py-2.5 bg-accent-rust text-white rounded-lg font-medium hover:bg-accent-rust/90 transition-colors"
          >
            Play Again
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 border border-border-light rounded-lg hover:bg-warm transition-colors"
          >
            Review Board
          </button>
        </div>
      </div>
    </div>
  );
}
