'use client';

import { useState, useEffect } from 'react';

const CAPTURE_TIPS = [
  { icon: '💡', text: 'Good lighting helps OCR accuracy' },
  { icon: '📐', text: 'Align page edges with the frame' },
  { icon: '✋', text: 'Hold steady before tapping' },
  { icon: '📖', text: 'Flatten the page to reduce shadows' },
  { icon: '🔄', text: 'Capture left page, then right page' },
];

interface CaptureOverlayProps {
  showTips?: boolean;
}

export default function CaptureOverlay({ showTips = true }: CaptureOverlayProps) {
  const [tipIndex, setTipIndex] = useState(0);

  // Rotate tips every 5 seconds
  useEffect(() => {
    if (!showTips) return;

    const interval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % CAPTURE_TIPS.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [showTips]);

  const currentTip = CAPTURE_TIPS[tipIndex];

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Semi-transparent overlay with clear center */}
      <svg className="absolute inset-0 w-full h-full">
        <defs>
          <mask id="frame-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x="10%"
              y="10%"
              width="80%"
              height="80%"
              rx="8"
              fill="black"
            />
          </mask>
        </defs>

        {/* Dark overlay with cutout */}
        <rect
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.5)"
          mask="url(#frame-mask)"
        />

        {/* Frame border */}
        <rect
          x="10%"
          y="10%"
          width="80%"
          height="80%"
          rx="8"
          fill="none"
          stroke="rgba(255, 255, 255, 0.8)"
          strokeWidth="3"
        />

        {/* Corner accents */}
        {/* Top-left */}
        <path
          d="M 10% 15% L 10% 10% L 15% 10%"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="4"
          strokeLinecap="round"
          style={{ transform: 'translate(0, 0)' }}
        />
        {/* Top-right */}
        <path
          d="M 85% 10% L 90% 10% L 90% 15%"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Bottom-left */}
        <path
          d="M 10% 85% L 10% 90% L 15% 90%"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Bottom-right */}
        <path
          d="M 85% 90% L 90% 90% L 90% 85%"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>

      {/* Tip at bottom of frame */}
      {showTips && (
        <div className="absolute bottom-[12%] left-1/2 -translate-x-1/2">
          <div
            className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-full text-white text-sm flex items-center gap-2 transition-opacity duration-300"
            key={tipIndex}
          >
            <span>{currentTip.icon}</span>
            <span>{currentTip.text}</span>
          </div>
        </div>
      )}
    </div>
  );
}
