import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Bhutanese Buddhist Digital Library',
  description: 'Over 1,300 manuscripts from Bhutanese monasteries and temples — Gangtey, Drametse, Ogyen Choling, Thadrak, Neyphug, Phurdrup, Tshamdrak. Digitized by the British Library Endangered Archives Programme.',
  robots: { index: true, follow: true },
};

/**
 * Bhutan tenant catalogue — redirects to search filtered by bhutan library.
 */
export default function BhutanCataloguePage() {
  redirect('/search?library=bhutan');
}
