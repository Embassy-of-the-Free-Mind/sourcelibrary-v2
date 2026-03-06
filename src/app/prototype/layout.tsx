import InputWidget from '@/components/InputWidget';

export default function PrototypeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <InputWidget allowedHosts={["localhost", "vercel.app", "sourcelibrary.org"]} />
    </>
  );
}
