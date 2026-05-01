import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hub Portal",
  description: "Точка входа портфолио",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="portal-root">{children}</body>
    </html>
  );
}
