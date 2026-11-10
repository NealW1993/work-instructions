import type { Metadata } from "next";
import localFont from "next/font/local";

import { Providers } from "@/components/providers";

import "./globals.css";

const headingFont = localFont({
  src: "./fonts/SpaceGrotesk-Variable.ttf",
  weight: "300 700",
  variable: "--font-heading",
  display: "swap",
});

const bodyFont = localFont({
  src: [
    { path: "./fonts/SourceSans3-Variable.ttf", weight: "200 900", style: "normal" },
    { path: "./fonts/SourceSans3-Italic-Variable.ttf", weight: "200 900", style: "italic" },
  ],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Work Instructions",
  description: "Internal work instructions platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${headingFont.variable} ${bodyFont.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
