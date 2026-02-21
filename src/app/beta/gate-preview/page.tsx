'use client';

import { useState } from 'react';
import BetaGateModal from '@/components/beta/BetaGateModal';

export default function GatePreviewPage() {
  const [showModal, setShowModal] = useState(true);
  const [lastEmail, setLastEmail] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8" style={{ background: 'var(--bg-cream, #fdfcf9)' }}>
      <div className="text-center mb-8">
        <h1
          className="text-3xl mb-2"
          style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary, #1a1612)', fontWeight: 500 }}
        >
          Gate Preview
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted, #6b6560)' }}>
          Preview the email gate modal without clearing localStorage.
        </p>
        {lastEmail && (
          <p className="text-sm mt-2" style={{ color: 'var(--accent-rust, #9e4a3a)' }}>
            Last submitted: {lastEmail}
          </p>
        )}
      </div>

      <button
        onClick={() => setShowModal(true)}
        className="px-6 py-3 rounded-lg font-medium text-sm transition-all"
        style={{
          background: 'var(--accent-rust, #9e4a3a)',
          color: '#ffffff',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
        onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
        onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
      >
        Show Gate Modal
      </button>

      {showModal && (
        <BetaGateModal
          onSuccess={(email) => {
            setLastEmail(email);
            setShowModal(false);
          }}
          onDismiss={() => setShowModal(false)}
          bookCount={1247}
        />
      )}
    </div>
  );
}
