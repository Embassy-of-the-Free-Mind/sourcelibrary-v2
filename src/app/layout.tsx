import type { Metadata } from "next";
import "./globals.css";
import GlobalFooter from "@/components/GlobalFooter";
import Providers from "@/components/Providers";
import { Analytics } from "@vercel/analytics/next";

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
      <body className="antialiased min-h-screen flex flex-col">
        <Providers>
          <div className="flex-1">
            {children}
          </div>
          <GlobalFooter />
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
