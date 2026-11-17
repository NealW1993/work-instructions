import type { Metadata } from "next";
import localFont from "next/font/local";

import { Providers } from "@/components/providers";

import "./globals.css";

// One typeface for headings and text: Source Sans 3 reads clearly on shop-floor screens and in print.
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
      <body className={`${bodyFont.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
