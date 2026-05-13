import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "job.pro — campus recruiting from your terminal",
  description:
    "Query Chinese big-tech campus recruiting from your terminal. No signup, no token, no proxy.",
  metadataBase: new URL("https://job.ha7ch.com"),
  openGraph: {
    title: "job.pro",
    description:
      "Query Chinese big-tech campus recruiting from your terminal — npx job-pro@latest tencent search 后台开发",
    url: "https://job.ha7ch.com",
    siteName: "job.pro",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
