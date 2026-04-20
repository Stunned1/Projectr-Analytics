import type { Metadata } from "next";
import { Martel_Sans, Geist_Mono, DM_Mono } from "next/font/google";
import "./globals.css";

const martelSans = Martel_Sans({
  variable: "--font-martel-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Scout",
  description: "ZIP-level real estate market intelligence and mapping.",
  icons: {
    icon: "/scout.png",
    shortcut: "/scout.png",
    apple: "/scout.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${martelSans.variable} ${geistMono.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
