import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "@/lib/store";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Astrologuy - The Calendar You Never Knew You Were Missing",
  description: "An interactive essay on the moon, the month, and the year that should have been. Discover why 13 months of 28 days makes more sense than the calendar we use.",
  keywords: ["lunar calendar", "13 month calendar", "moon phases", "interactive essay", "Chinese zodiac", "Metonic cycle", "astronomy"],
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
