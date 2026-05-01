import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hello Lab",
  description: "Тестовый микропроект портфолио",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="hl-m-0 hl-min-h-screen hl-bg-slate-950 hl-text-slate-100 hl-antialiased">
        {children}
      </body>
    </html>
  );
}
