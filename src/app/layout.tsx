import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wordly Editor",
  description: "Local project store for manuscript and reference records",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            Wordly Editor
          </Link>
          <span className="note">Local only (127.0.0.1)</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
