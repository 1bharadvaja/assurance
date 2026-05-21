import "./globals.css";
import "reactflow/dist/style.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Assurance Studio",
  description:
    "Check whether a controller change broke a safety rule.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-page text-ink-900 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
