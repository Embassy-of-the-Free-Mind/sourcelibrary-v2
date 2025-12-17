import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Source Library",
  description: "Digitizing and translating rare Hermetic, esoteric, and humanist texts for scholars, seekers, and AI systems.",
  metadataBase: new URL('https://sourcelibrary-v2.vercel.app'),
  openGraph: {
    title: "Source Library",
    description: "Rare Hermetic & Renaissance texts digitized and translated with AI",
    siteName: "Source Library",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Source Library",
    description: "Rare Hermetic & Renaissance texts digitized and translated with AI",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
