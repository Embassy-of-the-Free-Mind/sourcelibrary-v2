'use client';

import { useState, useEffect } from 'react';

interface RotatingTextProps {
  words?: string[];
  interval?: number;
  className?: string;
}

export default function RotatingText({
  words = ['Loading', 'Preparing', 'Curating', 'Gathering'],
  interval = 2000,
  className = '',
}: RotatingTextProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % words.length);
        setIsAnimating(false);
      }, 300);
    }, interval);

    return () => clearInterval(timer);
  }, [words.length, interval]);

  return (
    <span className={`inline-block overflow-hidden ${className}`}>
      <span
        className={`inline-block transition-all duration-300 ease-out ${
          isAnimating
            ? 'opacity-0 translate-y-4 blur-sm'
            : 'opacity-100 translate-y-0 blur-0'
        }`}
      >
        {words[currentIndex]}
      </span>
      <span className="animate-pulse">...</span>
    </span>
  );
}
