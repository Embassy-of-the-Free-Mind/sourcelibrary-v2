import type { ReactNode } from 'react';
import { Alegreya_Sans, Alegreya_Sans_SC, Bungee } from 'next/font/google';
import './worksheets.css';

// Ts'íib type (~/mayan/design-system): Bungee for the one title, Alegreya Sans for text, its small caps for labels.
const display = Bungee({ weight: '400', subsets: ['latin'], variable: '--ts-display', display: 'swap' });
const sans = Alegreya_Sans({ weight: ['400', '500', '700'], subsets: ['latin'], variable: '--ts-sans', display: 'swap' });
const label = Alegreya_Sans_SC({ weight: '700', subsets: ['latin'], variable: '--ts-label', display: 'swap' });

export default function WorksheetsLayout({ children }: { children: ReactNode }) {
  return <div className={`ts-root ${display.variable} ${sans.variable} ${label.variable}`}>{children}</div>;
}
