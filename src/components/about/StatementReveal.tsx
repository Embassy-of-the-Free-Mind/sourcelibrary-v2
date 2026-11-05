'use client';

import { Fragment } from 'react';
import { useInView } from './useInView';
import { useReducedMotion } from './useReducedMotion';

/** A large sentence whose words rise in one after another when it arrives. */
export default function StatementReveal({ text, className = '' }: { text: string; className?: string }) {
  const [ref, inView] = useInView<HTMLParagraphElement>(0.5);
  const still = useReducedMotion();
  const on = still || inView;
  const words = text.split(' ');
  return (
    <p ref={ref} className={className} aria-label={text}>
      {words.map((w, k) => (
        <Fragment key={k}>
          <span aria-hidden="true" className="inline-block overflow-hidden align-bottom pb-[0.08em]">
            <span
              className="inline-block"
              style={{
                transform: on ? 'none' : 'translateY(105%)',
                transition: still ? 'none' : `transform .9s cubic-bezier(.2,.7,.2,1) ${on ? 150 + k * 55 : 0}ms`,
              }}
            >
              {w}
            </span>
          </span>
          {k < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </p>
  );
}
