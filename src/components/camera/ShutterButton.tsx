'use client';

import { Camera } from 'lucide-react';

interface ShutterButtonProps {
  onCapture: () => void;
  disabled?: boolean;
}

export default function ShutterButton({ onCapture, disabled }: ShutterButtonProps) {
  return (
    <button
      onClick={onCapture}
      disabled={disabled}
      className={`
        w-[72px] h-[72px] rounded-full
        bg-white border-4 border-white/50
        flex items-center justify-center
        transition-transform duration-100 ease-out
        active:scale-[0.92]
        disabled:opacity-50 disabled:cursor-not-allowed
        shadow-lg
      `}
      aria-label="Capture page"
    >
      <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
        <Camera className="w-8 h-8 text-stone-700" />
      </div>
    </button>
  );
}
