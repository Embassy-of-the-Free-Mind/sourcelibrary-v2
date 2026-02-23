import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "@/lib/store";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Astrologuy - Lunar Calendar & Moon Phases",
  description: "Interactive 13-month lunar calendar with real-time moon phases, Chinese zodiac, and eclipse forecasts. All calculations run in your browser.",
  keywords: ["lunar calendar", "moon phases", "13 month calendar", "Chinese zodiac", "eclipse", "astronomy"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-bg-dark text-cream">
        <AppProvider>
          <Nav />
          <main className="min-h-[calc(100vh-8rem)]">{children}</main>
          <Footer />
        </AppProvider>
      </body>
    </html>
  );
}
