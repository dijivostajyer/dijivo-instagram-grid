import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Dijivo Instagram Grid Preview",
  description:
    "Dijivo için dahili Instagram profil grid önizleme aracı (MVP).",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
