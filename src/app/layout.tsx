import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display, Noto_Serif_SC } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-playfair",
});
const notoSerifSC = Noto_Serif_SC({
  weight: ["400", "700"],
  variable: "--font-noto-serif-sc",
  preload: false,
});

export const metadata: Metadata = {
  title: "job.pro — campus recruiting from your terminal",
  description:
    "Search Chinese big-tech campus jobs from Claude Code or your terminal. Tencent live. ByteDance, Alibaba coming.",
  metadataBase: new URL("https://job.ha7ch.com"),
  openGraph: {
    title: "job.pro",
    description:
      "Search Chinese big-tech campus jobs from Claude Code or your terminal.",
    url: "https://job.ha7ch.com",
    siteName: "job.pro",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "job.pro",
    description:
      "Search Chinese big-tech campus jobs from Claude Code or your terminal.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${playfair.variable} ${notoSerifSC.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
