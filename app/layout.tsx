import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DEMO } from "@/lib/demo-shared";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Inventory",
  description: "Track everything you own, what you're selling, and what it's worth.",
  appleWebApp: { capable: true, title: "Inventory", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        {DEMO && (
          <div className="bg-accent px-4 pt-[max(0.375rem,env(safe-area-inset-top))] pb-1.5 text-center text-xs font-medium text-accent-fg">
            Demo with made-up data. Your changes are private to this browser and reset after a day.
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
