import InputWidget from '@/components/InputWidget';

export const metadata = {
  title: 'Support Source Library | Help Preserve Ancient Wisdom',
  description: 'Your donation funds the digitization and translation of rare Hermetic texts from the Bibliotheca Philosophica Hermetica.',
  alternates: {
    canonical: '/support',
  },
};

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* Feedback widget — dormant on the real prod host; activate anywhere with ?getinput */}
      <InputWidget allowedHosts={['localhost', 'vercel.app']} />
    </>
  );
}
